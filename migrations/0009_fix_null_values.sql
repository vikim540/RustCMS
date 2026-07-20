-- ============================================================================
-- 遷移 0009：修復 NULL 值（所有站點通用）
-- 由於多站點架構每個站點的 acode 不同（endoscopy/smile/vision），
-- acode 更新通過單獨的 wrangler d1 execute 命令按站點執行。
-- ============================================================================

-- 1. 修復 ay_content 表 NULL 值
UPDATE ay_content SET titlecolor = '' WHERE titlecolor IS NULL;
UPDATE ay_content SET subtitle = '' WHERE subtitle IS NULL;
UPDATE ay_content SET filename = '' WHERE filename IS NULL;
UPDATE ay_content SET author = '' WHERE author IS NULL;
UPDATE ay_content SET source = '' WHERE source IS NULL;
UPDATE ay_content SET outlink = '' WHERE outlink IS NULL;
UPDATE ay_content SET ico = '' WHERE ico IS NULL;
UPDATE ay_content SET pics = '' WHERE pics IS NULL;
UPDATE ay_content SET picstitle = '' WHERE picstitle IS NULL;
UPDATE ay_content SET tags = '' WHERE tags IS NULL;
UPDATE ay_content SET enclosure = '' WHERE enclosure IS NULL;
UPDATE ay_content SET keywords = '' WHERE keywords IS NULL;
UPDATE ay_content SET description = '' WHERE description IS NULL;
UPDATE ay_content SET urlname = '' WHERE urlname IS NULL;
UPDATE ay_content SET gnote = '' WHERE gnote IS NULL;
UPDATE ay_content SET gid = '' WHERE gid IS NULL;
UPDATE ay_content SET gtype = '4' WHERE gtype IS NULL;
UPDATE ay_content SET subscode = '' WHERE subscode IS NULL;
UPDATE ay_content SET create_user = '' WHERE create_user IS NULL;
UPDATE ay_content SET update_user = '' WHERE update_user IS NULL;
UPDATE ay_content SET content = '' WHERE content IS NULL;

-- 2. 修復 ay_content_sort 表 NULL 值
UPDATE ay_content_sort SET subname = '' WHERE subname IS NULL;
UPDATE ay_content_sort SET listtpl = '' WHERE listtpl IS NULL;
UPDATE ay_content_sort SET contenttpl = '' WHERE contenttpl IS NULL;
UPDATE ay_content_sort SET ico = '' WHERE ico IS NULL;
UPDATE ay_content_sort SET pic = '' WHERE pic IS NULL;
UPDATE ay_content_sort SET title = '' WHERE title IS NULL;
UPDATE ay_content_sort SET keywords = '' WHERE keywords IS NULL;
UPDATE ay_content_sort SET description = '' WHERE description IS NULL;
UPDATE ay_content_sort SET filename = '' WHERE filename IS NULL;
UPDATE ay_content_sort SET outlink = '' WHERE outlink IS NULL;
UPDATE ay_content_sort SET def1 = '' WHERE def1 IS NULL;
UPDATE ay_content_sort SET def2 = '' WHERE def2 IS NULL;
UPDATE ay_content_sort SET def3 = '' WHERE def3 IS NULL;
UPDATE ay_content_sort SET urlname = '' WHERE urlname IS NULL;
UPDATE ay_content_sort SET gid = '' WHERE gid IS NULL;
UPDATE ay_content_sort SET gtype = '4' WHERE gtype IS NULL;

-- 3. 修復 ay_site 表 NULL 值
UPDATE ay_site SET title = '' WHERE title IS NULL;
UPDATE ay_site SET subtitle = '' WHERE subtitle IS NULL;
UPDATE ay_site SET lang = 'zh-hk' WHERE lang IS NULL;
UPDATE ay_site SET logo = '' WHERE logo IS NULL;
UPDATE ay_site SET domain = '' WHERE domain IS NULL;
UPDATE ay_site SET keywords = '' WHERE keywords IS NULL;
UPDATE ay_site SET description = '' WHERE description IS NULL;
UPDATE ay_site SET icp = '' WHERE icp IS NULL;
UPDATE ay_site SET copyright = '' WHERE copyright IS NULL;
UPDATE ay_site SET statistical = '' WHERE statistical IS NULL;
UPDATE ay_site SET theme = '' WHERE theme IS NULL;

