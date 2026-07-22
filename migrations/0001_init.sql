-- ============================================================================
-- 合併遷移 0001_init.sql
-- ============================================================================
-- 生成日期：2026-07-22
-- 替代原 0001-0013（含重複編號 0003/0004）共 15 個遷移文件
--
-- 本遷移為當前 D1 數據庫完整快照（schema + 種子數據），全冪等語法：
--   CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / INSERT OR IGNORE
-- 可安全重複執行，也可用於全新站點數據庫初始化。
--
-- 修復的歷史數據問題：
--   1. R103 levels 字段 M308→M508（v1.7.5 代碼遷移時 ay_role.levels 未同步更新）
--   2. R101 levels 字段補全 M508（v1.7.5 新增多站點菜單後未同步到 levels 緩存）
--   3. 移除 turnstile_secret_key 配置行（v1.8.6 已遷移至 Secrets Store）
--   4. ay_area 去重（原有 2 條完全相同的記錄）
--   5. 敏感憑證（s3_access_key/s3_secret_key/webhook_url）種子值留空，
--      生產環境通過 INSERT OR IGNORE 不覆蓋已有值
-- ============================================================================

-- ============================================================================
-- Section 1: 認證與 RBAC
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ucode TEXT,
    username TEXT,
    password TEXT,
    realname TEXT,
    rcodes TEXT,
    acodes TEXT DEFAULT 'cn',
    status TEXT DEFAULT '1',
    login_count INTEGER DEFAULT 0,
    last_login_ip TEXT,
    lastlogintime TEXT
);

CREATE TABLE IF NOT EXISTS ay_role (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    rcode TEXT,
    name TEXT,
    description TEXT,
    levels TEXT,
    status TEXT DEFAULT '1'
);

CREATE TABLE IF NOT EXISTS ay_role_area (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rcode TEXT,
    acode TEXT
);

CREATE TABLE IF NOT EXISTS ay_role_level (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rcode TEXT,
    level TEXT
);

CREATE TABLE IF NOT EXISTS ay_user_site (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', '+8 hours')),
    UNIQUE(user_id, site_id)
);

CREATE TABLE IF NOT EXISTS ay_area (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT,
    pcode TEXT DEFAULT '0',
    name TEXT,
    domain TEXT,
    is_default TEXT DEFAULT '0'
);

-- ============================================================================
-- Section 2: 菜單系統
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcode TEXT,
    pcode TEXT DEFAULT '0',
    name TEXT,
    url TEXT,
    ico TEXT,
    sorting INTEGER DEFAULT 255,
    status TEXT DEFAULT '1',
    shortcut TEXT DEFAULT '0',
    type TEXT DEFAULT '1'
);

CREATE TABLE IF NOT EXISTS ay_menu_action (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcode TEXT,
    name TEXT,
    action TEXT,
    sorting INTEGER DEFAULT 255
);

-- ============================================================================
-- Section 3: 內容管理
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    scode TEXT,
    subscode TEXT,
    title TEXT,
    titlecolor TEXT,
    subtitle TEXT,
    filename TEXT,
    author TEXT,
    source TEXT,
    outlink TEXT,
    date TEXT,
    ico TEXT,
    pics TEXT,
    picstitle TEXT,
    content TEXT,
    tags TEXT,
    enclosure TEXT,
    keywords TEXT,
    description TEXT,
    sorting INTEGER UNSIGNED DEFAULT 255,
    status TEXT DEFAULT '1',
    istop TEXT DEFAULT '0',
    isrecommend TEXT DEFAULT '0',
    isheadline TEXT DEFAULT '0',
    visits INTEGER UNSIGNED DEFAULT 0,
    likes INTEGER UNSIGNED DEFAULT 0,
    oppose INTEGER UNSIGNED DEFAULT 0,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT,
    gtype TEXT DEFAULT '4',
    gid TEXT DEFAULT '',
    gnote TEXT DEFAULT '',
    urlname TEXT
);

