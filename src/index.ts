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
import { Hono } from 'hono';
import type { D1Database, KVNamespace, Queue, VectorizeIndex, Ai, RateLimit, Flagship } from '@cloudflare/workers-types';

import { extractToken, verifyJwt, type JwtClaims } from './utils/jwt';
import { isTokenBlacklisted, hasPermission } from './services/auth';
import { okData, err } from './utils/response';
import * as authService from './services/auth';
import * as configService from './services/config';
import * as sortService from './services/sort';
import * as contentService from './services/content';
import * as storageService from './services/storage';
import * as extraService from './services/extra';
import * as modelService from './services/model';
import * as systemService from './services/system';
import * as notifyService from './services/notify';
import { loginRateLimit, formRateLimit, publicRateLimit, adminRateLimit } from './services/ratelimit';
import { apiCache, clearContentCache, clearConfigCache } from './services/cache';
import * as vectorizeService from './services/vectorize';
import * as schedulerService from './services/scheduler';

/** Worker 環境綁定 */
export interface Env {
  DB: D1Database;
  CONFIG_CACHE: KVNamespace;
  TOKEN_BLACKLIST: KVNamespace;
  API_CACHE: KVNamespace;
  JWT_SECRET: string;
  API_PREFIX: string;
  JWT_EXPIRE_DAYS: string;
  PUBLISH_QUEUE: Queue<{ articleId: number; action: string; scheduledAt: string }>;
  ARTICLE_INDEX: VectorizeIndex;
  AI: Ai;
  PUBLIC_API_LIMIT: RateLimit;
  ADMIN_API_LIMIT: RateLimit;
  LOGIN_LIMIT: RateLimit;
  FORM_LIMIT: RateLimit;
  FLAGS?: Flagship;
}

const app = new Hono<{ Bindings: Env }>();

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
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
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

// ===== JWT 驗證中間件 =====
async function requireAuth(c: { env: Env; req: { header: (name: string) => string | null } }): Promise<JwtClaims | null> {
  const authHeader = c.req.header('Authorization');
  const token = extractToken(authHeader);
  if (!token) return null;

  const claims = await verifyJwt(token, c.env.JWT_SECRET);
  if (!claims) return null;

  // 檢查黑名單
  const blacklisted = await isTokenBlacklisted(c.env.TOKEN_BLACKLIST, claims.jti);
  if (blacklisted) return null;

  return claims;
}

// ===== 健康檢查 =====
app.get('/api/health', (c) => {
  return okData({
    status: 'ok',
    version: '0.1.0',
    time: new Date().toISOString(),
  }, '健康');
});

// ===== 認證接口 =====
app.post('/api/v1/auth/login', loginRateLimit(), async (c) => {
  const body = await c.req.json();
  return authService.handleLogin(c.env.DB, c.env.JWT_SECRET, body);
});

app.get('/api/v1/auth/profile', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權或 Token 已過期', 2002);
  return authService.handleProfile(c.env.DB, claims);
});

app.post('/api/v1/auth/logout', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return authService.handleLogout(c.env.TOKEN_BLACKLIST, claims);
});

// ===== 前台公開接口 =====
app.get('/api/v1/site', async (c) => {
  const site = await configService.getSiteInfo(c.env.DB);
  if (!site) return err('站點信息未配置', 1004);
  return okData(site, '成功');
});

app.get('/api/v1/sorts', async (c) => sortService.handleSortTree(c.env.DB));
app.get('/api/v1/nav', async (c) => sortService.handleNav(c.env.DB));

app.get('/api/v1/sorts/:scode', async (c) => {
  const scode = c.req.param('scode');
  return sortService.handleSortDetail(c.env.DB, scode);
});

app.get('/api/v1/contents', publicRateLimit(), async (c) => {
  const params = new URL(c.req.url).searchParams;
  return contentService.handleListContents(c.env.DB, params);
});

app.get('/api/v1/contents/:id', async (c) => {
  const id = Number(c.req.param('id')) || 0;
  const track = c.req.query('track') === '1';
  return contentService.handleContentDetail(c.env.DB, id, track);
});

