/**
 * 多站點管理服務
 *
 * 設計：
 * - ay_site_registry 存於主庫（endoscopy-cms），記錄所有站點信息
 * - ay_user_site 存於主庫，記錄非超管用戶可訪問的站點
 * - 超級管理員可訪問所有站點，普通用戶只能訪問已分配的站點
 * - 動態站點（access_type='rest_api'）通過 D1 REST API 訪問
 */
import type { D1Database } from '@cloudflare/workers-types';
import { okData, ok, err, notFound } from '../utils/response';
import { parseSiteRegistry, createD1Database, D1RestClient } from '../utils/sitedb';

// ============================================================================
// 數據類型
// ============================================================================

export interface SiteRecord {
  id: number;
  site_id: string;
  name: string;
  binding: string;
  database_id: string;
  database_name: string;
  domain: string;
  region: string;
  access_type: string;
  status: string;
  is_primary: number;
  sorting: number;
  created_at: string;
  updated_at: string;
}

export interface SiteInfo {
  siteId: string;
  name: string;
  binding: string;
  databaseId: string;
  databaseName: string;
  domain: string;
  region: string;
  accessType: string;
  status: string;
  isPrimary: boolean;
  sorting: number;
}

// ============================================================================
// 內部工具
// ============================================================================

function toSiteInfo(row: SiteRecord): SiteInfo {
  return {
    siteId: row.site_id,
    name: row.name,
    binding: row.binding,
    databaseId: row.database_id,
    databaseName: row.database_name,
    domain: row.domain,
    region: row.region,
    accessType: row.access_type,
    status: row.status,
    isPrimary: row.is_primary === 1,
    sorting: row.sorting,
  };
}

// ============================================================================
// 查詢函數
// ============================================================================

/**
 * 獲取用戶可訪問的站點列表
 * 超管返回所有啟用站點，普通用戶返回已分配的站點
 */
export async function getUserSites(
  db: D1Database,
  userId: number,
  isSuper: boolean,
): Promise<SiteInfo[]> {
  let query: string;
  let params: unknown[];

  if (isSuper) {
    query = "SELECT * FROM ay_site_registry WHERE status = '1' ORDER BY is_primary DESC, sorting ASC, id ASC";
    params = [];
  } else {
    query = `SELECT s.* FROM ay_site_registry s
              INNER JOIN ay_user_site us ON us.site_id = s.site_id
              WHERE us.user_id = ? AND s.status = '1'
              ORDER BY s.is_primary DESC, s.sorting ASC, s.id ASC`;
    params = [userId];
  }

  const result = await db.prepare(query).bind(...params).all<SiteRecord>();
  return result.results.map(toSiteInfo);
}

/**
 * 檢查用戶是否有權訪問指定站點
 */
export async function checkSiteAccess(
  db: D1Database,
  userId: number,
  siteId: string,
  isSuper: boolean,
): Promise<boolean> {
  if (isSuper) return true;

  const row = await db
    .prepare(
      `SELECT 1 FROM ay_user_site us
       INNER JOIN ay_site_registry s ON s.site_id = us.site_id
       WHERE us.user_id = ? AND us.site_id = ? AND s.status = '1'`,
    )
    .bind(userId, siteId)
    .first();

  return !!row;
}

/**
 * 獲取用戶已分配的站點 ID 列表（用於用戶管理頁面）
 */
export async function getUserAssignedSiteIds(db: D1Database, userId: number): Promise<string[]> {
  const result = await db
    .prepare('SELECT site_id FROM ay_user_site WHERE user_id = ?')
    .bind(userId)
    .all<{ site_id: string }>();
  return result.results.map((r) => r.site_id);
}

// ============================================================================
// API 處理器
// ============================================================================

/**
 * 列出站點（超管看全部，普通用戶看已分配）
 * GET /api/v1/admin/sites
 */
export async function handleListSites(
  db: D1Database,
  userId: number,
  isSuper: boolean,
): Promise<Response> {
  const sites = await getUserSites(db, userId, isSuper);
  return okData({ sites }, '成功');
}

/**
 * 獲取當前站點信息
 * GET /api/v1/admin/sites/current
 */
export async function handleGetCurrentSite(
  db: D1Database,
  siteId: string,
): Promise<Response> {
  const row = await db
    .prepare('SELECT * FROM ay_site_registry WHERE site_id = ?')
    .bind(siteId)
    .first<SiteRecord>();

  if (!row) return notFound('站點不存在');
  return okData(toSiteInfo(row), '成功');
}

