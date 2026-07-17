# AGENTS.md - 項目約束與開發規範

> 本文件是 AI 編程代理和開發者的強制約束文件。所有代碼生成、修改、審查必須遵守以下規則。

---

## 項目概述

TypeScript + Hono + Cloudflare Workers CMS，基於 PbootCMS 3.2.12 數據庫結構，前後端完全分離的純 API 後端，部署在 Cloudflare Workers 上。

> **技術棧說明**：項目最初規劃 Rust（workers-rs），實際運行 TypeScript + Hono。workers-rs v0.8.5 活躍維護中，支持 D1/KV/R2/Queues/RateLimit/Email/ServiceBindings，但**缺 Vectorize 原生綁定**。未來 CPU 密集型模塊可拆分為獨立 Rust Worker，通過 Service Bindings 供 TS 主 Worker 調用。

### 參考項目

| 項目 | 路徑 |
|------|------|
| PbootCMS 3.2.12 (PHP原版) | `F:\mysite\AI\idea\pbootcmstogo\PbootCMS-3.2.12` |
| pbootcms-go (自研Go版) | `F:\mysite\AI\idea\pbootcmstogo\pbootcms-go` |
| 本項目 | `F:\mysite\AI\idea\Cloudflarerustcms` |

### Cloudflare 資源

| 資源 | 標識 |
|------|------|
| Worker | `rust-cms`，域名 `cms.vikim.eu.org` |
| D1 | `rust-cms-db`（ID: `28a95ec3-7228-4c47-b9f6-e9cfcfcaf319`） |
| KV | `CONFIG_CACHE`（`69737778474044ada68b6f34db79f8cb`）、`TOKEN_BLACKLIST`（`31e1d191d5664d2fa39a72dd9cae6906`）、`API_CACHE`（同 CONFIG_CACHE，邏輯分離） |
| Queues | `publish-queue`（定時發布）、`publish-dlq`（死信隊列） |
| Vectorize | `article-semantic-search`（768維 cosine，中文語義搜索） |
| Workers AI | 嵌入模型 `@cf/baai/bge-base-zh-v1.5` |
| Rate Limiting | `PUBLIC_API_LIMIT`(60/min)、`ADMIN_API_LIMIT`(300/min)、`LOGIN_LIMIT`(5/min)、`FORM_LIMIT`(1/10s) |
| 功能開關 | D1 存儲 + `FLAG_REGISTRY` 註冊表驅動，後台直接管理（flags: `mail_enabled`、`webhook_enabled`） |
| Email | MailChannels / Resend HTTP API（免費第三方，CF Email Service 需 Workers Paid） |
| Pages | `cms-admin`（管理後台 SPA），域名 `rbootcms.cmer.eu.org` |
| Service Binding | Pages `cms-admin` → Worker `rust-cms`（零延遲內部通信） |
| GitHub | `https://github.com/vikim540/RustCMS.git` |
| 賬號 | `waicun_lee@outlook.com`（Account ID: `f5d4e94cb23f69f8ae69baedff94f2ba`） |

開發文檔位於 `docs/` 目錄（00-06 共 7 份）。

---

## 硬約束

### 1. 數據庫管理

- 表前綴 `ay_` 保持不變，可按需修改/新增表結構和字段
- SQL 始終使用 `.bind()` 參數化，禁止字符串拼接
- 新增表/字段使用冪等語法：`CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN ... IF NOT EXISTS`
- 參考 PbootCMS/Go 版已驗證的新增表：`ay_area`, `ay_role_area`, `ay_301_redirect`, `ay_media_mark`, `ay_content_ext`

### 2. 技術棧

- 後端：**TypeScript + Hono**，運行於 Cloudflare Workers 原生運行時
- 數據庫：**D1**（`db.prepare().bind().all()`，禁止字符串拼接 SQL）
- 緩存：**KV**（`config:all` 配置緩存 + JWT 黑名單 + API 響應緩存）
- 存儲：**R2**（S3 兼容，AWS SigV4 簽名）
- 佇列：**Queues**（定時文章發布，`delaySeconds` 上限 24 小時，配合 Cron 每 15 分鐘掃描）
- 語義搜索：**Vectorize + Workers AI**（`@cf/baai/bge-base-zh-v1.5` 中文嵌入模型，768 維）
- 速率限制：**Rate Limiting bindings**（零網絡開銷，本地計數器）
- 功能開關：**D1 存儲** + `FLAG_REGISTRY` 註冊表驅動，後台直接切換（`src/services/flags.ts`），關閉時自動隱藏相關配置 + 攔截 API
- 郵件：**MailChannels / Resend** HTTP API（免費第三方，CF Email Service 需 Workers Paid）
- 前端：**React 18 + Vite + Tailwind CSS**（Cloudflare Pages）
- 內部通信：**Service Bindings**（Pages ↔ Worker 零延遲，不走公網）
- 序列化：原生 JSON

