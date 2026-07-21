/**
 * 標準化功能開關服務 (Feature Flag Service)
 *
 * 設計原則：
 *   1. 註冊表驅動 — 新增大功能只需在 FLAG_REGISTRY 註冊一條
 *   2. 混合模式 — Flagship 已配置讀 Flagship，否則 D1 回退
 *   3. 後端攔截 — 中間件直接攔截被關閉功能的 API 端點 (404)
 *   4. 前端聯動 — GET /admin/flags 返回完整註冊表供前端組件化控制
 *
 * 使用方式：
 *   // 註冊新功能開關
 *   FLAG_REGISTRY.push({ key: 'search_enabled', label: '語義搜索', ... })
 *
 *   // 後端中間件攔截
 *   app.use('/api/v1/search/*', featureFlagMiddleware('search_enabled'))
 *
 *   // 業務邏輯中檢查
 *   if (await getFlagEnabled(env, 'search_enabled')) { ... }
 *
 *   // 前端組件化
 *   <FeatureGate flagKey="mail_enabled">...</FeatureGate>
 */
import type { D1Database, Flagship } from '@cloudflare/workers-types';
import type { Context, MiddlewareHandler } from 'hono';
import { ok, okData, err } from '../utils/response';

// ============================================================================
// 功能開關註冊表
// ============================================================================

export interface FlagDef {
  /** 開關 key（唯一標識） */
  key: string;
  /** 顯示名稱 */
  label: string;
  /** 描述說明 */
  description: string;
  /** emoji 圖標 */
  icon: string;
  /** 默認值（未配置時） */
  defaultValue: boolean;
  /** 受保護的 API 路由前綴（關閉時攔截） */
  protectedRoutes?: string[];
}

/**
 * 功能開關註冊表 — 新增大功能在這裡加一條即可
 * 前端、後端、API 攔截全部由這個表驅動
 */
export const FLAG_REGISTRY: FlagDef[] = [
  {
    key: 'mail_enabled',
    label: '郵件通知',
    description: '關閉後隱藏所有郵件相關配置，攔截郵件測試 API',
    icon: '📧',
    defaultValue: true,
    protectedRoutes: ['/api/v1/admin/notify/test-mail'],
  },
  {
    key: 'webhook_enabled',
    label: 'Webhook 通知',
    description: '關閉後隱藏所有 Webhook 相關配置，攔截 Webhook 測試 API',
    icon: '🪝',
    defaultValue: true,
    protectedRoutes: ['/api/v1/admin/notify/test-webhook'],
  },
  // 未來擴展示例：
  // {
  //   key: 'semantic_search_enabled',
  //   label: '語義搜索',
  //   description: '關閉後隱藏搜索功能，攔截搜索 API',
  //   icon: '🔍',
  //   defaultValue: true,
  //   protectedRoutes: ['/api/v1/search'],
  // },
];

/** 按 key 查找定義 */
export function findFlagDef(key: string): FlagDef | undefined {
  return FLAG_REGISTRY.find((f) => f.key === key);
}

// ============================================================================
// 開關狀態讀取（混合模式：Flagship + D1 回退）
// ============================================================================

interface FlagReadEnv {
  DB: D1Database;
  'Flagship-service'?: Flagship;
  siteId?: string;
}

/** D1 配置緩存（按站點隔離，單次請求內有效） */
const d1FlagCache = new Map<string, Record<string, string>>();

/** 從 D1 讀取所有開關值（按站點隔離緩存） */
async function loadFlagsFromD1(db: D1Database, siteId: string): Promise<Record<string, string>> {
  const cacheKey = siteId || 'default';
  const cached = d1FlagCache.get(cacheKey);
  if (cached) return cached;
  const placeholders = FLAG_REGISTRY.map(() => '?').join(', ');
  const keys = FLAG_REGISTRY.map((f) => f.key);
  const result = await db
    .prepare(`SELECT name, value FROM ay_config WHERE name IN (${placeholders})`)
    .bind(...keys)
    .all<{ name: string; value: string }>();
  const map: Record<string, string> = {};
  for (const row of result.results) {
    map[row.name] = row.value;
  }
  d1FlagCache.set(cacheKey, map);
  return map;
}

/** 重置 D1 緩存（可指定站點，未指定則清除全部） */
export function resetFlagCache(siteId?: string): void {
  if (siteId) {
    d1FlagCache.delete(siteId || 'default');
  } else {
    d1FlagCache.clear();
  }
}

/**
 * 獲取單個開關狀態（統一入口）
 * 混合模式：Flagship 優先（如已配置綁定），D1 回退
 * - Flagship 模式：由 Cloudflare Dashboard 管理，只讀
 * - D1 回退模式：由後台設置頁直接切換
 * 值為 '0' = 關閉，其他 = 開啟
 */