/**
 * 更新站點信息
 * PUT /api/v1/admin/sites/:siteId
 */
export async function handleUpdateSite(
  db: D1Database,
  siteId: string,
  body: { name?: string; domain?: string; sorting?: number; status?: string },
): Promise<Response> {
  const existing = await db
    .prepare('SELECT * FROM ay_site_registry WHERE site_id = ?')
    .bind(siteId)
    .first<SiteRecord>();

  if (!existing) return notFound('站點不存在');

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    params.push(body.name);
  }
  if (body.domain !== undefined) {
    updates.push('domain = ?');
    params.push(body.domain);
  }
  if (body.sorting !== undefined) {
    updates.push('sorting = ?');
    params.push(body.sorting);
  }
  if (body.status !== undefined) {
    updates.push('status = ?');
    params.push(body.status);
  }

  if (updates.length === 0) {
    return err('沒有需要更新的字段');
  }

  updates.push("updated_at = datetime('now', '+8 hours')");
  params.push(siteId);

  await db
    .prepare(`UPDATE ay_site_registry SET ${updates.join(', ')} WHERE site_id = ?`)
    .bind(...params)
    .run();

  return ok('站點更新成功');
}

/**
 * 設置用戶可訪問的站點列表
 * POST /api/v1/admin/users/:id/sites
 */
export async function handleSetUserSites(
  db: D1Database,
  userId: number,
  siteIds: string[],
): Promise<Response> {
  // 驗證用戶存在
  const user = await db
    .prepare('SELECT id FROM ay_user WHERE id = ? AND status = ?')
    .bind(userId, '1')
    .first();
  if (!user) return notFound('用戶不存在');

  // 驗證所有站點 ID 有效
  if (siteIds.length > 0) {
    const placeholders = siteIds.map(() => '?').join(', ');
    const validSites = await db
      .prepare(`SELECT site_id FROM ay_site_registry WHERE site_id IN (${placeholders}) AND status = '1'`)
      .bind(...siteIds)
      .all<{ site_id: string }>();
    if (validSites.results.length !== siteIds.length) {
      return err('部分站點 ID 無效');
    }
  }

  // 事務：先刪除舊的，再插入新的
  await db.prepare('DELETE FROM ay_user_site WHERE user_id = ?').bind(userId).run();

  for (const siteId of siteIds) {
    await db
      .prepare('INSERT OR IGNORE INTO ay_user_site (user_id, site_id) VALUES (?, ?)')
      .bind(userId, siteId)
      .run();
  }

  return okData({ userId, siteIds }, '站點權限更新成功');
}

/**
 * 獲取用戶已分配的站點（用於用戶管理頁面顯示）
 * GET /api/v1/admin/users/:id/sites
 */
export async function handleGetUserSites(
  db: D1Database,
  userId: number,
): Promise<Response> {
  const siteIds = await getUserAssignedSiteIds(db, userId);
  return okData({ userId, siteIds }, '成功');
}

// ============================================================================
// 動態站點創建（Phase 4: REST API 模式）
// ============================================================================

interface CreateSiteParams {
  siteId: string;
  name: string;
  domain?: string;
  region?: string;
}

/**
 * 創建新站點（通過 Cloudflare REST API 創建 D1 數據庫）
 * POST /api/v1/admin/sites/create
 *
 * 流程：
 * 1. 通過 REST API 創建 APAC D1 數據庫
 * 2. 寫入 ay_site_registry（access_type='rest_api'）
 * 3. 初始化站點數據庫結構（通過 D1 REST API 執行 migration SQL）
 * 4. 返回站點信息
 */