// ===== 前台公開接口 - 擴展模塊 =====
app.get('/api/v1/singles', async (c) => extraService.handleListSingles(c.env.DB));

app.get('/api/v1/singles/:scode', async (c) => {
  const scode = c.req.param('scode');
  return extraService.handleSingleDetail(c.env.DB, scode);
});

app.get('/api/v1/links', async (c) => {
  const params = new URL(c.req.url).searchParams;
  return extraService.handleListLinks(c.env.DB, params);
});

app.get('/api/v1/slides', async (c) => {
  const params = new URL(c.req.url).searchParams;
  return extraService.handleListSlides(c.env.DB, params);
});

app.get('/api/v1/tags', async (c) => extraService.handleListTags(c.env.DB));

app.get('/api/v1/labels', async (c) => extraService.handleListLabelsPublic(c.env.DB));

app.post('/api/v1/messages', formRateLimit(), async (c) => {
  const body = await c.req.json();
  const userIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || '';
  const userAgent = c.req.header('User-Agent') || '';
  const sourceUrl = c.req.header('Referer') || c.req.header('Origin') || '';
  return extraService.handleSubmitMessage(c.env.DB, c.env.CONFIG_CACHE, c.executionCtx, c.env.FLAGS, userIp, userAgent, sourceUrl, body);
});

// ===== 後台管理接口 - 內容管理 =====
app.get('/api/v1/admin/contents', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return contentService.handleAdminListContents(c.env.DB, params);
});

// 擴展字段定義 (根據欄目 scode 查詢) - 必須在 :id 路由之前
app.get('/api/v1/admin/contents/extfields', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const scode = c.req.query('scode') || '';
  return modelService.handleGetContentExtFields(c.env.DB, scode);
});

// 回收站列表 - 必須在 :id 路由之前
app.get('/api/v1/admin/contents/trash', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return modelService.handleListTrashedContents(c.env.DB, params);
});

app.post('/api/v1/admin/contents', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const result = await contentService.handleCreateContent(c.env.DB, body);
  // 清除內容緩存
  await clearContentCache(c.env.API_CACHE);
  return result;
});

app.put('/api/v1/admin/contents/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  const result = await contentService.handleUpdateContent(c.env.DB, id, body);
  // 清除內容緩存
  await clearContentCache(c.env.API_CACHE);
  return result;
});

app.delete('/api/v1/admin/contents/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const result = await contentService.handleDeleteContent(c.env.DB, id);
  // 清除內容緩存
  await clearContentCache(c.env.API_CACHE);
  return result;
});

// 獲取內容的擴展字段值
app.get('/api/v1/admin/contents/:id/ext', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleGetContentExt(c.env.DB, id);
});

// 從回收站恢復 (使用 modelService 版本, 包含 status 守衛)
app.post('/api/v1/admin/contents/:id/restore', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleRestoreContent(c.env.DB, id);
});

// 永久刪除 (使用 modelService 版本, 包含 status 守衛)
app.delete('/api/v1/admin/contents/:id/permanent', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handlePermanentDeleteContent(c.env.DB, id);
});

// ===== 後台管理接口 - 欄目管理 =====
app.get('/api/v1/admin/sorts', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const mcode = c.req.query('mcode') || undefined;
  return sortService.handleSortTreeAll(c.env.DB, mcode);
});

app.post('/api/v1/admin/sorts', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return sortService.handleCreateSort(c.env.DB, body);
});

app.put('/api/v1/admin/sorts/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return sortService.handleUpdateSort(c.env.DB, id, body);
});

app.delete('/api/v1/admin/sorts/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return sortService.handleDeleteSort(c.env.DB, id);
});

// ===== 後台管理接口 - 系統配置 =====
app.get('/api/v1/admin/configs', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return configService.handleListConfigs(c.env.DB, c.env.CONFIG_CACHE);
});

app.put('/api/v1/admin/configs', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const result = await configService.handleUpdateConfig(c.env.DB, c.env.CONFIG_CACHE, body);
  // 清除 API 響應緩存
  await clearConfigCache(c.env.API_CACHE);
  return result;
});

