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
}

/** D1 配置緩存（單次請求內） */
let d1FlagCache: Record<string, string> | null = null;

/** 從 D1 讀取所有開關值 */
async function loadFlagsFromD1(db: D1Database): Promise<Record<string, string>> {
  if (d1FlagCache) return d1FlagCache;
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
  d1FlagCache = map;
  return map;
}

/** 重置 D1 緩存（測試用） */
export function resetFlagCache(): void {
  d1FlagCache = null;
}

/**
 * 獲取單個開關狀態（統一入口）
 * 始終使用 D1 存儲，支持後台直接切換（無需 Cloudflare Dashboard）
 * 值為 '0' = 關閉，其他 = 開啟
 */
export async function getFlagEnabled(env: FlagReadEnv, key: string): Promise<boolean> {
  const def = findFlagDef(key);
  if (!def) return true; // 未註冊的開關默認開啟

  // 始終從 D1 讀取（支持後台直接管理）
  const d1Flags = await loadFlagsFromD1(env.DB);
  const val = d1Flags[key];
  if (val === undefined) return def.defaultValue;
  return val !== '0';
}

/**
 * 批量獲取所有開關狀態（供 API 返回）
 */
export async function getAllFlags(env: FlagReadEnv): Promise<
  Array<{ key: string; label: string; description: string; icon: string; enabled: boolean; managedBy: 'flagship' | 'database' }>
> {
  const managedBy: 'flagship' | 'database' = 'database';
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
    const enabled = await getFlagEnabled(c.env as FlagReadEnv, flagKey);
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
    for (const def of FLAG_REGISTRY) {
      if (!def.protectedRoutes) continue;
      for (const route of def.protectedRoutes) {
        // 精確匹配或前綴匹配（route + /*）
        if (path === route || path.startsWith(route + '/') || path.startsWith(route + '?')) {
          const enabled = await getFlagEnabled(c.env as FlagReadEnv, def.key);
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
 * 切換開關（後台直接管理，寫入 D1）
 * @returns { success, error? }
 */
export async function setFlagEnabled(
  env: FlagReadEnv & { CONFIG_CACHE: import('@cloudflare/workers-types').KVNamespace },
  key: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  const def = findFlagDef(key);
  if (!def) return { success: false, error: '無效的功能開關 key' };

  // 先 UPDATE，無行則 INSERT（name 無 UNIQUE 約束）
  const updateResult = await env.DB.prepare('UPDATE ay_config SET value = ? WHERE name = ?')
    .bind(enabled ? '1' : '0', key)
    .run();

  if (!updateResult.meta.changes || updateResult.meta.changes === 0) {
    await env.DB.prepare('INSERT INTO ay_config (name, value, type, sorting, description) VALUES (?, ?, ?, ?, ?)')
      .bind(key, enabled ? '1' : '0', '1', 55, def.label + '總開關')
      .run();
  }

  // 重置緩存
  resetFlagCache();

  return { success: true };
}
