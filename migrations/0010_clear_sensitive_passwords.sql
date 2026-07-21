-- ============================================================================
-- 遷移 0010：清除數據庫中的敏感密碼/密鑰字段
-- ============================================================================
-- 背景：
--   原先 SMTP 密碼、API Secret、推送 Token、郵件 API Key、Turnstile 密鑰等
--   敏感憑證存儲在 ay_config 表中，存在明文洩露風險。
--   現已將所有敏感憑證遷移到 Cloudflare Secrets Store 統一管理，
--   Worker 運行時通過 env.secret() 讀取，不再依賴數據庫。
--
-- 說明：
--   1. 本遷移為冪等 UPDATE 語句，可重複執行（多次執行結果一致）
--   2. 僅清除敏感字段值，不刪除配置行本身（保留 name/sorting 結構）
--   3. ay_user.password 為用戶登錄密碼（雙 MD5），不屬於本次清除範圍
-- ============================================================================

-- 1. SMTP 密碼（原硬編碼於 0004 遷移，現已廢棄）
UPDATE ay_config SET value = '' WHERE name = 'smtp_password';

-- 2. API 認證密鑰（原 SSG 對接使用）
UPDATE ay_config SET value = '' WHERE name = 'api_secret';

-- 3. 百度推送 Token（已隨香港本地化廢棄，改用 Google/Bing 站點驗證）
UPDATE ay_config SET value = '' WHERE name = 'baidu_zz_token';
UPDATE ay_config SET value = '' WHERE name = 'baidu_xzh_token';

-- 4. 郵件服務 API Key（MailChannels / Resend）
UPDATE ay_config SET value = '' WHERE name = 'mail_api_key';

-- 5. Cloudflare Turnstile 密鑰（若已通過 wrangler d1 execute 寫入，一併清除）
UPDATE ay_config SET value = '' WHERE name = 'turnstile_secret_key';

-- ============================================================================
-- 後續維護說明：
--   新增敏感配置項時，請一律通過 Cloudflare Secrets Store 管理：
--     wrangler secret put SMTP_PASSWORD
--     wrangler secret put MAIL_API_KEY
--     wrangler secret put TURNSTILE_SECRET_KEY
--   禁止再將任何密碼/密鑰/Token 寫入 ay_config 表或遷移文件。
-- ============================================================================