### 3. 禁止依賴

| 禁止 | 替代 |
|------|------|
| `sqlx` / 數據庫驅動 | D1 binding API |
| `jsonwebtoken` | Web Crypto API 自實現 HS256 |
| `bcrypt` / `argon2` | 雙 MD5（`md5(md5(password))`） |
| `nodemailer` / SMTP 庫 | MailChannels / Resend HTTP API（免費第三方） |
| `node-fetch` / `axios` | 全局 `fetch()` |
| `lucide-react` / 字體圖標 | emoji（全盤使用 emoji 替代 SVG/字體圖標） |
| 圖片處理庫 / 模板引擎 | 無（水印交靜態生成層） |

### 4. 密碼方案

雙 MD5：`md5(md5(password))`，與 PbootCMS/Go 版兼容，常量時間比較防時序攻擊。

### 5. 前後端分離

- Worker 只返回 JSON，禁止渲染 HTML
- 管理後台 SPA 部署在 Pages（`cms-admin`），禁止打包進 Worker
- 前端通過 Pages Functions（`admin/functions/api/v1/[[path]].ts`）使用 **Service Binding** 內部代理 API（零延遲，不走公網）
- Service Binding 未配置時自動回退到公網 `fetch`

---

## 代碼規範

### TypeScript

1. 命名：camelCase（函數/變量）、PascalCase（接口/類型）、UPPER_SNAKE_CASE（常量）
2. 模塊：`index.ts`（路由薄）→ `services/*.ts`（業務厚）→ `utils/*.ts`（純函數）
3. 錯誤處理：service 返回 `Response`，`try/catch` 包裹外部調用，禁止未捕獲異常
4. SQL：`.bind()` 參數化，禁止拼接
5. 異步：D1/KV/R2/Queues/Vectorize/AI/fetch 均 `async/await`
6. 類型：嚴格 TS，禁止 `any`（用 `unknown` + 斷言）
7. 註釋：公共函數 JSDoc，複雜邏輯行內註釋
8. 圖標：全盤使用 emoji，禁止引入 SVG/字體圖標庫

### 統一響應格式

```jsonc
{ "code": 0, "msg": "成功", "data": {}, "meta": { "page": 1, "pagesize": 20, "total": 100 } }
```

### API 路由

- 前綴 `/api/v1/`，RESTful
- 公開：`/api/v1/{resource}`（無認證，Rate Limiting 60 req/min）
- 管理：`/api/v1/admin/{resource}`（JWT `requireAuth`，Rate Limiting 300 req/min）
- 語義搜索：`/api/v1/search?q=關鍵詞&topK=10&threshold=0.7`
- 定時發布：`/api/v1/admin/scheduler/list`、`/api/v1/admin/scheduler/schedule`
- Vectorize 索引：`/api/v1/admin/vectorize/reindex`
- 功能開關查詢/切換：`/api/v1/admin/flags`（GET 查詢，PUT 切換）
- 通知測試：`/api/v1/admin/notify/test-mail`、`/api/v1/admin/notify/test-webhook`

---

## 業務邏輯約束

### 內容按模型分類（參考 PbootCMS/Go mcode 邏輯）

- 側邊欄動態生成模型子菜單（`type='2'` 列表型模型）
- 後端子查詢過濾：`scode IN (SELECT scode FROM ay_content_sort WHERE mcode = ?)`
- 欄目查詢支持 `?mcode=` 參數；新建內容根據 URL `mcode` 預選欄目
- 內容管理僅管理有編輯器的文章，**不混入媒體庫資源**

### 圖片上傳支持外鏈 + 媒體庫選擇

縮略圖、Quill 編輯器、擴展字段圖片均支持：① 上傳 R2（`POST /admin/upload`）② 手動輸入外鏈 URL ③ 從媒體庫選擇（`MediaPickerModal` 組件）。

### CORS 動態域名校驗