export async function handleCreateSite(
  db: D1Database,
  env: { CF_ACCOUNT_ID: string; CF_API_TOKEN: string; SITE_REGISTRY: string },
  body: CreateSiteParams,
): Promise<Response> {
  const { siteId, name, domain = '', region = 'apac' } = body;

  // 參數驗證
  if (!siteId || !name) {
    return err('站點 ID 和名稱為必填項', 1001);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(siteId)) {
    return err('站點 ID 只能包含小寫字母、數字和連字符，且以字母開頭', 1001);
  }

  // 檢查 site_id 是否已存在
  const existing = await db
    .prepare('SELECT 1 FROM ay_site_registry WHERE site_id = ?')
    .bind(siteId)
    .first();
  if (existing) {
    return err(`站點 ID "${siteId}" 已存在`, 1005);
  }

  // 檢查是否已在 SITE_REGISTRY 中預綁定
  const registry = parseSiteRegistry(env.SITE_REGISTRY ?? '{}');
  if (registry[siteId]) {
    return err(`站點 ID "${siteId}" 已在預綁定列表中，無需重複創建`, 1005);
  }

  try {
    // 1. 創建 D1 數據庫（APAC 地區）
    const dbName = `${siteId}-cms`;
    const { uuid: dbUuid, name: createdName } = await createD1Database(
      env.CF_ACCOUNT_ID,
      env.CF_API_TOKEN,
      dbName,
      region,
    );

    // 2. 寫入站點註冊表
    const maxSorting = await db
      .prepare('SELECT MAX(sorting) as m FROM ay_site_registry')
      .first<{ m: number | null }>();
    const sorting = (maxSorting?.m ?? 0) + 1;

    await db
      .prepare(
        `INSERT INTO ay_site_registry (site_id, name, binding, database_id, database_name, domain, region, access_type, status, is_primary, sorting)
         VALUES (?, ?, '', ?, ?, ?, ?, 'rest_api', '1', 0, ?)`,
      )
      .bind(siteId, name, dbUuid, createdName, domain, region, sorting)
      .run();

    // 3. 初始化站點數據庫結構（通過 D1 REST API）
    // 使用 D1RestClient 執行 migration SQL
    const restClient = new D1RestClient(env.CF_ACCOUNT_ID, dbUuid, env.CF_API_TOKEN);

    // 讀取初始化 SQL（從 migration 0001 提取核心表結構）
    const initSql = getSiteInitSql();
    await restClient.exec(initSql);

    // 4. 為所有活躍用戶分配新站點（超管自動有權限，但為數據完整性也分配）
    await db
      .prepare(
        `INSERT OR IGNORE INTO ay_user_site (user_id, site_id)
         SELECT id, ? FROM ay_user WHERE status = '1' AND ucode = '10001'`,
      )
      .bind(siteId)
      .run();

    return okData(
      {
        siteId,
        name,
        databaseId: dbUuid,
        databaseName: createdName,
        domain,
        region,
        accessType: 'rest_api',
        status: '1',
      },
      `站點 "${name}" 創建成功，數據庫 ${createdName} 已在 ${region.toUpperCase()} 地區創建`,
    );
  } catch (e) {
    console.error('創建站點失敗:', e);
    return err(
      `創建站點失敗: ${e instanceof Error ? e.message : '未知錯誤'}`,
      1005,
    );
  }
}

/**
 * 獲取站點數據庫初始化 SQL
 * 從 migration 0001 提取核心表結構，確保新站點有完整的數據表
 */
