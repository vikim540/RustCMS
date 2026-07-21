-- ============================================================================
-- Migration 0004: 設置 SMTP 和郵件服務默認配置
-- 用戶提供的 SMTP 資料: smtp.139.com 465
-- 注意: Workers 無法直接 TCP 連接 SMTP, 此配置供參考
--       實際發信通過 MailChannels/Resend HTTP API (由 mail_provider 配置決定)
-- ============================================================================

-- 設置 SMTP 伺服器配置 (僅當值為空時更新, 不覆蓋用戶已配置的值)
UPDATE ay_config SET value = 'smtp.139.com' WHERE name = 'smtp_server' AND (value = '' OR value IS NULL);
UPDATE ay_config SET value = '465' WHERE name = 'smtp_port' AND (value = '' OR value IS NULL OR value = '25');
UPDATE ay_config SET value = '1' WHERE name = 'smtp_ssl' AND (value = '' OR value IS NULL OR value = '0');
UPDATE ay_config SET value = 'vikim_lee@139.com' WHERE name = 'smtp_username' AND (value = '' OR value IS NULL);
-- SMTP 密碼已遷移到 Cloudflare Secrets Store 管理，不再寫入數據庫遷移文件
-- 此處僅在值為空時顯式設置為空字符串，保持配置行存在但不存儲明文密碼
UPDATE ay_config SET value = '' WHERE name = 'smtp_password' AND (value = '' OR value IS NULL);

-- 設置郵件服務配置 (mail_provider 默認 mailchannels, 發件人使用 SMTP 用戶名)
UPDATE ay_config SET value = 'mailchannels' WHERE name = 'mail_provider' AND (value = '' OR value IS NULL);
UPDATE ay_config SET value = 'vikim_lee@139.com' WHERE name = 'mail_from' AND (value = '' OR value IS NULL);
UPDATE ay_config SET value = 'RustCMS 系統通知' WHERE name = 'mail_from_name' AND (value = '' OR value IS NULL);

-- 設置留言接收郵箱 (默認使用 SMTP 用戶名)
UPDATE ay_config SET value = 'vikim_lee@139.com' WHERE name = 'message_send_to' AND (value = '' OR value IS NULL);

-- 啟用留言郵件通知
UPDATE ay_config SET value = '1' WHERE name = 'message_send_mail' AND (value = '' OR value IS NULL OR value = '0');