中間件從 KV 讀取 `api_cors_origins`，配置白名單則僅允許列出的 Origin（含 `Vary: Origin` + `Credentials`），未配置則允許 `*`。

### 通知服務（Webhook + 郵件 + 功能開關）

- **功能開關（標準化架構）**：`mail_enabled` / `webhook_enabled` 控制通知總開關
  - **註冊表驅動**：所有功能開關在 `src/services/flags.ts` 的 `FLAG_REGISTRY` 中註冊（key/label/description/icon/defaultValue/protectedRoutes）
  - **D1 存儲**：開關值存儲在 `ay_config` 表，後台直接切換，無需外部面板
  - **後端攔截**：`autoRouteProtection()` 中間件自動攔截 `protectedRoutes` 定義的 API 端點，關閉時返回 `code:1004`
  - **前端組件化**：`FeatureFlagProvider` + `useFeatureFlags` Hook + `<FeatureGate flagKey="...">` 組件，關閉時不渲染子組件
  - 關閉後：通知邏輯不執行 + API 端點被攔截 + 後台隱藏對應配置區域
  - API：`GET /api/v1/admin/flags` 查詢開關狀態，`PUT /api/v1/admin/flags` 切換開關
  - **新增大功能時**：在 `FLAG_REGISTRY` 加一條即可，前端/後端/API 攔截全部自動生效
- **Webhook**（`src/services/notify.ts`）：自動檢測平台（釘釘 ActionCard / 企業微信 Markdown / 通用 JSON），分項開關 `webhook_message|form|comment`
- **郵件**（`src/services/notify.ts`）：MailChannels / Resend HTTP API（免費第三方）；配置 `mail_from|mail_from_name|mail_provider|mail_api_key`；HTML 模板含漸層 header / 字段表格 / 來源信息 / footer
- 通知日誌復用 `ay_syslog`（`level` = `mail_success|mail_error|webhook_success|webhook_error`），使用 `ctx.waitUntil()` 確保異步生命週期

### 定時文章發布（Queues + Cron）

- 文章 `date` 字段作為發布時間，`status='0'` 為草稿
- Cron 每 15 分鐘掃描 24 小時內待發布文章，投遞延遲消息到 Queue
- Queue 消費者將 `status` 從 `'0'` 更新為 `'1'`
- 已過期草稿直接在 Cron 中發布（兜底機制）
- API：`POST /api/v1/admin/scheduler/schedule` 設定文章發布時間

### 語義搜索（Vectorize + Workers AI）

- 嵌入模型：`@cf/baai/bge-base-zh-v1.5`（768 維，中文優化）
- 文章創建/更新時自動索引（標題+正文剝離 HTML 後組合，截斷 2000 字）
- 搜索流程：搜索詞 → Workers AI 嵌入 → Vectorize 查詢 → 按相似度閾值過濾 → D1 取完整文章
- 相關文章推薦：同理查詢當前文章的向量，返回相似文章
- API：`GET /api/v1/search?q=保養眼睛&topK=10&threshold=0.7`
- 重建索引：`POST /api/v1/admin/vectorize/reindex`

### Rate Limiting（速率限制）

| 綁定 | 限制 | 適用接口 |
|------|------|---------|
| `LOGIN_LIMIT` | 5 req/min per IP | `/api/v1/auth/login` |
| `FORM_LIMIT` | 1 req/10s per IP | `/api/v1/messages` |
| `PUBLIC_API_LIMIT` | 60 req/min per IP | 公開 GET 接口 |
| `ADMIN_API_LIMIT` | 300 req/min per user | `/api/v1/admin/*` |

### KV API 響應緩存

- 僅緩存公開 GET 請求，不緩存管理接口和錯誤響應
- 內容列表 TTL: 300s，配置數據 TTL: 3600s
- 內容 CRUD 後自動清除 `clearContentCache`，配置更新後清除 `clearConfigCache`

---

## PbootCMS 邏輯索引

