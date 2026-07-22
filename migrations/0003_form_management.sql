-- ============================================================================
-- 0003_form_management.sql
-- ============================================================================
-- v1.9.2: 表單管理系統 — 支持創建多個表單，每個表單有獨立 API 端點
-- ============================================================================

-- 擴展 ay_form 表字段
ALTER TABLE ay_form ADD COLUMN description TEXT;
ALTER TABLE ay_form ADD COLUMN is_active TEXT DEFAULT '1';
ALTER TABLE ay_form ADD COLUMN sorting INTEGER DEFAULT 255;
ALTER TABLE ay_form ADD COLUMN status TEXT DEFAULT '1';
ALTER TABLE ay_form ADD COLUMN webhook_url TEXT;

-- 種子數據：默認表單
INSERT OR IGNORE INTO ay_form (id, fcode, form_name, description, is_active, sorting, status, create_time, update_time) VALUES
  (1, 'general', '通用表單', '默認通用表單（無指定 formId 時使用）', '1', 100, '1', datetime('now'), datetime('now')),
  (2, 'appointment', '預約表單', '預約/報名表單', '1', 200, '1', datetime('now'), datetime('now')),
  (3, 'contact', '聯絡表單', '聯絡/諮詢表單', '1', 300, '1', datetime('now'), datetime('now'));

-- 更新已存在的提交記錄，將 form_key 文字改為 form ID
UPDATE ay_form_submission SET form_key = '1' WHERE form_key = 'general';
UPDATE ay_form_submission SET form_key = '2' WHERE form_key = 'appointment';
UPDATE ay_form_submission SET form_key = '3' WHERE form_key = 'contact';

-- 新增菜單：基礎內容 → 表單管理
INSERT OR IGNORE INTO ay_menu (id, mcode, pcode, name, url, ico, sorting, status, shortcut, type) VALUES
  (55, 'M210', 'M200', '表單管理', '/admin/forms', '📝', 220, '1', '0', '1');

-- v1.9.0: M204 統一為自定義表單（取代留言管理）、M205 舊佔位禁用
UPDATE ay_menu SET name = '自定義表單', url = '/admin/forms/submissions' WHERE mcode = 'M204' AND name = '留言管理';
UPDATE ay_menu SET status = '0' WHERE mcode = 'M205';

-- 分配權限（ay_role_level + ay_role.levels 同步更新）
INSERT OR IGNORE INTO ay_role_level (rcode, level) VALUES
  ('R101', 'M210'),
  ('R102', 'M210'),
  ('R103', 'M210');

-- 同步更新 ay_role.levels（冪等：僅在 M210 不存在時追加）
UPDATE ay_role SET levels = levels || ',M210' WHERE rcode = 'R101' AND levels NOT LIKE '%M210%';
UPDATE ay_role SET levels = levels || ',M210' WHERE rcode = 'R102' AND levels NOT LIKE '%M210%';
UPDATE ay_role SET levels = levels || ',M210' WHERE rcode = 'R103' AND levels NOT LIKE '%M210%';
