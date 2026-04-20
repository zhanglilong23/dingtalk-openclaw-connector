/**
 * Dynamic Agent Creation for DingTalk DM users
 *
 * Ported from feishu connector's dynamic-agent.ts.
 * When enabled, automatically creates a dedicated agent instance with its own
 * workspace, agentDir, and binding for each first-time DM user.
 *
 * Configuration (channels.dingtalk-connector.dynamicAgentCreation):
 *   - enabled: boolean          — master switch
 *   - workspaceTemplate: string — per-user workspace path (default: ~/.openclaw/workspace-{agentId})
 *   - agentDirTemplate: string  — per-user agent config dir (default: ~/.openclaw/agents/{agentId}/agent)
 *   - maxAgents: number         — cap on total "dingtalk-" prefixed agents (optional)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { DynamicAgentCreationConfig } from "./types/index.ts";

export type MaybeCreateDynamicAgentResult = {
  created: boolean;
  updatedCfg: ClawdbotConfig;
  agentId?: string;
};

/**
 * Check if a dynamic agent should be created for a DM user and create it if needed.
 * This creates a unique agent instance with its own workspace for each DM user.
 */
export async function maybeCreateDynamicAgent(params: {
  cfg: ClawdbotConfig;
  runtime: PluginRuntime;
  senderId: string;
  dynamicCfg: DynamicAgentCreationConfig;
  accountId?: string;
  log: (msg: string) => void;
}): Promise<MaybeCreateDynamicAgentResult> {
  const { cfg, runtime, senderId, dynamicCfg, accountId, log } = params;

  // Check if there's already a binding for this user
  const existingBindings = cfg.bindings ?? [];
  const hasBinding = existingBindings.some(
    (b: any) =>
      b.match?.channel === "dingtalk-connector" &&
      (!accountId || b.match?.accountId === accountId) &&
      b.match?.peer?.kind === "direct" &&
      b.match?.peer?.id === senderId,
  );

  if (hasBinding) {
    return { created: false, updatedCfg: cfg };
  }

  // Check maxAgents limit if configured
  if (dynamicCfg.maxAgents !== undefined) {
    const dingtalkAgentCount = (cfg.agents?.list ?? []).filter((a: any) =>
      a.id.startsWith("dingtalk-"),
    ).length;
    if (dingtalkAgentCount >= dynamicCfg.maxAgents) {
      log(
        `dingtalk: maxAgents limit (${dynamicCfg.maxAgents}) reached, not creating agent for ${senderId}`,
      );
      return { created: false, updatedCfg: cfg };
    }
  }

  // Generate agent ID from sender's staffId
  const agentId = `dingtalk-${senderId}`;

  // Check if agent already exists (but binding was missing — orphan recovery)
  const existingAgent = (cfg.agents?.list ?? []).find(
    (a: any) => a.id === agentId,
  );
  if (existingAgent) {
    // Agent exists but binding doesn't — just add the binding
    log(
      `dingtalk: agent "${agentId}" exists, adding missing binding for ${senderId}`,
    );

    const updatedCfg: ClawdbotConfig = {
      ...cfg,
      bindings: [
        ...existingBindings,
        {
          agentId,
          match: {
            channel: "dingtalk-connector",
            ...(accountId ? { accountId } : {}),
            peer: { kind: "direct", id: senderId },
          },
        },
      ],
    };

    await runtime.config.writeConfigFile(updatedCfg);
    return { created: true, updatedCfg, agentId };
  }

  // Resolve path templates with substitutions
  const workspaceTemplate =
    dynamicCfg.workspaceTemplate ?? "~/.openclaw/workspace-{agentId}";
  const agentDirTemplate =
    dynamicCfg.agentDirTemplate ?? "~/.openclaw/agents/{agentId}/agent";

  const workspace = resolveUserPath(
    workspaceTemplate
      .replace("{userId}", senderId)
      .replace("{agentId}", agentId),
  );
  const agentDir = resolveUserPath(
    agentDirTemplate
      .replace("{userId}", senderId)
      .replace("{agentId}", agentId),
  );

  log(`dingtalk: creating dynamic agent "${agentId}" for user ${senderId}`);
  log(`  workspace: ${workspace}`);
  log(`  agentDir: ${agentDir}`);

  // Create directories
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  // Update configuration with new agent and binding
  const updatedCfg: ClawdbotConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: [...(cfg.agents?.list ?? []), { id: agentId, workspace, agentDir }],
    },
    bindings: [
      ...existingBindings,
      {
        agentId,
        match: {
          channel: "dingtalk-connector",
          ...(accountId ? { accountId } : {}),
          peer: { kind: "direct", id: senderId },
        },
      },
    ],
  };

  // Write updated config using PluginRuntime API
  await runtime.config.writeConfigFile(updatedCfg);

  return { created: true, updatedCfg, agentId };
}

/**
 * Resolve a path that may start with ~ to the user's home directory.
 */
function resolveUserPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
