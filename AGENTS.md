# AGENTS.md — 項目約束與開發規範

> **強制約束文件**。所有代碼生成、修改、審查必須遵守。當前版本：**v1.5.9**（2026-07-20）

---

## 環境與工具

| 工具 | 版本/路徑 | 備註 |
|------|-----------|------|
| wrangler | 4.112.0 | `D:\AI\Cache\pnpm-home\wrangler.CMD`（全局 3.1.0 已禁用） |
| pnpm | 11.5.1 | `D:\AI\Cache\pnpm-home`（全局緩存 `D:\AI\Cache\pnpm`） |
| Node.js | >= 18 | 系統 PATH |
| PowerShell | pwsh.exe 7 | 禁止寫入 C 盤，所有工具/緩存存放 `D:\AI` |
| Cloudflare API Token | 環境變量 `CLOUDFLARE_API_TOKEN` | — |
| JWT_SECRET | wrangler secret | — |
| TZ | `Asia/Hong_Kong` | wrangler.jsonc vars，Worker 運行時自動使用香港時區 |

---

## 目錄結構

```
Cloudflarerustcms/
├── src/                        # 後端 Worker（TypeScript + Hono）
│   ├── index.ts                # 路由薄層 + 中間件註冊
│   ├── services/               # 業務厚層（每個功能一個文件）
│   │   ├── auth.ts             # JWT + 權限（reloadUserPermissions 實時刷新）
│   │   ├── content.ts          # 內容 CRUD + 按模型過濾
│   │   ├── config.ts           # KV 配置緩存
│   │   ├── extra.ts            # 站點/公司信息（HK 本地化字段白名單）
│   │   ├── flags.ts            # FLAG_REGISTRY 功能開關註冊表
│   │   ├── notify.ts           # Webhook + 郵件通知
│   │   ├── vectorize.ts        # 語義搜索（Vectorize + Workers AI）
│   │   ├── scheduler.ts        # Queues 定時發布 + Cron
│   │   ├── ratelimit.ts        # Rate Limiting bindings
│   │   ├── cache.ts            # KV API 響應緩存
│   │   ├── storage.ts          # R2/S3 S3 兼容存儲 + 媒體庫引用
│   │   ├── sort.ts             # 欄目樹 buildSortTree
│   │   ├── model.ts            # 內容模型管理
│   │   └── system.ts           # 系統日誌/菜單/數據庫
│   └── utils/                  # 純函數
│       ├── jwt.ts              # Web Crypto HS256 自實現
│       ├── password.ts         # 雙 MD5
│       ├── response.ts         # okData/err/forbidden 統一響應
│       ├── datetime.ts         # UTC+8 香港時區
│       ├── pagination.ts       # 分頁工具
│       └── s3sig.ts            # AWS SigV4 簽名（純 Web Crypto）
├── admin/                      # 前端 SPA（React 18 + Vite + Tailwind）
│   ├── functions/api/v1/[[path]].ts  # Pages Functions Service Binding 代理
│   ├── src/
│   │   ├── App.tsx             # 路由 + RequirePermission 守衛
│   │   ├── components/         # Layout / ImageCompressDialog / TagInput 等
│   │   ├── hooks/              # useFeatureFlags / useImageUpload
│   │   ├── lib/                # api.ts（HTTP 客戶端）/ imageCompress.ts / utils.ts
│   │   └── pages/              # 24 個頁面組件
│   ├── vite.config.ts          # 輸出目錄 deploy（非 build！fixEmptyChunksPlugin）
│   └── package.json
├── migrations/                 # D1 遷移（冪等語法）
├── docs/                       # 設計文檔（00-06）
└── wrangler.jsonc              # Worker 配置（bindings + cron）
```

> **注意**：`src/model/`、`src/service/`、`src/util/`（`.rs` 文件）為早期 Rust 原型遺留，已廢棄，當前使用 `src/services/` 和 `src/utils/`（`.ts`）。

---

## Cloudflare 資源