-- 4. 修復 ay_company 表 NULL 值
UPDATE ay_company SET address = '' WHERE address IS NULL;
UPDATE ay_company SET postcode = '' WHERE postcode IS NULL;
UPDATE ay_company SET contact = '' WHERE contact IS NULL;
UPDATE ay_company SET mobile = '' WHERE mobile IS NULL;
UPDATE ay_company SET phone = '' WHERE phone IS NULL;
UPDATE ay_company SET fax = '' WHERE fax IS NULL;
UPDATE ay_company SET email = '' WHERE email IS NULL;
UPDATE ay_company SET qq = '' WHERE qq IS NULL;
UPDATE ay_company SET weixin = '' WHERE weixin IS NULL;
UPDATE ay_company SET icp = '' WHERE icp IS NULL;
UPDATE ay_company SET blicense = '' WHERE blicense IS NULL;
UPDATE ay_company SET other = '' WHERE other IS NULL;
UPDATE ay_company SET legal = '' WHERE legal IS NULL;
UPDATE ay_company SET business = '' WHERE business IS NULL;
UPDATE ay_company SET whatsapp = '' WHERE whatsapp IS NULL;

-- 5. 修復 ay_slide 表 NULL 值
UPDATE ay_slide SET title = '' WHERE title IS NULL;
UPDATE ay_slide SET subtitle = '' WHERE subtitle IS NULL;
UPDATE ay_slide SET link = '' WHERE link IS NULL;
UPDATE ay_slide SET pic = '' WHERE pic IS NULL;
UPDATE ay_slide SET pic_mobile = '' WHERE pic_mobile IS NULL;
UPDATE ay_slide SET button_text = '' WHERE button_text IS NULL;
UPDATE ay_slide SET gid = '' WHERE gid IS NULL;
UPDATE ay_slide SET sorting = 1 WHERE sorting IS NULL;
UPDATE ay_slide SET create_user = '' WHERE create_user IS NULL;
UPDATE ay_slide SET update_user = '' WHERE update_user IS NULL;

-- 6. 修復 ay_link 表 NULL 值
UPDATE ay_link SET name = '' WHERE name IS NULL;
UPDATE ay_link SET link = '' WHERE link IS NULL;
UPDATE ay_link SET logo = '' WHERE logo IS NULL;
UPDATE ay_link SET gid = '' WHERE gid IS NULL;
UPDATE ay_link SET sorting = 1 WHERE sorting IS NULL;
UPDATE ay_link SET create_user = '' WHERE create_user IS NULL;
UPDATE ay_link SET update_user = '' WHERE update_user IS NULL;

-- 7. 修復 ay_tags 表 NULL 值
UPDATE ay_tags SET name = '' WHERE name IS NULL;
UPDATE ay_tags SET link = '' WHERE link IS NULL;
UPDATE ay_tags SET sorting = 1 WHERE sorting IS NULL;
UPDATE ay_tags SET create_user = '' WHERE create_user IS NULL;
UPDATE ay_tags SET update_user = '' WHERE update_user IS NULL;

-- 8. 修復 ay_message 表 NULL 值
UPDATE ay_message SET contacts = '' WHERE contacts IS NULL;
UPDATE ay_message SET mobile = '' WHERE mobile IS NULL;
UPDATE ay_message SET content = '' WHERE content IS NULL;
UPDATE ay_message SET user_ip = '' WHERE user_ip IS NULL;
UPDATE ay_message SET user_os = '' WHERE user_os IS NULL;
UPDATE ay_message SET user_bs = '' WHERE user_bs IS NULL;
UPDATE ay_message SET recontent = '' WHERE recontent IS NULL;
UPDATE ay_message SET uid = '' WHERE uid IS NULL;
UPDATE ay_message SET status = '0' WHERE status IS NULL;
UPDATE ay_message SET create_user = '' WHERE create_user IS NULL;
UPDATE ay_message SET update_user = '' WHERE update_user IS NULL;
