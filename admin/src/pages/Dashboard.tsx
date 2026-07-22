import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

/** 統計數據結構 */
interface Stats {
  contentTotal: number
  sortTotal: number
  visitsTotal: number
  todayNew: number
}

/** 當前激活的分頁 */
type TabKey = 'overview' | 'versions' | 'api' | 'system'

/** 版本更新條目 */
interface VersionEntry {
  version: string
  date: string
  changes: string
  icon: string
  /** 是否為最新版本 */
  latest?: boolean
}

/** API 接口條目 */
interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  desc: string
  auth: boolean
}

/** 分頁定義 */
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: '概覽', icon: '📊' },
  { key: 'versions', label: '版本更新', icon: '🚀' },
  { key: 'api', label: 'API 開發手冊', icon: '📡' },
  { key: 'system', label: '系統信息', icon: '⚙️' },
]

/** 版本更新歷史（硬編碼，時區：Asia/Hong_Kong） */
const VERSIONS: VersionEntry[] = [
  {
    version: 'v1.9.6',
    date: '2026-07-22 15:18:14',
    icon: '🎨',
    latest: true,
    changes: '🎨 保存提示 UI 優化\n\n📋 編輯保存提示\n• 保存提示改為 fixed 頂部中間定位（頁面較長時也能看見）\n• 提示 5 秒後自動隱藏（無需手動關閉）\n• 無修改提示：深色背景「✅ 此次無修改，未觸發保存」\n• 有修改提示：藍色背景「📝 此次修改了 N 處：字段名」',
  },
  {
    version: 'v1.9.5',
    date: '2026-07-22 15:05:01',
    icon: '🔧',
    latest: false,
    changes: '🔧 權限清理 + 媒體庫刪除狀態 + 編輯保存比對 + 編輯器排版\n\n📋 權限修正\n• 徹底清除 M205（自定義表單舊）菜單 + 角色權限（M204 為現行啟用版本）\n• Roles.tsx 權限樹不再顯示重複的表單選項\n\n📋 媒體庫優化\n• 刪除圖片時顯示覆蓋層狀態：🔄 [文件名] 刪除中...\n• 刪除按鈕加 disabled 防重複點擊\n\n📋 文章編輯保存\n• 編輯模式保存時自動比對修改字段，提示「此次修改了 N 處：字段名」\n• 無修改時提示「此次無修改，未觸發保存」並跳過後端請求\n\n📋 編輯器排版\n• 有序列表懸掛縮進 CSS（序號在外，標題描述左對齊嚴絲合縫）\n• 新增 HTML 源碼按鈕（工具列末尾 <> 圖標），切換 textarea 模式直接編輯 HTML',
  },
  {
    version: 'v1.9.4',
    date: '2026-07-22 14:29:42',
    icon: '🔧',
    latest: false,
    changes: '🔧 權限歸類修正 + 幻燈片顯隱控制\n\n📋 權限修正\n• M210 (表單管理) pcode: M200→M610（歸入基礎內容，與側邊欄一致）\n• 修正前 Roles.tsx 權限樹中 M210 錯誤顯示在「文章內容」下\n\n📋 幻燈片管理\n• 新增顯示/隱藏開關（status 字段，關閉後不返回到公開 API）\n• 公開 API handleListSlides 增加 status=\'1\' 過濾\n• 移除新增對話框中冗餘的分組 ID 文字輸入框（已有下拉選擇）\n• 切換分組時自動計算排序序號（動態自增，無需手動填寫）',
  },
  {
    version: 'v1.9.3',
    date: '2026-07-22 14:01:06',
    icon: '🔒',
    latest: false,
    changes: '🔒 表單提交 API 安全加固 + 路徑隱蔽化\n\n📋 API 簡化\n• 移除舊 POST /api/v1/messages（留言系統，已被統一表單取代）\n• 移除 POST /api/v1/forms/submit 和 /:formId（路徑太標準化）\n• 移除公開 GET /api/v1/forms/active（不需暴露表單結構）\n• 新增 POST /api/v1/f/:token — 16位隨機 token 隱蔽化端點\n\n🔒 安全層級\n• 1. submit_token 隨機路徑（62^16 種組合，不可猜測）\n• 2. Honeypot 蜜罐字段（_hp 字段被填 → 靜默丟棄）\n• 3. Origin/Referer 校驗（allowed_origins 配置時生效）\n• 4. 可選 Turnstile 人機驗證（每個表單可單獨開啟）\n• 5. 速率限制 1次/10秒/IP\n\n📋 新增字段\n• ay_form 新增 submit_token / turnstile_enabled / allowed_origins\n• FormManager 表格顯示隱蔽化端點 + 安全狀態徽章\n• 編輯對話框新增安全配置區域（Turnstile 開關 + 來源域名）\n• 表格新增 📋 複製端點 + 🔄 重新生成 token 按鈕',
  },
  {
    version: 'v1.9.2',
    date: '2026-07-22 11:59:05',
    icon: '📝',
    latest: false,
    changes: '📝 表單管理系統 + Settings Tab 修正\n\n📋 新功能：表單管理\n• 新增表單管理頁面（基礎內容 → 表單管理，M210 權限）\n• 支持創建/編輯/刪除多個表單（每個表單有獨立 API 端點）\n• 新增 POST /api/v1/forms/submit/:formId 精準路由到具體表單\n• 每個表單可配置專屬 Webhook URL（獨立推送通道）\n• 表單啟用/停用開關（is_active 控制是否展示在擴展內容側邊欄）\n• 活躍表單自動注入側邊欄「擴展內容」分組（按表單名稱顯示）\n• 點擊側邊欄表單名 → 自動篩選對應表單的提交記錄\n• FormSubmissions 顯示表單名稱（取代原始 form_key）\n\n📋 Settings Tab 修正\n• WebAPI 獨立為單獨 Tab（不再混在基本配置中）\n• 修正「其他配置」在每個 Tab 重複出現的問題（僅在基本配置 Tab 顯示）\n\n📋 數據庫變更\n• ay_form 表新增 description / is_active / sorting / status / webhook_url 字段\n• 新增 M210 菜單項 + R101/R102/R103 角色權限分配',
  },
  {
    version: 'v1.9.1',
    date: '2026-07-22 11:02:17',
    icon: '🎨',
    latest: false,
    changes: '🎨 UI 統一 + 批量操作 + Settings Tab 重構\n\n📋 FormSubmissions UI 修正\n• 統一 p-6 padding、text-2xl font-bold 標題（與 Messages/Tags/Links 一致）\n• 統一按鈕 class（rounded-md / hover:bg-accent / bg-primary text-primary-foreground）\n• 統一對話框結構（sticky header/footer、bg-black/50 遮罩）\n• 新增批量刪除 + 批量狀態更新（checkbox 選擇 + 批量操作欄）\n• 新增 form_key 篩選下拉（多表單類型自動檢測）\n• 新增 form-keys 端點 + batch 操作端點\n\n📋 Settings Tab 重構\n• 5 個 Tab 導航：功能開關 / 基本配置 / 安全配置 / 存儲配置 / 通知配置\n• 通知配置 Tab 中 Webhook 獨立一個 section 板塊展示\n• Webhook section 包含 webhook_url / form_webhook_url 及各類開關',
  },
  {
    version: 'v1.9.0',
    date: '2026-07-22 10:33:37',
    icon: '📝',
    latest: false,
    changes: '📝 統一表單系統（取代留言管理）\n\n📋 新功能\n• 新增 ay_form_submission 表（動態 JSON 存儲，支持任意字段結構）\n• 公開端點 POST /api/v1/forms/submit（接收表單提交，Form Rate Limit）\n• 管理端 CRUD：列表/詳情/狀態更新/刪除/統計\n• 釘魯 ActionCard 推送到客服群（form_webhook_url 配置）\n• 前端瀑布流網格佈局（響應式 auto-fill minmax）\n• 按週分隔 HR 橫線（週一至週日）\n• 搜索（姓名/電話/郵箱）+ 狀態篩選 + 排序\n• 詳情彈窗（點擊卡片展開全部字段）\n• 自動標記已讀（待處理 → 已處理）\n• 統計卡片（待處理/已處理/已封存計數）\n\n📋 菜單統一\n• M204 留言管理 → 自定義表單（URL: /admin/forms/submissions）\n• M205 舊自定義表單佔位項禁用\n• 側邊欄圖標 💬 → 📝',
  },
  {
    version: 'v1.8.8',
    date: '2026-07-22 09:31:40',
    icon: '🐛',
    latest: false,
    changes: '🐛 Quill 編輯器載入修復 + 全局錯誤通知一鍵複製重構\n\n📋 Quill 編輯器修復\n• CSP script-src 缺少 cdnjs.cloudflare.com 導致 Quill 腳本被瀏覽器阻擋\n• _headers CSP 新增 cdnjs.cloudflare.com 到 script-src 和 style-src\n\n📋 全局錯誤通知重構\n• api.ts 新增 buildTechReport() 函數，捕獲完整技術診斷信息\n• 一鍵複製內容：請求方法/URL/Headers(脫敏)/Body + 響應狀態/Body/錯誤碼 + 調用堆疊（文件位置+行號）\n• UI 展示保持簡短（標題+簡述），複製內容包含精準調試信息',
  },
  {
    version: 'v1.8.7',
    date: '2026-07-22 09:23:28',
    icon: '🔧',
    latest: false,
    changes: '🔧 S3 憑證遷移 Secrets Store + 安全修復 + TS 編譯修復\n\n📋 S3 憑證遷移\n• s3_access_key / s3_secret_key 從 D1 遷移至 Cloudflare Secrets Store\n• wrangler.jsonc 新增 S3_ACCESS_KEY_STORE / S3_SECRET_KEY_STORE 綁定\n• storage.ts / config.ts / system.ts 全鏈路重構（S3Secrets 參數傳遞）\n• SecretsStoreSecretWritable 接口（補充 @cloudflare/workers-types 未聲明的 put()）\n• config.ts 虛擬配置注入（前端讀取 *** 遮罩，寫入路由至 Secrets Store）\n• 18 條 index.ts 路由同步更新\n\n📋 安全修復\n• MIME 白名單：移除 SVG（XSS 向量）、修復空值繞過\n• sanitize.ts：修復 regex 繞過（[/"]+ 分隔符屬性注入）\n• site.ts getSiteInitSql：3 處 schema drift 修復\n\n📋 清理與修復\n• 遷移文件合併（15 個 → 1 個冪等 0001_init.sql）\n• 刪除 open_wap / wap_domain / wap_site_dir 移動端殘留\n• ay_config sorting 衝突修復（水印→200-206、URL→210-216、webhook 去重）\n• TypeScript 9 個預存編譯錯誤修復（ExecutionContext/Queue/Scheduled handler 類型、js-md5 導入、ArrayBuffer、content.ts 類型推斷）',
  },
  {
    version: 'v1.8.6',
    date: '2026-07-22 08:05:05',
    icon: '🔐',
    latest: false,
    changes: '🔐 Turnstile 密鑰遷移至 Secrets Store（修復 v1.7.0 遺留問題）\n\n📋 根因\n• v1.7.0 遷移 0010_clear_sensitive_passwords.sql 清空了 D1 中的 turnstile_secret_key\n• 意圖是遷移到 Secrets Store，但代碼未同步更新（auth.ts 仍從 D1 讀取）\n• 導致 verifyTurnstile() 始終拿到空字串，所有登錄被人機驗證擋住\n• 這是「改了一處、留一處」的代碼一致性問題\n\n📋 修復\n• Turnstile secret key 存入 Cloudflare Secrets Store（TURNSTILE_SECRET_KEY）\n• wrangler.jsonc 新增 TURNSTILE_SECRET_STORE 綁定\n• auth.ts handleLogin() 改為接收 turnstileSecret 參數（從 Secrets Store 讀取）\n• index.ts login 路由傳入 await c.env.TURNSTILE_SECRET_STORE.get()\n• 重新啟用 Turnstile（turnstile_enabled = 1）\n• 瀏覽器驗證：Turnstile widget 正常渲染+驗證，登錄流程正常',
  },
  {
    version: 'v1.8.5',
    date: '2026-07-22 07:53:09',
    icon: '🐛',
    latest: false,
    changes: '🐛 緊急修復：Turnstile secret key 為空導致所有賬號無法登錄\n\n📋 根因\n• 數據庫 ay_config 中 turnstile_secret_key 為空字串\n• verifyTurnstile() 在 secret key 為空時返回 false（拒絕所有登錄）\n• 即使 Turnstile widget 正常渲染並生成 token，後端也無法驗證\n• 疊加 v1.8.3 的 err() bug（code 2007 返回 401），前端顯示「登錄已過期」\n\n📋 修復\n• 臨時停用 Turnstile（turnstile_enabled = 0）恢復登錄\n• verifyTurnstile() 防禦性修復：secret key 為空時放行（return true）\n  - 與網絡異常放行邏輯一致，避免配置丟失鎖死所有用戶\n  - 僅 token 為空時才拒絕（return false）',
  },
  {
    version: 'v1.8.4',
    date: '2026-07-21 18:48:50',
    icon: '🐛',
    latest: false,
    changes: '🐛 緊急修復：v1.8.3 安全加固導致所有賬號無法登錄\n\n📋 根因分析（兩個問題疊加）\n• 問題 1：CSP connect-src 缺少 challenges.cloudflare.com\n  - v1.8.3 的 _headers 設置 connect-src \'self\'\n  - Turnstile JS 需向 challenges.cloudflare.com 發起 API 調用\n  - CSP 阻擋 → Turnstile 無法獲取 token → 登錄失敗\n• 問題 2：err() 函數 HTTP 狀態碼映射錯誤\n  - 原邏輯：code >= 2000 ? 401 : 400\n  - Turnstile 失敗(2007)和密碼錯誤(2001)都返回 HTTP 401\n  - 前端攔截 401 → 顯示「登錄已過期」而非實際錯誤\n\n📋 修復內容\n• _headers：connect-src 加入 https://challenges.cloudflare.com\n• response.ts：err() 改用 AUTH_ERROR_CODES 白名單（2002/2003/2004/2006）\n  - 僅認證過期類錯誤返回 401，其他錯誤返回 400\n  - 前端正確顯示實際錯誤消息（如「人機驗證失敗，請重試」）',
  },
  {
    version: 'v1.8.3',
    date: '2026-07-21 18:01:35',
    icon: '🔒',
    latest: false,
    changes: '🔒 安全加固 P0-P3（防禦縱深，通用 HTTP 標準）\n\n📋 P0：安全 HTTP 響應頭\n• Worker 中間件統一設置 6 個安全頭\n  - X-Content-Type-Options: nosniff（防 MIME 嗅探）\n  - X-Frame-Options: DENY（防點擊劫持）\n  - Referrer-Policy: strict-origin-when-cross-origin\n  - Permissions-Policy: camera/microphone/geolocation/payment 全禁\n  - Strict-Transport-Security: HSTS 預載入\n  - Content-Security-Policy: default-src \'none\'（API 只返回 JSON，最嚴格策略）\n• Pages 新增 _headers 文件（前端 SPA 安全頭，CSP 允許 Turnstile）\n• 這些是通用 HTTP 安全標準，非 Cloudflare 特有\n\n📋 P1：HTML 淨化（XSS 防禦）\n• 新增 src/utils/sanitize.ts（輕量級純函數，無 DOM 依賴）\n• sanitizeHtml()：移除 <script>、危險標籤、on* 事件、javascript: 協議\n• stripHtmlTags()：剝離所有 HTML 標籤（用於 description/keywords）\n• 整合到 handleCreateContent + handleUpdateContent\n\n📋 P2：輸入長度校驗 + 請求體限制\n• FIELD_LENGTH_LIMITS 常量定義 18 個字段最大長度（新聞網站場景）\n• validateFieldLengths() 校驗函數，超長返回明確錯誤消息\n• 請求體大小限制 2MB（排除文件上傳 multipart/form-data）\n\n📋 P3：文件上傳 MIME 白名單\n• ALLOWED_MIME_TYPES 白名單（圖片/視頻/音頻/PDF/文本/ZIP）\n• 非白名單類型返回 1001 錯誤，拒絕可執行文件上傳',
  },
  {
    version: 'v1.8.2',
    date: '2026-07-21 17:37:10',
    icon: '🧹',
    latest: false,
    changes: '🧹 數據庫清理 + 媒體庫 bug 修復 + 日誌分類重組 + 組件抽象\n\n📋 數據庫\n• 清理 ay_content_ext 幽靈字段（13 個無定義的 ext_* 刪除）\n  - 保留：extid, contentid, ext_price, ext_type, ext_color（PbootCMS 原版）, ext_content_whatsapp\n  - 三個數據庫（endoscopy/smile/vision）同步清理\n\n🐛 Bug 修復\n• 媒體庫上傳 WebP 變成 blob 文件\n  - 根因：browser-image-compression 對 WebP 二次壓縮時 Blob name 異常\n  - 修復：WebP 跳過壓縮直接上傳 + 後端 generateKey 從 Content-Type 推斷擴展名\n\n📋 日誌分類重組（7 類完全互斥）\n• 新增 🕷️ 爬蟲日誌 tab（spider）\n• 「系統日誌」重命名為「管理操作」（更準確）\n• 「內容日誌」重命名為「內容操作」\n• 頁面標題從「系統日誌」改為「操作日誌」\n\n🔧 組件抽象\n• 新增 ImagePreviewWithRemove 統一組件\n  - 取代 ContentEdit 中 3 處重複的圖片預覽+移除按鈕\n  - 統一圓形按鈕樣式，消除樣式不一致',
  },
  {
    version: 'v1.8.1',
    date: '2026-07-21 16:32:54',
    icon: '📝',
    latest: false,
    changes: '📝 文章詳情 API 重構：參考 PbootCMS 平鋪模式\n\n📋 變更\n• GET /contents/:idOrSlug 響應結構重構，移除 sort/extFields/extValues 獨立對象\n  - 欄目名稱平鋪到 content.sortname（參考 PbootCMS b.name as sortname）\n  - 欄目 slug 平鋪到 content.sortfilename\n  - 擴展字段值直接平鋪到 content.ext_*（僅有值的字段，null 不返回）\n  - 移除一堆無用的 null 字段（ext_price/ext_type/ext_color 等硬編碼列）\n• prev/next 改為同欄目樹範圍查詢（參考 PbootCMS getSubScodes 邏輯）\n  - 使用遞迴 CTE 取得當前欄目及子孫欄目 scode 列表\n  - 上一篇/下一篇限制在同欄目樹內，不再全局查詢\n\n💡 設計原則\n• 對齊 PbootCMS ParserModel.getContent() 的 JOIN 平鋪模式\n• content 對象即為完整文章數據，前端無需二次組裝',
  },
  {
    version: 'v1.8.0',
    date: '2026-07-21 16:09:50',
    icon: '📝',
    latest: false,
    changes: '📝 欄目下拉權限修復\n\n📋 新增功能\n• 新增 GET /admin/sorts/all 端點（無需 M202 權限，所有登錄用戶可訪問）\n\n🐛 Bug 修復\n• 非授權用戶欄目下拉為空\n  - 根因：ContentEdit/Contents 調用 /admin/sorts（需 M202 權限），非授權用戶被 403 攔截\n  - 修復：改用 /admin/sorts/all（在 PUBLIC_READ_PATHS 白名單中）\n• endoscopyeditor 編輯文章無權限\n  - 根因：同上，欄目下拉載入失敗導致無法選擇欄目',
  },
  {
    version: 'v1.7.9',
    date: '2026-07-21 15:16:08',
    icon: '🔗',
    latest: false,
    changes: '🔗 公開 API 支持 slug 查詢 + 靜態打包批量端點\n\n📋 新增功能\n• GET /api/v1/contents/:idOrSlug — 詳情 API 支持數字 ID 或 slug (filename)\n  - /api/v1/contents/27 → 按 ID 查詢\n  - /api/v1/contents/colon-polyps-cancer-causes → 按 slug 查詢\n• GET /api/v1/contents/all — 批量列表端點，pagesize 最大 500（靜態打包專用）\n  - 一般列表 API pagesize 上限 100，此端點放寬至 500\n  - 專供 Nuxt 靜態生成時批量拉取文章列表\n\n🔧 實現細節\n• 參數為純數字 → 按 id 查詢（原有邏輯）\n• 參數為非數字 → 按 filename 查詢（slug，利用 idx_content_filename 索引）\n• ⚠️ slug 對應 ay_content.filename 字段（PbootCMS 約定），非 urlname\n• prev/next 查詢返回 filename 字段，前端可用於生成上一篇/下一篇連結\n• /contents/all 路由在 /:idOrSlug 之前註冊（Hono 路由順序約束）\n\n💡 前端使用指南\n• 1. 調用 /contents/all?scode=xxx&pagesize=500 獲取所有文章列表（含 id+filename）\n• 2. 根據 meta.total 判斷是否需要翻頁\n• 3. 逐一調用 /contents/{filename或id} 獲取正文\n• 4. Nuxt generate 時遍歷所有文章生成靜態頁面',
  },
  {
    version: 'v1.7.8',
    date: '2026-07-21 15:05:16',
    icon: '🕐',
    latest: false,
    changes: '🕐 版本日誌時間戳修正 + 幻燈片默認分組\n\n📋 版本時間修正\n• 問題：26 個版本的 date 字段全為手動估算，非真實推送時間\n• 最嚴重：v1.6.4 寫了 14:00:00（與 v1.7.5 重複），實際 git commit 為 08:53:17，導致順序倒置\n• 修復：全部改用 git log --format="%ci" 真實時間戳（Asia/Hong_Kong UTC+8）\n• AGENTS.md 新增強制規則：版本時間必須使用 git commit 時間戳，禁止手動估算\n\n🗂️ 幻燈片默認分組\n• 問題：默認展示「全部」幻燈片，視覺凌亂\n• 修復：默認打開 gid 1（首頁輪播）分組 tab',
  },
  {
    version: 'v1.7.7',
    date: '2026-07-21 14:44:42',
    icon: '🗂️',
    latest: false,
    changes: '🗂️ 幻燈片分組名稱持久化（取代 localStorage 方案）\n\n🐛 原問題\n• 幻燈片分組名稱（如「首頁輪播」「費用一覽」「大腸鏡檢查」）僅存於瀏覽器 localStorage\n• 不同賬號/設備登錄後看不到分組名稱，只顯示「分組 1」「分組 2」等無意義標籤\n\n🔧 修復\n• 新建 ay_slide_group 表（gid → name 映射），存儲於數據庫，所有賬號共享\n• 種子數據：gid 1=首頁輪播, gid 2=費用一覽, gid 3=大腸鏡檢查\n• 新增 4 個 API 端點：GET/POST/PUT/DELETE /admin/slides/groups\n• 前端移除 localStorage 方案，改為從後端 API 拉取分組列表\n• 新建站點自動建表 + 種子數據（site.ts 同步更新）\n• 遷移 0012 需在所有站點庫執行',
  },
  {
    version: 'v1.7.6',
    date: '2026-07-21 14:30:43',
    icon: '🔒',
    latest: false,
    changes: '🔒 側邊欄權限過濾修復（根因：邊緣快取跨用戶污染）\n\n🐛 現象\n• 角色已設定有限權限，但用戶登錄後側邊欄仍顯示全部菜單\n• 點擊無權限菜單時後端正確返回 403「無權限訪問此功能」\n• 前端側邊欄與後端權限判斷不一致\n\n🔍 根因分析\n• Workers Cache 中間件僅排除 /api/v1/admin/*，未排除 /api/v1/auth/*\n• /auth/profile 響應被設為 Cache-Control: public, max-age=300\n• 邊緣快取以 URL + X-Site-Id 為 key，不含 Authorization 頭\n• 管理員（全部權限）的 profile 被快取後，普通用戶拿到管理員的權限列表\n• 前端據此渲染側邊欄 → 顯示全部菜單\n• 後端 reloadUserPermissions 每次從 D1 實時載入 → 正確返回 403\n\n🔧 修復\n• cache 中間件新增排除 /api/v1/auth/*（認證接口返回用戶專屬數據，嚴禁跨用戶快取）\n• /auth/profile 響應顯式設置 Cache-Control: no-store（防禦性雙保險）',
  },
  {
    version: 'v1.7.5',
    date: '2026-07-21 13:58:27',
    icon: '⚙️',
    latest: false,
    changes: '⚙️ 權限管理三處修復\n\n📋 多站點管理位置修正\n• 根因：數據庫 ay_menu 表中 M308（多站點管理）的 pcode 為 M300（多媒體），應為 M500（系統管理）\n• 修復：UPDATE ay_menu SET mcode=M508, pcode=M500, sorting=580 WHERE mcode=M308（mcode 對齊父分組前綴）\n• 影響：菜單管理頁面中多站點管理從「多媒體」分組移至「系統管理」分組\n\n🔐 角色代碼自動生成\n• 根因：前端 Roles.tsx 要求用戶手動填寫 rcode（如 R101），但後端 handleCreateRole 已自動生成 rcode（generateRcode），前端填寫的值被忽略\n• 修復：移除前端 rcode 輸入框，改為顯示「創建後自動生成（如 R101）」\n• 編輯時顯示已有 rcode（唯讀）\n\n👤 用戶創建站點權限丟失修復\n• 根因：handleCreateUser 返回 ok(用戶創建成功) 不含新用戶 ID，前端 userId 為 undefined，站點分配 POST 被跳過\n• 修復：改為 okData({ id: newId, ucode })，前端正確獲取 userId 後立即保存站點權限',
  },
  {
    version: 'v1.7.4',
    date: '2026-07-21 13:51:26',
    icon: '🔒',
    latest: false,
    changes: '🔒 媒體庫權限修復 + 存儲配置安全修復\n\n🖼️ 非超管用戶圖片預覽為空修復\n• 根因：MediaLibrary 和 ContentEdit 調用 /admin/storage/config 獲取存儲配置，但該端點需要 requireSuperAdmin，非超管用戶收到 403 導致 storageConfig 為 null\n• 結果：fileUrl 為空，圖片 fallback 到 🖼️ emoji 而非實際預覽\n• 修復：新增 GET /admin/media/config 端點（M301 權限，僅返回 s3_public_url/endpoint/bucket 非敏感字段）\n• 前端 MediaLibrary + ContentEdit 媒體選擇器改用新端點\n\n🔐 存儲配置安全修復\n• handleGetStorageConfig 中 s3_access_key 原為明文返回，改為 *** 遮罩（與 s3_secret_key 一致）\n• 新增 handleGetMediaPublicConfig 函數，僅暴露非敏感字段',
  },
  {
    version: 'v1.7.3',
    date: '2026-07-21 12:08:43',
    icon: '🐛',
    latest: false,
    changes: '🐛 內容編輯全鏈路修復 + Webhook 推送修復 + 粘貼圖片轉存\n\n📝 創建文章丟失字段修復\n• 根因：handleCreateContent INSERT 語句缺少 author/source/ico/filename/subtitle/outlink/tags/keywords/description 等 9 個字段\n• 修復：INSERT 補全所有表單字段，創建時不再丟失數據\n\n🔍 編輯頁面字段為空修復\n• 根因：前端使用公開 API /contents/:id 載入編輯數據，被 Workers Cache 緩存 300s\n• 根因2：公開 API 過濾 status=\'1\'，草稿無法載入\n• 修復：新增 admin 端點 GET /admin/contents/:id（無緩存、無 status 過濾、無訪問量追蹤）\n• 前端 ContentEdit 改用 admin 端點載入，確保讀到最新數據\n\n🔔 Webhook 版本通知修復\n• 根因：v1.7.0 Flagship 混合模式後，getFlagEnabled 優先讀 Flagship，未配置時返回 false 導致 webhook 被靜默跳過\n• 修復：版本通知直接讀 D1 配置 webhook_enabled（繞過 Flagship），系統級功能不受 Flagship 影響\n• 改善：Dashboard 版本通知添加結果日誌（成功/跳過原因/失敗），不再靜默吞錯\n\n📋 粘貼富文本 base64 圖片轉存\n• 場景：從本地文章/Word/網頁複製帶圖富文本，圖片為 base64 data URI\n• 修復：粘貼後延遲掃描編輯器 img[src^="data:image/"]，轉為 File 上傳 R2，替換 src 為媒體庫 URL',
  },
  {
    version: 'v1.7.2',
    date: '2026-07-21 11:50:35',
    icon: '🔧',
    latest: false,
    changes: '🔧 錯誤追蹤系統升級 + Service Binding 配置修復\n\n🐛 PUT /admin/contents/:id 返回 500 修復\n• 根因：admin/wrangler.jsonc 創建時缺少 services 綁定配置，部署後覆蓋了 Dashboard 中的 Service Binding\n• 修復：wrangler.jsonc 添加 services: [{ binding: "API", service: "rust-cms" }]\n\n🛡️ 後端 handleUpdateContent 添加 try/catch\n• SQL 執行失敗時返回有意義的錯誤信息（包含具體錯誤原因），不再返回裸 500\n\n🔗 Pages Function 錯誤處理增強\n• 添加 try/catch 捕獲 Service Binding fetch 異常\n• 錯誤響應增加 detail 字段，包含請求方法、路徑、時間戳、異常詳情\n\n📡 前端 api.ts 錯誤處理升級\n• 新增 HTTP 500 專門處理分支，解析後端 detail 字段\n• 新增其他非 200 狀態碼處理（404/429/502/503 等）\n• res.json() 失敗時有 fallback，不再因非 JSON 響應崩潰\n\n📋 GlobalErrorToast 一鍵複製功能\n• 每個錯誤卡片新增 📋 複製按鈕，一鍵複製完整錯誤信息（標題+描述+時間+技術詳情）\n• 技術詳情默認展開（不再需要手動點擊）\n• 複製成功顯示 ✅ 反饋\n• 錯誤信息包含：請求方法、路徑、HTTP 狀態碼、錯誤碼、後端詳情',
  },
  {
    version: 'v1.7.1',
    date: '2026-07-21 11:36:33',
    icon: '🎨',
    latest: false,
    changes: '🎨 前端細節優化：統一 emoji + 編輯器修復 + 圖片上傳體驗升級\n\n❌ 統一關閉按鈕為 emoji\n• 全站 10 處 ✕ 符號統一替換為 ❌ emoji（Modal/Dialog/TagInput/Toast/顏色清除等）\n• 尺寸顯示的 × 乘號保持不變（語義不同）\n\n📝 編輯器 tab 切換內容丟失修復\n• 根因：條件渲染卸載編輯器 DOM，切回時 Quill 實例不會重新初始化\n• 修復：改用 CSS display:none/block 切換 tab，編輯器 DOM 始終保持掛載\n\n🖼️ 編輯器圖片上傳三合一優化\n• 移除 window.prompt URL 輸入框，點擊圖片圖標直開媒體庫選擇彈窗\n• MediaPickerModal 增強為三合一：媒體庫網格 + ⬆️上傳圖片 + 🔗外鏈URL\n• 上傳後自動刷新列表，單張圖片自動選中插入\n\n📋 粘貼批量圖片壓縮\n• 監聽 Quill paste 事件，攔截剪貼板圖片（截圖/複製帶圖富文本）\n• 阻止默認 base64 插入，走 ImageCompressDialog 批量壓縮上傳\n• 修復批量上傳只取第一張的問題（pendingImageUpload 改為多文件）\n\n🐛 媒體庫壓縮卡 0% 修復\n• 根因：壓縮觸發 useEffect 依賴缺少 files，首次上傳時 runCompress 從未執行\n• 修復：添加 previewsRef 同步鏡像避免閉包陳舊，依賴加入 files\n\n🔧 wrangler 部署 warning 修復\n• 創建 admin/wrangler.jsonc 指定 pages_build_output_dir，消除配置警告',
  },
  {
    version: 'v1.7.0',
    date: '2026-07-21 10:18:22',
    icon: '🔐',
    latest: false,
    changes: '🔐 架構級優化：密鑰管理 + 邊緣緩存 + 功能開關 + 代碼清理\n\n🔐 Secrets Store 密鑰遷移\n• JWT_SECRET 和 CF_API_TOKEN 從 wrangler secret 遷移至 Cloudflare Secrets Store\n• 異步綁定（await env.X.get()），帳號級別跨 Worker 共享\n• Store ID: aef7c32e26c84aedb4b2a5938128ca23\n\n🚀 Workers Cache 邊緣緩存\n• 取代失敗的 KV API 響應緩存中間件，聲明式邊緣緩存\n• 公開 GET 自動緩存（配置 3600s / 內容 300s），管理接口自動繞過\n• Vary: X-Site-Id 多站點緩存分區\n\n🎯 Flagship 真混合模式\n• getFlagEnabled 優先調用 Flagship getBooleanValue，失敗回退 D1\n• Flagship 模式下開關只讀保護，d1FlagCache 按站點隔離\n\n📍 Smart Placement\n• Worker 自動部署靠近 D1 的數據中心，降低數據庫延遲\n\n🧹 代碼清理\n• 移除 acode=cn 硬編碼（vectorize.ts 兩處）\n• 移除多餘 +08:00/Z 時區後綴（scheduler.ts，依賴 TZ=Asia/Hong_Kong）\n• 清理 apiCache/getCached/setCached 死代碼\n• 刪除過時文檔（docs/00-06）+ 廢棄 Rust 原型 + lucide-react/radix-ui 依賴\n\n🐛 全局錯誤追蹤\n• ErrorBoundary + GlobalErrorToast（左下角固定彈框，手動關閉）\n• 非開發者用戶可直觀看到 bug 信息\n\n🔧 autoRouteProtection 順序修復\n• 功能開關中間件從路由後移至路由前，確保攔截生效',
  },
  {
    version: 'v1.6.4',
    date: '2026-07-21 08:53:17',
    icon: '🧩',
    latest: false,
    changes: '🧩 前端狀態組件統一化\n\n• LoadingState / EmptyState / ErrorState 三個通用狀態組件\n• 19 個頁面全部替換為組件化狀態展示\n• 消除重複的加載/空數據/錯誤 UI 代碼',
  },
  {
    version: 'v1.6.3',
    date: '2026-07-21 08:38:00',
    icon: '🎨',
    latest: false,
    changes: '🎨 標題顏色選擇器 + 操作者自動記錄 + Slug/發佈時間調整\n\n🎨 標題顏色 (titlecolor)\n• 文章編輯器標題旁新增顏色選擇器，可設置標題字色\n• 數據以 # 色號格式存儲（如 #ff0000）\n• 可一鍵清除顏色（恢復默認）\n\n👤 操作者自動記錄 (create_user/update_user)\n• 創建內容時自動記錄 create_user 為當前登錄用戶\n• 更新內容時自動更新 update_user 為當前操作用戶\n• 前端無需填寫，純後端處理（從 JWT claims 獲取 realname/username）\n\n🔄 Slug + 發佈時間移至基本內容\n• Slug (URL別名) 和發佈時間從高級內容 Tab 移到基本內容 Tab\n\n🗂️ 模型管理清理\n• 僅保留專題和文章兩個模型，刪除其餘 5 個模型',
  },
  {
    version: 'v1.6.2',
    date: '2026-07-20 19:09:11',
    icon: '🔧',
    latest: false,
    changes: '🔧 內容管理修復 + 標籤輸入體驗升級\n\n📂 父欄目文章列表修復\n• 後台內容列表點擊父欄目（如醫生專欄）現在正確顯示所有子欄目文章\n• handleAdminListContents 改用 getDescendantScodes（與公開 API 邏輯一致）\n\n📋 公開內容列表 API 字段補全\n• 補回被過度刪除的字段：acode、subscode、enclosure、gnote、create_user、update_user\n• 僅排除 content 正文字段（減小響應體積）\n\n🏷️ 標籤輸入器升級\n• 文字輸入改為 TagInput 組件：輸入後按 Enter 生成可關閉的標籤塊\n• 歷史標籤快速補充：顯示曾用標籤，點擊即可添加，無需重複打字\n• 新增 API：GET /admin/contents/all-tags 獲取所有歷史標籤\n\n🔁 Slug 去重\n• 移除基本內容 Tab 中重複的 Slug 字段，僅保留高級內容 Tab 中的 Slug',
  },
  {
    version: 'v1.6.1',
    date: '2026-07-20 18:20:41',
    icon: '🗂️',
    latest: false,
    changes: '🗂️ 欄目管理批量操作 — 批量排序 + 批量刪除 + 排序默認值優化\n\n📝 批量排序（dirty tracking 模式）\n• 排序列改為可編輯的 SortInput 組件（統一組件 useBatchSorting + BatchSortSaveBar）\n• 修改後標記 dirty（amber 高亮），底部顯示「保存排序」按鈕統一提交\n• 調用 PUT /admin/sorts/batch-sorting 批量更新\n• 成功/失敗均自動刷新欄目樹\n\n🗑️ 批量刪除\n• 表格頭部全選 checkbox + 每行 checkbox\n• 選中後顯示「批量刪除（N）」按鈕\n• 確認對話框警告「刪除欄目將同時刪除所有子欄目和關聯內容」\n• 逐條調用 DELETE /admin/sorts/:id（後端級聯刪除）\n• 顯示刪除進度 X/Y，失敗項計數\n\n🔢 排序默認值優化\n• 新建欄目 sorting 從硬編碼 255 改為 max(sorting)+1（同級 pcode 範圍）\n• 無同級欄目時默認為 1\n• 後端 handleCreateSort 查詢 MAX(sorting) 計算新值',
  },
  {
    version: 'v1.6.0',
    date: '2026-07-20 17:32:35',
    icon: '🌐',
    latest: false,
    changes: '🌐 多站點架構 — 亞太三站點獨立數據庫 + 用戶站點權限分配\n\n🏗️ 架構設計\n• 主庫 endoscopy-cms：全局用戶/角色/菜單/站點註冊表\n• 站點庫 smile-cms / vision-cms：各站點獨立內容/配置\n• SITE_REGISTRY 環境變量映射 siteId → D1 binding\n• X-Site-Id header 中間件路由至對應站點數據庫\n• siteDB(c) / primaryDB(c) 雙軌數據庫訪問模式\n\n🗄️ 數據庫（全部 APAC 地區）\n• endoscopy-cms（主站，現有數據）\n• smile-cms（結構 + 初始數據）\n• vision-cms（結構 + 初始數據）\n• 遷移 0006：ay_site_registry + ay_user_site 關聯表\n• 遷移 0007：M508 多站點管理菜單 + R101 權限\n\n👥 用戶站點權限分配\n• 全局用戶 + 站點分配模式（用戶/角色/菜單在主庫）\n• 非超管用戶必須至少分配一個站點（前端驗證 + 後端檢查）\n• 超級管理員自動擁有所有站點權限\n• 用戶編輯對話框新增站點勾選 UI（全選/清空）\n• GET /admin/users/:id/sites + POST /admin/users/:id/sites\n\n🎨 前端多站點體驗\n• 側邊欄頂部站點選擇下拉（替代固定標題）\n• 切換站點自動刷新頁面載入新站點數據\n• Login.tsx 登入後緩存站點列表 + 設置默認站點\n• 多站點管理頁（/sites）：站點列表 + 創建嚮導 + 編輯\n\n🔌 API 端點\n• GET /admin/sites — 列出用戶可訪問的站點\n• GET /admin/sites/current — 當前站點信息\n• POST /admin/sites/create — 一鍵創建新站點（REST API）\n• PUT /admin/sites/:siteId — 更新站點信息\n• GET /admin/users/:id/sites — 用戶已分配站點\n• POST /admin/users/:id/sites — 設置用戶站點分配',
  },
  {
    version: 'v1.5.9',
    date: '2026-07-20 14:56:26',
    icon: '🧹',
    latest: false,
    changes: '版本通知自動化 + 格式化 + 幻燈片排序優化\n\n🔧 版本通知自動推送（恢復）\n• 機制：Dashboard useEffect 偵測最新版本 → POST /notify/version-check → 後端構造 ActionCard markdown 推送\n• KV 去重：notified_version:{version} 確保每個版本只推送一次（避免重複）\n• 格式：changes 字段帶 emoji + 換行，直接渲染為釘釘 ActionCard / 企業微信 markdown\n• 優勢：無需開發者手動推送，部署後首次訪問 Dashboard 即自動觸發\n\n📝 版本更新格式化\n• changes 字段從純文字改為帶 emoji + 換行格式（whitespace-pre-line）\n• 與釘釘 webhook 推送格式保持一致\n\n📊 幻燈片排序優化\n• 默認排序從 0 改為從 1 開始（拖拽 idx+1，新增 maxSorting+1）\n• 列表按 sorting ASC 排序展示（拖到第一則顯示第一）',
  },
  {
    version: 'v1.5.8',
    date: '2026-07-20 14:20:34',
    icon: '🐛',
    latest: false,
    changes: '🐛 幻燈片排序 API 根因修復 — Hono 路由順序 bug\n\n根因\n• PUT /slides/:id 在 PUT /slides/batch-sorting 之前註冊\n• Hono 按順序匹配，"batch-sorting" 被當作 :id 參數\n• 匹配到 handleUpdateSlide（返回 1001 "沒有需要更新的字段"）\n• batch-sorting handler 永遠不會被執行\n\n修復\n• 將 batch-sorting 路由移到 :id 路由之前\n\n舉一反三\n• contents/trash：GET 不衝突 ✓\n• models/all：順序正確 ✓\n• roles/all：順序正確 ✓\n\n驗證\n• ✅ batch-sorting API → code=0, msg=排序更新成功\n• ✅ 數據庫 ID 2 sorting = 99 已確認更新',
  },
  {
    version: 'v1.5.7',
    date: '2026-07-20 14:08:45',
    icon: '🔧',
    latest: false,
    changes: '🔧 幻燈片排序 bug 修復 + 時間戳時區修正 + TZ 環境變量\n\nSlides 排序修復\n• 根因：onBlur 中 val !== item.sorting 永遠為 false\n• 改用 dirty tracking + 保存排序按鈕（黃色高亮 + 批量提交）\n• 新增幻燈片默認分組改為當前選中分組（或 1）\n• 新增幻燈片排序自動填入該分組最大值+1\n\n時間戳修正\n• v1.5.1-v1.5.6 從錯誤時區修正為香港 UTC+8\n• v1.4.0 去除過於規整的 09:30:00\n\nTZ 環境變量\n• wrangler.jsonc 新增 TZ=Asia/Hong_Kong',
  },
  {
    version: 'v1.5.6',
    date: '2026-07-20 12:57:03',
    icon: '🤖',
    latest: false,
    changes: 'Cloudflare Turnstile 人機驗證整合：後端新增 verifyTurnstile() 函數調用 Cloudflare siteverify API 驗證 token；handleLogin 新增 turnstileToken 參數，開關開啟時強制驗證（網絡異常時放行避免故障）；新增公開端點 GET /api/v1/auth/turnstile-config（返回 enabled + siteKey，secret key 不暴露）；前端 Login.tsx 動態載入 Turnstile 腳本 + explicit 模式渲染 widget（語言 zh-HK，主題 light），登錄失敗自動 reset widget；DB 新增 3 條配置（turnstile_enabled/turnstile_site_key/turnstile_secret_key，sorting 35-37 安全配置分組）；新增錯誤碼 2007（人機驗證失敗）；修復 v1.5.1-v1.5.5 版本時間戳（時區從 UTC 修正為香港 UTC+8，修正順序顛倒問題，去除過於規整的整點時間）',
  },
  {
    version: 'v1.5.5',
    date: '2026-07-20 12:28:09',
    icon: '🔑',
    latest: false,
    changes: '權限系統根因修復 — JWT 權限實時刷新：後端 admin 認證中間件每次請求為非超管用戶從數據庫重新加載權限（reloadUserPermissions），解決角色權限變更後 JWT 中權限過時的問題（無需重新登錄即可生效）；handleProfile 改為從數據庫重新加載權限（非 JWT 快照）；loadUserPermissions 優化為單次 IN 查詢（替代逐角色查詢）；禁用用戶返回 401 觸發前端登出；回收站路由權限修復（contents/trash、restore、permanent 改用 M208 回收站權限，不再被 M201 文章列表攔截）；前端 Layout 掛載時拉取 /auth/profile 刷新 localStorage 權限（Outlet key 綁定權限變化，確保 RequirePermission 路由守衛即時生效）',
  },
  {
    version: 'v1.5.4',
    date: '2026-07-20 12:20:00',
    icon: '🇭🇰',
    latest: false,
    changes: '公司/站點信息香港本地化 + 公開公司 API：公司信息移除內地專用字段（QQ、郵編 postcode、ICP 備案號），新增 WhatsApp 字段（香港主流通訊），重命名標籤（法人代表→董事/公司秘書、營業執照號→商業登記證號碼、微信→WeChat 微信），placeholder 改為香港格式（8位電話號碼、.com.hk 郵箱）；站點信息移除 ICP 備案號（與公司信息重複且內地專用）和主題模板（headless CMS 無模板系統），域名 placeholder 改為 cms.cmermedical.com.hk，版權信息 placeholder 改為英文格式；後端 SITE_FIELDS/COMPANY_FIELDS 白名單同步更新，getOrCreateSite/getOrCreateCompany INSERT 語句對齊；DB 遷移 0005 新增 ay_company.whatsapp 列，ay_site.lang 從 zh-cn 更新為 zh-hk；新增公開 API GET /api/v1/company（參考 Go 版 /api/company，過濾敏感字段僅返回聯繫信息）；storage.ts 公司媒體引用新增 WhatsApp 二維碼列，標籤更新為 WeChat 二維碼/商業登記證',
  },
  {
    version: 'v1.5.3',
    date: '2026-07-20 11:10:00',
    icon: '🔐',
    latest: false,
    changes: '權限系統全面修復 + 幻燈片拖拽排序：後端新增 forbidden() 函數返回 HTTP 403（區分 401 未認證 vs 403 權限拒絕），requireMenuPermission 和 requireSuperAdmin 改用 403；前端 request() 僅 HTTP 401 時重定向 login，403 時彈出權限拒絕 toast 提示（Layout 註冊 setPermissionDeniedCallback，右上角紅色 toast 3秒自動消失）；App.tsx 新增 RequirePermission 路由守衛組件，所有 24 個頁面路由均包裹權限檢查（mcode 映射，storage/database 為 __super__ 僅超管），無權限時顯示 🔒 提示頁而非重定向 login；幻燈片管理新增分組 ID 自動遞增（計算 maxId+1，不允許重複），分組名稱改為可選（留空自動命名）；幻燈片表格新增拖拽排序（HTML5 draggable，拖拽 ⋮⋮ 圖示調整順序，即時更新後端 batch-sorting API）+ 手動排序輸入框（失焦自動保存）；新增 PUT /admin/slides/batch-sorting 批量排序 API（D1 batch 更新）',
  },
  {
    version: 'v1.5.2',
    date: '2026-07-20 10:55:17',
    icon: '📐',
    latest: false,
    changes: '媒體庫尺寸顯示 + 壓縮比例縮放 + 權限修復：媒體庫瀑布流卡片新增圖片尺寸徽章（ImageWithDimensions 組件，onLoad 取得 naturalWidth/naturalHeight，左下角黑色半透明徽章顯示 寬×高）；詳情面板也顯示前端取得的圖片尺寸；壓縮對話框從獨立「最大寬度1920 + 最大高度1080」改為單一「最大邊長」輸入（imageCompress.ts 新增 maxDimension 選項，browser-image-compression 的 maxWidthOrHeight 按原始比例等比縮放，不會拉伸變形），附帶四個尺寸預設（PC 1920 / Mobile 1080 / 縮略 800 / 小圖 400）；DB 新增 M301 媒體庫子菜單（M300 多媒體為父級容器，M301 為實際權限鍵，url=/admin/media 對應後端中間件），兩個角色均已加入 M301；後端 media 中間件註釋從 M300 更新為 M301；Layout.tsx LABEL_MCODE_MAP「媒體庫」從 M300 改為 M301；權限審計：所有 24 個前端頁面均有對應 mcode 權限控制（資料庫管理/存儲設置僅超管可見），上傳端點 /admin/upload 保留 requireAuth（所有可上傳角色均已含 M301）',
  },
  {
    version: 'v1.5.1',
    date: '2026-07-20 10:23:31',
    icon: '🎨',
    latest: false,
    changes: '上傳體驗統一 + 媒體庫瀑布流 + Worker URL 禁用：ImageCompressDialog 新增前後圖片對比區域（原始 vs 壓縮後並排展示，棋盤格背景，hover 彈出全屏放大預覽不超過 100vw/vh）；移除對比區域 px-3 加寬顯示空間；統一所有上傳位置使用 ImageCompressDialog（ContentEdit 從 autoCompress=true 改為 Promise-based 對話框模式，與媒體庫/幻燈片完全一致）；新增 UploadProgressOverlay 組件（屏幕居中進度覆蓋層，替代各頁面內聯進度條，漸變進度條+錯誤卡片可關閉）；媒體庫從固定网格改為 CSS columns 瀑布流佈局（columns-2~6 響應式，圖片按原始比例顯示高度，方便辨別 PC/Mobile 圖片尺寸）；修復 MediaLibrary 上傳 bug（FileList 清空順序：先 Array.from 複製再清空 input.value）；幻燈片菜單從擴展內容移至多媒體分組（DB M402 pcode M400→M300，Layout.tsx 分組調整）；Worker 禁用 workers.dev 和 preview_urls（僅作為 Pages cms-admin 內部 ServiceBinding，Cloudflare API 確認 subdomain enabled=false）；修復 Vite 構建 0 字節文件問題（fixEmptyChunksPlugin 插件，輸出目錄 build→deploy）',
  },
  {
    version: 'v1.5.0',
    date: '2026-07-20 09:46:02',
    icon: '🗜️',
    latest: false,
    changes: '圖片壓縮引擎重構 + 自定義標籤移除：引入 browser-image-compression 開源庫（Web Worker 壓縮，不阻塞 UI），建立三層組件化架構（imageCompress.ts 引擎層 → useImageUpload.ts hook 層 → ImageCompressDialog.tsx UI 層），引擎可獨立替換不影響消費方；所有圖片上傳位置默認接入壓縮：媒體庫（壓縮對話框預覽+進度條）、幻燈片（桌面/移動端進度條）、文章內容（Quill 編輯器+縮略圖+擴展字段，autoCompress=true 自動壓縮為 WebP）；上傳過程實時進度展示（壓縮中/上傳中階段+百分比+文件名）；上傳失敗顯示具體錯誤（文件名+錯誤原因，可關閉）；ContentEdit 浮動進度提示（右下角 toast）；移除自定義標籤功能（headless CMS 無模板引擎，與 config API 重疊）— 刪除後端路由/services、前端頁面/路由/側邊欄、DB 菜單 M404 + 角色權限',
  },
  {
    version: 'v1.4.2',
    date: '2026-07-20 09:00:28',
    icon: '📐',
    latest: false,
    changes: '側邊欄分組重構對齊 PbootCMS/Go 版邏輯（參考原版 6 分組結構）：新增 DB 頂級菜單 M600「全局配置」和 M610「基礎內容」；移動技術性子菜單（M206 擴展字段、M207 內容模型、M503 系統配置）pcode 從 M200/M500 → M600 全局配置；移動基礎內容子菜單（M501 站點信息、M502 公司信息、M202 欄目管理）pcode → M610；移動擴展內容子菜單（M203 單頁管理、M204 留言管理、M205 自定義表單）pcode → M400；M200 改名「內容管理→文章內容」、M400 改名「SEO設置→擴展內容」、M500 改名「系統設置→系統管理」；文章內容分組僅放文案相關（動態模型列表+回收站），技術性菜單移至全局配置；更新 copywriter 權限為 12 項（含父菜單 M610/M200/M400/M300）；更新超管 R101 權限為 27 項（含新增 M600/M610）',
  },
  {
    version: 'v1.4.1',
    date: '2026-07-20 08:48:51',
    icon: '🔧',
    latest: false,
    changes: '側邊欄分組與數據庫菜單樹完全對齊（消除「全局配置」等自定義分組與權限選擇器不一致問題）：重構 NAV_GROUPS 為 4 個分組（內容管理/多媒體/SEO設置/系統設置），與 ay_menu 25 個菜單 1:1 映射；LABEL_MCODE_MAP 更新為 DB 菜單名稱；修正 copywriter 角色權限（移除 M205/M206/M207/M501/M502 技術與系統權限，保留 10 項內容相關權限）；後端權限中間件新增 GET 白名單（PUBLIC_READ_PATHS：models/all/menus/sorts/all 供側邊欄與下拉選單使用，POST/PUT/DELETE 仍需權限）；修復 ay_role_level 表權限同步問題（手動 SQL 需同時更新 levels 欄位與 ay_role_level 表）',
  },
  {
    version: 'v1.4.0',
    date: '2026-07-18 09:27:14',
    icon: '🔐',
    latest: false,
    changes: 'RBAC 權限安全修復：前端側邊欄改用顯式 LABEL_MCODE_MAP 映射表（替代動態 API 查找），未映射項目默認隱藏（安全優先），內容模型統一檢查 M201 權限；後端補齊 12 條路由的 requireMenuPermission 中間件（contents/sorts/singles/messages/extfields/media/links/slides/tags/labels/site/company），新增 requireSuperAdmin 中間件保護 database/storage 路由；語義搜索模型替換（@cf/baai/bge-base-zh-v1.5 → @cf/baai/bge-base-en-v1.5，768 維不變），默認閾值降低 0.7→0.5；媒體庫上傳壓縮對話框（ImageCompressDialog 組件，質量滑桿+實時預覽+格式選擇）；存儲上傳 content-type 修復（generateKey 包含副檔名 + guessContentType 兜底）；幻燈片移動端圖片高度自適應（h-32 → maxWidth/maxHeight + auto）；admin 用戶分配 R101 超級管理員角色；Pages Functions 部署修復（從 admin/ 目錄部署以正確上傳 Functions bundle）',
  },
  {
    version: 'v1.3.0',
    date: '2026-07-17 17:22:50',
    icon: '🎨',
    latest: false,
    changes: '幻燈片管理優化：圖片預覽改為原比例展示（object-contain）+ 新增前端 WebP 壓縮上傳功能（Canvas API 自動縮放+質量壓縮，類似 Squoosh 效果）；域名安全重構：移除 Worker 後端公網域名暴露（wrangler.jsonc 取消自定義域名 + Pages Functions 回退改為錯誤響應 + Dashboard 系統信息不再顯示後端域名），Pages 域名更新為 cms.cmermedical.com.hk',
  },
  {
    version: 'v1.2.0',
    date: '2026-07-17 16:56:11',
    icon: '🚀',
    latest: false,
    changes: '資料庫備份建立時間修復（從文件名解析精確時間 + 記錄備份日誌）；側邊導航菜單默認收起僅文章內容展開；版本更新自動通知機制（Pages 部署後 Dashboard 自動觸發釘釘 webhook，KV 記錄已通知版本避免重複推送）',
  },
  {
    version: 'v1.1.0',
    date: '2026-07-17 16:43:39',
    icon: '🔧',
    latest: false,
    changes: '時區修復：創建 src/utils/datetime.ts 統一 UTC+8 香港時區，替換全部 8 個 service 文件的 nowStr 本地定義；登錄 IP 記錄修復（CF-Connecting-IP 提取 + SQL 更新 last_login_ip）；菜單 FontAwesome 圖標清理（migration 0003 將 fa-* 轉為 emoji + 前端過濾）；系統日誌大幅增強：操作日誌中間件自動記錄所有 admin 寫操作（content/security/error 分類）+ 全局錯誤處理器記錄錯誤日誌 + 前端新增內容/安全/錯誤三個日誌 Tab；多值配置改為 TagInput 標籤式輸入（CORS 域名自動剝離 http/https + IP 黑白名單批量導入 + 郵件收件人標籤管理）；媒體庫污染內容管理修復（移除 handleUpload 中的 ay_content 插入 + scode != 過濾 + migration 0004 清理已有記錄）；AGENTS.md 精簡重構（刪除文件修改記錄/日誌命令/性能預算/免費額度等運維內容）',
  },
  {
    version: 'v1.0.0',
    date: '2026-07-17 15:59:10',
    icon: '🎉',
    latest: false,
    changes: '登錄頁無限刷新根因修復（FeatureFlagProvider 移至 Layout 僅認證頁加載 + 全局重定向鎖防並發 401 + data-cfasync=false 繞過 Rocket Loader）；功能開關改為始終 D1 模式（後台直接管理無需 Flagship 面板）；移除 isFlagshipManaged 只讀判斷，開關始終可互動；S3 存儲配置獨立分塊 + 默認鎖定防誤觸（解鎖按鈕）+ 默認折疊；搜索引擎推送默認折疊；幻燈片增加移動端圖片預覽列；AGENTS.md 移除數據庫零改動約束 + 更新 Flagship 為始終 D1 + 精簡重複內容',
  },
  {
    version: 'v0.9.0',
    date: '2026-07-17 15:11:27',
    icon: '🔧',
    changes: '登錄頁無限刷新修復（FeatureFlagProvider 401 守衛 + 無 Token 跳過 + 401 不重定向至 /login）；系統用戶改為單選角色（radio UI）；角色管理增加權限數/用戶數列 + 系統角色徽章；側邊欄按 mcode 權限過濾 + 用戶信息顯示；後端內容排序改為 PbootCMS 邏輯（istop DESC, isrecommend DESC, isheadline DESC, sorting ASC, date DESC, id DESC）；內容排序支持內聯修改；幻燈片增加分組標籤 + 自定義分組名（localStorage）',
  },
  {
    version: 'v0.8.0',
    date: '2026-07-17 14:50:00',
    icon: '🔐',
    changes: 'API 菜單權限攔截：requireMenuPermission 中間件按 ay_menu URL 查詢 mcode 進行權限校驗；auth 新增 hasMenuPermission 函數基於 mcode 校驗；角色列表 API 增加 userCount（用戶引用數）和 levelCount（權限數）；認證中間件設置 claims 到上下文避免重複驗證；菜單 CRUD 後清除 URL→mcode 緩存',
  },
  {
    version: 'v0.7.0',
    date: '2026-07-17 14:30:00',
    icon: '🚩',
    changes: 'Flagship 重命名：app 改為 Rustcms-service；flag 鍵改為 mail_enabled / webhook_enabled；Worker 綁定變量改為 Flagship-service（含連字符需用 env["Flagship-service"] 括號語法）；wrangler.jsonc 配置 app_id 綁定；D1 回退數據同步更新',
  },
  {
    version: 'v0.6.0',
    date: '2026-07-17 14:04:41',
    icon: '🎨',
    changes: '系統設置分區塊獨立保存（無需整頁刷新）；角色權限改為菜單樹驅動（與菜單管理聯動）；用戶管理增加權限預覽（所選角色合併權限）；菜單管理顯示 mcode 權限鍵並修正 scode→mcode 字段；三頁面增加三者關係說明卡片',
  },
  {
    version: 'v0.5.0',
    date: '2026-07-17 13:45:03',
    icon: '🏗️',
    changes: '功能開關標準化架構：FLAG_REGISTRY 註冊表驅動；autoRouteProtection API 攔截中間件；FeatureFlagProvider + FeatureGate 組件化前端控制；後端關閉功能時 API 返回 404',
  },
  {
    version: 'v0.4.0',
    date: '2026-07-17 13:05:49',
    icon: '🚩',
    changes: 'Flagship 功能開關整合到系統設置頁面；混合模式（Flagship + D1 回退）支持本地切換；關閉郵件/Webhook 開關後自動隱藏後台對應配置區域',
  },
  {
    version: 'v0.3.0',
    date: '2026-07-17 11:55:08',
    icon: '🏗️',
    changes: '架構升級：Queues 定時發布、Vectorize 語義搜索（768維 bge-base-zh-v1.5）、Rate Limiting 速率限制（4組綁定）、KV API 響應緩存、Service Bindings 內部通信、Flagship 功能開關、Cron 每 15 分鐘掃描待發布文章',
  },
  {
    version: 'v0.2.1',
    date: '2026-07-17 10:50:00',
    icon: '🐛',
    changes: '移除 CF Email Service（需 Workers Paid），改用 MailChannels/Resend 免費方案；清理 D1 重複數據（43 條配置 + 1 個管理員 + 25 個菜單）；創建 Vectorize 索引 article-semantic-search',
  },
  {
    version: 'v0.2.0',
    date: '2026-07-17 10:31:34',
    icon: '✨',
    changes: '郵件服務改用 Cloudflare Email Service Workers API；修復 Webhook 異步通知生命週期；側邊欄模型子菜單去重',
  },
  {
    version: 'v0.1.2',
    date: '2026-07-17 08:57:45',
    icon: '✨',
    changes: '內容按模型分類管理；圖片上傳支持外鏈；API CORS 動態域名校驗；通知服務（Webhook + 郵件）',
  },
  {
    version: 'v0.1.1',
    date: '2026-07-16 14:30:00',
    icon: '🐛',
    changes: '修復 D1 遷移字段缺失問題；前端 Pages 部署優化',
  },
  {
    version: 'v0.1.0',
    date: '2026-07-16 10:00:00',
    icon: '🎉',
    changes: '項目初始版本，基於 PbootCMS 3.2.12 數據庫結構的 TypeScript + Hono CMS',
  },
]

