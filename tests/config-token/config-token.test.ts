import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('config & token helpers', () => {
  const baseCfg = {
    channels: {
      'dingtalk-connector': {
        clientId: 'id-1',
        clientSecret: 'secret-1',
      },
    },
  } as any;

  beforeEach(() => {
    // token helpers 在模块级别缓存 token，这里重置模块避免用例之间互相污染
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('getConfig / isConfigured', () => {
    it('should extract dingtalk-connector config from ClawdbotConfig', async () => {
      const { __testables } = await import('../../test');
      const { getConfig } = __testables as any;
      const cfg = getConfig(baseCfg);
      expect(cfg).toEqual(baseCfg.channels['dingtalk-connector']);
    });

    it('should return empty object when channel not configured', async () => {
      const { __testables } = await import('../../test');
      const { getConfig } = __testables as any;
      const cfg = getConfig({ channels: {} } as any);
      expect(cfg).toEqual({});
    });

    it('should return empty object when cfg is undefined or empty', async () => {
      const { __testables } = await import('../../test');
      const { getConfig } = __testables as any;
      expect(getConfig(undefined as any)).toEqual({});
      expect(getConfig({} as any)).toEqual({});
    });

    it('should consider config valid only when clientId and clientSecret exist', async () => {
      const { __testables } = await import('../../test');
      const { isConfigured } = __testables as any;
      expect(isConfigured(baseCfg)).toBe(true);
      expect(isConfigured({ channels: {} } as any)).toBe(false);
      expect(
        isConfigured({
          channels: { 'dingtalk-connector': { clientId: 'id-only' } },
        } as any),
      ).toBe(false);
      expect(
        isConfigured({
          channels: { 'dingtalk-connector': { clientSecret: 'secret-only' } },
        } as any),
      ).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should request new token and cache it', async () => {
      const { __testables } = await import('../../test');
      const { getAccessToken } = __testables as any;
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      (axios.post as any).mockResolvedValue({
        data: {
          accessToken: 'token-1',
          expireIn: 3600,
        },
      });

      const token1 = await getAccessToken(baseCfg.channels['dingtalk-connector']);
      const token2 = await getAccessToken(baseCfg.channels['dingtalk-connector']);

      expect(token1).toBe('token-1');
      expect(token2).toBe('token-1');
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOapiAccessToken', () => {
    it('should return token when oapi returns success', async () => {
      const { __testables } = await import('../../test');
      const { getOapiAccessToken } = __testables as any;
      (axios.get as any).mockResolvedValue({
        data: {
          errcode: 0,
          access_token: 'oapi-token',
        },
      });

      const token = await getOapiAccessToken(baseCfg.channels['dingtalk-connector']);
      expect(token).toBe('oapi-token');
    });

    it('should return null when oapi returns error', async () => {
      const { __testables } = await import('../../test');
      const { getOapiAccessToken } = __testables as any;
      (axios.get as any).mockResolvedValue({
        data: {
          errcode: 123,
        },
      });

      const token = await getOapiAccessToken(baseCfg.channels['dingtalk-connector']);
      expect(token).toBeNull();
    });

    it('should return null when axios.get throws', async () => {
      const { __testables } = await import('../../test');
      const { getOapiAccessToken } = __testables as any;
      (axios.get as any).mockRejectedValue(new Error('network error'));
      const token = await getOapiAccessToken(baseCfg.channels['dingtalk-connector']);
      expect(token).toBeNull();
    });
  });

  describe('getUnionId', () => {
    it('should call oapi once and then use cache', async () => {
      const { __testables } = await import('../../test');
      const { getUnionId } = __testables as any;
      const log = {
        info: vi.fn(),
        error: vi.fn(),
      };

      // 根据 URL 分支模拟 gettoken 与 user/get 两种调用
      (axios.get as any).mockImplementation((url: string) => {
        if (url.includes('gettoken')) {
          return Promise.resolve({
            data: {
              errcode: 0,
              access_token: 'oapi-token',
            },
          });
        }
        if (url.includes('/user/get')) {
          return Promise.resolve({
            data: {
              unionid: 'union-1',
            },
          });
        }
        return Promise.reject(new Error('unexpected url'));
      });

      const cfg = baseCfg.channels['dingtalk-connector'];

      const u1 = await getUnionId('staff-1', cfg, log);
      const u2 = await getUnionId('staff-1', cfg, log);

      expect(u1).toBe('union-1');
      expect(u2).toBe('union-1');
      // 第一次：gettoken + user/get，两次 HTTP 调用；第二次命中缓存不再访问网络
      expect((axios.get as any).mock.calls.length).toBe(2);
      expect(log.info).toHaveBeenCalled();
    });
  });
});