export async function getFlagEnabled(env: FlagReadEnv, key: string): Promise<boolean> {
  const def = findFlagDef(key);
  if (!def) return true; // 未註冊的開關默認開啟

  const siteId = env.siteId || 'default';

  // 混合模式：Flagship 優先
  const flagship = env['Flagship-service'];
  if (flagship) {
    try {
      return await flagship.getBooleanValue(key, def.defaultValue);
    } catch {
      // Flagship 評估失敗，回退到 D1
    }
  }

  // D1 回退
  const d1Flags = await loadFlagsFromD1(env.DB, siteId);
  const val = d1Flags[key];
  if (val === undefined) return def.defaultValue;
  return val !== '0';
}

/**
 * 批量獲取所有開關狀態（供 API 返回）
 * managedBy 反映當前使用的是 Flagship 還是 D1 回退
 */
export async function getAllFlags(env: FlagReadEnv): Promise<
  Array<{ key: string; label: string; description: string; icon: string; enabled: boolean; managedBy: 'flagship' | 'database' }>
> {
  const managedBy: 'flagship' | 'database' = env['Flagship-service'] ? 'flagship' : 'database';
  const results = await Promise.all(
    FLAG_REGISTRY.map(async (def) => ({
      key: def.key,
      label: def.label,
      description: def.description,
      icon: def.icon,
      enabled: await getFlagEnabled(env, def.key),
      managedBy,
    })),
  );
  return results;
}

// ============================================================================
// 中間件：API 攔截
// ============================================================================

/**
 * 功能開關中間件 — 關閉時返回 404
 * 用法：app.use('/api/v1/search/*', featureFlagMiddleware('semantic_search_enabled'))
 */
export function featureFlagMiddleware(flagKey: string): MiddlewareHandler {
  return async (c, next) => {
    // 多站點：優先使用站點庫，回退到主庫
    const siteDb = (c.get('siteDb') as D1Database | undefined) ?? c.env.DB;
    const siteId = (c.get('siteId') as string | undefined) ?? 'default';
    const flagEnv = { ...c.env, DB: siteDb, siteId } as FlagReadEnv;
    const enabled = await getFlagEnabled(flagEnv, flagKey);
    if (!enabled) {
      return err('此功能已關閉', 1004);
    }
    await next();
  };
}

/**
 * 路由保護中間件 — 自動匹配註冊表中的 protectedRoutes
 * 在 index.ts 的路由註冊前調用：app.use('*', autoRouteProtection())
 */
export function autoRouteProtection(): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    // 多站點：優先使用站點庫，回退到主庫
    const siteDb = (c.get('siteDb') as D1Database | undefined) ?? c.env.DB;
    const siteId = (c.get('siteId') as string | undefined) ?? 'default';
    const flagEnv = { ...c.env, DB: siteDb, siteId } as FlagReadEnv;
    for (const def of FLAG_REGISTRY) {
      if (!def.protectedRoutes) continue;
      for (const route of def.protectedRoutes) {
        // 精確匹配或前綴匹配（route + /*）
        if (path === route || path.startsWith(route + '/') || path.startsWith(route + '?')) {
          const enabled = await getFlagEnabled(flagEnv, def.key);
          if (!enabled) {
            return err(`${def.label}功能已關閉`, 1004);
          }
        }
      }
    }
    await next();
  };
}

// ============================================================================
// 配置寫入（僅 D1 回退模式）
// ============================================================================

/**
 * 切換開關（D1 回退模式，後台直接管理）
 * 注意：Flagship 模式下為只讀，此操作僅在 D1 回退模式生效
 * @returns { success, error? }
 */
export async function setFlagEnabled(
  env: FlagReadEnv & { CONFIG_CACHE: import('@cloudflare/workers-types').KVNamespace },
  key: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  const def = findFlagDef(key);
  if (!def) return { success: false, error: '無效的功能開關 key' };

  // Flagship 模式下只讀，拒絕寫入
  if (env['Flagship-service']) {
    return { success: false, error: 'Flagship 模式下開關為只讀，請在 Cloudflare Dashboard 管理' };
  }

  const siteId = env.siteId || 'default';

  // 先 UPDATE，無行則 INSERT（name 無 UNIQUE 約束）
  const updateResult = await env.DB.prepare('UPDATE ay_config SET value = ? WHERE name = ?')
    .bind(enabled ? '1' : '0', key)
    .run();

  if (!updateResult.meta.changes || updateResult.meta.changes === 0) {
    await env.DB.prepare('INSERT INTO ay_config (name, value, type, sorting, description) VALUES (?, ?, ?, ?, ?)')
      .bind(key, enabled ? '1' : '0', '1', 55, def.label + '總開關')
      .run();
  }

  // 重置該站點的緩存
  resetFlagCache(siteId);

  return { success: true };
}
