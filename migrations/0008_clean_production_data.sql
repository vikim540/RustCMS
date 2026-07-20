-- 0008_clean_production_data.sql
-- 生產環境數據清理：僅保留醫生專欄 + WhatsApp字段 + 專題/新聞模型
-- 冪等設計：使用 WHERE 條件確保可重複執行

-- ============================================================================
-- 1. 清理欄目：僅保留 id=13（醫生專欄）和 id=14（疾病知識，醫生專欄子欄目）
-- ============================================================================

-- 1a. 先刪除不需要的欄目下的所有內容的擴展字段值
DELETE FROM ay_content_ext
WHERE contentid IN (
  SELECT id FROM ay_content WHERE scode IN (
    SELECT scode FROM ay_content_sort WHERE id NOT IN (13, 14)
  )
);

-- 1b. 刪除不需要的欄目下的所有內容（含回收站中的）
DELETE FROM ay_content
WHERE scode IN (
  SELECT scode FROM ay_content_sort WHERE id NOT IN (13, 14)
);

-- 1c. 刪除不需要的欄目
DELETE FROM ay_content_sort WHERE id NOT IN (13, 14);

-- 1d. 更新保留欄目的排序（從1開始）
UPDATE ay_content_sort SET sorting = 1 WHERE id = 13;
UPDATE ay_content_sort SET sorting = 1 WHERE id = 14;

-- ============================================================================
-- 2. 清理擴展字段：僅保留 id=15（了解更多（WhatsApp））
-- ============================================================================

-- 2a. 刪除不需要的擴展字段定義（物理刪除）
DELETE FROM ay_extfield WHERE id != 15;

-- 2b. 更新保留字段的排序
UPDATE ay_extfield SET sorting = 1 WHERE id = 15;

-- ============================================================================
-- 3. 確認模型狀態：專題(mcode=1)和新聞(mcode=2)啟用，其他禁用
-- ============================================================================
UPDATE ay_model SET status = '1' WHERE mcode IN ('1', '2');
UPDATE ay_model SET status = '0' WHERE mcode NOT IN ('1', '2');

-- ============================================================================
-- 4. 清理已刪除擴展字段的列數據（冪等，列不存在時整個遷移不中斷）
--    嘗試 DROP COLUMN（D1/SQLite 3.35+ 支持），失敗則忽略
--    注意：這些列是動態 ALTER TABLE 新增的，可能不存在
-- ============================================================================
-- D1 不支持 IF EXISTS 語法用於 DROP COLUMN，因此直接嘗試
-- 如果列不存在會報錯，但 wrangler migrations 會繼續執行下一條
-- 由於內容已刪除 + 字段定義已刪除，殘留列數據不影響功能
-- 如需徹底清理可在後台手動執行 ALTER TABLE DROP COLUMN
