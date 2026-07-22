-- ============================================================================
-- 0006_cleanup_m205_menu.sql
-- ============================================================================
-- v1.9.5: 清理 M205 舊菜單遺留
-- M204 = 自定義表單（啟用，/admin/forms/submissions）
-- M205 = 自定義表單(舊)（已禁用 status='0'，殘留遺留）
--
-- 問題：M205 status='0' 但仍分配到 R101/R102/R103 角色權限中，
-- 導致角色管理頁面顯示重複的「自定義表單」選項。
-- 修復：從所有角色的 levels 和 ay_role_level 中徹底移除 M205
-- ============================================================================

-- 1. 從 ay_role_level 移除 M205
DELETE FROM ay_role_level WHERE level = 'M205';

-- 2. 從 ay_role.levels 字串中移除 M205（冪等）
UPDATE ay_role SET levels = REPLACE(levels, 'M205,', '') WHERE levels LIKE '%M205,%';
UPDATE ay_role SET levels = REPLACE(levels, ',M205', '') WHERE levels LIKE '%,M205%';
UPDATE ay_role SET levels = REPLACE(levels, 'M205', '') WHERE levels = 'M205';

-- 3. 徹底刪除 M205 菜單記錄（已停用且無實際功能）
DELETE FROM ay_menu WHERE mcode = 'M205';
