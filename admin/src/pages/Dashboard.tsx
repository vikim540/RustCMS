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
    version: 'v1.6.3',
    date: '2026-07-21 10:30:00',
    icon: '🎨',
    latest: true,
    changes: '🎨 標題顏色選擇器 + 操作者自動記錄 + Slug/發佈時間調整\n\n🎨 標題顏色 (titlecolor)\n• 文章編輯器標題旁新增顏色選擇器，可設置標題字色\n• 數據以 # 色號格式存儲（如 #ff0000）\n• 可一鍵清除顏色（恢復默認）\n\n👤 操作者自動記錄 (create_user/update_user)\n• 創建內容時自動記錄 create_user 為當前登錄用戶\n• 更新內容時自動更新 update_user 為當前操作用戶\n• 前端無需填寫，純後端處理（從 JWT claims 獲取 realname/username）\n\n🔄 Slug + 發佈時間移至基本內容\n• Slug (URL別名) 和發佈時間從高級內容 Tab 移到基本內容 Tab\n\n🗂️ 模型管理清理\n• 僅保留專題和文章兩個模型，刪除其餘 5 個模型',
  },
  {
    version: 'v1.6.2',
    date: '2026-07-20 22:30:00',
    icon: '🔧',
    latest: false,
    changes: '🔧 內容管理修復 + 標籤輸入體驗升級\n\n📂 父欄目文章列表修復\n• 後台內容列表點擊父欄目（如醫生專欄）現在正確顯示所有子欄目文章\n• handleAdminListContents 改用 getDescendantScodes（與公開 API 邏輯一致）\n\n📋 公開內容列表 API 字段補全\n• 補回被過度刪除的字段：acode、subscode、enclosure、gnote、create_user、update_user\n• 僅排除 content 正文字段（減小響應體積）\n\n🏷️ 標籤輸入器升級\n• 文字輸入改為 TagInput 組件：輸入後按 Enter 生成可關閉的標籤塊\n• 歷史標籤快速補充：顯示曾用標籤，點擊即可添加，無需重複打字\n• 新增 API：GET /admin/contents/all-tags 獲取所有歷史標籤\n\n🔁 Slug 去重\n• 移除基本內容 Tab 中重複的 Slug 字段，僅保留高級內容 Tab 中的 Slug',
  },
  {
    version: 'v1.6.1',
    date: '2026-07-20 18:00:00',
    icon: '🗂️',
    latest: false,
    changes: '🗂️ 欄目管理批量操作 — 批量排序 + 批量刪除 + 排序默認值優化\n\n📝 批量排序（dirty tracking 模式）\n• 排序列改為可編輯的 SortInput 組件（統一組件 useBatchSorting + BatchSortSaveBar）\n• 修改後標記 dirty（amber 高亮），底部顯示「保存排序」按鈕統一提交\n• 調用 PUT /admin/sorts/batch-sorting 批量更新\n• 成功/失敗均自動刷新欄目樹\n\n🗑️ 批量刪除\n• 表格頭部全選 checkbox + 每行 checkbox\n• 選中後顯示「批量刪除（N）」按鈕\n• 確認對話框警告「刪除欄目將同時刪除所有子欄目和關聯內容」\n• 逐條調用 DELETE /admin/sorts/:id（後端級聯刪除）\n• 顯示刪除進度 X/Y，失敗項計數\n\n🔢 排序默認值優化\n• 新建欄目 sorting 從硬編碼 255 改為 max(sorting)+1（同級 pcode 範圍）\n• 無同級欄目時默認為 1\n• 後端 handleCreateSort 查詢 MAX(sorting) 計算新值',
  },
  {
    version: 'v1.6.0',
    date: '2026-07-20 17:29:20',
    icon: '🌐',
    latest: false,
    changes: '🌐 多站點架構 — 亞太三站點獨立數據庫 + 用戶站點權限分配\n\n🏗️ 架構設計\n• 主庫 endoscopy-cms：全局用戶/角色/菜單/站點註冊表\n• 站點庫 smile-cms / vision-cms：各站點獨立內容/配置\n• SITE_REGISTRY 環境變量映射 siteId → D1 binding\n• X-Site-Id header 中間件路由至對應站點數據庫\n• siteDB(c) / primaryDB(c) 雙軌數據庫訪問模式\n\n🗄️ 數據庫（全部 APAC 地區）\n• endoscopy-cms（主站，現有數據）\n• smile-cms（結構 + 初始數據）\n• vision-cms（結構 + 初始數據）\n• 遷移 0006：ay_site_registry + ay_user_site 關聯表\n• 遷移 0007：M308 多站點管理菜單 + R101 權限\n\n👥 用戶站點權限分配\n• 全局用戶 + 站點分配模式（用戶/角色/菜單在主庫）\n• 非超管用戶必須至少分配一個站點（前端驗證 + 後端檢查）\n• 超級管理員自動擁有所有站點權限\n• 用戶編輯對話框新增站點勾選 UI（全選/清空）\n• GET /admin/users/:id/sites + POST /admin/users/:id/sites\n\n🎨 前端多站點體驗\n• 側邊欄頂部站點選擇下拉（替代固定標題）\n• 切換站點自動刷新頁面載入新站點數據\n• Login.tsx 登入後緩存站點列表 + 設置默認站點\n• 多站點管理頁（/sites）：站點列表 + 創建嚮導 + 編輯\n\n🔌 API 端點\n• GET /admin/sites — 列出用戶可訪問的站點\n• GET /admin/sites/current — 當前站點信息\n• POST /admin/sites/create — 一鍵創建新站點（REST API）\n• PUT /admin/sites/:siteId — 更新站點信息\n• GET /admin/users/:id/sites — 用戶已分配站點\n• POST /admin/users/:id/sites — 設置用戶站點分配',
  },
  {
    version: 'v1.5.9',
    date: '2026-07-20 15:02:38',
    icon: '🧹',
    latest: false,
    changes: '版本通知自動化 + 格式化 + 幻燈片排序優化\n\n🔧 版本通知自動推送（恢復）\n• 機制：Dashboard useEffect 偵測最新版本 → POST /notify/version-check → 後端構造 ActionCard markdown 推送\n• KV 去重：notified_version:{version} 確保每個版本只推送一次（避免重複）\n• 格式：changes 字段帶 emoji + 換行，直接渲染為釘釘 ActionCard / 企業微信 markdown\n• 優勢：無需開發者手動推送，部署後首次訪問 Dashboard 即自動觸發\n\n📝 版本更新格式化\n• changes 字段從純文字改為帶 emoji + 換行格式（whitespace-pre-line）\n• 與釘釘 webhook 推送格式保持一致\n\n📊 幻燈片排序優化\n• 默認排序從 0 改為從 1 開始（拖拽 idx+1，新增 maxSorting+1）\n• 列表按 sorting ASC 排序展示（拖到第一則顯示第一）',
  },
  {
    version: 'v1.5.8',
    date: '2026-07-20 14:35:17',
    icon: '🐛',
    latest: false,
    changes: '🐛 幻燈片排序 API 根因修復 — Hono 路由順序 bug\n\n根因\n• PUT /slides/:id 在 PUT /slides/batch-sorting 之前註冊\n• Hono 按順序匹配，"batch-sorting" 被當作 :id 參數\n• 匹配到 handleUpdateSlide（返回 1001 "沒有需要更新的字段"）\n• batch-sorting handler 永遠不會被執行\n\n修復\n• 將 batch-sorting 路由移到 :id 路由之前\n\n舉一反三\n• contents/trash：GET 不衝突 ✓\n• models/all：順序正確 ✓\n• roles/all：順序正確 ✓\n\n驗證\n• ✅ batch-sorting API → code=0, msg=排序更新成功\n• ✅ 數據庫 ID 2 sorting = 99 已確認更新',
  },
  {
    version: 'v1.5.7',
    date: '2026-07-20 14:05:23',
    icon: '🔧',
    latest: false,
    changes: '🔧 幻燈片排序 bug 修復 + 時間戳時區修正 + TZ 環境變量\n\nSlides 排序修復\n• 根因：onBlur 中 val !== item.sorting 永遠為 false\n• 改用 dirty tracking + 保存排序按鈕（黃色高亮 + 批量提交）\n• 新增幻燈片默認分組改為當前選中分組（或 1）\n• 新增幻燈片排序自動填入該分組最大值+1\n\n時間戳修正\n• v1.5.1-v1.5.6 從錯誤時區修正為香港 UTC+8\n• v1.4.0 去除過於規整的 09:30:00\n\nTZ 環境變量\n• wrangler.jsonc 新增 TZ=Asia/Hong_Kong',
  },
  {
    version: 'v1.5.6',
    date: '2026-07-20 13:37:41',
    icon: '🤖',
    latest: false,
    changes: 'Cloudflare Turnstile 人機驗證整合：後端新增 verifyTurnstile() 函數調用 Cloudflare siteverify API 驗證 token；handleLogin 新增 turnstileToken 參數，開關開啟時強制驗證（網絡異常時放行避免故障）；新增公開端點 GET /api/v1/auth/turnstile-config（返回 enabled + siteKey，secret key 不暴露）；前端 Login.tsx 動態載入 Turnstile 腳本 + explicit 模式渲染 widget（語言 zh-HK，主題 light），登錄失敗自動 reset widget；DB 新增 3 條配置（turnstile_enabled/turnstile_site_key/turnstile_secret_key，sorting 35-37 安全配置分組）；新增錯誤碼 2007（人機驗證失敗）；修復 v1.5.1-v1.5.5 版本時間戳（時區從 UTC 修正為香港 UTC+8，修正順序顛倒問題，去除過於規整的整點時間）',
  },
  {
    version: 'v1.5.5',
    date: '2026-07-20 13:08:52',
    icon: '🔑',
    latest: false,
    changes: '權限系統根因修復 — JWT 權限實時刷新：後端 admin 認證中間件每次請求為非超管用戶從數據庫重新加載權限（reloadUserPermissions），解決角色權限變更後 JWT 中權限過時的問題（無需重新登錄即可生效）；handleProfile 改為從數據庫重新加載權限（非 JWT 快照）；loadUserPermissions 優化為單次 IN 查詢（替代逐角色查詢）；禁用用戶返回 401 觸發前端登出；回收站路由權限修復（contents/trash、restore、permanent 改用 M208 回收站權限，不再被 M201 文章列表攔截）；前端 Layout 掛載時拉取 /auth/profile 刷新 localStorage 權限（Outlet key 綁定權限變化，確保 RequirePermission 路由守衛即時生效）',
  },
  {
    version: 'v1.5.4',
    date: '2026-07-20 12:46:08',
    icon: '🇭🇰',
    latest: false,
    changes: '公司/站點信息香港本地化 + 公開公司 API：公司信息移除內地專用字段（QQ、郵編 postcode、ICP 備案號），新增 WhatsApp 字段（香港主流通訊），重命名標籤（法人代表→董事/公司秘書、營業執照號→商業登記證號碼、微信→WeChat 微信），placeholder 改為香港格式（8位電話號碼、.com.hk 郵箱）；站點信息移除 ICP 備案號（與公司信息重複且內地專用）和主題模板（headless CMS 無模板系統），域名 placeholder 改為 cms.cmermedical.com.hk，版權信息 placeholder 改為英文格式；後端 SITE_FIELDS/COMPANY_FIELDS 白名單同步更新，getOrCreateSite/getOrCreateCompany INSERT 語句對齊；DB 遷移 0005 新增 ay_company.whatsapp 列，ay_site.lang 從 zh-cn 更新為 zh-hk；新增公開 API GET /api/v1/company（參考 Go 版 /api/company，過濾敏感字段僅返回聯繫信息）；storage.ts 公司媒體引用新增 WhatsApp 二維碼列，標籤更新為 WeChat 二維碼/商業登記證',
  },
  {
    version: 'v1.5.3',
    date: '2026-07-20 12:28:15',
    icon: '🔐',
    latest: false,
    changes: '權限系統全面修復 + 幻燈片拖拽排序：後端新增 forbidden() 函數返回 HTTP 403（區分 401 未認證 vs 403 權限拒絕），requireMenuPermission 和 requireSuperAdmin 改用 403；前端 request() 僅 HTTP 401 時重定向 login，403 時彈出權限拒絕 toast 提示（Layout 註冊 setPermissionDeniedCallback，右上角紅色 toast 3秒自動消失）；App.tsx 新增 RequirePermission 路由守衛組件，所有 24 個頁面路由均包裹權限檢查（mcode 映射，storage/database 為 __super__ 僅超管），無權限時顯示 🔒 提示頁而非重定向 login；幻燈片管理新增分組 ID 自動遞增（計算 maxId+1，不允許重複），分組名稱改為可選（留空自動命名）；幻燈片表格新增拖拽排序（HTML5 draggable，拖拽 ⋮⋮ 圖示調整順序，即時更新後端 batch-sorting API）+ 手動排序輸入框（失焦自動保存）；新增 PUT /admin/slides/batch-sorting 批量排序 API（D1 batch 更新）',
  },
  {
    version: 'v1.5.2',
    date: '2026-07-20 12:09:47',
    icon: '📐',
    latest: false,
    changes: '媒體庫尺寸顯示 + 壓縮比例縮放 + 權限修復：媒體庫瀑布流卡片新增圖片尺寸徽章（ImageWithDimensions 組件，onLoad 取得 naturalWidth/naturalHeight，左下角黑色半透明徽章顯示 寬×高）；詳情面板也顯示前端取得的圖片尺寸；壓縮對話框從獨立「最大寬度1920 + 最大高度1080」改為單一「最大邊長」輸入（imageCompress.ts 新增 maxDimension 選項，browser-image-compression 的 maxWidthOrHeight 按原始比例等比縮放，不會拉伸變形），附帶四個尺寸預設（PC 1920 / Mobile 1080 / 縮略 800 / 小圖 400）；DB 新增 M301 媒體庫子菜單（M300 多媒體為父級容器，M301 為實際權限鍵，url=/admin/media 對應後端中間件），兩個角色均已加入 M301；後端 media 中間件註釋從 M300 更新為 M301；Layout.tsx LABEL_MCODE_MAP「媒體庫」從 M300 改為 M301；權限審計：所有 24 個前端頁面均有對應 mcode 權限控制（資料庫管理/存儲設置僅超管可見），上傳端點 /admin/upload 保留 requireAuth（所有可上傳角色均已含 M301）',
  },
  {
    version: 'v1.5.1',
    date: '2026-07-20 11:52:33',
    icon: '🎨',
    latest: false,
    changes: '上傳體驗統一 + 媒體庫瀑布流 + Worker URL 禁用：ImageCompressDialog 新增前後圖片對比區域（原始 vs 壓縮後並排展示，棋盤格背景，hover 彈出全屏放大預覽不超過 100vw/vh）；移除對比區域 px-3 加寬顯示空間；統一所有上傳位置使用 ImageCompressDialog（ContentEdit 從 autoCompress=true 改為 Promise-based 對話框模式，與媒體庫/幻燈片完全一致）；新增 UploadProgressOverlay 組件（屏幕居中進度覆蓋層，替代各頁面內聯進度條，漸變進度條+錯誤卡片可關閉）；媒體庫從固定网格改為 CSS columns 瀑布流佈局（columns-2~6 響應式，圖片按原始比例顯示高度，方便辨別 PC/Mobile 圖片尺寸）；修復 MediaLibrary 上傳 bug（FileList 清空順序：先 Array.from 複製再清空 input.value）；幻燈片菜單從擴展內容移至多媒體分組（DB M402 pcode M400→M300，Layout.tsx 分組調整）；Worker 禁用 workers.dev 和 preview_urls（僅作為 Pages cms-admin 內部 ServiceBinding，Cloudflare API 確認 subdomain enabled=false）；修復 Vite 構建 0 字節文件問題（fixEmptyChunksPlugin 插件，輸出目錄 build→deploy）',
  },
  {
    version: 'v1.5.0',
    date: '2026-07-20 10:08:35',
    icon: '🗜️',
    latest: false,
    changes: '圖片壓縮引擎重構 + 自定義標籤移除：引入 browser-image-compression 開源庫（Web Worker 壓縮，不阻塞 UI），建立三層組件化架構（imageCompress.ts 引擎層 → useImageUpload.ts hook 層 → ImageCompressDialog.tsx UI 層），引擎可獨立替換不影響消費方；所有圖片上傳位置默認接入壓縮：媒體庫（壓縮對話框預覽+進度條）、幻燈片（桌面/移動端進度條）、文章內容（Quill 編輯器+縮略圖+擴展字段，autoCompress=true 自動壓縮為 WebP）；上傳過程實時進度展示（壓縮中/上傳中階段+百分比+文件名）；上傳失敗顯示具體錯誤（文件名+錯誤原因，可關閉）；ContentEdit 浮動進度提示（右下角 toast）；移除自定義標籤功能（headless CMS 無模板引擎，與 config API 重疊）— 刪除後端路由/services、前端頁面/路由/側邊欄、DB 菜單 M404 + 角色權限',
  },
  {
    version: 'v1.4.2',
    date: '2026-07-20 09:43:18',
    icon: '📐',
    latest: false,
    changes: '側邊欄分組重構對齊 PbootCMS/Go 版邏輯（參考原版 6 分組結構）：新增 DB 頂級菜單 M600「全局配置」和 M610「基礎內容」；移動技術性子菜單（M206 擴展字段、M207 內容模型、M503 系統配置）pcode 從 M200/M500 → M600 全局配置；移動基礎內容子菜單（M501 站點信息、M502 公司信息、M202 欄目管理）pcode → M610；移動擴展內容子菜單（M203 單頁管理、M204 留言管理、M205 自定義表單）pcode → M400；M200 改名「內容管理→文章內容」、M400 改名「SEO設置→擴展內容」、M500 改名「系統設置→系統管理」；文章內容分組僅放文案相關（動態模型列表+回收站），技術性菜單移至全局配置；更新 copywriter 權限為 12 項（含父菜單 M610/M200/M400/M300）；更新超管 R101 權限為 27 項（含新增 M600/M610）',
  },
  {
    version: 'v1.4.1',
    date: '2026-07-20 09:17:42',
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
    date: '2026-07-17 17:17:50',
    icon: '🎨',
    latest: false,
    changes: '幻燈片管理優化：圖片預覽改為原比例展示（object-contain）+ 新增前端 WebP 壓縮上傳功能（Canvas API 自動縮放+質量壓縮，類似 Squoosh 效果）；域名安全重構：移除 Worker 後端公網域名暴露（wrangler.jsonc 取消自定義域名 + Pages Functions 回退改為錯誤響應 + Dashboard 系統信息不再顯示後端域名），Pages 域名更新為 cms.cmermedical.com.hk',
  },
  {
    version: 'v1.2.0',
    date: '2026-07-17 16:53:59',
    icon: '🚀',
    latest: false,
    changes: '資料庫備份建立時間修復（從文件名解析精確時間 + 記錄備份日誌）；側邊導航菜單默認收起僅文章內容展開；版本更新自動通知機制（Pages 部署後 Dashboard 自動觸發釘釘 webhook，KV 記錄已通知版本避免重複推送）',
  },
  {
    version: 'v1.1.0',
    date: '2026-07-17 16:40:37',
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
  { method: 'GET', path: '/api/v1/auth/profile', desc: '個人信息', auth: true },
  // 公開接口 (60次/分/IP)
  { method: 'GET', path: '/api/v1/site', desc: '站點信息', auth: false },
  { method: 'GET', path: '/api/v1/company', desc: '公司信息（公開聯繫方式）', auth: false },
  { method: 'GET', path: '/api/v1/sorts', desc: '欄目樹', auth: false },
  { method: 'GET', path: '/api/v1/sorts/:scode', desc: '欄目詳情', auth: false },
  { method: 'GET', path: '/api/v1/contents', desc: '內容列表 (?scode=&page=&pagesize=)', auth: false },
  { method: 'GET', path: '/api/v1/contents/:id', desc: '內容詳情', auth: false },
  { method: 'GET', path: '/api/v1/search', desc: '語義搜索 (?q=關鍵詞&topK=10&threshold=0.5)', auth: false },
  { method: 'GET', path: '/api/v1/slides', desc: '幻燈片列表 (?gid=)', auth: false },
  { method: 'GET', path: '/api/v1/links', desc: '友情連結 (?gid=)', auth: false },
  { method: 'GET', path: '/api/v1/singles', desc: '單頁列表', auth: false },
  { method: 'GET', path: '/api/v1/singles/:scode', desc: '單頁詳情', auth: false },
  { method: 'GET', path: '/api/v1/tags', desc: '標籤列表', auth: false },
  { method: 'POST', path: '/api/v1/messages', desc: '提交留言 (1次/10秒/IP)', auth: false },
  // 管理接口 (300次/分/用戶)
  { method: 'GET', path: '/api/v1/admin/contents', desc: '後台內容列表 (?scode=&mcode=&page=)', auth: true },
  { method: 'GET', path: '/api/v1/admin/contents/all-tags', desc: '歷史標籤列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/contents', desc: '新建內容', auth: true },
  { method: 'PUT', path: '/api/v1/admin/contents/:id', desc: '更新內容', auth: true },
  { method: 'GET', path: '/api/v1/admin/models/all', desc: '所有模型', auth: true },
  { method: 'GET', path: '/api/v1/admin/sorts', desc: '欄目樹 (?mcode=)', auth: true },
  { method: 'GET', path: '/api/v1/admin/media', desc: '媒體列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/upload', desc: '文件上傳 (multipart/form-data)', auth: true },
  { method: 'GET', path: '/api/v1/admin/configs', desc: '系統配置', auth: true },
  { method: 'PUT', path: '/api/v1/admin/configs', desc: '更新配置', auth: true },
  { method: 'GET', path: '/api/v1/admin/users', desc: '用戶列表', auth: true },
  { method: 'GET', path: '/api/v1/admin/roles', desc: '角色列表 (含 userCount/levelCount)', auth: true },
  { method: 'GET', path: '/api/v1/admin/roles/all', desc: '全部啟用角色 (含 levelCount)', auth: true },
  { method: 'GET', path: '/api/v1/admin/menus', desc: '菜單樹', auth: true },
  { method: 'GET', path: '/api/v1/admin/logs', desc: '系統日誌 (?level=admin|content|security|error|notify)', auth: true },
  { method: 'GET', path: '/api/v1/admin/flags', desc: '查詢功能開關狀態', auth: true },
  { method: 'PUT', path: '/api/v1/admin/flags', desc: '切換功能開關 (D1回退模式)', auth: true },
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
  // 欄目管理 + 擴展字段 (v1.6.1+)
  { method: 'GET', path: '/api/v1/admin/sorts', desc: '欄目樹 (?mcode=)', auth: true },
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
  { code: 2002, desc: '未授權', color: 'red' },
  { code: 2003, desc: 'Token 已過期', color: 'red' },
  { code: 2004, desc: 'Token 已登出', color: 'red' },
  { code: 2005, desc: '無權限訪問此功能', color: 'red' },
  { code: 2006, desc: '用戶已被禁用或不存在', color: 'red' },
  { code: 2007, desc: '人機驗證失敗（Turnstile）', color: 'red' },
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
      .post('/admin/notify/version-check', {
        version: latest.version,
        date: latest.date,
        changes: latest.changes,
        icon: latest.icon,
      })
      .catch(() => {})
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
              RustCMS 管理後台 · 歡迎回來，在此管理您的網站內容
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
                    <div className="font-semibold text-foreground mt-0.5">RustCMS</div>
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
                        <span className="text-muted-foreground mx-2 text-xs">768維 cosine · bge-base-zh-v1.5</span>
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
                        <span className="text-muted-foreground mx-2 text-xs">D1 回退模式</span>
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