| 資源 | 標識 | 說明 |
|------|------|------|
| Worker | `rust-cms` | 內部 Service Binding，**公網 URL 已禁用**（`workers_dev: false`） |
| D1 | `rust-cms-db` | ID: `28a95ec3-7228-4c47-b9f6-e9cfcfcaf319` |
| KV | `CONFIG_CACHE` / `TOKEN_BLACKLIST` / `API_CACHE` | 邏輯分離（CONFIG_CACHE 與 API_CACHE 共用 namespace） |
| Queues | `publish-queue` → `publish-dlq` | 定時發布，Cron 每 15 分鐘掃描 |
| Vectorize | `article-semantic-search` | 768 維 cosine，多語言語義搜索 |
| Workers AI | `@cf/baai/bge-base-en-v1.5` | XLM-RoBERTa 嵌入模型，支持中文 |
| Rate Limiting | `PUBLIC_API_LIMIT`(60/min) / `ADMIN_API_LIMIT`(300/min) / `LOGIN_LIMIT`(5/min) / `FORM_LIMIT`(1/10s) | 零網絡開銷 |
| Flagship | `Flagship-service`（app: `Rustcms-service`） | 混合模式：Flagship UUID 配置則只讀，未配置則 D1 回退 |
| Pages | `cms-admin` | 管理後台 SPA，域名 `cms.cmermedical.com.hk` |
| Service Binding | Pages `cms-admin` → Worker `rust-cms` | 零延遲內部通信，前端通過 `functions/api/v1/[[path]].ts` 代理 |
| GitHub | `https://github.com/vikim540/RustCMS.git` | 賬號 `waicun_lee@outlook.com`（Account ID: `f5d4e94cb23f69f8ae69baedff94f2ba`） |

---

## 硬約束

### 數據庫

- 表前綴 `ay_` 不變，**可按需修改/新增表結構和字段**
- SQL 始終 `.bind()` 參數化，**禁止字符串拼接**
- 新增表/字段用冪等語法：`CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN`
- 遷移文件編號需唯一（當前存在重複編號 0003/0004，後續新增從 0006 開始）

### 禁止依賴

| 禁止 | 替代 |
|------|------|
| `sqlx` / 數據庫驅動 | D1 binding API |
| `jsonwebtoken` | Web Crypto API 自實現 HS256 |
| `bcrypt` / `argon2` | 雙 MD5（`md5(md5(password))`，與 PbootCMS/Go 版兼容） |
| `nodemailer` / SMTP 庫 | MailChannels / Resend HTTP API |
| `node-fetch` / `axios` | 全局 `fetch()` |
| `lucide-react` / 字體圖標 | emoji（`lucide-react` 在 package.json 中為殘留依賴，可移除） |

### 前後端分離

- Worker **只返回 JSON**，禁止渲染 HTML
- 管理後台 SPA 部署在 Pages（`cms-admin`），**禁止打包進 Worker**
- 前端通過 Pages Functions **Service Binding** 內部代理 API（`admin/functions/api/v1/[[path]].ts`），未配置時返回 500 錯誤

---

## 代碼規範

- **命名**：camelCase（函數/變量）、PascalCase（接口/類型）、UPPER_SNAKE_CASE（常量）
- **模塊**：`index.ts`（路由薄）→ `services/*.ts`（業務厚）→ `utils/*.ts`（純函數）
- **錯誤處理**：service 返回 `Response`，`try/catch` 包裹外部調用
- **類型**：嚴格 TS，禁止 `any`（用 `unknown` + 斷言）
- **圖標**：全盤 emoji，禁止 SVG/字體圖標庫

### 統一響應格式

```jsonc
{ "code": 0, "msg": "成功", "data": {}, "meta": { "page": 1, "pagesize": 20, "total": 100 } }
```

### API 路由

- 前綴 `/api/v1/`，RESTful
- **公開**：`/api/v1/{resource}`（無認證，60 req/min）— 含 `/api/v1/company`（公開公司聯繫信息）、`/api/v1/search`（語義搜索）、`/api/v1/auth/turnstile-config`（Turnstile 配置）
- **管理**：`/api/v1/admin/{resource}`（JWT `requireAuth` + `requireMenuPermission`，300 req/min）
  - `database` / `storage` 路由僅超管可用 `requireSuperAdmin`
  - `flags` / `stats` / `upload` / `notify` / `vectorize` 路由僅需登錄（無菜單權限限制）

---

## 權限系統（RBAC）

> **v1.5.5 核心修復**：JWT 權限實時刷新，無需重新登錄即可生效。

### 機制

1. **登錄**：生成 JWT（含 `isSuper` + `permissions` 快照），有效期 7 天
2. **每次 admin 請求**：中間件為非超管用戶調用 `reloadUserPermissions()` 從 D1 重新加載權限，**覆蓋 JWT 中的過時權限**
3. **禁用用戶**：返回 401（code 2006），觸發前端登出
4. **前端刷新**：Layout 掛載時拉取 `/auth/profile` 更新 localStorage 權限，`Outlet key` 綁定權限變化確保 `RequirePermission` 即時生效