// ===== 後台管理接口 - 儀表板統計 =====
app.get('/api/v1/admin/stats', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);

  const db = c.env.DB;
  const today = new Date().toISOString().slice(0, 10);

  const [contentTotal, sortTotal, visitsTotal, todayNew] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM ay_content WHERE acode = 'cn' AND status >= '0'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM ay_content_sort WHERE acode = 'cn'").first<{ n: number }>(),
    db.prepare("SELECT COALESCE(SUM(visits), 0) as n FROM ay_content WHERE acode = 'cn' AND status = '1'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM ay_content WHERE acode = 'cn' AND status >= '0' AND date LIKE ?").bind(`${today}%`).first<{ n: number }>(),
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
  return storageService.handleGetStorageConfig(c.env.DB, c.env.CONFIG_CACHE);
});

app.put('/api/v1/admin/storage/config', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json<Record<string, string>>();
  return storageService.handleUpdateStorageConfig(c.env.DB, c.env.CONFIG_CACHE, body);
});

app.post('/api/v1/admin/storage/test', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleTestStorage(c.env.DB, c.env.CONFIG_CACHE);
});

app.post('/api/v1/admin/storage/upload', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleUpload(c.env.DB, c.env.CONFIG_CACHE, c.req.raw);
});

app.get('/api/v1/admin/storage/download/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  return storageService.handleDownload(c.env.DB, c.env.CONFIG_CACHE, key);
});

app.delete('/api/v1/admin/storage/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  return storageService.handleDelete(c.env.DB, c.env.CONFIG_CACHE, key);
});

app.get('/api/v1/admin/storage/presigned/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  const expires = parseInt(c.req.query('expires') || '3600', 10);
  return storageService.handlePresignedUrl(c.env.DB, c.env.CONFIG_CACHE, key, expires);
});

// ===== 後台管理接口 - 媒體庫 =====
app.get('/api/v1/admin/media', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return storageService.handleListMedia(c.env.DB, c.env.CONFIG_CACHE, params);
});

// 文件詳情 (含使用狀態和標記狀態)
app.get('/api/v1/admin/media/detail', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.query('key') || '';
  if (!key) return err('缺少 key 參數', 1001);
  return storageService.handleMediaDetail(c.env.DB, c.env.CONFIG_CACHE, key);
});

// 切換文件標記 (標記保護/取消標記)
app.post('/api/v1/admin/media/mark', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const key = body.key || '';
  if (!key) return err('缺少 key 參數', 1001);
  return storageService.handleToggleMediaMark(c.env.DB, key);
});

// 清理未使用的文件
app.post('/api/v1/admin/media/clean', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json().catch(() => ({}));
  const force = body.force === true || body.force === 1 || body.force === '1';
  return storageService.handleCleanUnused(c.env.DB, c.env.CONFIG_CACHE, force);
});

app.delete('/api/v1/admin/media/:key{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const key = c.req.param('key');
  const force = c.req.query('force') === '1';
  return storageService.handleDeleteMedia(c.env.DB, c.env.CONFIG_CACHE, key, force);
});

// 通用上傳端點 (供編輯器圖片上傳使用)
app.post('/api/v1/admin/upload', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return storageService.handleUpload(c.env.DB, c.env.CONFIG_CACHE, c.req.raw);
});

// ===== 後台管理接口 - 單頁管理 =====
app.get('/api/v1/admin/singles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListSingles(c.env.DB, params);
});

app.get('/api/v1/admin/singles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleAdminGetSingle(c.env.DB, id);
});

app.post('/api/v1/admin/singles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateSingle(c.env.DB, body);
});

app.put('/api/v1/admin/singles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateSingle(c.env.DB, id, body);
});

app.delete('/api/v1/admin/singles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteSingle(c.env.DB, id);
});

// ===== 後台管理接口 - 友情連結 =====
app.get('/api/v1/admin/links', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListLinks(c.env.DB, params);
});

app.post('/api/v1/admin/links', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateLink(c.env.DB, body);
});

