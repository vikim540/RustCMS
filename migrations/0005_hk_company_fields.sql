-- 遷移 0005: 公司信息字段香港本地化
-- 1. 新增 whatsapp 列（香港主流通訊工具）
-- 2. 更新 ay_site lang 為 zh-hk（香港繁體）
-- 注意：qq、icp、postcode、theme 字段保留在數據庫中（向後兼容），
--       但前後端不再使用，避免影響已有數據。

-- 新增 WhatsApp 字段到公司信息表
ALTER TABLE ay_company ADD COLUMN whatsapp TEXT DEFAULT '';

-- 更新站點語言為香港繁體
UPDATE ay_site SET lang = 'zh-hk' WHERE lang = 'zh-cn' OR lang IS NULL;