### HTTP 狀態碼語義

| 狀態碼 | code | 含義 | 前端行為 |
|--------|------|------|----------|
| 401 | 2002/2003/2004/2006 | 未認證/Token 過期/已登出/用戶禁用 | 重定向 login |
| 403 | 2005 | 權限拒絕 | 彈出 toast 提示（**不重定向**） |
| 400 | 2007 | Turnstile 人機驗證失敗 | 登錄頁提示重試 |

### 回收站路由特殊處理

`/api/v1/admin/contents/trash`、`/contents/:id/restore`、`/contents/:id/permanent` 使用 **M208** 權限（非 M201 文章列表），在中間件中按路徑動態判斷。

### 關鍵文件

- 後端：`src/services/auth.ts`（`loadUserPermissions` / `reloadUserPermissions` / `hasMenuPermission`）、`src/index.ts`（admin 認證中間件 + `requireMenuPermission` 路由保護）
- 前端：`admin/src/App.tsx`（`RequirePermission` 路由守衛）、`admin/src/components/Layout.tsx`（側邊欄權限過濾 + profile 刷新）、`admin/src/lib/api.ts`（401/403 區分處理）

---

## 業務邏輯重點

### 內容按模型分類

- 側邊欄動態生成模型子菜單（`type='2'` 列表型模型）
- 後端子查詢過濾：`scode IN (SELECT scode FROM ay_content_sort WHERE mcode = ?)`
- **媒體庫資源不混入內容管理**（`scode != ''` 過濾），媒體庫通過 S3 ListObjects 直接列出

### 圖片上傳與壓縮

- **三層架構**：`lib/imageCompress.ts`（引擎層，browser-image-compression）→ `hooks/useImageUpload.ts`（Hook 層）→ `components/ImageCompressDialog.tsx`（UI 層）
- 所有上傳位置默認 JPG/PNG → WebP 壓縮，引擎可獨立替換
- 上傳方式：① R2 上傳 ② 外鏈 URL ③ 媒體庫選擇（`MediaPickerModal`）
- 進度展示：`UploadProgressOverlay` 屏幕居中覆蓋層

### 通知服務

- **功能開關**：`mail_enabled` / `webhook_enabled` 控制總開關，註冊表 `FLAG_REGISTRY`（`src/services/flags.ts`）驅動後端攔截 + 前端隱藏 + API 保護
- **新增大功能**：在 `FLAG_REGISTRY` 加一條即可，三層自動生效
- **Webhook**：自動檢測釘釘/企業微信/通用 JSON，分項開關
- **郵件**：MailChannels / Resend HTTP API，HTML 模板
- 通知日誌復用 `ay_syslog`，`ctx.waitUntil()` 確保異步生命週期

### 定時發布

- 文章 `date` 字段作為發布時間，`status='0'` 為草稿
- Cron 每 15 分鐘掃描 24 小時內待發布文章，投遞延遲消息到 Queue
- 已過期草稿直接在 Cron 中發布（兜底）

### 語義搜索

- 文章創建/更新時自動索引（標題+正文剝離 HTML，截斷 2000 字）
- 流程：搜索詞 → Workers AI 嵌入 → Vectorize 查詢 → 閾值 0.5 過濾 → D1 取完整文章
- 重建索引：`POST /api/v1/admin/vectorize/reindex`

### KV 緩存

- 僅緩存公開 GET 請求：內容列表 TTL 300s，配置數據 TTL 3600s
- 內容 CRUD 後 `clearContentCache`，配置更新後 `clearConfigCache`

### 香港本地化（v1.5.4）

- 公司信息：移除 QQ/郵編/ICP，新增 WhatsApp，標籤香港化（商業登記證號碼、董事/公司秘書）
- 站點信息：移除 ICP 備案號（與公司重複）、主題模板（headless 無模板）
- 系統設置：搜索引擎驗證從百度推送改為 Google/Bing 站點驗證
- 公開 API：`GET /api/v1/company` 過濾敏感字段僅返回聯繫信息

### Cloudflare Turnstile 人機驗證（v1.5.6）