| 功能 | PHP 版 | Go 版 | 本項目 |
|------|--------|-------|--------|
| 欄目樹 | `core/function/handle.php` `get_tree()` | `ContentSortService.go` `buildAreaTree()` | `src/services/sort.ts` `buildSortTree` |
| 內容按模型 | `ContentModel.php` `getList($mcode)` | `ContentService.go` `ListContents()` | `src/services/content.ts` `handleAdminListContents` |
| 配置加載 | `Config.php` `loadConfig()` | `db.go` `preloadConfigCache()` | `src/services/config.ts` KV `config:all` |
| 密碼 | `md5(md5(password))` | `security.go` `ConstantTimeCompare` | `src/utils/password.ts` |
| 權限 | `ay_role_level.level` | `auth.go` uid=1 跳過 | `src/services/auth.ts` JWT + `requireAuth` |
| Webhook | 無 | `webhook/webhook.go` | `src/services/notify.ts` `sendWebhook` |
| 郵件 | `Smtp.php` | `mail/mailer.go` SMTP | `src/services/notify.ts` CF Email Service |
| 語義搜索 | 無 | 無 | `src/services/vectorize.ts` Vectorize + Workers AI |
| 定時發布 | 無 | 無 | `src/services/scheduler.ts` Queues + Cron |
| 速率限制 | 無 | 無 | `src/services/ratelimit.ts` Rate Limiting bindings |
| 功能開關 | 無 | 無 | `src/services/flags.ts` D1 + FLAG_REGISTRY |
| API 緩存 | 無 | 無 | `src/services/cache.ts` KV |

---

## 環境與工具

### 環境位置

| 工具 | 位置 |
|------|------|
| wrangler 4.96.0 | `D:\AI\Cache\pnpm-home\wrangler.CMD` |
| pnpm | `D:\AI\Cache\pnpm-home` |
| Node.js >= 18 | 系統 PATH |
| Cloudflare API Token | 環境變量 `CLOUDFLARE_API_TOKEN`（需 Vectorize/Queues 權限） |
| JWT_SECRET | wrangler secret（`wrangler secret put JWT_SECRET`） |
| 前端緩存 | `D:\AI\Cache\pnpm` |
| 臨時文件 | `D:\AI\Temp` |

> 全局 `wrangler`（3.1.0）版本過舊不支持 `--remote`，**禁止使用**，必須用上述 pnpm 環境的 4.96.0。

### 環境規則

- PowerShell 只用 pwsh.exe 7
- 禁止寫入 C 盤，所有工具/緩存/配置存放在 `D:\AI`
- `D:\AI` 結構：Tools / Runtime / Cache / Data / IDE / Downloads / Temp

---

## 常用命令

### 開發

```powershell
# 後端本地開發
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' dev

# 前端本地開發
cd admin; npx vite dev
```

### 部署

```powershell
# 後端 Worker (必須先部署 Worker，再部署 Pages，因 Pages 依賴 Service Binding)
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' deploy --dry-run   # 驗證
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' deploy              # 部署

# 前端 Pages
cd admin; npx vite build
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' pages deploy build --project-name=cms-admin

# Secret 管理
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' secret put JWT_SECRET
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' secret list
```

### Cloudflare 資源管理

```powershell
# Queues
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' queues create publish-queue
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' queues list

# Vectorize
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' vectorize create article-semantic-search --dimensions=768 --metric=cosine
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' vectorize list

# Email Sending
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' email sending list
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' email sending enable vikim.eu.org

# 生成類型 (配置變更後必須運行)
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' types
```

### 數據庫

```powershell
# 遷移
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 migrations apply rust-cms-db --remote
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 migrations list rust-cms-db --remote

# 執行 SQL
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 execute rust-cms-db --remote --command "SELECT * FROM ay_config LIMIT 5"

# 備份
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 export rust-cms-db --remote --output backup.sql
```

### Git

```powershell
git status --short
git add -A
git commit -m '✨ feat: 描述'
git push origin main
git log --oneline -10
```

### 日誌與調試

```powershell
# 實時日誌
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' tail
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' tail --status error --search "notify"

# 啟動時間分析
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' check startup

# 生成類型
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' types
```

---

## 開發檢查清單

1. 是否有 PbootCMS/Go 版對應實現？優先參考
2. 是否引入禁止依賴？
3. SQL 是否參數化？
4. 響應格式是否統一 `{code,msg,data}`？
5. 配置修改後是否清除 KV 緩存（`clearConfigCache` + `clearContentCache`）？
6. 熱點數據是否走 KV？
7. 通知服務是否異步觸發（`ctx.waitUntil`）？
8. 功能開關是否檢查？
9. 內容變更後是否清除 API 緩存？
10. 圖標是否使用 emoji（非 SVG/字體圖標）？
11. **是否同步更新了儀表盤的版本更新、API 開發手冊、系統信息？（強制）**

