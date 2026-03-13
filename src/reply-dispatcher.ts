import type {
  ClawdbotConfig,
  RuntimeEnv,
  ReplyPayload,
} from "openclaw/plugin-sdk";
import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
} from "openclaw/plugin-sdk";
import { resolveDingtalkAccount } from "./accounts.js";
import { getDingtalkRuntime } from "./runtime.js";
import {
  createAICardForTarget,
  streamAICard,
  finishAICard,
  type AICardTarget,
} from "./messaging.js";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  processFileMarkers,
  uploadMediaToDingTalk,
} from "./media.js";

export type CreateDingtalkReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  conversationId: string;
  senderId: string;
  isDirect: boolean;
  accountId?: string;
  messageCreateTimeMs?: number;
};

export function createDingtalkReplyDispatcher(params: CreateDingtalkReplyDispatcherParams) {
  const core = getDingtalkRuntime();
  const {
    cfg,
    agentId,
    conversationId,
    senderId,
    isDirect,
    accountId,
  } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  // AI Card 状态管理
  let currentCardTarget: AICardTarget | null = null;
  let accumulatedText = "";
  const deliveredFinalTexts = new Set<string>();

  // 打字指示器回调（钉钉暂不支持，预留接口）
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // 钉钉暂不支持打字指示器
    },
    stop: async () => {
      // 钉钉暂不支持打字指示器
    },
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "dingtalk-connector",
        action: "start",
        error: err,
      }),
    onStopError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "dingtalk-connector",
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(
    cfg,
    "dingtalk-connector",
    accountId,
    { fallbackLimit: 4000 }
  );
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "dingtalk-connector");

  // 流式 AI Card 支持
  const streamingEnabled = account.config?.streaming !== false;

  const startStreaming = async () => {
    if (!streamingEnabled || currentCardTarget) {
      return;
    }

    try {
      currentCardTarget = await createAICardForTarget({
        cfg,
        conversationId,
        senderId,
        isDirect,
        accountId: account.accountId,
      });
      accumulatedText = "";
    } catch (error) {
      params.runtime.error?.(
        `dingtalk[${account.accountId}]: streaming start failed: ${String(error)}`
      );
      currentCardTarget = null;
    }
  };

  const closeStreaming = async () => {
    if (!currentCardTarget) {
      return;
    }

    try {
      // 处理媒体标记
      let finalText = accumulatedText;
      
      // 处理本地图片
      const { text: textAfterImages, localPaths: imagePaths } = 
        await processLocalImages(finalText);
      finalText = textAfterImages;

      // 上传图片到钉钉
      if (imagePaths.length > 0) {
        for (const localPath of imagePaths) {
          try {
            const mediaId = await uploadMediaToDingTalk({
              cfg,
              localPath,
              accountId: account.accountId,
            });
            // 将 mediaId 添加到文本中（钉钉 AI Card 支持）
            finalText += `\n[image:${mediaId}]`;
          } catch (err) {
            params.runtime.error?.(
              `dingtalk[${account.accountId}]: upload image failed: ${String(err)}`
            );
          }
        }
      }

      // 处理视频、音频、文件标记
      finalText = await processVideoMarkers(finalText);
      finalText = await processAudioMarkers(finalText);
      finalText = await processFileMarkers(finalText);

      await finishAICard({
        cfg,
        target: currentCardTarget,
        text: finalText,
        accountId: account.accountId,
      });
    } catch (error) {
      params.runtime.error?.(
        `dingtalk[${account.accountId}]: streaming close failed: ${String(error)}`
      );
    } finally {
      currentCardTarget = null;
      accumulatedText = "";
    }
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        deliveredFinalTexts.clear();
        if (streamingEnabled) {
          void startStreaming();
        }
        void typingCallbacks.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info) => {
        const text = payload.text ?? "";
        const hasText = Boolean(text.trim());
        const skipTextForDuplicateFinal =
          info?.kind === "final" && hasText && deliveredFinalTexts.has(text);
        const shouldDeliverText = hasText && !skipTextForDuplicateFinal;

        if (!shouldDeliverText) {
          return;
        }

        // 流式模式：使用 AI Card
        if (info?.kind === "block" && streamingEnabled) {
          if (!currentCardTarget) {
            await startStreaming();
          }
          if (currentCardTarget) {
            accumulatedText += text;
            await streamAICard({
              cfg,
              target: currentCardTarget,
              text: accumulatedText,
              accountId: account.accountId,
            });
          }
          return;
        }

        if (info?.kind === "final" && streamingEnabled && currentCardTarget) {
          accumulatedText = text;
          await closeStreaming();
          deliveredFinalTexts.add(text);
          return;
        }

        // 非流式模式：直接发送消息
        // TODO: 实现非流式消息发送
        // 这里需要调用钉钉的普通消息发送 API
        params.runtime.log?.(
          `dingtalk[${account.accountId}]: non-streaming delivery not yet implemented`
        );
      },
      onError: async (error, info) => {
        params.runtime.error?.(
          `dingtalk[${account.accountId}] ${info.kind} reply failed: ${String(error)}`
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onCleanup: () => {
        typingCallbacks.onCleanup?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
      onPartialReply: streamingEnabled
        ? (payload: ReplyPayload) => {
            if (!payload.text) {
              return;
            }
            if (currentCardTarget) {
              accumulatedText = payload.text;
              void streamAICard({
                cfg,
                target: currentCardTarget,
                text: accumulatedText,
                accountId: account.accountId,
              });
            }
          }
        : undefined,
    },
    markDispatchIdle,
  };
}