- **配置**：DB `ay_config` 表 3 條記錄（sorting 35-37，安全配置分組）— `turnstile_enabled`（開關）/ `turnstile_site_key`（站點密鑰）/ `turnstile_secret_key`（密鑰）
- **後端**：`src/services/auth.ts` `verifyTurnstile()` 調用 Cloudflare siteverify API 驗證 token；`handleLogin` 開關開啟時強制驗證（網絡異常時放行避免故障）
- **前端**：`Login.tsx` 動態載入 Turnstile 腳本（explicit 模式），掛載時拉取 `/auth/turnstile-config` 判斷是否啟用，登錄失敗自動 reset widget
- **公開端點**：`GET /api/v1/auth/turnstile-config` 返回 `{ enabled, siteKey }`（secret key 不暴露）

---

## 常用命令

```powershell
# ===== 開發 =====
# 後端（Worker，端口 8787）
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' dev

# 前端（Vite，端口 3000，代理 /api → 127.0.0.1:8787）
cd admin; npx vite dev

# ===== 部署（先 Worker 後 Pages）=====
# 1. Worker 部署
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' deploy

# 2. 前端構建（輸出到 deploy 目錄，非 build！）
cd admin; npx vite build

# 3. Pages 部署（從 admin 目錄執行，需含 functions/ 目錄）
cd admin; & 'D:\AI\Cache\pnpm-home\wrangler.CMD' pages deploy deploy --project-name=cms-admin

# ===== 數據庫 =====
# 遷移
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 migrations apply rust-cms-db --remote

# 執行 SQL
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 execute rust-cms-db --remote --command "SELECT * FROM ay_config LIMIT 5"

# 生成類型（配置變更後必須運行）
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' types

# ===== Git =====
git add -A; git commit -m '✨ feat: 描述'; git push origin main
```

> **部署注意**：Pages 部署必須從 `admin/` 目錄執行，否則 `functions/` 目錄不會被上傳。Vite 構建輸出到 `deploy/` 目錄（`vite.config.ts` 中 `outDir: 'deploy'`，配合 `fixEmptyChunksPlugin` 修復 Windows 0 字節 chunk 問題）。

---

## 開發檢查清單

1. 是否有 PbootCMS/Go 版對應實現？優先參考
2. SQL 是否 `.bind()` 參數化？
3. 響應格式是否統一 `{code,msg,data}`？
4. 配置修改後是否清除 KV 緩存？
5. 通知服務是否異步觸發（`ctx.waitUntil`）？
6. 功能開關是否檢查？
7. 媒體庫上傳是否避免寫入 `ay_content`？
8. 圖標是否使用 emoji？
9. **Hono 路由順序**：`/:id` 路由必須在子路徑路由（如 `/batch-sorting`、`/trash`、`/all`）之後註冊，否則子路徑會被當作 `:id` 匹配
10. **是否同步更新了儀表盤的版本更新、API 開發手冊、系統信息？（強制）**
11. **版本更新完成後是否推送釘釘 webhook 通知？（強制）**

---

## 儀表盤同步更新規則（強制）

> **每次修改代碼後，必須同步更新 `admin/src/pages/Dashboard.tsx` 中的三個 Tab。**

### 版本更新 Tab

- 新增版本條目到 `VERSIONS` 數組頂部，設 `latest: true`，舊版本移除 `latest`
- 格式：`{ version: 'vX.Y.Z', date: 'YYYY-MM-DD HH:mm:ss', icon: 'emoji', latest: true, changes: '簡述' }`
- 版本號：主版本（架構變更）/ 次版本（功能新增）/ 修訂號（Bug 修復）

### API 開發手冊 Tab

- 新增/修改 API 端點時，同步更新 `API_ENDPOINTS` 數組
- 新增錯誤碼時，同步更新 `ERROR_CODES` 數組

### 系統信息 Tab

- Cloudflare 資源變更時更新資源表格
- 技術棧變更時更新項目信息卡片

---

## 參考項目

| 項目 | 路徑 | 用途 |
|------|------|------|
| PbootCMS 3.2.12（PHP 原版） | `F:\mysite\AI\idea\pbootcmstogo\PbootCMS-3.2.12` | 數據庫結構 + 業務邏輯參考 |
| pbootcms-go（自研 Go 版） | `F:\mysite\AI\idea\pbootcmstogo\pbootcms-go` | API 設計參考 |
| 本項目 | `F:\mysite\AI\idea\Cloudflarerustcms` | — |