CREATE TABLE IF NOT EXISTS ay_content_sort (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    mcode TEXT,
    pcode TEXT DEFAULT '0',
    scode TEXT,
    name TEXT,
    subname TEXT,
    type TEXT,
    listtpl TEXT,
    contenttpl TEXT,
    ico TEXT,
    pic TEXT,
    title TEXT,
    keywords TEXT,
    description TEXT,
    filename TEXT,
    sorting INTEGER UNSIGNED DEFAULT 255,
    status TEXT DEFAULT '1',
    outlink TEXT,
    def1 TEXT,
    def2 TEXT,
    def3 TEXT,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT,
    gtype TEXT DEFAULT '4',
    gid TEXT DEFAULT '',
    gnote TEXT DEFAULT '',
    urlname TEXT
);

CREATE TABLE IF NOT EXISTS ay_content_ext (
    extid INTEGER PRIMARY KEY AUTOINCREMENT,
    contentid INTEGER,
    ext_price TEXT,
    ext_type TEXT,
    ext_color TEXT,
    ext_content_whatsapp TEXT
);

CREATE TABLE IF NOT EXISTS ay_single (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scode TEXT,
    title TEXT,
    keywords TEXT,
    description TEXT,
    content TEXT,
    sorting INTEGER DEFAULT 255,
    status TEXT DEFAULT '1',
    createtime TEXT,
    updatetime TEXT
);

CREATE TABLE IF NOT EXISTS ay_model (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcode TEXT,
    name TEXT,
    type TEXT DEFAULT '2',
    urlname TEXT,
    listtpl TEXT,
    contenttpl TEXT,
    status TEXT DEFAULT '1',
    issystem TEXT DEFAULT '0',
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_extfield (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mcode TEXT,
    name TEXT,
    field TEXT,
    type TEXT,
    description TEXT,
    value TEXT,
    scode TEXT,
    required TEXT DEFAULT '0',
    sorting INTEGER DEFAULT 255,
    status TEXT DEFAULT '1'
);

-- ============================================================================
-- Section 4: 配置與站點
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    value TEXT,
    type TEXT DEFAULT '1',
    sorting INTEGER DEFAULT 255,
    description TEXT
);

CREATE TABLE IF NOT EXISTS ay_site (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    name TEXT,
    title TEXT,
    subtitle TEXT,
    domain TEXT,
    keywords TEXT,
    description TEXT,
    logo TEXT,
    icp TEXT,
    copyright TEXT,
    statistical TEXT,
    theme TEXT,
    lang TEXT DEFAULT 'zh-cn'
);

CREATE TABLE IF NOT EXISTS ay_company (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    name TEXT,
    address TEXT,
    postcode TEXT,
    contact TEXT,
    mobile TEXT,
    phone TEXT,
    fax TEXT,
    email TEXT,
    qq TEXT,
    weixin TEXT,
    icp TEXT,
    blicense TEXT,
    other TEXT,
    legal TEXT,
    business TEXT,
    whatsapp TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ay_site_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    binding TEXT DEFAULT '',
    database_id TEXT DEFAULT '',
    database_name TEXT DEFAULT '',
    domain TEXT DEFAULT '',
    region TEXT DEFAULT 'apac',
    access_type TEXT DEFAULT 'binding',
    status TEXT DEFAULT '1',
    is_primary INTEGER DEFAULT 0,
    sorting INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT DEFAULT (datetime('now', '+8 hours'))
);

-- ============================================================================
-- Section 5: 擴展功能
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_form (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fcode TEXT,
    form_name TEXT,
    table_name TEXT,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);
-- 注意：ay_form 的擴展字段（description/is_active/sorting/status/webhook_url/
-- submit_token/turnstile_enabled/allowed_origins）由 0003/0004 遷移 ALTER TABLE 添加