app.put('/api/v1/admin/links/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateLink(c.env.DB, id, body);
});

app.delete('/api/v1/admin/links/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteLink(c.env.DB, id);
});

// ===== 後台管理接口 - 幻燈片 =====
app.get('/api/v1/admin/slides', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListSlides(c.env.DB, params);
});

app.post('/api/v1/admin/slides', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateSlide(c.env.DB, body);
});

app.put('/api/v1/admin/slides/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateSlide(c.env.DB, id, body);
});

app.delete('/api/v1/admin/slides/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteSlide(c.env.DB, id);
});

// ===== 後台管理接口 - 標籤管理 =====
app.get('/api/v1/admin/tags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListTags(c.env.DB, params);
});

app.post('/api/v1/admin/tags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateTag(c.env.DB, body);
});

app.put('/api/v1/admin/tags/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateTag(c.env.DB, id, body);
});

app.delete('/api/v1/admin/tags/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteTag(c.env.DB, id);
});

// ===== 後台管理接口 - 自定義標籤 =====
app.get('/api/v1/admin/labels', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return extraService.handleListLabels(c.env.DB);
});

app.post('/api/v1/admin/labels', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleCreateLabel(c.env.DB, body);
});

// 注意: batch 路由必須在 :id 之前註冊,避免被當作 id 參數
app.put('/api/v1/admin/labels/batch', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleBatchUpdateLabels(c.env.DB, body);
});

app.put('/api/v1/admin/labels/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateLabel(c.env.DB, id, body);
});

app.delete('/api/v1/admin/labels/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteLabel(c.env.DB, id);
});

// ===== 後台管理接口 - 留言管理 =====
app.get('/api/v1/admin/messages', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return extraService.handleAdminListMessages(c.env.DB, params);
});

app.get('/api/v1/admin/messages/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleAdminGetMessage(c.env.DB, id);
});

app.put('/api/v1/admin/messages/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return extraService.handleUpdateMessage(c.env.DB, id, body);
});

app.delete('/api/v1/admin/messages/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return extraService.handleDeleteMessage(c.env.DB, id);
});

// ===== 後台管理接口 - 通知測試 =====
// 郵件發送測試
app.post('/api/v1/admin/notify/test-mail', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return notifyService.handleTestMail(c.env.DB, c.env.CONFIG_CACHE, body);
});

// Webhook 推送測試
app.post('/api/v1/admin/notify/test-webhook', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return notifyService.handleTestWebhook(c.env.DB, c.env.CONFIG_CACHE, body);
});

// ===== 後台管理接口 - 站點信息 =====
app.get('/api/v1/admin/site', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return extraService.handleAdminGetSite(c.env.DB);
});

app.put('/api/v1/admin/site', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleAdminUpdateSite(c.env.DB, body);
});

// ===== 後台管理接口 - 公司信息 =====
app.get('/api/v1/admin/company', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return extraService.handleAdminGetCompany(c.env.DB);
});

app.put('/api/v1/admin/company', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return extraService.handleAdminUpdateCompany(c.env.DB, body);
});

// ===== 後台管理接口 - 模型管理 =====
app.get('/api/v1/admin/models', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return modelService.handleListModels(c.env.DB, params);
});

app.get('/api/v1/admin/models/all', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return modelService.handleListModelAll(c.env.DB);
});

app.get('/api/v1/admin/models/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleGetModel(c.env.DB, id);
});

app.post('/api/v1/admin/models', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return modelService.handleCreateModel(c.env.DB, body);
});

app.put('/api/v1/admin/models/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return modelService.handleUpdateModel(c.env.DB, id, body);
});

app.delete('/api/v1/admin/models/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleDeleteModel(c.env.DB, id);
});

// ===== 後台管理接口 - 擴展字段管理 =====
app.get('/api/v1/admin/extfields', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return modelService.handleListExtFields(c.env.DB, params);
});

app.post('/api/v1/admin/extfields', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return modelService.handleCreateExtField(c.env.DB, body);
});

app.put('/api/v1/admin/extfields/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return modelService.handleUpdateExtField(c.env.DB, id, body);
});

