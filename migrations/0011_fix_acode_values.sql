-- ============================================================================
-- 遷移 0011：修復 acode 舊值（PbootCMS 語言代碼 → 多站點標識）
-- ============================================================================
-- 背景：
--   PbootCMS 原版 acode 字段固定使用 'cn'（簡體中文語言代碼）。
--   v1.6.0 多站點架構上線後，acode 字段被重新定義為站點標識（site_id），
--   取值為 endoscopy / smile / vision（對應 ay_site_registry.site_id）。
--   主站點（is_primary=1）為 endoscopy。
--
--   本遷移將歷史數據中殘留的 'cn' / 'en' 語言代碼統一更新為主站點 'endoscopy'。
--
-- 處理範圍（acode 作為站點標識的業務表）：
--   ay_content        文章表
--   ay_content_sort   欄目表
--   ay_site           站點信息表
--   ay_company        公司信息表
--   ay_message        留言表
--   ay_link           友情連結表
--   ay_slide          幻燈片表
--   ay_tags           標籤表
--
-- 不處理的表（acode 為區域/語言代碼，非站點標識）：
--   ay_area           區域表（acode 為區域主鍵，如 'cn'=簡體中文）
--   ay_role_area      角色區域關聯表（acode 指向 ay_area.acode）
--   ay_user.acodes    用戶可訪問區域（複數字段，已由 ay_user_site 表取代，
--                     超管默認擁有所有站點權限，無需遷移此字段值）
--
-- 說明：
--   1. 冪等 UPDATE 語句，可重複執行
--   2. 'cn' 和 'en' 均映射到主站點 'endoscopy'
--      （'en' 為早期英文版殘留，主站點同時承載中英文內容）
--   3. 各站點庫（smile/vision）需單獨執行對應 acode 更新，
--      本遷移僅處理主庫 endoscopy 的歷史 'cn'/'en' 數據
-- ============================================================================

-- 1. ay_content 文章表
UPDATE ay_content SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_content SET acode = 'endoscopy' WHERE acode = 'en';

-- 2. ay_content_sort 欄目表
UPDATE ay_content_sort SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_content_sort SET acode = 'endoscopy' WHERE acode = 'en';

-- 3. ay_site 站點信息表
UPDATE ay_site SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_site SET acode = 'endoscopy' WHERE acode = 'en';

-- 4. ay_company 公司信息表
UPDATE ay_company SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_company SET acode = 'endoscopy' WHERE acode = 'en';

-- 5. ay_message 留言表
UPDATE ay_message SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_message SET acode = 'endoscopy' WHERE acode = 'en';

-- 6. ay_link 友情連結表
UPDATE ay_link SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_link SET acode = 'endoscopy' WHERE acode = 'en';

-- 7. ay_slide 幻燈片表
UPDATE ay_slide SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_slide SET acode = 'endoscopy' WHERE acode = 'en';

-- 8. ay_tags 標籤表
UPDATE ay_tags SET acode = 'endoscopy' WHERE acode = 'cn';
UPDATE ay_tags SET acode = 'endoscopy' WHERE acode = 'en';

-- ============================================================================
-- 驗證查詢（執行後可手動運行確認無殘留）：
--   SELECT acode, COUNT(*) FROM ay_content GROUP BY acode;
--   SELECT acode, COUNT(*) FROM ay_content_sort GROUP BY acode;
--   SELECT acode, COUNT(*) FROM ay_message GROUP BY acode;
--   -- 預期：僅剩 'endoscopy' 及其他有效站點標識，無 'cn'/'en' 殘留
-- ============================================================================
