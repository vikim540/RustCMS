/**
 * Cloudflare CMS Worker - 主入口
 * 基於 PbootCMS 3.2.12 數據庫結構,純 API 後端
 *
 * 路由結構:
 *   /api/health              - 健康檢查
 *   /api/v1/auth/*           - 認證接口 (登錄/登出/個人信息)
 *   /api/v1/site             - 站點信息
 *   /api/v1/sorts            - 欄目樹
 *   /api/v1/nav              - 導航欄目
 *   /api/v1/sorts/:scode     - 欄目詳情
 *   /api/v1/contents         - 內容列表
 *   /api/v1/contents/:id     - 內容詳情
 *   /api/v1/admin/*          - 管理接口 (需 JWT)
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { D1Database, KVNamespace, Queue, VectorizeIndex, Ai, RateLimit, Flagship, SecretsStoreSecret } from '@cloudflare/workers-types';

import { extractToken, verifyJwt, type JwtClaims } from './utils/jwt';
import { isTokenBlacklisted, hasPermission, hasMenuPermission, reloadUserPermissions } from './services/auth';
import { ok, okData, err, forbidden } from './utils/response';
import { siteDB, primaryDB, currentSiteId, currentSiteName, resolveBinding, parseSiteRegistry, listRegisteredSites, D1RestClient, createD1Database } from './utils/sitedb';
import * as authService from './services/auth';
import * as configService from './services/config';
import * as sortService from './services/sort';
import * as contentService from './services/content';
import * as storageService from './services/storage';
import * as extraService from './services/extra';
import * as modelService from './services/model';
import * as systemService from './services/system';
import * as notifyService from './services/notify';
import * as siteService from './services/site';
import { loginRateLimit, formRateLimit, publicRateLimit, adminRateLimit } from './services/ratelimit';
import { clearContentCache, clearConfigCache } from './services/cache';
import * as vectorizeService from './services/vectorize';
import * as schedulerService from './services/scheduler';
import { getAllFlags, setFlagEnabled, autoRouteProtection } from './services/flags';
import { nowStr, todayStr } from './utils/datetime';

/** Worker 環境綁定 */
export interface Env {
  DB: D1Database;                    // 主庫 endoscopy-cms（認證/用戶/角色/菜單/站點註冊表）
  DB_SMILE: D1Database;              // smile-cms 站點庫
  DB_VISION: D1Database;             // vision-cms 站點庫
  CONFIG_CACHE: KVNamespace;
  TOKEN_BLACKLIST: KVNamespace;
  API_CACHE: KVNamespace;
  JWT_SECRET_STORE: SecretsStoreSecret;    // Secrets Store 異步綁定（await .get() 獲取值）
  API_PREFIX: string;
  JWT_EXPIRE_DAYS: string;
  TZ: string;
  SITE_REGISTRY: string;             // 多站點註冊表 JSON（site_id → {binding, name, domain}）
  CF_ACCOUNT_ID: string;             // Cloudflare Account ID（D1 REST API 創建動態站點用）
  CF_API_TOKEN_STORE: SecretsStoreSecret;  // Cloudflare API Token（Secrets Store 異步綁定，D1 REST API 用）
  PUBLISH_QUEUE: Queue<{ articleId: number; action: string; scheduledAt: string; siteId?: string }>;
  ARTICLE_INDEX: VectorizeIndex;
  AI: Ai;
  PUBLIC_API_LIMIT: RateLimit;
  ADMIN_API_LIMIT: RateLimit;
  LOGIN_LIMIT: RateLimit;
  FORM_LIMIT: RateLimit;
  'Flagship-service'?: Flagship;
}

/** Hono 應用環境類型 (含 Bindings 和 Variables) */
type AppEnv = { Bindings: Env; Variables: { claims?: JwtClaims; siteDb?: D1Database; siteId?: string; siteName?: string } };

const app = new Hono<AppEnv>();

// ===== CORS 中間件 (動態域名校驗, 根據 api_cors_origins 配置) =====
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');

  // 從 KV 緩存讀取 CORS 配置
  let allowedOrigin = '*';
  let credentials = false;

  if (origin) {
    try {
      const cached = await c.env.CONFIG_CACHE.get('config:all');
      if (cached) {
        const configs = JSON.parse(cached) as Record<string, string>;
        const corsOrigins = configs.api_cors_origins || '';
        if (corsOrigins) {
          // 配置了 CORS 域名白名單, 檢查 Origin 是否允許
          const origins = corsOrigins
            .split(/[,，\n]/)
            .map((o) => o.trim())
            .filter(Boolean);
          if (origins.includes('*')) {
            allowedOrigin = '*';
          } else if (origins.includes(origin)) {
            allowedOrigin = origin;
            credentials = true;
          } else {
            // Origin 不在白名單中, 不設置 CORS 頭 (瀏覽器將拒絕跨域)
            if (c.req.method === 'OPTIONS') {
              return c.body(null, 204);
            }
            await next();
            return;
          }
        } else {
          // 未配置 CORS 域名, 允許所有
          allowedOrigin = '*';
        }
      }
    } catch {
      // 配置讀取失敗, 回退到允許所有
      allowedOrigin = '*';
    }
  }

  c.header('Access-Control-Allow-Origin', allowedOrigin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Site-Id');
  c.header('Access-Control-Max-Age', '86400');
  if (credentials) {
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});