function getSiteInitSql(): string {
  return `
-- 站點數據庫初始化（複製自 migration 0001 核心表結構）
CREATE TABLE IF NOT EXISTS ay_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', scode TEXT, subscode TEXT,
  title TEXT, titlecolor TEXT, subtitle TEXT, filename TEXT, author TEXT, source TEXT,
  outlink TEXT, date TEXT, ico TEXT, pics TEXT, picstitle TEXT, content TEXT, tags TEXT,
  enclosure TEXT, keywords TEXT, description TEXT, sorting INTEGER UNSIGNED DEFAULT 255,
  status TEXT DEFAULT '1', istop TEXT DEFAULT '0', isrecommend TEXT DEFAULT '0',
  isheadline TEXT DEFAULT '0', visits INTEGER UNSIGNED DEFAULT 0, likes INTEGER UNSIGNED DEFAULT 0,
  oppose INTEGER UNSIGNED DEFAULT 0, create_user TEXT, update_user TEXT, create_time TEXT,
  update_time TEXT, gtype TEXT DEFAULT '4', gid TEXT DEFAULT '', gnote TEXT DEFAULT '', urlname TEXT
);
CREATE TABLE IF NOT EXISTS ay_content_sort (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', mcode TEXT, pcode TEXT DEFAULT '0',
  scode TEXT, name TEXT, subname TEXT, type TEXT, listtpl TEXT, contenttpl TEXT, ico TEXT, pic TEXT,
  title TEXT, keywords TEXT, description TEXT, filename TEXT, sorting INTEGER UNSIGNED DEFAULT 255,
  status TEXT DEFAULT '1', outlink TEXT, def1 TEXT, def2 TEXT, def3 TEXT, create_user TEXT,
  update_user TEXT, create_time TEXT, update_time TEXT, gtype TEXT DEFAULT '4', gid TEXT DEFAULT '',
  gnote TEXT DEFAULT '', urlname TEXT
);
CREATE TABLE IF NOT EXISTS ay_content_ext (
  extid INTEGER PRIMARY KEY AUTOINCREMENT, contentid INTEGER, ext_price TEXT, ext_type TEXT, ext_color TEXT, ext_content_whatsapp TEXT
);
CREATE TABLE IF NOT EXISTS ay_extfield (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mcode TEXT, name TEXT, field TEXT, type TEXT,
  description TEXT, value TEXT, scode TEXT, required TEXT DEFAULT '0', sorting INTEGER DEFAULT 255, status TEXT DEFAULT '1'
);
CREATE TABLE IF NOT EXISTS ay_single (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scode TEXT, title TEXT, keywords TEXT, description TEXT,
  content TEXT, sorting INTEGER DEFAULT 255, status TEXT DEFAULT '1', createtime TEXT, updatetime TEXT
);
CREATE TABLE IF NOT EXISTS ay_model (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mcode TEXT, name TEXT, type TEXT DEFAULT '2', urlname TEXT,
  listtpl TEXT, contenttpl TEXT, status TEXT DEFAULT '1', issystem TEXT DEFAULT '0',
  create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value TEXT, type TEXT DEFAULT '1',
  sorting INTEGER DEFAULT 255, description TEXT
);
CREATE TABLE IF NOT EXISTS ay_site (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', name TEXT, title TEXT, subtitle TEXT,
  domain TEXT, keywords TEXT, description TEXT, logo TEXT, icp TEXT, copyright TEXT, statistical TEXT,
  theme TEXT, lang TEXT DEFAULT 'zh-cn'
);
CREATE TABLE IF NOT EXISTS ay_company (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', name TEXT, address TEXT, postcode TEXT,
  contact TEXT, mobile TEXT, phone TEXT, fax TEXT, email TEXT, qq TEXT, weixin TEXT, icp TEXT,
  blicense TEXT, other TEXT, legal TEXT, business TEXT, whatsapp TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ay_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', contacts TEXT, mobile TEXT, content TEXT,
  user_ip TEXT, user_os TEXT, user_bs TEXT, recontent TEXT, status TEXT DEFAULT '1', uid INTEGER DEFAULT 0,
  create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_form (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fcode TEXT, form_name TEXT, table_name TEXT,
  description TEXT, is_active TEXT DEFAULT '1', sorting INTEGER DEFAULT 255,
  status TEXT DEFAULT '1', webhook_url TEXT,
  submit_token TEXT, turnstile_enabled TEXT DEFAULT '0', allowed_origins TEXT,
  create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
-- 預設表單（含隨機 submit_token）
INSERT OR IGNORE INTO ay_form (id, fcode, form_name, description, is_active, sorting, status, submit_token, create_time, update_time) VALUES
  (1, 'general', '通用表單', '默認通用表單', '1', 100, '1', substr(hex(randomblob(8)), 1, 16), datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (2, 'appointment', '預約表單', '預約/報名表單', '1', 200, '1', substr(hex(randomblob(8)), 1, 16), datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (3, 'contact', '聯絡表單', '聯絡/諮詢表單', '1', 300, '1', substr(hex(randomblob(8)), 1, 16), datetime('now', '+8 hours'), datetime('now', '+8 hours'));
CREATE TABLE IF NOT EXISTS ay_form_field (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fcode TEXT, name TEXT, length INTEGER, required TEXT DEFAULT '0',
  description TEXT, sorting INTEGER DEFAULT 255, create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_form_submission (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', form_key TEXT DEFAULT 'general',
  data TEXT NOT NULL, name TEXT, tel TEXT, email TEXT, status TEXT DEFAULT '0',
  user_ip TEXT, user_os TEXT, user_bs TEXT, source_url TEXT, create_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', gid TEXT DEFAULT '1', name TEXT,
  link TEXT, logo TEXT, sorting INTEGER DEFAULT 255, create_user TEXT, update_user TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_slide (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', gid TEXT DEFAULT '1', pic TEXT,
  pic_mobile TEXT, link TEXT, title TEXT, subtitle TEXT, button_text TEXT, sorting INTEGER DEFAULT 255,
  status TEXT DEFAULT '1', create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_slide_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT, gid TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  sorting INTEGER DEFAULT 255, create_time TEXT, update_time TEXT
);
INSERT OR IGNORE INTO ay_slide_group (gid, name, sorting, create_time, update_time)
VALUES ('1', '首頁輪播', 1, datetime('now', '+8 hours'), datetime('now', '+8 hours'));
INSERT OR IGNORE INTO ay_slide_group (gid, name, sorting, create_time, update_time)
VALUES ('2', '費用一覽', 2, datetime('now', '+8 hours'), datetime('now', '+8 hours'));
INSERT OR IGNORE INTO ay_slide_group (gid, name, sorting, create_time, update_time)
VALUES ('3', '大腸鏡檢查', 3, datetime('now', '+8 hours'), datetime('now', '+8 hours'));
CREATE TABLE IF NOT EXISTS ay_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acode TEXT DEFAULT 'cn', name TEXT, link TEXT,
  sorting INTEGER DEFAULT 255, create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_label (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value TEXT, type TEXT DEFAULT '1',
  description TEXT, create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_syslog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, event TEXT, user_ip TEXT, user_os TEXT, user_bs TEXT,
  create_user TEXT, create_time TEXT, username TEXT, url TEXT, content TEXT, ip TEXT, createtime TEXT
);
CREATE TABLE IF NOT EXISTS ay_media_mark (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, create_time TEXT
);
CREATE TABLE IF NOT EXISTS ay_301_redirect (
  id INTEGER PRIMARY KEY AUTOINCREMENT, old_url TEXT, new_url TEXT, match_type TEXT DEFAULT 'exact',
  status TEXT DEFAULT '1', sorting INTEGER DEFAULT 255, create_user TEXT, update_user TEXT, create_time TEXT, update_time TEXT
);
-- 索引（複製自 0001 Section 7 + 0002，確保查詢性能）
CREATE INDEX IF NOT EXISTS idx_content_acode ON ay_content(acode);
CREATE INDEX IF NOT EXISTS idx_content_date ON ay_content(date);
CREATE INDEX IF NOT EXISTS idx_content_ext_contentid ON ay_content_ext(contentid);
CREATE INDEX IF NOT EXISTS idx_content_filename ON ay_content(filename);
CREATE INDEX IF NOT EXISTS idx_content_scode_status ON ay_content(scode, status);
CREATE INDEX IF NOT EXISTS idx_content_sorting ON ay_content(sorting);
CREATE INDEX IF NOT EXISTS idx_content_status ON ay_content(status);
CREATE INDEX IF NOT EXISTS idx_content_urlname ON ay_content(urlname);
CREATE INDEX IF NOT EXISTS idx_media_mark_path ON ay_media_mark(path);
CREATE INDEX IF NOT EXISTS idx_sort_filename ON ay_content_sort(filename);
CREATE INDEX IF NOT EXISTS idx_sort_pcode ON ay_content_sort(pcode);
CREATE INDEX IF NOT EXISTS idx_sort_scode ON ay_content_sort(scode);
CREATE INDEX IF NOT EXISTS idx_sort_urlname ON ay_content_sort(urlname);
CREATE INDEX IF NOT EXISTS idx_form_sub_status ON ay_form_submission(status);
CREATE INDEX IF NOT EXISTS idx_form_sub_create_time ON ay_form_submission(create_time);
CREATE INDEX IF NOT EXISTS idx_form_sub_form_key ON ay_form_submission(form_key);
CREATE INDEX IF NOT EXISTS idx_form_sub_name ON ay_form_submission(name);
CREATE INDEX IF NOT EXISTS idx_form_sub_tel ON ay_form_submission(tel);
-- 內容模型（必須，否則側邊欄無模型子菜單 + 內容管理不可用）
INSERT OR IGNORE INTO ay_model (id, mcode, name, type, urlname, listtpl, contenttpl, status, issystem, create_time, update_time) VALUES
  (1, '1', '專題', '1', 'about', NULL, NULL, '1', '1', datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (2, '2', '文章', '2', 'list', NULL, NULL, '1', '1', datetime('now', '+8 hours'), datetime('now', '+8 hours'));
-- 默認站點信息（避免 /api/v1/site 報錯 1004）
INSERT OR IGNORE INTO ay_site (id, acode, name, title, subtitle, domain, lang) VALUES
  (1, 'cn', 'default', '網站標題', '網站副標題', '', 'zh-hk');
-- 默認公司信息（避免 /api/v1/company 返回空）
INSERT OR IGNORE INTO ay_company (id, acode, name, address, contact, mobile, email, whatsapp) VALUES
  (1, 'cn', '公司名稱', '公司地址', '聯繫人', '', 'admin@example.com', '');
-- 擴展字段定義
INSERT OR IGNORE INTO ay_extfield (id, mcode, name, field, type, description, value, scode, required, sorting, status) VALUES
  (15, '2', '了解更多（WhatsApp）', 'ext_content_whatsapp', '1', '', '', '', '0', 1, '1');
-- 初始化系統配置（完整配置項，與 0001_init.sql 對齊）
INSERT OR IGNORE INTO ay_config (name, value, type, sorting, description) VALUES
  ('message_check_code','1','1',20,'留言驗證碼'),
  ('message_send_mail','1','1',21,'留言發送郵件'),
  ('message_send_to','','2',22,'留言接收郵箱'),
  ('message_verify','1','1',23,'留言審核'),
  ('message_status','1','1',24,'留言狀態'),
  ('form_check_code','1','1',25,'表單驗證碼'),
  ('form_status','1','1',26,'表單狀態'),
  ('form_send_mail','0','1',27,'表單發送郵件'),
  ('comment_send_mail','0','1',28,'評論發送郵件'),
  ('admin_check_code','1','1',30,'後台驗證碼'),
  ('lock_count','5','2',31,'登錄失敗鎖定次數'),
  ('lock_time','900','2',32,'鎖定時間(秒)'),
  ('ip_deny','','2',33,'IP黑名單'),
  ('ip_allow','','2',34,'IP白名單'),
  ('turnstile_enabled','0','1',35,'登錄人機驗證開關'),
  ('turnstile_site_key','','2',36,'Turnstile 站點密鑰'),
  ('api_open','1','1',40,'API開關'),
  ('api_auth','0','1',41,'API認證'),
  ('api_appid','','2',42,'API AppID'),
  ('api_secret','','2',43,'API Secret'),
  ('api_cors_origins','','2',44,'API CORS域名'),
  ('smtp_server','','2',50,'SMTP伺服器'),
  ('smtp_port','465','2',51,'SMTP端口'),
  ('smtp_ssl','1','1',52,'SMTP SSL'),
  ('smtp_username','','2',53,'SMTP用戶名'),
  ('smtp_password','','2',54,'SMTP密碼'),
  ('mail_enabled','1','1',55,'郵件通知總開關'),
  ('webhook_enabled','1','1',56,'Webhook通知總開關'),
  ('webhook_url','','2',57,'Webhook推送地址'),
  ('webhook_message','1','1',58,'留言推送開關'),
  ('webhook_form','0','1',59,'表單推送開關'),
  ('webhook_comment','0','1',60,'評論推送開關'),
  ('google_verification','','2',61,'Google驗證碼'),
  ('bing_verification','','2',62,'Bing驗證碼'),
  ('storage_type','r2','2',70,'存儲類型(r2/s3)'),
  ('s3_endpoint','','2',71,'S3/R2 端點'),
  ('s3_bucket','','2',74,'S3/R2 存儲桶'),
  ('s3_region','auto','2',75,'S3/R2 區域'),
  ('s3_public_url','','2',76,'S3/R2 公開URL'),
  ('mail_provider','mailchannels','2',90,'郵件服務(mailchannels/resend)'),
  ('mail_api_key','','2',91,'郵件服務API Key'),
  ('mail_from','','2',92,'發件人地址'),
  ('mail_from_name','CMS 系統','2',93,'發件人名稱'),
  ('url_rule_type','2','2',210,'URL規則模式'),
  ('url_break_char','_','2',211,'URL分隔符'),
  ('url_index_404','0','1',212,'首頁404跳轉'),
  ('tpl_html_dir','html','2',213,'模板HTML目錄'),
  ('gzip','1','1',214,'GZIP壓縮'),
  ('content_tags_replace_num','3','2',215,'內容關鍵詞替換次數'),
  ('pagesize','15','2',216,'默認分頁大小');
  `;
}