app.delete('/api/v1/admin/extfields/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return modelService.handleDeleteExtField(c.env.DB, id);
});

// ===== 後台管理接口 - 用戶管理 =====
app.get('/api/v1/admin/users', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return systemService.handleListUsers(c.env.DB, params);
});

app.get('/api/v1/admin/users/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleGetUser(c.env.DB, id);
});

app.post('/api/v1/admin/users', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleCreateUser(c.env.DB, body);
});

app.put('/api/v1/admin/users/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleUpdateUser(c.env.DB, id, body);
});

app.delete('/api/v1/admin/users/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleDeleteUser(c.env.DB, id);
});

app.post('/api/v1/admin/users/:id/reset-password', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleResetPassword(c.env.DB, id, body);
});

// ===== 後台管理接口 - 角色管理 =====
app.get('/api/v1/admin/roles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return systemService.handleListRoles(c.env.DB, params);
});

app.get('/api/v1/admin/roles/all', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListRolesAll(c.env.DB);
});

app.get('/api/v1/admin/roles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleGetRole(c.env.DB, id);
});

app.post('/api/v1/admin/roles', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleCreateRole(c.env.DB, body);
});

app.put('/api/v1/admin/roles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleUpdateRole(c.env.DB, id, body);
});

app.delete('/api/v1/admin/roles/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleDeleteRole(c.env.DB, id);
});

// ===== 後台管理接口 - 菜單管理 =====
app.get('/api/v1/admin/menus', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListMenus(c.env.DB);
});

app.get('/api/v1/admin/menus/flat', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListMenusFlat(c.env.DB);
});

app.post('/api/v1/admin/menus', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleCreateMenu(c.env.DB, body);
});

app.put('/api/v1/admin/menus/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  const body = await c.req.json();
  return systemService.handleUpdateMenu(c.env.DB, id, body);
});

app.delete('/api/v1/admin/menus/:id', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const id = Number(c.req.param('id')) || 0;
  return systemService.handleDeleteMenu(c.env.DB, id);
});

// ===== 後台管理接口 - 系統日誌 =====
app.get('/api/v1/admin/logs', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const params = new URL(c.req.url).searchParams;
  return systemService.handleListLogs(c.env.DB, params);
});

app.post('/api/v1/admin/logs/clear', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  return systemService.handleClearLogs(c.env.DB, body);
});

// ===== 後台管理接口 - 數據庫備份 =====
app.get('/api/v1/admin/database/backups', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleListBackups(c.env.DB, c.env.CONFIG_CACHE);
});

app.post('/api/v1/admin/database/backup', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return systemService.handleCreateBackup(c.env.DB, c.env.CONFIG_CACHE);
});

app.get('/api/v1/admin/database/backups/:filename{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const filename = c.req.param('filename');
  return systemService.handleDownloadBackup(c.env.DB, c.env.CONFIG_CACHE, filename);
});

app.delete('/api/v1/admin/database/backups/:filename{.+}', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const filename = c.req.param('filename');
  return systemService.handleDeleteBackup(c.env.DB, c.env.CONFIG_CACHE, filename);
});

// ===== 語義搜索 (Vectorize + Workers AI) =====
app.get('/api/v1/search', publicRateLimit(), async (c) => {
  const query = c.req.query('q') || '';
  const topK = parseInt(c.req.query('topK') || '10', 10);
  const threshold = parseFloat(c.req.query('threshold') || '0.7');
  return vectorizeService.semanticSearch(c.env.AI, c.env.ARTICLE_INDEX, c.env.DB, query, topK, threshold);
});

// ===== 定時發布管理 (Queues + Cron) =====
app.get('/api/v1/admin/scheduler/list', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return schedulerService.handleListScheduled(c.env.DB);
});

app.post('/api/v1/admin/scheduler/schedule', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  const body = await c.req.json();
  const id = Number(body.id) || 0;
  const publishDate = body.publishDate || '';
  return schedulerService.handleScheduleArticle(c.env.DB, c.env.PUBLISH_QUEUE, id, publishDate);
});

