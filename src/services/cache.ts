/**
 * KV API 響應緩存層
 * 緩存公開 GET 請求的響應，減少 D1 查詢壓力
 *
 * 緩存策略:
 *   - 僅緩存 GET 請求
 *   - 不緩存管理接口 (/api/v1/admin/*)
 *   - 不緩存錯誤響應 (code !== 0)
 *   - 內容列表 TTL: 300s (5 分鐘)
 *   - 配置/站點信息 TTL: 3600s (1 小時)
 *
 * 免費額度控制: KV 免費 100,000 讀/天
 *   假設日均 100 萬請求，緩存命中率 80% → KV 讀取 100 萬次/天（超免費額度）
 *   建議: 對熱點接口啟用緩存，非熱點接口不緩存
 */
import type { KVNamespace } from '@cloudflare/workers-types';

/** 默認緩存 TTL (5 分鐘) */
const DEFAULT_TTL = 300;

/** 配置數據緩存 TTL (1 小時) */
const CONFIG_TTL = 3600;

/**
 * 生成緩存鍵
 * 格式: api:{method}:{path}:{query}
 */
export function cacheKey(method: string, path: string, query: string): string {
  return `api:${method}:${path}:${query}`;
}

/**
 * 讀取緩存的 JSON 數據
 */
export async function getCached<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    const cached = await kv.get(key, 'json');
    return cached as T | null;
  } catch {
    return null;
  }
}

/**
 * 寫入緩存
 */
export async function setCached(
  kv: KVNamespace,
  key: string,
  data: unknown,
  ttl: number,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
  } catch {
    // KV 寫入失敗不影響主流程
  }
}

/**
 * 按前綴清除緩存
 * 注意: KV 的 list 操作有最終一致性，可能有少量殘留
 */
export async function clearCacheByPrefix(kv: KVNamespace, prefix: string): Promise<void> {
  try {
    const list = await kv.list({ prefix });
    const keys = list.keys.map((k) => k.name);
    if (keys.length > 0) {
      await Promise.all(keys.map((k) => kv.delete(k)));
    }
  } catch {
    // 清除失敗不影響主流程
  }
}

/**
 * 清除內容相關緩存
 * 在文章創建/更新/刪除時調用
 */
export async function clearContentCache(kv: KVNamespace): Promise<void> {
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/contents');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/sorts');
}

/**
 * 清除配置相關緩存
 * 在系統配置/站點信息更新時調用
 */
export async function clearConfigCache(kv: KVNamespace): Promise<void> {
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/site');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/nav');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/singles');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/links');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/slides');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/tags');
  await clearCacheByPrefix(kv, 'api:GET:/api/v1/labels');
}

/**
 * Hono API 緩存中間件
 * 僅緩存公開 GET 請求，跳過管理接口和錯誤響應
 *
 * @param ttl - 緩存有效期（秒），默認 300s
 * @param enabled - 是否啟用緩存（可用於條件啟用）
 */
export function apiCache(ttl: number = DEFAULT_TTL, enabled: boolean = true) {
  return async (
    c: {
      env: { API_CACHE: KVNamespace };
      req: { method: string; url: string; header: (n: string) => string | null };
      header: (n: string, v: string) => void;
      res: () => unknown;
    },
    next: () => Promise<void>,
  ): Promise<void | Response> => {
    if (!enabled) {
      await next();
      return;
    }

    // 僅緩存 GET 請求
    if (c.req.method !== 'GET') {
      await next();
      return;
    }

    const url = new URL(c.req.url);
    const path = url.pathname;

    // 不緩存管理接口
    if (path.startsWith('/api/v1/admin')) {
      await next();
      return;
    }

    // 不緩存帶 no-cache 頭的請求
    const cacheControl = c.req.header('Cache-Control');
    if (cacheControl && cacheControl.includes('no-cache')) {
      await next();
      return;
    }

    // 僅緩存 API 路徑
    if (!path.startsWith('/api/v1/')) {
      await next();
      return;
    }

    const key = cacheKey('GET', path, url.search);

    // 嘗試讀取緩存
    const cached = await getCached<{ body: unknown; status: number }>(c.env.API_CACHE, key);
    if (cached) {
      c.header('X-Cache', 'HIT');
      return new Response(JSON.stringify(cached.body), {
        status: cached.status,
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }

    // 緩存未命中，執行後續中間件/路由
    await next();

    // 獲取響應並嘗試緩存
    // 注意: Hono 的中間件模式中，next() 後無法直接獲取 response body
    // 此中間件主要用於標記緩存狀態，實際緩存邏輯在各路由處理函數中調用
    c.header('X-Cache', 'MISS');
  };
}

/** 根據路徑自動判斷 TTL */
export function getTtlByPath(path: string): number {
  // 配置類數據緩存 1 小時
  if (
    path.includes('/site') ||
    path.includes('/nav') ||
    path.includes('/singles') ||
    path.includes('/links') ||
    path.includes('/slides') ||
    path.includes('/tags') ||
    path.includes('/labels')
  ) {
    return CONFIG_TTL;
  }
  // 內容列表緩存 5 分鐘
  return DEFAULT_TTL;
}
