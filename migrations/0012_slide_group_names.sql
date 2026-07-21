-- ============================================================================
-- 0012: 幻燈片分組名稱表
-- 新建 ay_slide_group 表，存儲分組 ID → 名稱映射
-- 解決問題：原前端用 localStorage 存分組名稱，不同賬號/設備無法共享
-- 種子數據：gid 1=首頁輪播, gid 2=費用一覽, gid 3=大腸鏡檢查
-- 需在所有站點庫執行（endoscopy-cms / smile-cms / vision-cms）
-- ============================================================================

CREATE TABLE IF NOT EXISTS ay_slide_group (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sorting INTEGER DEFAULT 255,
    create_time TEXT,
    update_time TEXT
);

-- 種子數據：用戶指定的 3 個分組
INSERT OR IGNORE INTO ay_slide_group (gid, name, sorting, create_time, update_time)
VALUES ('1', '首頁輪播', 1, datetime('now', '+8 hours'), datetime('now', '+8 hours'));
INSERT OR IGNORE INTO ay_slide_group (gid, name, sorting, create_time, update_time)
VALUES ('2', '費用一覽', 2, datetime('now', '+8 hours'), datetime('now', '+8 hours'));
INSERT OR IGNORE INTO ay_slide_group (gid, name, sorting, create_time, update_time)
VALUES ('3', '大腸鏡檢查', 3, datetime('now', '+8 hours'), datetime('now', '+8 hours'));