// ===== Vectorize 索引管理 =====
app.post('/api/v1/admin/vectorize/reindex', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);
  return vectorizeService.reindexAllArticles(c.env.AI, c.env.ARTICLE_INDEX, c.env.DB);
});

// ===== Flagship 功能開關查詢 =====
// 混合模式: Flagship 已配置時讀取 Flagship, 否則回退到 D1 配置
const FLAG_DEFS = [
  { key: 'notify_mail_enabled', label: '郵件通知', defaultValue: true },
  { key: 'notify_webhook_enabled', label: 'Webhook通知', defaultValue: true },
];

app.get('/api/v1/admin/flags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);

  const flagshipConfigured = !!c.env.FLAGS;

  // Flagship 未配置時從 D1 讀取 (回退模式, 可在設置頁切換)
  let d1Configs: Record<string, string> = {};
  if (!flagshipConfigured) {
    const result = await c.env.DB.prepare('SELECT name, value FROM ay_config WHERE name IN (?, ?)')
      .bind(FLAG_DEFS[0].key, FLAG_DEFS[1].key)
      .all<{ name: string; value: string }>();
    for (const row of result.results) {
      d1Configs[row.name] = row.value;
    }
  }

  const results = await Promise.all(
    FLAG_DEFS.map(async (f) => {
      let enabled: boolean;
      if (flagshipConfigured) {
        enabled = await c.env.FLAGS!.getBooleanValue(f.key, f.defaultValue, {});
      } else {
        // D1 回退: 值為 '0' 表示關閉, 其他(含未配置)表示開啟
        const val = d1Configs[f.key];
        enabled = val === undefined ? f.defaultValue : val !== '0';
      }
      return { key: f.key, label: f.label, enabled, managedBy: flagshipConfigured ? 'flagship' : 'database' };
    }),
  );
  return okData(results, '成功');
});

// ===== Flagship 功能開關更新 (僅 D1 回退模式可用) =====
app.put('/api/v1/admin/flags', async (c) => {
  const claims = await requireAuth(c);
  if (!claims) return err('未授權', 2002);

  // Flagship 已配置時不允許從 API 修改 (需在 Cloudflare Dashboard 管理)
  if (c.env.FLAGS) {
    return err('Flagship 已配置，請在 Cloudflare Dashboard > Flagship 中管理功能開關', 1005);
  }

  const body = await c.req.json<{ key?: string; enabled?: boolean }>();
  if (!body.key || typeof body.enabled !== 'boolean') {
    return err('缺少 key 或 enabled 參數');
  }

  // 驗證 key 是否合法
  const validKey = FLAG_DEFS.find((f) => f.key === body.key);
  if (!validKey) {
    return err('無效的功能開關 key', 1001);
  }

  // 寫入 D1 (冪等: INSERT OR REPLACE)
  await c.env.DB.prepare('INSERT OR REPLACE INTO ay_config (name, value, type, sorting, description) VALUES (?, ?, ?, ?, ?)')
    .bind(body.key, body.enabled ? '1' : '0', '1', 55, validKey.label + '總開關')
    .run();

  // 清除配置緩存
  await clearConfigCache(c.env.CONFIG_CACHE);

  return ok(body.enabled ? '功能已開啟' : '功能已關閉');
});

// ===== 內容更新時清除緩存 + 索引向量 =====

// ===== 404 兜底 =====
app.notFound((c) => err('接口不存在', 1004));

// ===== 全局錯誤處理 =====
app.onError((e, c) => {
  console.error('路由錯誤:', e);
  return err('內部伺服器錯誤', 500);
});

// ===== Queues 消費者 (定時發布) =====
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ articleId: number; action: string; scheduledAt: string }>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await schedulerService.handleQueuePublish(env.DB, msg.body);
        msg.ack();
      } catch (e) {
        console.error('定時發布失敗:', e);
        msg.retry();
      }
    }
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(schedulerService.handleScheduledPublish(env.DB, env.PUBLISH_QUEUE));
  },
} satisfies ExportedHandler<Env>;