// ===== 多站點上下文中間件（解析 X-Site-Id header → 路由到對應 D1 binding）=====
// 數據路由通過 siteDB(c) 獲取當前站點庫，認證/系統路由通過 primaryDB(c) 始終用主庫
// 未攜帶 X-Site-Id 或未知站點時，回退到主庫（endoscopy-cms）確保向後兼容
app.use('*', async (c, next) => {
  const siteId = c.req.header('X-Site-Id') || 'endoscopy';
  const registry = parseSiteRegistry(c.env.SITE_REGISTRY ?? '{}');
  const entry = registry[siteId];
  if (entry && entry.binding) {
    const envBindings = c.env as unknown as Record<string, D1Database>;
    const db = envBindings[entry.binding];
    if (db) {
      c.set('siteDb', db);
      c.set('siteId', siteId);
      c.set('siteName', entry.name);
    }
  }
  await next();
});

// ===== JWT 驗證中間件 =====
async function requireAuth(c: Context<AppEnv>): Promise<JwtClaims | null> {
  // 若已由認證中間件驗證, 直接返回緩存的 claims (避免重複驗證)
  const cached = c.get('claims');
  if (cached) return cached;

  const authHeader = c.req.header('Authorization');
  const token = extractToken(authHeader);
  if (!token) return null;

  const claims = await verifyJwt(token, await c.env.JWT_SECRET_STORE.get());
  if (!claims) return null;

  // 檢查黑名單
  const blacklisted = await isTokenBlacklisted(c.env.TOKEN_BLACKLIST, claims.jti);
  if (blacklisted) return null;

  return claims;
}

// ===== 菜單權限攔截中間件 =====

/** 模塊級緩存: 菜單 URL → mcode 映射 (避免每次請求查詢數據庫) */
let urlMcodeCache: Map<string, string> | null = null;

/**
 * 查詢數據庫中所有菜單的 URL → mcode 映射 (模塊級緩存)
 * 菜單變更後需調用 clearUrlMcodeCache() 清除緩存
 */
async function getUrlMcodeMap(db: D1Database): Promise<Map<string, string>> {
  if (urlMcodeCache) return urlMcodeCache;
  const result = await db
    .prepare("SELECT mcode, url FROM ay_menu WHERE url IS NOT NULL AND url != ''")
    .all<{ mcode: string; url: string }>();
  const map = new Map<string, string>();
  for (const row of result.results) {
    if (row.url) map.set(row.url, row.mcode);
  }
  urlMcodeCache = map;
  return map;
}

/** 清除 URL → mcode 緩存 (菜單 CRUD 後調用) */
function clearUrlMcodeCache(): void {
  urlMcodeCache = null;
}

/**
 * 菜單權限攔截中間件
 * 根據菜單 URL 查詢對應 mcode, 檢查 JWT claims.permissions 是否包含該 mcode
 * - 超級管理員跳過所有檢查
 * - 找不到 mcode 時放行 (避免誤攔)
 * - 未認證請求放行 (由 requireAuth 處理)
 *
 * @param menuUrl 菜單 URL (如 '/admin/system/user', '/admin/content/model')
 */
/**
 * 公開讀取端點白名單（供側邊欄/下拉選單使用，所有登錄用戶可訪問）
 * 這些端點只返回基礎引用數據，不涉及敏感操作，無需菜單權限
 */
const PUBLIC_READ_PATHS = new Set([
  '/api/v1/admin/models/all',  // 側邊欄動態模型項目（所有用戶需載入）
  '/api/v1/admin/menus',       // 權限選擇器菜單樹（角色管理頁需要）
  '/api/v1/admin/sorts/all',   // 下拉選單欄目列表（輕量級引用數據）
]);

function requireMenuPermission(menuUrl: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // 公開讀取端點跳過權限檢查（僅限 GET，供側邊欄/下拉選單使用）
    // POST/PUT/DELETE 仍需權限，防止非授權用戶創建/修改數據
    if (c.req.method === 'GET' && PUBLIC_READ_PATHS.has(c.req.path)) {
      return await next();
    }
    const claims = c.get('claims');
    if (!claims) return await next(); // 未認證由 requireAuth 處理
    if (claims.isSuper) return await next(); // 超級管理員跳過

    const map = await getUrlMcodeMap(primaryDB(c));
    const mcode = map.get(menuUrl);
    if (!mcode) return await next(); // 找不到 mcode 時放行 (避免誤攔)

    if (!hasMenuPermission(claims, mcode)) {
      return forbidden('無權限訪問此功能');
    }
    await next();
  };
}

/**
 * 僅超級管理員可訪問的中間件
 * 用於無對應菜單條目但需限制為超管專用的功能（如資料庫管理、存儲設置）
 */
function requireSuperAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const claims = c.get('claims');
    if (!claims) return await next(); // 未認證由 requireAuth 處理
    if (claims.isSuper) return await next(); // 超級管理員放行
    return forbidden('僅超級管理員可訪問此功能');
  };
}

// ===== 功能開關路由保護（必須在路由定義之前註冊）=====
// 攔截 FLAG_REGISTRY 中 protectedRoutes 定義的端點，開關關閉時返回 403
app.use('/api/v1/*', autoRouteProtection());

