/**
 * 配置服務 - KV 緩存 + D1 回退
 * KV key: config:all (JSON map)
 */
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { okData, ok, err } from '../utils/response';

const CONFIG_CACHE_KEY = 'config:all';

/** 從 KV 緩存讀取配置,未命中時回退 D1 查詢後寫入 KV */
export async function getAllConfigs(
  db: D1Database,
  kv: KVNamespace,
): Promise<Record<string, string>> {
  // 先嘗試從 KV 讀取
  const cached = await kv.get(CONFIG_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { /* KV 數據損壞,回退 D1 */ }
  }

  // KV 未命中,查詢 D1
  const result = await db.prepare('SELECT name, value FROM ay_config').all<{ name: string; value: string }>();
  const map: Record<string, string> = {};
  for (const row of result.results) {
    map[row.name] = row.value;
  }

  // 寫入 KV 緩存
  await kv.put(CONFIG_CACHE_KEY, JSON.stringify(map));

  return map;
}

/** 獲取單個配置項 */
export async function getConfig(
  db: D1Database,
  kv: KVNamespace,
  name: string,
  defaultValue = '',
): Promise<string> {
  const configs = await getAllConfigs(db, kv);
  return configs[name] ?? defaultValue;
}

/** 清除配置緩存 */
export async function clearConfigCache(kv: KVNamespace): Promise<void> {
  await kv.delete(CONFIG_CACHE_KEY);
}

/** 獲取站點信息 */
export async function getSiteInfo(db: D1Database): Promise<Record<string, unknown> | null> {
  const stmt = db.prepare('SELECT * FROM ay_site LIMIT 1');
  return await stmt.first();
}

/** 獲取所有配置 (API 響應) */
export async function handleListConfigs(
  db: D1Database,
  kv: KVNamespace,
): Promise<Response> {
  // 觸發緩存預熱
  await getAllConfigs(db, kv);
  const result = await db.prepare('SELECT * FROM ay_config ORDER BY sorting ASC').all();
  return okData(result.results, '成功');
}

/** 修改配置 */
export async function handleUpdateConfig(
  db: D1Database,
  kv: KVNamespace,
  body: { configs?: Array<{ name?: string; value?: string }> },
): Promise<Response> {
  const configs = body.configs;
  if (!Array.isArray(configs)) {
    return err('缺少 configs 參數');
  }

  for (const item of configs) {
    if (item.name !== undefined && item.value !== undefined) {
      await db.prepare('UPDATE ay_config SET value = ? WHERE name = ?')
        .bind(item.value, item.name)
        .run();
    }
  }

  // 清除配置緩存
  await clearConfigCache(kv);

  return ok('配置更新成功');
}