---

## 儀表盤同步更新規則（強制）

> **每次修改代碼後，必須同步更新 `admin/src/pages/Dashboard.tsx` 中的以下三個 Tab，無需用戶提醒。**

### 1. 版本更新 Tab

- 新增版本條目到 `VERSIONS` 數組頂部，設 `latest: true`，舊版本移除 `latest`
- 格式：`{ version: 'vX.Y.Z', date: 'YYYY-MM-DD  HH:mm:ss', icon: 'emoji', latest: true, changes: '簡述本次修改' }`
- 版本號規則：主版本（架構變更）/ 次版本（功能新增）/ 修訂號（Bug 修復）
- `changes` 用中文分號分隔多項修改

### 2. API 開發手冊 Tab

- 新增/修改 API 端點時，同步更新 `API_ENDPOINTS` 數組
- 格式：`{ method, path, desc, auth }`
- 新增錯誤碼時，同步更新 `ERROR_CODES` 數組
- 快速開始示例代碼如有新場景，同步更新 `代碼示例`

### 3. 系統信息 Tab

- 新增/移除 Cloudflare 資源（KV/Queue/Vectorize/RateLimit 等）時，更新 Cloudflare 資源表格
- 技術棧變更時，更新項目信息卡片
- 性能預算變更時，更新性能預算卡片

---

## 性能預算

| 指標 | 限制 | 目標 |
|------|------|------|
| Worker 體積 | 3MB（gzip 1MB） | ≤ 500KB（gzip ≤ 100KB） |
| 單請求 CPU | 10ms（免費）/ 50ms（付費） | ≤ 5ms |
| D1 日寫入 | 100,000 行 | KV 緩存減少寫入 |
| KV 日讀取 | 100,000 次 | 合理 TTL + API 緩存 |
| Queues 操作 | 10,000/天（免費） | Cron 每 15 分鐘批量處理 |
| Vectorize 查詢維度 | 3,000 萬/月（免費） | 1 萬文章 × 768 維 = 768 萬（額度內） |
| Rate Limiting | 無獨立計費 | 含在 Workers 計劃中 |

---

## 免費額度管理

| 產品 | 免費額度 | 本項目預估用量 | 是否充足 |
|------|---------|--------------|---------|
| Workers 請求 | 100,000/天 | 100 萬/天需付費 (~$11/月) | 需 Workers Paid |
| D1 查詢 | 100,000/天 | KV 緩存減少查詢 | 充足（配合緩存） |
| KV 讀取 | 100,000/天 | 緩存命中率 80% → ~20 萬/天 | 需控制緩存策略 |
| Queues 操作 | 10,000/天 | 定時發布低頻 | 充足 |
| Vectorize | 3,000 萬查詢維度/月 | 1 萬文章 × 768 維 = 768 萬 | 充足 |
| Workers AI | 10,000 神經網絡請求/天 | 搜索+索引 | 需監控 |

---

## 文件修改記錄

| 日期 | 修改內容 | 修改人 |
|------|---------|--------|
| 2026-07-16 | 初始創建 | AI Assistant |
| 2026-07-17 | v0.2-v0.5：技術棧更正 TS+Hono；全盤 emoji 圖標；媒體庫選擇器；儀表盤 Tab；架構升級（Queues/Vectorize/Rate Limiting/KV 緩存/Service Bindings）；功能開關標準化架構（flags.ts 註冊表 + autoRouteProtection + FeatureGate） | AI Assistant |
| 2026-07-17 | v0.6-v0.9：系統設置分區塊獨立保存；角色權限菜單樹驅動；用戶管理權限預覽；菜單管理 mcode 權限鍵；API 菜單權限攔截中間件；登錄頁無限刷新修復；系統用戶單選角色；側邊欄 mcode 權限過濾；後端內容排序 PbootCMS 邏輯；幻燈片分組標籤 | AI Assistant |
| 2026-07-17 | v1.0.0：登錄頁無限刷新根因修復（FeatureFlagProvider 移至 Layout + 全局重定向鎖 + Rocket Loader 繞過）；功能開關改為始終 D1 模式；S3 存儲獨立分塊 + 鎖定防誤觸 + 折疊；幻燈片移動端圖片預覽；AGENTS.md 移除數據庫零改動約束 + Flagship 更新為始終 D1 + 精簡重複內容 | AI Assistant |
