/**
 * Rate Limiting 中間件服務
 * 使用 Cloudflare 原生 Rate Limiting bindings，零網絡開銷
 *
 * 綁定配置 (wrangler.jsonc):
 *   PUBLIC_API_LIMIT  - 公開 API (60 req/min per IP)
 *   ADMIN_API_LIMIT   - 管理 API (300 req/min per user)
 *   LOGIN_LIMIT       - 登錄接口 (5 req/min per IP)
 *   FORM_LIMIT        - 表單提交 (1 req/10s per IP)
 */
import type { RateLimit } from '@cloudflare/workers-types';

/** 統一錯誤響應構建 */
function rateLimitResponse() {
  return new Response(
    JSON.stringify({ code: -1, msg: '請求過於頻繁，請稍後再試' }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    },
  );
}

/** 從請求中獲取客戶端 IP */
function getClientIp(c: { req: { header: (n: string) => string | null } }): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown';
}

/**
 * 通用速率限制中間件工廠
 * @param bindingName - Env 上的 RateLimit 綁定名
 * @param keyFn - 從上下文提取唯一標識的函數
 */
export function createRateLimiter<T extends Record<string, unknown>>(
  bindingName: keyof T,
  keyFn: (c: { req: { header: (n: string) => string | null }; get?: (k: string) => unknown }) => string,
) {
  return async (
    c: {
      env: T;
      req: { header: (n: string) => string | null };
      get?: (k: string) => unknown;
      header: (n: string, v: string) => void;
    },
    next: () => Promise<void>,
  ): Promise<void | Response> => {
    const limiter = c.env[bindingName] as unknown as RateLimit | undefined;
    if (!limiter) {
      // 綁定未配置，跳過限流
      await next();
      return;
    }
    const key = keyFn(c);
    const { success } = await limiter.limit({ key });
    if (!success) {
      c.header('X-RateLimit-Limit', 'exceeded');
      return rateLimitResponse();
    }
    await next();
  };
}

/**
 * 公開 API 速率限制 (60 req/min per IP)
 * 適用於: /api/v1/contents, /api/v1/sorts, /api/v1/site 等公開接口
 */
export function publicRateLimit() {
  return createRateLimiter<{ PUBLIC_API_LIMIT: RateLimit }>('PUBLIC_API_LIMIT', (c) => {
    const ip = getClientIp(c);
    return `public:${ip}`;
  });
}

/**
 * 管理 API 速率限制 (300 req/min per user)
 * 適用於: /api/v1/admin/* 需認證接口
 */
export function adminRateLimit() {
  return createRateLimiter<{ ADMIN_API_LIMIT: RateLimit }>('ADMIN_API_LIMIT', (c) => {
    // 優先使用已登錄用戶的 uid
    const user = c.get?.('user') as { uid?: number } | undefined;
    if (user?.uid) return `admin:${user.uid}`;
    // 未登錄時用 IP
    const ip = getClientIp(c);
    return `admin:${ip}`;
  });
}

/**
 * 登錄接口速率限制 (5 req/min per IP)
 * 防止暴力破解密碼
 */
export function loginRateLimit() {
  return createRateLimiter<{ LOGIN_LIMIT: RateLimit }>('LOGIN_LIMIT', (c) => {
    const ip = getClientIp(c);
    return `login:${ip}`;
  });
}

/**
 * 表單/留言提交速率限制 (1 req/10s per IP)
 * 防止垃圾留言和表單轟炸
 */
export function formRateLimit() {
  return createRateLimiter<{ FORM_LIMIT: RateLimit }>('FORM_LIMIT', (c) => {
    const ip = getClientIp(c);
    return `form:${ip}`;
  });
}