CREATE TABLE IF NOT EXISTS ay_form_field (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fcode TEXT,
    name TEXT,
    length INTEGER,
    required TEXT DEFAULT '0',
    description TEXT,
    sorting INTEGER DEFAULT 255,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_form_submission (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    form_key TEXT DEFAULT 'general',
    data TEXT NOT NULL,
    name TEXT,
    tel TEXT,
    email TEXT,
    status TEXT DEFAULT '0',
    user_ip TEXT,
    user_os TEXT,
    user_bs TEXT,
    source_url TEXT,
    create_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_form_sub_status ON ay_form_submission(status);
CREATE INDEX IF NOT EXISTS idx_form_sub_create_time ON ay_form_submission(create_time);

CREATE TABLE IF NOT EXISTS ay_label (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    value TEXT,
    type TEXT DEFAULT '1',
    description TEXT,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    gid TEXT DEFAULT '1',
    name TEXT,
    link TEXT,
    logo TEXT,
    sorting INTEGER DEFAULT 255,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    name TEXT,
    link TEXT,
    sorting INTEGER DEFAULT 255,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    contacts TEXT,
    mobile TEXT,
    content TEXT,
    user_ip TEXT,
    user_os TEXT,
    user_bs TEXT,
    recontent TEXT,
    status TEXT DEFAULT '1',
    uid INTEGER DEFAULT 0,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

-- ============================================================================
-- Section 6: 媒體與系統
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_media_mark (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT,
    create_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_slide (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acode TEXT DEFAULT 'cn',
    gid TEXT DEFAULT '1',
    pic TEXT,
    pic_mobile TEXT,
    link TEXT,
    title TEXT,
    subtitle TEXT,
    button_text TEXT,
    sorting INTEGER DEFAULT 255,
    status TEXT DEFAULT '1',
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_slide_group (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sorting INTEGER DEFAULT 255,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_301_redirect (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    old_url TEXT,
    new_url TEXT,
    match_type TEXT DEFAULT 'exact',
    status TEXT DEFAULT '1',
    sorting INTEGER DEFAULT 255,
    create_user TEXT,
    update_user TEXT,
    create_time TEXT,
    update_time TEXT
);

CREATE TABLE IF NOT EXISTS ay_syslog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT,
    event TEXT,
    user_ip TEXT,
    user_os TEXT,
    user_bs TEXT,
    create_user TEXT,
    create_time TEXT,
    username TEXT,
    url TEXT,
    content TEXT,
    ip TEXT,
    createtime TEXT
);

-- ============================================================================
-- Section 7: 索引
-- ============================================================================

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

-- ============================================================================
-- Section 8: 種子數據 — 菜單
-- ============================================================================

INSERT OR IGNORE INTO ay_menu (id, mcode, pcode, name, url, ico, sorting, status, shortcut, type) VALUES
  (1,  'M100', '0',   '儀表盤',   '/admin/dashboard',         '📊', 10,  '1', '1', '1'),
  (2,  'M200', '0',   '文章內容', '/admin/content',           '📄', 40,  '1', '1', '1'),
  (3,  'M201', 'M200','文章列表', '/admin/content/index',    '',   210, '1', '0', '1'),
  (4,  'M202', 'M610','欄目管理', '/admin/content/sort',      '',   613, '1', '0', '1'),
  (5,  'M203', 'M400','單頁管理', '/admin/content/single',   '',   230, '1', '0', '1'),
  (6,  'M204', 'M400','自定義表單','/admin/forms/submissions',  '',   240, '1', '0', '1'),
  (7,  'M205', 'M400','自定義表單(舊)','/admin/content/form',  '',   250, '0', '0', '1'), -- 已在 0006 中刪除，保留行號佔位
  (8,  'M206', 'M600','擴展字段', '/admin/content/extfield', '',   603, '1', '0', '1'),
  (9,  'M207', 'M600','內容模型', '/admin/content/model',    '',   602, '1', '0', '1'),
  (10, 'M208', 'M200','回收站',   '/admin/content/trash',    '',   280, '1', '0', '1'),
  (11, 'M300', '0',   '多媒體',   NULL,                       '🖼️', 55,  '1', '1', '1'),
  (12, 'M400', '0',   '擴展內容', '/admin/seo',              '🔍', 50,  '1', '0', '1'),
  (13, 'M401', 'M400','友情連結', '/admin/seo/link',        '',   410, '1', '0', '1'),
  (14, 'M402', 'M300','幻燈片',   '/admin/seo/slide',       '',   420, '1', '0', '1'),
  (15, 'M403', 'M400','標籤管理', '/admin/seo/tags',        '',   430, '1', '0', '1'),
  (17, 'M405', 'M400','301重定向','/admin/seo/redirect',     '',   450, '1', '0', '1'),
  (18, 'M500', '0',   '系統管理', '/admin/system',          '⚙️', 60,  '1', '0', '1'),
  (19, 'M501', 'M610','站點信息', '/admin/system/site',     '',   611, '1', '0', '1'),
  (20, 'M502', 'M610','公司信息', '/admin/system/company',  '',   612, '1', '0', '1'),
  (21, 'M503', 'M600','系統配置', '/admin/system/config',   '',   601, '1', '0', '1'),
  (22, 'M504', 'M500','管理員管理','/admin/system/user',     '',   540, '1', '0', '1'),
  (23, 'M505', 'M500','角色管理', '/admin/system/role',     '',   550, '1', '0', '1'),
  (24, 'M506', 'M500','菜單管理', '/admin/system/menu',     '',   560, '1', '0', '1'),
  (25, 'M507', 'M500','系統日誌', '/admin/system/syslog',   '',   570, '1', '0', '1'),
  (51, 'M600', '0',   '全局配置', '/admin/global',          '🌐', 20,  '1', '0', '1'),
  (52, 'M610', '0',   '基礎內容', '/admin/basic',           '📋', 30,  '1', '0', '1'),
  (53, 'M301', 'M300','媒體庫',   '/admin/media',           '🖼️', 301, '1', '1', '1'),
  (54, 'M508', 'M500','多站點管理','/sites',                 '🌐', 580, '1', '0', '1'),
  (55, 'M210', 'M610','表單管理', '/admin/forms',             '📝', 220, '1', '0', '1');

-- ============================================================================
-- Section 9: 種子數據 — 內容模型
-- ============================================================================

INSERT OR IGNORE INTO ay_model (id, mcode, name, type, urlname, listtpl, contenttpl, status, issystem, create_time, update_time) VALUES
  (1, '1', '專題', '1', 'about', NULL, NULL, '1', '1', NULL, NULL),
  (2, '2', '文章', '2', 'list',  NULL, NULL, '1', '1', NULL, '2026-07-17 01:15:49');

-- ============================================================================
-- Section 10: 種子數據 — 角色（修復 M308→M508 + R101 補全 M508）
-- ============================================================================

INSERT OR IGNORE INTO ay_role (id, code, rcode, name, description, levels, status) VALUES
  (1, 'R101', 'R101', '超級管理員',     '最大管理權限',
   'M100,M600,M503,M207,M206,M610,M501,M502,M202,M200,M201,M208,M400,M203,M204,M210,M401,M402,M403,M405,M300,M500,M504,M505,M506,M507,M301,M508', '1'),
  (2, 'R102', 'R102', '文案編輯',       '資料修改文案上傳',
   'M100,M200,M201,M208,M400,M203,M204,M210,M401,M402,M300,M301', '1'),
  (3, 'R103', 'R103', 'EndoscopyAdmin', 'Endoscopy站點超級管理員',
   'M100,M600,M503,M207,M206,M610,M501,M502,M202,M200,M201,M208,M400,M203,M204,M210,M401,M403,M405,M300,M301,M508,M402,M500,M504,M505,M506,M507', '1'),
  (4, 'R104', 'R104', 'Endoscopyeditor', 'Endoscopy資料上傳',
   'M100,M200,M201,M208,M401,M203,M402,M301', '1');

-- 角色權限映射（ay_role_level）
INSERT OR IGNORE INTO ay_role_level (rcode, level) VALUES
  ('R101','M100'),('R101','M600'),('R101','M503'),('R101','M207'),('R101','M206'),
  ('R101','M610'),('R101','M501'),('R101','M502'),('R101','M202'),('R101','M200'),
  ('R101','M201'),('R101','M208'),('R101','M400'),('R101','M203'),('R101','M204'),
  ('R101','M210'),('R101','M401'),('R101','M402'),('R101','M403'),('R101','M405'),
  ('R101','M300'),('R101','M500'),('R101','M504'),('R101','M505'),('R101','M506'),
  ('R101','M507'),('R101','M301'),('R101','M508'),
  ('R102','M100'),('R102','M200'),('R102','M201'),('R102','M208'),('R102','M400'),
  ('R102','M203'),('R102','M204'),('R102','M210'),('R102','M401'),('R102','M402'),('R102','M300'),
  ('R102','M301'),
  ('R103','M100'),('R103','M600'),('R103','M503'),('R103','M207'),('R103','M206'),
  ('R103','M610'),('R103','M501'),('R103','M502'),('R103','M202'),('R103','M200'),
  ('R103','M201'),('R103','M208'),('R103','M400'),('R103','M203'),('R103','M204'),
  ('R103','M210'),('R103','M401'),('R103','M403'),('R103','M405'),('R103','M300'),
  ('R103','M301'),('R103','M508'),('R103','M402'),('R103','M500'),('R103','M504'),
  ('R103','M505'),('R103','M506'),('R103','M507'),
  ('R104','M100'),('R104','M200'),('R104','M201'),('R104','M208'),('R104','M401'),
  ('R104','M203'),('R104','M402'),('R104','M301');

-- ============================================================================
-- Section 11: 種子數據 — 區域（去重：原 2 條合併為 1 條）
-- ============================================================================

INSERT OR IGNORE INTO ay_area (id, acode, pcode, name, domain, is_default) VALUES
  (1, 'cn', '0', '簡體中文', NULL, '1');

-- ============================================================================
-- Section 12: 種子數據 — 幻燈片分組
-- ============================================================================

INSERT OR IGNORE INTO ay_slide_group (id, gid, name, sorting, create_time, update_time) VALUES
  (1, '1', '首頁輪播',   1, datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (2, '2', '費用一覽',   2, datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (3, '3', '大腸鏡檢查', 3, datetime('now', '+8 hours'), datetime('now', '+8 hours'));

-- ============================================================================
-- Section 12b: 種子數據 — 預設表單
-- ============================================================================
-- 注意：預設表單種子數據由 0003_form_management.sql 提供
-- （因 ay_form 表的擴展字段在 0003 中通過 ALTER TABLE 添加）

-- ============================================================================
-- Section 13: 種子數據 — 擴展字段定義
-- ============================================================================

INSERT OR IGNORE INTO ay_extfield (id, mcode, name, field, type, description, value, scode, required, sorting, status) VALUES
  (15, '2', '了解更多（WhatsApp）', 'ext_content_whatsapp', '1', '', '', '', '0', 1, '1');

-- ============================================================================
-- Section 14: 種子數據 — 站點註冊表
-- ============================================================================

INSERT OR IGNORE INTO ay_site_registry (id, site_id, name, binding, database_id, database_name, domain, region, access_type, status, is_primary, sorting, created_at, updated_at) VALUES
  (1, 'endoscopy', 'Endoscopy CMS', 'DB',        'c824a999-6a14-4878-bc43-2f3de023cbde', 'endoscopy-cms', 'cms.cmermedical.com.hk',    'apac', 'binding', '1', 1, 1, datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (2, 'smile',     'Smile CMS',     'DB_SMILE',  'f59320b5-b1f2-47cf-8b32-e341e1c5da48', 'smile-cms',     'smile.cmermedical.com.hk',    'apac', 'binding', '1', 0, 2, datetime('now', '+8 hours'), datetime('now', '+8 hours')),
  (3, 'vision',    'Vision CMS',    'DB_VISION', 'a49903a9-098e-43cd-934c-9bad2466d8ae', 'vision-cms',    'vision.cmermedical.com.hk',   'apac', 'binding', '1', 0, 3, datetime('now', '+8 hours'), datetime('now', '+8 hours'));

-- ============================================================================
-- Section 15: 種子數據 — 系統配置
-- ============================================================================
-- 注意：s3_access_key/s3_secret_key 已遷移至 Secrets Store（v1.8.7），不在 D1 中。
-- turnstile_secret_key 已移除（v1.8.6 遷移至 Secrets Store）。
-- open_wap/wap_domain/wap_site_dir 已移除（headless CMS 無移動版）。
-- ============================================================================

INSERT OR IGNORE INTO ay_config (id, name, value, type, sorting, description) VALUES
  -- 留言與表單
  (4,  'message_check_code',   '1', '1', 20, '留言驗證碼'),
  (5,  'message_send_mail',   '1', '1', 21, '留言發送郵件'),
  (6,  'message_send_to',      '',  '2', 22, '留言接收郵箱'),
  (7,  'message_verify',       '1', '1', 23, '留言審核'),
  (8,  'message_status',       '1', '1', 24, '留言狀態'),
  (9,  'form_check_code',      '1', '1', 25, '表單驗證碼'),
  (10, 'form_status',          '1', '1', 26, '表單狀態'),
  (11, 'form_send_mail',       '0', '1', 27, '表單發送郵件'),
  (98, 'comment_send_mail',    '0', '1', 28, '評論發送郵件'),
  -- 安全
  (12, 'admin_check_code',     '1', '1', 30, '後台驗證碼'),
  (13, 'lock_count',           '5', '2', 31, '登錄失敗鎖定次數'),
  (14, 'lock_time',            '900','2', 32, '鎖定時間(秒)'),
  (15, 'ip_deny',              '',  '2', 33, 'IP黑名單'),
  (16, 'ip_allow',             '',  '2', 34, 'IP白名單'),
  (110,'turnstile_enabled',    '0', '1', 35, '登錄人機驗證開關'),
  (111,'turnstile_site_key',   '',  '2', 36, 'Turnstile 站點密鑰'),
  -- API
  (17, 'api_open',             '1', '1', 40, 'API開關'),
  (18, 'api_auth',             '0', '1', 41, 'API認證'),
  (19, 'api_appid',            '',  '2', 42, 'API AppID'),
  (20, 'api_secret',           '',  '2', 43, 'API Secret'),
  (21, 'api_cors_origins',     '',  '2', 44, 'API CORS域名'),
  -- 郵件
  (22, 'smtp_server',          '',  '2', 50, 'SMTP伺服器'),
  (23, 'smtp_port',            '465','2', 51, 'SMTP端口'),
  (24, 'smtp_ssl',             '1', '1', 52, 'SMTP SSL'),
  (25, 'smtp_username',        '',  '2', 53, 'SMTP用戶名'),
  (26, 'smtp_password',        '',  '2', 54, 'SMTP密碼'),
  (99, 'mail_provider',        'mailchannels','2', 90, '郵件服務(mailchannels/resend)'),
  (100,'mail_api_key',         '',  '2', 91, '郵件服務API Key'),
  (101,'mail_from',            '',  '2', 92, '發件人地址'),
  (102,'mail_from_name',       'CMS 系統','2', 93, '發件人名稱'),
  (106,'mail_enabled',         '1', '1', 55, '郵件通知總開關'),
  -- Webhook（webhook_url 含 token，種子留空）
  (107,'webhook_enabled',      '1', '1', 56, 'Webhook通知總開關'),
  (94, 'webhook_url',          '',  '2', 57, 'Webhook推送地址(釘釘/企業微信/通用)'),
  (95, 'webhook_message',      '1', '1', 58, '留言推送開關'),
  (96, 'webhook_form',         '0', '1', 59, '表單推送開關'),
  (97, 'webhook_comment',      '0', '1', 60, '評論推送開關'),
  -- 搜索引擎驗證
  (108,'google_verification',  '',  '2', 61, 'Google Search Console 驗證碼'),
  (109,'bing_verification',    '',  '2', 62, 'Bing Webmaster Tools 驗證碼'),
  -- 水印（已隱藏，headless CMS 不使用）
  (30, 'watermark_open',       '0', '1', 200, '水印開關'),
  (31, 'watermark_text',      '',  '2', 201, '水印文字'),
  (32, 'watermark_text_font', '',  '2', 202, '水印字體'),
  (33, 'watermark_text_size', '20','2', 203, '水印字號'),
  (34, 'watermark_text_color','#000000','2', 204, '水印顏色'),
  (35, 'watermark_pic',       '',  '2', 205, '水印圖片'),
  (36, 'watermark_position',  '3', '2', 206, '水印位置'),
  -- URL與模板（已隱藏，headless CMS 不使用）
  (37, 'url_rule_type',        '2', '2', 210, 'URL規則模式'),
  (38, 'url_break_char',      '_', '2', 211, 'URL分隔符'),
  (39, 'url_index_404',       '0', '1', 212, '首頁404跳轉'),
  (40, 'tpl_html_dir',        'html','2', 213, '模板HTML目錄'),
  (41, 'gzip',                '1', '1', 214, 'GZIP壓縮'),
  (42, 'content_tags_replace_num','3','2', 215, '內容關鍵詞替換次數'),
  (43, 'pagesize',            '15','2', 216, '默認分頁大小'),
  -- 存儲（v1.8.7: s3_access_key/s3_secret_key 已遷移至 Secrets Store，不在 D1 中）
  (44, 'storage_type',        'r2','2', 70, '存儲類型(r2/s3)'),
  (45, 's3_endpoint',         '',  '2', 71, 'S3/R2 端點'),
  (48, 's3_bucket',           '',  '2', 74, 'S3/R2 存儲桶'),
  (49, 's3_region',           'auto','2', 75, 'S3/R2 區域'),
  (50, 's3_public_url',       '',  '2', 76, 'S3/R2 公開URL');

-- ============================================================================
-- Section 16: 種子數據 — 默認管理員
-- ============================================================================
-- 密碼為 admin123 的雙 MD5 值，首次登錄後請修改
-- ============================================================================

INSERT OR IGNORE INTO ay_user (id, ucode, username, password, realname, rcodes, acodes, status, login_count) VALUES
  (1, '10001', 'admin', 'c5f7f0e8e6b3e3c8e3a0b3e3c8e3a0b3', '超級管理員', 'R101', 'cn', '1', 0);

-- ============================================================================
-- Section 17: 種子數據 — 默認公司與站點信息（佔位）
-- ============================================================================

INSERT OR IGNORE INTO ay_company (id, acode, name, address, contact, mobile, email, whatsapp) VALUES
  (1, 'cn', '公司名稱', '公司地址', '聯繫人', '', 'admin@example.com', '');

INSERT OR IGNORE INTO ay_site (id, acode, name, title, subtitle, domain, lang) VALUES
  (1, 'cn', 'default', '網站標題', '網站副標題', '', 'zh-hk');

-- ============================================================================
-- END
-- ============================================================================