// ===== Workers Cache 中間件（聲明式邊緣緩存，2026 新功能）=====
// 為公開 GET 請求設置 Cache-Control 頭，配合 wrangler.jsonc 的 cache.enabled 實現邊緣緩存
// 管理接口（/api/v1/admin/*）因 Authorization 頭自動被 Workers Cache 繞過
// 多站點通過 Vary: X-Site-Id 實現緩存分區，防止跨站污染
app.use('/api/v1/*', async (c, next) => {
  await next();
  // 僅對公開 GET、成功響應設置緩存頭
  if (c.req.method === 'GET' && !c.req.path.startsWith('/api/v1/admin') && c.res.status === 200) {
    const path = c.req.path;
    // 搜索結果不緩存（實時性要求高）
    if (path.includes('/search')) return;
    // 配置類數據緩存 1 小時，其他公開數據 5 分鐘
    const ttl = (path.includes('/company') || path.includes('/site') || path.includes('/nav') || path.startsWith('/api/v1/sorts')) ? 3600 : 300;
    // 設置緩存頭 + Vary 實現多站點分區
    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=60`);
    headers.set('Vary', 'X-Site-Id');
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
  }
});

// ===== 健康檢查 =====
app.get('/api/health', (c) => {
  return okData({
    status: 'ok',
    version: '0.1.0',
    time: nowStr(),
  }, '健康');
});

// ===== 認證接口 =====
app.post('/api/v1/auth/login', loginRateLimit(), async (c) => {
  const body = await c.req.json();
  const loginIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || '';
  return authService.handleLogin(primaryDB(c), c.env.CONFIG_CACHE, await c.env.JWT_SECRET_STORE.get(), body, loginIp);
});

// 公開：獲取 Turnstile 配置（site key 是公開的，secret key 不返回）
app.get('/api/v1/auth/turnstile-config', async (c) => {
  const enabled = await configService.getConfig(primaryDB(c), c.env.CONFIG_CACHE, 'turnstile_enabled', '0');
  const siteKey = await configService.getConfig(primaryDB(c), c.env.CONFIG_CACHE, 'turnstile_site_key', '');
  return okData({ enabled: enabled === '1', siteKey }, '成功');
});

app.get('/api/v1/auth/profile', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權或 Token 已過期', 2002);
  return authService.handleProfile(primaryDB(c), claims);
});

app.post('/api/v1/auth/logout', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return authService.handleLogout(c.env.TOKEN_BLACKLIST, claims);
});

// ===== 前台公開接口 =====
app.get('/api/v1/site', async (c) => {
  const site = await configService.getSiteInfo(siteDB(c));
  if (!site) return err('站點信息未配置', 1004);
  return okData(site, '成功');
});

app.get('/api/v1/company', async (c) => {
  const company = await extraService.getPublicCompany(siteDB(c));
  return okData(company, '成功');
});

app.get('/api/v1/sorts', async (c) => sortService.handleSortTree(siteDB(c)));
app.get('/api/v1/nav', async (c) => sortService.handleNav(siteDB(c)));

app.get('/api/v1/sorts/:scode', async (c) => {
  const scode = c.req.param('scode');
  return sortService.handleSortDetail(siteDB(c), scode);
});

app.get('/api/v1/contents', publicRateLimit(), async (c) => {
  const params = new URL(c.req.url).searchParams;
  return contentService.handleListContents(siteDB(c), params);
});

app.get('/api/v1/contents/:id', async (c) => {
  const id = Number(c.req.param('id')) || 0;
  const track = c.req.query('track') === '1';
  return contentService.handleContentDetail(siteDB(c), id, track);
});

// ===== 前台公開接口 - 擴展模塊 =====
app.get('/api/v1/singles', async (c) => extraService.handleListSingles(siteDB(c)));

app.get('/api/v1/singles/:scode', async (c) => {
  const scode = c.req.param('scode');
  return extraService.handleSingleDetail(siteDB(c), scode);
});

app.get('/api/v1/links', async (c) => {
  const params = new URL(c.req.url).searchParams;
  return extraService.handleListLinks(siteDB(c), params);
});

app.get('/api/v1/slides', async (c) => {
  const params = new URL(c.req.url).searchParams;
  return extraService.handleListSlides(siteDB(c), params);
});

app.get('/api/v1/tags', async (c) => extraService.handleListTags(siteDB(c)));

app.post('/api/v1/messages', formRateLimit(), async (c) => {
  const body = await c.req.json();
  const userIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || '';
  const userAgent = c.req.header('User-Agent') || '';
  const sourceUrl = c.req.header('Referer') || c.req.header('Origin') || '';
  return extraService.handleSubmitMessage(siteDB(c), c.env.CONFIG_CACHE, c.executionCtx, c.env['Flagship-service'], userIp, userAgent, sourceUrl, body, currentSiteId(c));
});

// ===== 後台管理 - JWT 認證中間件 (設置 claims 到上下文供後續中間件使用) =====
// 在 requireMenuPermission 之前執行, 將驗證後的 claims 存入上下文
// 未認證請求不放行 (由各 handler 中的 requireAuth 返回 401)
// 非超管用戶每次請求重新加載權限，確保角色權限變更後即時生效（無需重新登錄）
// 多站點：非超管用戶只能訪問已分配的站點，否則返回 403
app.use('/api/v1/admin/*', async (c, next) => {
  const claims = await requireAuth(c);
  if (claims) {
    if (!claims.isSuper) {
      // 非超管用戶：從數據庫重新加載權限（解決 JWT 中權限過時的問題）
      const freshPerms = await reloadUserPermissions(primaryDB(c), Number(claims.sub));
      if (freshPerms === null) {
        // 用戶不存在或已禁用 → 返回 401，觸發前端登出
        return err('用戶已被禁用或不存在', 2006);
      }
      claims.permissions = freshPerms;

      // 多站點訪問權限檢查：非超管用戶只能訪問已分配的站點
      // 站點管理路由（/admin/sites）本身允許訪問（用戶需要查看自己的站點列表）
      const requestedSiteId = c.req.header('X-Site-Id') || 'endoscopy';
      const path = c.req.path;
      const isSiteMgmtRoute = path.startsWith('/api/v1/admin/sites') || path.startsWith('/api/v1/admin/users');
      if (!isSiteMgmtRoute) {
        const hasAccess = await siteService.checkSiteAccess(
          primaryDB(c), Number(claims.sub), requestedSiteId, false,
        );
        if (!hasAccess) {
          return forbidden('無權訪問此站點');
        }
      }
    }
    c.set('claims', claims);
  }
  await next();
});

// ===== 後台管理 - 操作日誌中間件 =====
// 自動記錄所有 admin POST/PUT/DELETE 操作到 ay_syslog
// 記錄內容操作、敏感數據變更、操作錯誤，使用 waitUntil 異步寫入
app.use('/api/v1/admin/*', async (c, next) => {
  await next();

  const method = c.req.method;
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return;

  const claims = c.get('claims');
  if (!claims) return;

  const url = new URL(c.req.url);
  const path = url.pathname;
  const userIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || '';
  const userAgent = c.req.header('User-Agent') || '';

  // 根據 URL 推斷操作類型和日誌級別
  let level = 'admin';
  let action = '';
  if (path.includes('/contents')) { level = 'content'; action = '內容管理'; }
  else if (path.includes('/sorts')) { level = 'content'; action = '欄目管理'; }
  else if (path.includes('/models')) { level = 'content'; action = '模型管理'; }
  else if (path.includes('/upload') || path.includes('/storage') || path.includes('/media')) { level = 'content'; action = '媒體存儲'; }
  else if (path.includes('/users')) { level = 'security'; action = '用戶管理'; }
  else if (path.includes('/roles')) { level = 'security'; action = '角色管理'; }
  else if (path.includes('/menus')) { level = 'security'; action = '菜單管理'; }
  else if (path.includes('/configs')) { level = 'security'; action = '系統配置'; }
  else if (path.includes('/flags')) { level = 'security'; action = '功能開關'; }
  else if (path.includes('/database')) { level = 'security'; action = '數據庫備份'; }

  // 檢查響應是否為錯誤
  let isError = false;
  let errorMsg = '';
  try {
    const res = c.res;
    if (res.ok) {
      const cloned = res.clone();
      const body = await cloned.json() as { code?: number; msg?: string };
      if (body.code && body.code !== 0) {
        isError = true;
        errorMsg = body.msg || `code=${body.code}`;
      }
    } else {
      isError = true;
      errorMsg = `HTTP ${res.status}`;
    }
  } catch { /* 響應非 JSON，忽略 */ }

  const finalLevel = isError ? 'error' : level;
  const event = `${method} ${path} - ${action}${isError ? ` 失敗: ${errorMsg}` : ''}`;

  c.executionCtx.waitUntil(
    systemService.logAction(primaryDB(c), claims.username, userIp, userAgent, event, finalLevel, path),
  );
});

// ===== 後台管理 - 菜單權限攔截中間件 =====
// 按菜單 URL 查詢 mcode, 檢查 JWT claims.permissions 是否包含該 mcode
// 超級管理員跳過; 找不到 mcode 時放行 (避免誤攔)
// 不攔截通用接口: /flags, /stats, /notify/*, /upload 等 (所有登錄用戶可用)
app.use('/api/v1/admin/users/*', requireMenuPermission('/admin/system/user'));
app.use('/api/v1/admin/roles/*', requireMenuPermission('/admin/system/role'));
app.use('/api/v1/admin/menus/*', requireMenuPermission('/admin/system/menu'));
app.use('/api/v1/admin/logs/*', requireMenuPermission('/admin/system/syslog'));
app.use('/api/v1/admin/database/*', requireSuperAdmin());
app.use('/api/v1/admin/storage/*', requireSuperAdmin());
app.use('/api/v1/admin/configs/*', requireMenuPermission('/admin/system/config'));
app.use('/api/v1/admin/models/*', requireMenuPermission('/admin/content/model'));
// 補齊: 內容管理及擴展內容路由的權限保護（防非授權用戶繞過前端直接調用 API）
// 回收站相關路由（trash, restore, permanent）使用 M208 權限，其他使用 M201
app.use('/api/v1/admin/contents/*', async (c, next) => {
  const path = c.req.path;
  // 回收站相關路由 → M208 回收站權限
  if (path.endsWith('/contents/trash') ||
      path.match(/\/contents\/\d+\/(restore|permanent)$/)) {
    return requireMenuPermission('/admin/content/trash')(c, next);
  }
  // 其他內容管理路由 → M201 文章列表權限
  return requireMenuPermission('/admin/content/index')(c, next);
});
app.use('/api/v1/admin/sorts/*', requireMenuPermission('/admin/content/sort'));         // M202 欄目管理
app.use('/api/v1/admin/singles/*', requireMenuPermission('/admin/content/single'));     // M203 單頁管理
app.use('/api/v1/admin/messages/*', requireMenuPermission('/admin/content/message'));   // M204 留言管理
app.use('/api/v1/admin/extfields/*', requireMenuPermission('/admin/content/extfield')); // M206 擴展字段
app.use('/api/v1/admin/media/*', requireMenuPermission('/admin/media'));                // M301 媒體庫
app.use('/api/v1/admin/links/*', requireMenuPermission('/admin/seo/link'));             // M401 友情連結
app.use('/api/v1/admin/slides/*', requireMenuPermission('/admin/seo/slide'));           // M402 幻燈片
app.use('/api/v1/admin/tags/*', requireMenuPermission('/admin/seo/tags'));              // M403 標籤管理
app.use('/api/v1/admin/labels/*', requireMenuPermission('/admin/seo/label'));           // M404 自定義標籤
app.use('/api/v1/admin/site/*', requireMenuPermission('/admin/system/site'));           // M501 站點信息
app.use('/api/v1/admin/company/*', requireMenuPermission('/admin/system/company'));     // M502 公司信息

// ===== 後台管理接口 - 內容管理 =====
app.get('/api/v1/admin/contents', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return contentService.handleAdminListContents(siteDB(c), params);
});

// 擴展字段定義 (根據欄目 scode 查詢) - 必須在 :id 路由之前
app.get('/api/v1/admin/contents/extfields', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const scode = c.req.query('scode') || '';
  return modelService.handleGetContentExtFields(siteDB(c), scode);
});

// 歷史標籤列表（供編輯器快速補充）- 必須在 :id 路由之前
app.get('/api/v1/admin/contents/all-tags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return contentService.handleAllContentTags(siteDB(c));
});

// 回收站列表 - 必須在 :id 路由之前
app.get('/api/v1/admin/contents/trash', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return modelService.handleListTrashedContents(siteDB(c), params);
});

// 後台內容詳情（無緩存、無 status 過濾、無訪問量追蹤）— 專供編輯頁面載入
app.get('/api/v1/admin/contents/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return contentService.handleAdminContentDetail(siteDB(c), id);
});

app.post('/api/v1/admin/contents', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const operator = claims.username || '';
  const result = await contentService.handleCreateContent(siteDB(c), body, currentSiteId(c), operator);
  // 清除內容緩存
  await clearContentCache(c.env.API_CACHE);
  return result;
});

app.put('/api/v1/admin/contents/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  const operator = claims.username || '';
  const result = await contentService.handleUpdateContent(siteDB(c), id, body, operator);
  // 清除內容緩存
  await clearContentCache(c.env.API_CACHE);
  return result;
});

app.delete('/api/v1/admin/contents/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const result = await contentService.handleDeleteContent(siteDB(c), id);
  // 清除內容緩存
  await clearContentCache(c.env.API_CACHE);
  return result;
});

// 獲取內容的擴展字段值
app.get('/api/v1/admin/contents/:id/ext', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleGetContentExt(siteDB(c), id);
});

// 從回收站恢復 (使用 modelService 版本, 包含 status 守衛)
app.post('/api/v1/admin/contents/:id/restore', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleRestoreContent(siteDB(c), id);
});

// 永久刪除 (使用 modelService 版本, 包含 status 守衛)
app.delete('/api/v1/admin/contents/:id/permanent', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handlePermanentDeleteContent(siteDB(c), id);
});

// ===== 後台管理接口 - 欄目管理 =====
app.get('/api/v1/admin/sorts', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const mcode = c.req.query('mcode') || undefined;
  return sortService.handleSortTreeAll(siteDB(c), mcode);
});

app.post('/api/v1/admin/sorts', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return sortService.handleCreateSort(siteDB(c), body, currentSiteId(c));
});

// ⚠️ batch-sorting 必須在 :id 路由之前註冊（Hono 路由順序約束）
app.put('/api/v1/admin/sorts/batch-sorting', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  return sortService.handleBatchUpdateSortSorting(siteDB(c), items);
});

app.put('/api/v1/admin/sorts/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return sortService.handleUpdateSort(siteDB(c), id, body);
});

app.delete('/api/v1/admin/sorts/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return sortService.handleDeleteSort(siteDB(c), id);
});

// ===== 後台管理接口 - 系統配置 =====
app.get('/api/v1/admin/configs', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return configService.handleListConfigs(siteDB(c), c.env.CONFIG_CACHE);
});

app.put('/api/v1/admin/configs', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const result = await configService.handleUpdateConfig(siteDB(c), c.env.CONFIG_CACHE, body);
  // 清除 API 響應緩存
  await clearConfigCache(c.env.API_CACHE);
  return result;
});

// ===== 後台管理接口 - 儀表板統計 =====
app.get('/api/v1/admin/stats', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);

  const db = siteDB(c);
  const today = todayStr();

  const [contentTotal, sortTotal, visitsTotal, todayNew] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM ay_content WHERE status >= '0'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM ay_content_sort").first<{ n: number }>(),
    db.prepare("SELECT COALESCE(SUM(visits), 0) as n FROM ay_content WHERE status = '1'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM ay_content WHERE status >= '0' AND date LIKE ?").bind(`${today}%`).first<{ n: number }>(),
  ]);

  return okData({
    contentTotal: contentTotal?.n ?? 0,
    sortTotal: sortTotal?.n ?? 0,
    visitsTotal: visitsTotal?.n ?? 0,
    todayNew: todayNew?.n ?? 0,
  }, '成功');
});

// ===== 後台管理接口 - 存儲管理 =====
app.get('/api/v1/admin/storage/config', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleGetStorageConfig(siteDB(c), c.env.CONFIG_CACHE);
});

app.put('/api/v1/admin/storage/config', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json<Record<string, string>>();
  return storageService.handleUpdateStorageConfig(siteDB(c), c.env.CONFIG_CACHE, body);
});

app.post('/api/v1/admin/storage/test', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleTestStorage(siteDB(c), c.env.CONFIG_CACHE);
});

app.post('/api/v1/admin/storage/upload', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleUpload(siteDB(c), c.env.CONFIG_CACHE, c.req.raw);
});

app.get('/api/v1/admin/storage/download/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  return storageService.handleDownload(siteDB(c), c.env.CONFIG_CACHE, key);
});

app.delete('/api/v1/admin/storage/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  return storageService.handleDelete(siteDB(c), c.env.CONFIG_CACHE, key);
});

app.get('/api/v1/admin/storage/presigned/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  const expires = parseInt(c.req.query('expires') || '3600', 10);
  return storageService.handlePresignedUrl(siteDB(c), c.env.CONFIG_CACHE, key, expires);
});

// ===== 後台管理接口 - 媒體庫 =====
app.get('/api/v1/admin/media', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return storageService.handleListMedia(siteDB(c), c.env.CONFIG_CACHE, params);
});

// 文件詳情 (含使用狀態和標記狀態)
app.get('/api/v1/admin/media/detail', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.query('key') || '';
  if (!key) return err('缺少 key 參數', 1001);
  return storageService.handleMediaDetail(siteDB(c), c.env.CONFIG_CACHE, key);
});

// 切換文件標記 (標記保護/取消標記)
app.post('/api/v1/admin/media/mark', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const key = body.key || '';
  if (!key) return err('缺少 key 參數', 1001);
  return storageService.handleToggleMediaMark(siteDB(c), key);
});

// 清理未使用的文件
app.post('/api/v1/admin/media/clean', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json().catch(() => ({}));
  const force = body.force === true || body.force === 1 || body.force === '1';
  return storageService.handleCleanUnused(siteDB(c), c.env.CONFIG_CACHE, force);
});

app.delete('/api/v1/admin/media/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  const force = c.req.query('force') === '1';
  return storageService.handleDeleteMedia(siteDB(c), c.env.CONFIG_CACHE, key, force);
});

// 通用上傳端點 (供編輯器圖片上傳使用)
app.post('/api/v1/admin/upload', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleUpload(siteDB(c), c.env.CONFIG_CACHE, c.req.raw);
});

// ===== 後台管理接口 - 單頁管理 =====
app.get('/api/v1/admin/singles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListSingles(siteDB(c), params);
});

app.get('/api/v1/admin/singles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleAdminGetSingle(siteDB(c), id);
});

app.post('/api/v1/admin/singles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateSingle(siteDB(c), body);
});

app.put('/api/v1/admin/singles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateSingle(siteDB(c), id, body);
});

app.delete('/api/v1/admin/singles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteSingle(siteDB(c), id);
});

// ===== 後台管理接口 - 友情連結 =====
app.get('/api/v1/admin/links', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListLinks(siteDB(c), params);
});

app.post('/api/v1/admin/links', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateLink(siteDB(c), body, currentSiteId(c));
});

app.put('/api/v1/admin/links/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateLink(siteDB(c), id, body);
});

app.delete('/api/v1/admin/links/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteLink(siteDB(c), id);
});

// ===== 後台管理接口 - 幻燈片 =====
app.get('/api/v1/admin/slides', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListSlides(siteDB(c), params);
});

app.post('/api/v1/admin/slides', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateSlide(siteDB(c), body, currentSiteId(c));
});

// ⚠️ batch-sorting 路由必須在 :id 路由之前，否則 "batch-sorting" 會被當作 :id 匹配
app.put('/api/v1/admin/slides/batch-sorting', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  return extraService.handleBatchUpdateSlideSorting(siteDB(c), items);
});

app.put('/api/v1/admin/slides/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateSlide(siteDB(c), id, body);
});

app.delete('/api/v1/admin/slides/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteSlide(siteDB(c), id);
});

// ===== 後台管理接口 - 標籤管理 =====
app.get('/api/v1/admin/tags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListTags(siteDB(c), params);
});

app.post('/api/v1/admin/tags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateTag(siteDB(c), body, currentSiteId(c));
});

app.put('/api/v1/admin/tags/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateTag(siteDB(c), id, body);
});

app.delete('/api/v1/admin/tags/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteTag(siteDB(c), id);
});

// ===== 後台管理接口 - 留言管理 =====
app.get('/api/v1/admin/messages', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListMessages(siteDB(c), params);
});

app.get('/api/v1/admin/messages/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleAdminGetMessage(siteDB(c), id);
});

app.put('/api/v1/admin/messages/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateMessage(siteDB(c), id, body);
});

app.delete('/api/v1/admin/messages/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteMessage(siteDB(c), id);
});

// ===== 後台管理接口 - 通知測試 =====
// 郵件發送測試
app.post('/api/v1/admin/notify/test-mail', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return notifyService.handleTestMail(siteDB(c), c.env.CONFIG_CACHE, body);
});

// Webhook 推送測試
app.post('/api/v1/admin/notify/test-webhook', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return notifyService.handleTestWebhook(siteDB(c), c.env.CONFIG_CACHE, body);
});

// 版本更新通知 — Dashboard 掛載時自動觸發（KV 去重，每版本只推送一次）
app.post('/api/v1/admin/notify/version-check', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return notifyService.handleVersionNotify(siteDB(c), c.env.CONFIG_CACHE, c.env['Flagship-service'], body, currentSiteId(c));
});

// ===== 後台管理接口 - 站點信息 =====
app.get('/api/v1/admin/site', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return extraService.handleAdminGetSite(siteDB(c));
});

app.put('/api/v1/admin/site', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleAdminUpdateSite(siteDB(c), body);
});

// ===== 後台管理接口 - 公司信息 =====
app.get('/api/v1/admin/company', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return extraService.handleAdminGetCompany(siteDB(c));
});

app.put('/api/v1/admin/company', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleAdminUpdateCompany(siteDB(c), body);
});

// ===== 後台管理接口 - 模型管理 =====
app.get('/api/v1/admin/models', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return modelService.handleListModels(siteDB(c), params);
});

app.get('/api/v1/admin/models/all', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return modelService.handleListModelAll(siteDB(c));
});

app.get('/api/v1/admin/models/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleGetModel(siteDB(c), id);
});

app.post('/api/v1/admin/models', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return modelService.handleCreateModel(siteDB(c), body);
});

app.put('/api/v1/admin/models/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return modelService.handleUpdateModel(siteDB(c), id, body);
});

app.delete('/api/v1/admin/models/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleDeleteModel(siteDB(c), id);
});

// ===== 後台管理接口 - 擴展字段管理 =====
app.get('/api/v1/admin/extfields', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return modelService.handleListExtFields(siteDB(c), params);
});

app.post('/api/v1/admin/extfields', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return modelService.handleCreateExtField(siteDB(c), body);
});

// ⚠️ batch-sorting 必須在 :id 路由之前註冊（Hono 路由順序約束）
app.put('/api/v1/admin/extfields/batch-sorting', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  return modelService.handleBatchUpdateExtFieldSorting(siteDB(c), items);
});

app.put('/api/v1/admin/extfields/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return modelService.handleUpdateExtField(siteDB(c), id, body);
});

app.delete('/api/v1/admin/extfields/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleDeleteExtField(siteDB(c), id);
});

// ===== 後台管理接口 - 用戶管理 =====
app.get('/api/v1/admin/users', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return systemService.handleListUsers(primaryDB(c), params);
});

app.get('/api/v1/admin/users/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleGetUser(primaryDB(c), id);
});

app.post('/api/v1/admin/users', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleCreateUser(primaryDB(c), body);
});

app.put('/api/v1/admin/users/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleUpdateUser(primaryDB(c), id, body);
});

app.delete('/api/v1/admin/users/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleDeleteUser(primaryDB(c), id);
});

app.post('/api/v1/admin/users/:id/reset-password', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleResetPassword(primaryDB(c), id, body);
});

// ===== 後台管理接口 - 角色管理 =====
app.get('/api/v1/admin/roles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return systemService.handleListRoles(primaryDB(c), params);
});

app.get('/api/v1/admin/roles/all', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListRolesAll(primaryDB(c));
});

app.get('/api/v1/admin/roles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleGetRole(primaryDB(c), id);
});

app.post('/api/v1/admin/roles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleCreateRole(primaryDB(c), body);
});

app.put('/api/v1/admin/roles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleUpdateRole(primaryDB(c), id, body);
});

app.delete('/api/v1/admin/roles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleDeleteRole(primaryDB(c), id);
});

// ===== 後台管理接口 - 菜單管理 =====
app.get('/api/v1/admin/menus', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListMenus(primaryDB(c));
});

app.get('/api/v1/admin/menus/flat', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListMenusFlat(primaryDB(c));
});

app.post('/api/v1/admin/menus', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const result = await systemService.handleCreateMenu(primaryDB(c), body);
  // 清除 URL→mcode 緩存 (菜單新增後)
  clearUrlMcodeCache();
  return result;
});

app.put('/api/v1/admin/menus/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  const result = await systemService.handleUpdateMenu(primaryDB(c), id, body);
  // 清除 URL→mcode 緩存 (菜單更新後)
  clearUrlMcodeCache();
  return result;
});

app.delete('/api/v1/admin/menus/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const result = await systemService.handleDeleteMenu(primaryDB(c), id);
  // 清除 URL→mcode 緩存 (菜單刪除後)
  clearUrlMcodeCache();
  return result;
});

// ===== 後台管理接口 - 系統日誌 =====
app.get('/api/v1/admin/logs', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return systemService.handleListLogs(primaryDB(c), params);
});

app.post('/api/v1/admin/logs/clear', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleClearLogs(primaryDB(c), body);
});

// ===== 後台管理接口 - 數據庫備份 =====
app.get('/api/v1/admin/database/backups', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListBackups(siteDB(c), c.env.CONFIG_CACHE);
});

app.post('/api/v1/admin/database/backup', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleCreateBackup(siteDB(c), c.env.CONFIG_CACHE);
});

app.get('/api/v1/admin/database/backups/:filename{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const filename = c.req.param('filename');
  return systemService.handleDownloadBackup(siteDB(c), c.env.CONFIG_CACHE, filename);
});

app.delete('/api/v1/admin/database/backups/:filename{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const filename = c.req.param('filename');
  return systemService.handleDeleteBackup(siteDB(c), c.env.CONFIG_CACHE, filename);
});

// ===== 語義搜索 (Vectorize + Workers AI) =====
app.get('/api/v1/search', publicRateLimit(), async (c) => {
  const query = c.req.query('q') || '';
  const topK = parseInt(c.req.query('topK') || '10', 10);
  const threshold = parseFloat(c.req.query('threshold') || '0.7');
  return vectorizeService.semanticSearch(c.env.AI, c.env.ARTICLE_INDEX, siteDB(c), query, topK, threshold);
});

// ===== 定時發布管理 (Queues + Cron) =====
app.get('/api/v1/admin/scheduler/list', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return schedulerService.handleListScheduled(siteDB(c));
});

app.post('/api/v1/admin/scheduler/schedule', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const id = Number(body.id) || 0;
  const publishDate = body.publishDate || '';
  return schedulerService.handleScheduleArticle(siteDB(c), c.env.PUBLISH_QUEUE, id, publishDate, currentSiteId(c));
});

// ===== Vectorize 索引管理 =====
app.post('/api/v1/admin/vectorize/reindex', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return vectorizeService.reindexAllArticles(c.env.AI, c.env.ARTICLE_INDEX, siteDB(c));
});

// ===== 功能開關（標準化：註冊表驅動 + API 攔截 + 前端聯動）=====

// 查詢所有功能開關狀態
app.get('/api/v1/admin/flags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const flags = await getAllFlags({ ...c.env, DB: siteDB(c), siteId: currentSiteId(c) } as never);
  return okData(flags, '成功');
});

// 切換功能開關（僅 D1 回退模式）
app.put('/api/v1/admin/flags', async (c) => {
  try {
    const claims = await requireAuth(c);
    if (!claims) return err('未授權', 2002);

    const body = await c.req.json<{ key?: string; enabled?: boolean }>();
    if (!body.key || typeof body.enabled !== 'boolean') {
      return err('缺少 key 或 enabled 參數');
    }

    const result = await setFlagEnabled({ ...c.env, DB: siteDB(c), siteId: currentSiteId(c) } as never, body.key, body.enabled);
    if (!result.success) {
      return err(result.error || '開關切換失敗', 1005);
    }

    // 清除配置緩存
    await clearConfigCache(c.env.CONFIG_CACHE);

    return ok(body.enabled ? '功能已開啟' : '功能已關閉');
  } catch (e) {
    console.error('flags PUT error:', e);
    return err(e instanceof Error ? e.message : '開關切換失敗', 1005);
  }
});

// ===== 內容更新時清除緩存 + 索引向量 =====

// ===== 多站點管理接口 =====
// 列出站點（超管看全部，普通用戶看已分配）
app.get('/api/v1/admin/sites', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return siteService.handleListSites(primaryDB(c), Number(claims.sub), claims.isSuper);
});

// 獲取當前站點信息（根據 X-Site-Id header）
app.get('/api/v1/admin/sites/current', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const siteId = c.req.header('X-Site-Id') || 'endoscopy';
  return siteService.handleGetCurrentSite(primaryDB(c), siteId);
});

// 創建新站點（僅超管，通過 REST API 創建 D1 數據庫）
app.post('/api/v1/admin/sites/create', requireSuperAdmin(), async (c) => {
  const body = await c.req.json();
  return siteService.handleCreateSite(primaryDB(c), {
    CF_ACCOUNT_ID: c.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: await c.env.CF_API_TOKEN_STORE.get(),
    SITE_REGISTRY: c.env.SITE_REGISTRY,
  }, body);
});

// 更新站點信息
app.put('/api/v1/admin/sites/:siteId', requireSuperAdmin(), async (c) => {
  const siteId = c.req.param('siteId');
  const body = await c.req.json();
  return siteService.handleUpdateSite(primaryDB(c), siteId, body);
});

// 用戶站點分配管理
// 獲取用戶已分配的站點列表
app.get('/api/v1/admin/users/:id/sites', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return siteService.handleGetUserSites(primaryDB(c), id);
});

// 設置用戶可訪問的站點
app.post('/api/v1/admin/users/:id/sites', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json<{ siteIds?: string[] }>();
  const siteIds = Array.isArray(body?.siteIds) ? body.siteIds : [];
  return siteService.handleSetUserSites(primaryDB(c), id, siteIds);
});

// ===== 404 兜底 =====
app.notFound((c) => err('接口不存在', 1004));

// ===== 全局錯誤處理 =====
app.onError((e, c) => {
  console.error('路由錯誤:', e);
  const msg = e instanceof Error ? e.message : '內部伺服器錯誤';
  // 異步記錄錯誤日誌
  const claims = c.get('claims');
  const userIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || '';
  const userAgent = c.req.header('User-Agent') || '';
  const url = new URL(c.req.url);
  const errorEvent = `路由錯誤: ${c.req.method} ${url.pathname} - ${msg}`;
  c.executionCtx.waitUntil(
    systemService.logAction(primaryDB(c), claims?.username || '', userIp, userAgent, errorEvent, 'error', url.pathname),
  );
  return err(msg, 500);
});

// ===== Queues 消費者 (定時發布) =====
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ articleId: number; action: string; scheduledAt: string; siteId?: string }>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        // 多站點：根據 siteId 路由到正確的數據庫
        const siteId = msg.body.siteId || 'endoscopy';
        const registry = parseSiteRegistry(env.SITE_REGISTRY ?? '{}');
        const entry = registry[siteId];
        const envBindings = env as unknown as Record<string, D1Database>;
        const db = (entry && entry.binding && envBindings[entry.binding]) || env.DB;
        await schedulerService.handleQueuePublish(db, msg.body);
        msg.ack();
      } catch (e) {
        console.error('定時發布失敗:', e);
        msg.retry();
      }
    }
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // 多站點：遍歷所有已註冊站點數據庫
    const sites = listRegisteredSites(env.SITE_REGISTRY ?? '{}');
    for (const site of sites) {
      const envBindings = env as unknown as Record<string, D1Database>;
      const db = envBindings[site.binding];
      if (db) {
        ctx.waitUntil(schedulerService.handleScheduledPublish(db, env.PUBLISH_QUEUE, site.siteId));
      }
    }
    // 兜底：如果沒有註冊站點，至少處理主庫
    if (sites.length === 0) {
      ctx.waitUntil(schedulerService.handleScheduledPublish(env.DB, env.PUBLISH_QUEUE, 'endoscopy'));
    }
  },
} satisfies ExportedHandler<Env>;
