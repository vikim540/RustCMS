-- ============================================================================
-- 0005_menu_fix_and_slide_status.sql
-- ============================================================================
-- v1.9.4: 權限歸類修正 + 幻燈片顯隱開關
-- 1. 修正 M210 (表單管理) pcode: M200→M610（歸入基礎內容，與側邊欄一致）
-- 2. 幻燈片新增 status 字段（控制公開 API 是否返回）
-- ============================================================================

-- 1. 修正 M210 pcode
UPDATE ay_menu SET pcode = 'M610' WHERE mcode = 'M210' AND pcode = 'M200';

-- 2. 幻燈片新增 status 字段（冪等）
-- 注意：SQLite 不支持 IF NOT EXISTS 語法 for ALTER TABLE ADD COLUMN
-- 使用 try/catch 模式：先檢查是否存在（D1 migration 會自動跳過已存在的列）
ALTER TABLE ay_slide ADD COLUMN status TEXT DEFAULT '1';