/** API 接口列表 */
const API_ENDPOINTS: ApiEndpoint[] = [
  // 認證
  { method: 'POST', path: '/api/v1/auth/login', desc: '登錄 (5次/分/IP)', auth: false },
  { method: 'GET', path: '/api/v1/auth/turnstile-config', desc: 'Turnstile 人機驗證配置', auth: false },
  { method: 'GET', path: '/api/v1/auth/profile', desc: '個人信息（no-store，不緩存）', auth: true },
  // 公開接口 (60次/分/IP)
  { method: 'GET', path: '/api/v1/site', desc: '站點信息', auth: false },
  { method: 'GET', path: '/api/v1/company', desc: '公司信息（公開聯繫方式）', auth: false },
  { method: 'GET', path: '/api/v1/sorts', desc: '欄目樹', auth: false },
  { method: 'GET', path: '/api/v1/sorts/:scode', desc: '欄目詳情', auth: false },
  { method: 'GET', path: '/api/v1/contents', desc: '內容列表 (?scode=&page=&pagesize=, max 100/頁)', auth: false },
  { method: 'GET', path: '/api/v1/contents/all', desc: '批量內容列表-靜態打包用 (?scode=&page=&pagesize=, max 500/頁, v1.7.9+)', auth: false },
  { method: 'GET', path: '/api/v1/contents/:idOrSlug', desc: '內容詳情 (content平鋪sortname+ext_*字段, prev/next同欄目樹, v1.8.1+)', auth: false },
  { method: 'GET', path: '/api/v1/search', desc: '語義搜索 (?q=關鍵詞&topK=10&threshold=0.5)', auth: false },
  { method: 'GET', path: '/api/v1/slides', desc: '幻燈片列表 (?gid=)', auth: false },
  { method: 'GET', path: '/api/v1/links', desc: '友情連結 (?gid=)', auth: false },
  { method: 'GET', path: '/api/v1/singles', desc: '單頁列表', auth: false },
  { method: 'GET', path: '/api/v1/singles/:scode', desc: '單頁詳情', auth: false },
  { method: 'GET', path: '/api/v1/tags', desc: '標籤列表', auth: false },
  { method: 'POST', path: '/api/v1/f/:token', desc: '表單提交（隱蔽化端點，16位隨機 token）', auth: false },
  { method: 'GET', path: '/api/v1/admin/forms/active', desc: '活躍表單列表（側邊欄，M204）', auth: true },
  { method: 'GET', path: '/api/v1/admin/forms/config', desc: '表單配置列表（M210）', auth: true },
  { method: 'POST', path: '/api/v1/admin/forms/config', desc: '新建表單', auth: true },
  { method: 'PUT', path: '/api/v1/admin/forms/config/:id', desc: '更新表單配置', auth: true },
  { method: 'DELETE', path: '/api/v1/admin/forms/config/:id', desc: '刪除表單（id=1 不可刪）', auth: true },
  { method: 'GET', path: '/api/v1/admin/forms/submissions', desc: '表單列表（分頁+搜索+篩選）', auth: true },
  { method: 'GET', path: '/api/v1/admin/forms/submissions/:id', desc: '表單詳情', auth: true },
  { method: 'PUT', path: '/api/v1/admin/forms/submissions/:id', desc: '更新表單狀態', auth: true },
  { method: 'DELETE', path: '/api/v1/admin/forms/submissions/:id', desc: '刪除表單記錄', auth: true },
  // 管理接口 (300次/分/用戶)
  { method: 'GET', path: '/api/v1/admin/contents', desc: '後台內容列表 (?scode=&mcode=&page=)', auth: true },
  { method: 'GET', path: '/api/v1/admin/contents/:id', desc: '後台內容詳情（無緩存，編輯用）', auth: true },
  { method: 'GET', path: '/api/v1/admin/contents/all-tags', desc: '歷史標籤列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/contents', desc: '新建內容', auth: true },
  { method: 'PUT', path: '/api/v1/admin/contents/:id', desc: '更新內容', auth: true },
  { method: 'GET', path: '/api/v1/admin/models/all', desc: '所有模型', auth: true },
  { method: 'GET', path: '/api/v1/admin/media', desc: '媒體列表', auth: true },
  { method: 'GET', path: '/api/v1/admin/media/config', desc: '媒體庫公開配置（非敏感字段）', auth: true },
  { method: 'POST', path: '/api/v1/admin/upload', desc: '文件上傳 (multipart/form-data)', auth: true },
  { method: 'GET', path: '/api/v1/admin/configs', desc: '系統配置', auth: true },
  { method: 'PUT', path: '/api/v1/admin/configs', desc: '更新配置', auth: true },
  { method: 'GET', path: '/api/v1/admin/users', desc: '用戶列表', auth: true },
  { method: 'GET', path: '/api/v1/admin/roles', desc: '角色列表 (含 userCount/levelCount)', auth: true },
  { method: 'GET', path: '/api/v1/admin/roles/all', desc: '全部啟用角色 (含 levelCount)', auth: true },
  { method: 'GET', path: '/api/v1/admin/menus', desc: '菜單樹', auth: true },
  { method: 'GET', path: '/api/v1/admin/logs', desc: '系統日誌 (?level=admin|content|security|error|notify)', auth: true },
  { method: 'GET', path: '/api/v1/admin/flags', desc: '查詢功能開關狀態', auth: true },
  { method: 'PUT', path: '/api/v1/admin/flags', desc: '切換功能開關 (Flagship 混合模式，Flagship 模式下只讀)', auth: true },
  { method: 'GET', path: '/api/v1/admin/scheduler/list', desc: '定時發布列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/scheduler/schedule', desc: '設定文章發布時間', auth: true },
  { method: 'POST', path: '/api/v1/admin/vectorize/reindex', desc: '重建向量索引', auth: true },
  { method: 'POST', path: '/api/v1/admin/notify/test-mail', desc: '測試郵件發送', auth: true },
  { method: 'POST', path: '/api/v1/admin/notify/test-webhook', desc: '測試 Webhook 推送', auth: true },
  { method: 'POST', path: '/api/v1/admin/notify/version-check', desc: '版本更新自動通知（KV 去重）', auth: true },
  { method: 'GET', path: '/api/v1/admin/slides', desc: '幻燈片列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/slides', desc: '新增幻燈片', auth: true },
  { method: 'PUT', path: '/api/v1/admin/slides/:id', desc: '更新幻燈片', auth: true },
  { method: 'DELETE', path: '/api/v1/admin/slides/:id', desc: '刪除幻燈片', auth: true },
  { method: 'GET', path: '/api/v1/admin/slides/groups', desc: '幻燈片分組列表 (v1.7.7+)', auth: true },
  { method: 'POST', path: '/api/v1/admin/slides/groups', desc: '新增幻燈片分組 (v1.7.7+)', auth: true },
  { method: 'PUT', path: '/api/v1/admin/slides/groups/:gid', desc: '更新幻燈片分組名稱 (v1.7.7+)', auth: true },
  { method: 'DELETE', path: '/api/v1/admin/slides/groups/:gid', desc: '刪除幻燈片分組 (v1.7.7+)', auth: true },
  // 欄目管理 + 擴展字段 (v1.6.1+)
  { method: 'GET', path: '/api/v1/admin/sorts/all', desc: '欄目列表-下拉用 (無需M202權限, v1.8.0+)', auth: true },
  { method: 'GET', path: '/api/v1/admin/sorts', desc: '欄目樹 (需M202權限)', auth: true },
  { method: 'POST', path: '/api/v1/admin/sorts', desc: '新增欄目', auth: true },
  { method: 'PUT', path: '/api/v1/admin/sorts/:id', desc: '更新欄目', auth: true },
  { method: 'DELETE', path: '/api/v1/admin/sorts/:id', desc: '刪除欄目 (級聯刪除子欄目+內容)', auth: true },
  { method: 'PUT', path: '/api/v1/admin/sorts/batch-sorting', desc: '批量更新欄目排序', auth: true },
  { method: 'GET', path: '/api/v1/admin/extfields', desc: '擴展字段列表 (?include_disabled=1)', auth: true },
  { method: 'POST', path: '/api/v1/admin/extfields', desc: '新增擴展字段', auth: true },
  { method: 'PUT', path: '/api/v1/admin/extfields/:id', desc: '更新擴展字段', auth: true },
  { method: 'DELETE', path: '/api/v1/admin/extfields/:id', desc: '徹底刪除擴展字段 (DROP COLUMN)', auth: true },
  { method: 'PUT', path: '/api/v1/admin/extfields/batch-sorting', desc: '批量更新擴展字段排序', auth: true },
  { method: 'PUT', path: '/api/v1/admin/slides/batch-sorting', desc: '批量更新幻燈片排序', auth: true },
  // 多站點管理 (v1.6.0+)
  { method: 'GET', path: '/api/v1/admin/sites', desc: '列出用戶可訪問的站點', auth: true },
  { method: 'GET', path: '/api/v1/admin/sites/current', desc: '當前站點信息', auth: true },
  { method: 'POST', path: '/api/v1/admin/sites/create', desc: '一鍵創建新站點 (超管，REST API)', auth: true },
  { method: 'PUT', path: '/api/v1/admin/sites/:siteId', desc: '更新站點信息 (超管)', auth: true },
  { method: 'GET', path: '/api/v1/admin/users/:id/sites', desc: '用戶已分配的站點列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/users/:id/sites', desc: '設置用戶站點分配', auth: true },
]

