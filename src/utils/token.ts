/**
 * Access Token 管理模块
 * 支持钉钉 API 和 OAPI 的 Token 获取和缓存
 */

import axios from 'axios';
import type { DingtalkConfig } from '../types/index.ts';

// ============ 常量 ============

export const DINGTALK_API = 'https://api.dingtalk.com';
export const DINGTALK_OAPI = 'https://oapi.dingtalk.com';

// ============ Access Token 缓存 ============

type CachedToken = {
  token: string;
  expiryMs: number;
};

/**
 * 按 clientId 分桶缓存，避免多账号串 token。
 */
const apiTokenCache = new Map<string, CachedToken>();
const oapiTokenCache = new Map<string, CachedToken>();

function cacheKey(config: DingtalkConfig): string {
  // clientId 可能来自多账号合并配置，理论上必填；这里做兜底避免 Map key 为 undefined
  return String((config as any)?.clientId ?? '').trim();
}

/**
 * 获取钉钉 Access Token（新版 API）
 */
export async function getAccessToken(config: DingtalkConfig): Promise<string> {
  const now = Date.now();
  const key = cacheKey(config);
  const cached = apiTokenCache.get(key);
  if (cached && cached.expiryMs > now + 60_000) {
    return cached.token;
  }

  const response = await axios.post(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  const token = response.data.accessToken as string;
  const expireInSec = Number(response.data.expireIn ?? 0);
  apiTokenCache.set(key, {
    token,
    expiryMs: now + expireInSec * 1000,
  });
  return token;
}

/**
 * 获取钉钉 OAPI Access Token（旧版 API，用于媒体上传等）
 */
export async function getOapiAccessToken(config: DingtalkConfig): Promise<string | null> {
  try {
    const now = Date.now();
    const key = cacheKey(config);
    const cached = oapiTokenCache.get(key);
    if (cached && cached.expiryMs > now + 60_000) {
      return cached.token;
    }

    const resp = await axios.get(`${DINGTALK_OAPI}/gettoken`, {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });

    if (resp.data?.errcode === 0 && resp.data?.access_token) {
      const token = String(resp.data.access_token);
      // 钉钉返回 expires_in（秒），拿不到就按 2 小时兜底
      const expiresInSec = Number(resp.data.expires_in ?? 7200);
      oapiTokenCache.set(key, { token, expiryMs: now + expiresInSec * 1000 });
      return token;
    }
    return null;
  } catch {
    return null;
  }
}