/** 錯誤碼對照 */
const ERROR_CODES: { code: number; desc: string; color: string }[] = [
  { code: 0, desc: '成功', color: 'green' },
  { code: 1001, desc: '參數錯誤', color: 'yellow' },
  { code: 1004, desc: '未找到', color: 'yellow' },
  { code: 1005, desc: '操作失敗', color: 'orange' },
  { code: 2001, desc: '用戶名或密碼錯誤', color: 'orange' },
  { code: 2002, desc: '未授權（HTTP 401，觸發登出）', color: 'red' },
  { code: 2003, desc: 'Token 已過期（HTTP 401，觸發登出）', color: 'red' },
  { code: 2004, desc: 'Token 已登出（HTTP 401，觸發登出）', color: 'red' },
  { code: 2005, desc: '無權限訪問此功能（HTTP 403）', color: 'red' },
  { code: 2006, desc: '用戶已被禁用或不存在（HTTP 401，觸發登出）', color: 'red' },
  { code: 2007, desc: '人機驗證失敗（Turnstile）', color: 'orange' },
  { code: 4290, desc: '請求過於頻繁 (Rate Limited)', color: 'red' },
]

/** HTTP 方法對應的樣式 */
function methodStyle(method: ApiEndpoint['method']): string {
  switch (method) {
    case 'GET':
      return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'POST':
      return 'bg-green-100 text-green-700 border-green-200'
    case 'PUT':
      return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'DELETE':
      return 'bg-red-100 text-red-700 border-red-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

/** 錯誤碼對應顏色樣式 */
function errorCodeStyle(color: string): string {
  switch (color) {
    case 'green':
      return 'bg-green-100 text-green-700'
    case 'yellow':
      return 'bg-yellow-100 text-yellow-700'
    case 'orange':
      return 'bg-orange-100 text-orange-700'
    case 'red':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [stats, setStats] = useState<Stats>({
    contentTotal: 0,
    sortTotal: 0,
    visitsTotal: 0,
    todayNew: 0,
  })

  useEffect(() => {
    api
      .get<Stats>('/admin/stats')
      .then((res) => {
        const d = res.data as Partial<Stats> | undefined
        setStats({
          contentTotal: d?.contentTotal ?? 0,
          sortTotal: d?.sortTotal ?? 0,
          visitsTotal: d?.visitsTotal ?? 0,
          todayNew: d?.todayNew ?? 0,
        })
      })
      .catch(() => {})
  }, [])

  // 版本更新自動通知 — 偵測最新版本，POST /notify/version-check
  // 後端用 KV 去重（notified_version:{version}），每個版本只推送一次
  // 推送格式：釘釘 ActionCard / 企業微信 markdown（帶 emoji + 換行）
  useEffect(() => {
    const latest = VERSIONS.find((v) => v.latest)
    if (!latest) return
    api
      .post<{ pushed?: boolean; skipped?: boolean; reason?: string }>('/admin/notify/version-check', {
        version: latest.version,
        date: latest.date,
        changes: latest.changes,
        icon: latest.icon,
      })
      .then((res) => {
        const data = res.data
        if (data?.pushed) {
          console.log(`[版本通知] ${latest.version} webhook 推送成功`)
        } else if (data?.skipped) {
          console.log(`[版本通知] ${latest.version} 跳過: ${data.reason}`)
        }
      })
      .catch((e) => {
        console.error(`[版本通知] ${latest.version} 推送失敗:`, e instanceof Error ? e.message : e)
      })
  }, [])

  /** 統計卡片配置 */
  const statCards = [
    {
      label: '內容總數',
      value: stats.contentTotal,
      icon: '📄',
      to: '/contents',
      gradient: 'from-blue-500 to-indigo-600',
    },
    {
      label: '欄目數量',
      value: stats.sortTotal,
      icon: '🗂️',
      to: '/categories',
      gradient: 'from-emerald-500 to-teal-600',
    },
    {
      label: '總訪問量',
      value: stats.visitsTotal,
      icon: '👁️',
      to: '/contents',
      gradient: 'from-purple-500 to-fuchsia-600',
    },
    {
      label: '今日新增',
      value: stats.todayNew,
      icon: '📈',
      to: '/contents',
      gradient: 'from-amber-500 to-orange-600',
    },
  ]

  /** 快速操作配置 */
  const quickActions = [
    { label: '新建內容', icon: '✏️', to: '/contents/new', desc: '創建新文章', color: 'hover:border-blue-400 hover:bg-blue-50' },
    { label: '新建欄目', icon: '📁', to: '/categories', desc: '管理內容欄目', color: 'hover:border-emerald-400 hover:bg-emerald-50' },
    { label: '媒體庫', icon: '🖼️', to: '/media', desc: '管理圖片文件', color: 'hover:border-purple-400 hover:bg-purple-50' },
    { label: '系統設置', icon: '⚙️', to: '/settings', desc: '配置系統參數', color: 'hover:border-amber-400 hover:bg-amber-50' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* 頁面頭部 - 漸層背景 */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🎛️</span>
          <div>
            <h1 className="text-2xl font-bold">儀表板</h1>
            <p className="text-sm text-slate-300 mt-1">
              CloudflareCMS 管理後台 · 歡迎回來，在此管理您的網站內容
            </p>
          </div>
        </div>
      </div>

      {/* 分頁按鈕 */}
      <div className="flex flex-wrap gap-1 border-b border-border bg-white rounded-t-lg px-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 分頁內容 */}
      <div className="bg-white rounded-b-lg border border-t-0 border-border p-6">
        {/* ========== Tab 1: 概覽 ========== */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* 統計卡片 */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>📈</span>
                <span>數據統計</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((card) => (
                  <Link
                    key={card.label}
                    to={card.to}
                    className="group relative overflow-hidden rounded-xl border border-border bg-white p-5 transition-all hover:shadow-lg hover:-translate-y-0.5"
                  >
                    {/* 漸層頂部條 */}
                    <div
                      className={cn(
                        'absolute top-0 left-0 right-0 h-1 bg-gradient-to-r',
                        card.gradient,
                      )}
                    />
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-3xl">{card.icon}</span>
                      <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        查看詳情 →
                      </span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">
                      {card.value.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {card.label}
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            {/* 快速操作 */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>⚡</span>
                <span>快速操作</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    to={action.to}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border border-border bg-white p-4 transition-all',
                      action.color,
                    )}
                  >
                    <span className="text-3xl">{action.icon}</span>
                    <div>
                      <div className="font-medium text-foreground">
                        {action.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {action.desc}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ========== Tab 2: 版本更新 ========== */}
        {activeTab === 'versions' && (
          <div className="space-y-6">
            {/* 提示信息 */}
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              <span className="text-lg">📋</span>
              <span>最新版本更新將顯示在頂部</span>
            </div>

            {/* 版本時間線 */}
            <div className="relative">
              {/* 垂直線 */}
              <div className="absolute left-5 top-2 bottom-2 w-0.5 bg-gradient-to-b from-primary via-border to-transparent" />

              <ol className="space-y-6">
                {VERSIONS.map((v) => (
                  <li key={v.version} className="relative pl-14">
                    {/* 節點圓點 */}
                    <div
                      className={cn(
                        'absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-lg',
                        v.latest
                          ? 'border-primary shadow-md ring-4 ring-primary/10'
                          : 'border-border',
                      )}
                    >
                      {v.icon}
                    </div>

                    {/* 內容卡片 */}
                    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold',
                            v.latest
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground',
                          )}
                        >
                          {v.version}
                        </span>
                        {v.latest && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <span>🟢</span>
                            <span>最新</span>
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <span>📅</span>
                          <span>{v.date}</span>
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                        {v.changes}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* ========== Tab 3: API 開發手冊 ========== */}
        {activeTab === 'api' && (
          <div className="space-y-8">
            <div className="rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 p-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-indigo-900">
                <span>📚</span>
                <span>API 開發手冊</span>
              </h2>
              <p className="text-sm text-indigo-700 mt-1">
                本手冊面向前端開發者，提供完整的接口調用說明與示例代碼。
              </p>
            </div>

            {/* 1. 認證方式 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>🔑</span>
                <span>認證方式</span>
              </h3>
              <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                <p className="text-sm text-foreground leading-relaxed">
                  本系統使用 <strong className="font-semibold">JWT Bearer Token</strong>{' '}
                  進行身份認證。登錄接口返回 token 後，前端需將其存儲在{' '}
                  <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">
                    localStorage
                  </code>{' '}
                  中，並在後續請求的 Header 中攜帶。
                </p>
                <ul className="text-sm text-foreground space-y-1.5 list-disc list-inside">
                  <li>
                    登錄：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">POST /api/v1/auth/login</code>，請求體{' '}
                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{'{ username, password, turnstileToken? }'}</code>
                  </li>
                  <li>返回：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{'{ token }'}</code></li>
                  <li>
                    存儲：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">localStorage.setItem('cms_token', token)</code>
                  </li>
                  <li>
                    請求頭：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">Authorization: Bearer {'<token>'}</code>
                  </li>
                </ul>
              </div>
            </section>

            {/* 2. 基礎信息 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📡</span>
                <span>基礎信息</span>
              </h3>
              <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                <div className="text-sm text-foreground">
                  <strong className="font-semibold">Base URL：</strong>
                  通過 Pages Functions 同域代理，前綴為{' '}
                  <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">/api/v1</code>
                </div>
                <div className="text-sm text-foreground">
                  <strong className="font-semibold">統一響應格式：</strong>
                </div>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm">
                  <code>{`{
  "code": 0,
  "msg": "成功",
  "data": {},
  "meta": {
    "page": 1,
    "pagesize": 20,
    "total": 100
  }
}`}</code>
                </pre>
                <div className="text-sm text-foreground">
                  <strong className="font-semibold">多站點路由（X-Site-Id header）：</strong>
                  <span className="text-muted-foreground ml-1">
                    所有公開與管理接口均可通過 <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">X-Site-Id</code> header 指定站點（endoscopy / smile / vision），未攜帶時默認回退到主站（endoscopy）。前端網站調用時務必攜帶此 header 確保數據隔離。
                  </span>
                </div>
                <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                  <strong>💡 交付示例：</strong>
                  前端網站調用 Endoscopy 站點疾病知識欄目列表（分頁）：
                  <code className="block mt-1.5 text-xs font-mono bg-blue-100 rounded px-2 py-1 text-blue-900">
                    GET /api/v1/contents?scode=14&amp;page=1&amp;pagesize=20
                  </code>
                  <code className="block mt-1 text-xs font-mono bg-blue-100 rounded px-2 py-1 text-blue-900">
                    Header: X-Site-Id: endoscopy
                  </code>
                </div>
              </div>
            </section>

            {/* 3. 接口列表 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📋</span>
                <span>接口列表</span>
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-secondary-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">方法</th>
                      <th className="px-4 py-3 text-left font-semibold">路徑</th>
                      <th className="px-4 py-3 text-left font-semibold">說明</th>
                      <th className="px-4 py-3 text-center font-semibold">認證</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {API_ENDPOINTS.map((ep) => (
                      <tr key={`${ep.method}-${ep.path}`} className="hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              'inline-block px-2 py-0.5 rounded text-xs font-bold border',
                              methodStyle(ep.method),
                            )}
                          >
                            {ep.method}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="text-xs font-mono text-foreground">{ep.path}</code>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{ep.desc}</td>
                        <td className="px-4 py-2.5 text-center">
                          {ep.auth ? (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <span>🔒</span>
                              <span>需認證</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700">
                              <span>🌐</span>
                              <span>公開</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. 快速開始 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>🚀</span>
                <span>快速開始</span>
              </h3>
              <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm">
                <code>{`// 1. 登錄獲取 token
const res = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'xxx' })
})
const { data } = await res.json()
localStorage.setItem('cms_token', data.token)

// 2. 調用需認證接口
const resp = await fetch('/api/v1/admin/contents?page=1', {
  headers: { Authorization: \`Bearer \${localStorage.getItem('cms_token')}\` }
})
const result = await resp.json()
console.log(result.data) // 內容列表

// 3. 語義搜索（公開接口，無需認證）
const search = await fetch('/api/v1/search?q=保養眼睛&topK=10&threshold=0.5')
const { data: articles } = await search.json()
console.log(articles) // 相似文章列表

// 4. 多站點內容調用（核心場景：前端網站調用指定站點數據）
//    X-Site-Id header 指定站點：endoscopy / smile / vision
//    未攜帶 X-Site-Id 時默認回退到主站（endoscopy）

// 4a. 獲取 Endoscopy 站點「疾病知識」欄目列表（分頁）
//     scode=14 為疾病知識欄目，自動包含子欄目內容
const endoscopyRes = await fetch(
  '/api/v1/contents?scode=14&page=1&pagesize=20&order=date',
  { headers: { 'X-Site-Id': 'endoscopy' } }
)
const endoscopyData = await endoscopyRes.json()
console.log(endoscopyData.data)       // 文章列表
console.log(endoscopyData.meta)       // { page: 1, pagesize: 20, total: 15 }

// 4b. 獲取 Smile 站點全部欄目樹
const smileRes = await fetch('/api/v1/sorts', {
  headers: { 'X-Site-Id': 'smile' }
})
const { data: smileSorts } = await smileRes.json()

// 4c. 獲取 Vision 站點某篇文章詳情
const visionRes = await fetch('/api/v1/contents/42', {
  headers: { 'X-Site-Id': 'vision' }
})
const { data: article } = await visionRes.json()

// 4d. 後台管理多站點操作（需 JWT + X-Site-Id）
const adminRes = await fetch(
  '/api/v1/admin/contents?mcode=2&page=1',
  {
    headers: {
      Authorization: \`Bearer \${localStorage.getItem('cms_token')}\`,
      'X-Site-Id': 'smile'  // 管理 Smile 站點數據
    }
  }
)

// 5. 批量排序（欄目/擴展字段/幻燈片通用模式）
await fetch('/api/v1/admin/sorts/batch-sorting', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: \`Bearer \${localStorage.getItem('cms_token')}\`,
    'X-Site-Id': 'endoscopy'
  },
  body: JSON.stringify({
    items: [
      { id: 13, sorting: 1 },
      { id: 14, sorting: 2 }
    ]
  })
})`}</code>
              </pre>
            </section>

            {/* 5. 錯誤碼 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>⚠️</span>
                <span>錯誤碼</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ERROR_CODES.map((err) => (
                  <div
                    key={err.code}
                    className="flex items-center gap-3 rounded-lg border border-border bg-white p-3"
                  >
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[3rem] px-2.5 py-1 rounded text-sm font-bold font-mono',
                        errorCodeStyle(err.color),
                      )}
                    >
                      {err.code}
                    </span>
                    <span className="text-sm text-foreground">{err.desc}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ========== Tab 4: 系統信息 ========== */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            {/* 項目信息 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📦</span>
                <span>項目信息</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">📦</span>
                  <div>
                    <div className="text-xs text-muted-foreground">項目名稱</div>
                    <div className="font-semibold text-foreground mt-0.5">CloudflareCMS</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">🔧</span>
                  <div>
                    <div className="text-xs text-muted-foreground">技術棧</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      TypeScript + Hono + Cloudflare Workers
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">🗄️</span>
                  <div>
                    <div className="text-xs text-muted-foreground">數據庫</div>
                    <div className="font-semibold text-foreground mt-0.5">Cloudflare D1</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">💾</span>
                  <div>
                    <div className="text-xs text-muted-foreground">存儲</div>
                    <div className="font-semibold text-foreground mt-0.5">R2 (S3 兼容)</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4 sm:col-span-2">
                  <span className="text-2xl">🌐</span>
                  <div>
                    <div className="text-xs text-muted-foreground">前端</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      React 18 + Vite + Tailwind CSS
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Cloudflare 資源 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>☁️</span>
                <span>Cloudflare 資源</span>
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap w-32">
                        <span className="inline-flex items-center gap-2">
                          <span>⚙️</span>
                          <span>Worker</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">rust-cms</code>
                        <span className="text-muted-foreground mx-2">·</span>
                        <span className="text-muted-foreground text-xs">內部綁定（Service Binding）</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🗄️</span>
                          <span>D1 數據庫</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">endoscopy-cms</code>
                        <span className="text-muted-foreground mx-1 text-xs">（主庫）</span>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">smile-cms</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">vision-cms</code>
                        <span className="text-muted-foreground mx-2 text-xs">（APAC）</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📄</span>
                          <span>Pages</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">cms-admin</code>
                        <span className="text-muted-foreground mx-2">·</span>
                        <a
                          href="https://cms.cmermedical.com.hk"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          <span>cms.cmermedical.com.hk</span>
                          <span>🔗</span>
                        </a>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📦</span>
                          <span>KV 命名空間</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">CONFIG_CACHE</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">TOKEN_BLACKLIST</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">API_CACHE</code>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📬</span>
                          <span>Queues</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">publish-queue</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">publish-dlq</code>
                        <span className="text-muted-foreground mx-2 text-xs">定時發布</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🧠</span>
                          <span>Vectorize</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">article-semantic-search</code>
                        <span className="text-muted-foreground mx-2 text-xs">768維 cosine · @cf/baai/bge-base-en-v1.5</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🛡️</span>
                          <span>Rate Limiting</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">PUBLIC 60/min</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">ADMIN 300/min</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">LOGIN 5/min</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">FORM 1/10s</code>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🔗</span>
                          <span>Service Binding</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">cms-admin → rust-cms</code>
                        <span className="text-muted-foreground mx-2 text-xs">零延遲內部通信</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🚩</span>
                          <span>Flagship</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">mail_enabled</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">webhook_enabled</code>
                        <span className="text-muted-foreground mx-2 text-xs">真混合模式（Flagship 優先 + D1 回退）</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🔐</span>
                          <span>Secrets Store</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">JWT_SECRET</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">CF_API_TOKEN</code>
                        <span className="text-muted-foreground mx-2 text-xs">異步綁定 await get()</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>⚡</span>
                          <span>Workers Cache</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">cache.enabled</code>
                        <span className="text-muted-foreground mx-2 text-xs">聲明式邊緣緩存（配置 3600s / 內容 300s），排除 /admin/* 及 /auth/*</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📍</span>
                          <span>Smart Placement</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">placement: smart</code>
                        <span className="text-muted-foreground mx-2 text-xs">自動靠近 D1 數據中心</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 性能預算 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📊</span>
                <span>性能預算</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">📦</span>
                    <span className="font-medium text-foreground">Worker 體積限制</span>
                  </div>
                  <div className="text-2xl font-bold text-indigo-700">3 MB</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    壓縮後 gzip 約 1 MB
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">⚡</span>
                    <span className="font-medium text-foreground">單請求 CPU 時間</span>
                  </div>
                  <div className="text-2xl font-bold text-orange-700">
                    10ms <span className="text-sm font-normal text-muted-foreground">免費</span>
                    <span className="mx-2 text-muted-foreground">/</span>
                    50ms <span className="text-sm font-normal text-muted-foreground">付費</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    建議單請求 CPU ≤ 5ms
                  </p>
                </div>
              </div>
            </section>

            {/* 數據庫管理說明 */}
            <section>
              <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-4">
                <span className="text-xl">🗄️</span>
                <div>
                  <div className="font-semibold text-blue-900">數據庫管理</div>
                  <p className="text-sm text-blue-700 mt-1">
                    表前綴 <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">ay_</code> 保持不變，可按需修改/新增表結構和字段。SQL 始終使用參數化查詢。
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
