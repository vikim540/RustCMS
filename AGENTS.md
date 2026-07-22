# AGENTS.md — 項目約束與開發規範

> **強制約束文件**。所有代碼生成、修改、審查必須遵守。當前版本：**v1.9.7**（2026-07-22）


## 版本更新記錄（憑證）

> 每次正式版本更新必須記錄於此，作為開發憑證。日常瑣碎修改無需頻繁記錄。

| 版本 | 日期 | 摘要 |
|------|------|------|
| v1.9.7 | 2026-07-22 | 編輯器有序列表軟換行修復。顯式註冊 softBreak 鍵盤綁定確保 Shift+Enter 在有序列表內插入軟換行（實現「標題+縮進內容」排版）、懸掛縮進 CSS 確保續行與首行文字對齊、編輯器下方新增鍵盤快捷鍵提示 |
| v1.9.6 | 2026-07-22 | 保存提示 UI 優化。fixed 頂部中間定位（頁面較長時也可見）、5 秒自動隱藏、深色/藍色背景區分無修改/有修改 |
| v1.9.5 | 2026-07-22 | 權限清理 + 媒體庫刪除狀態 + 編輯保存比對 + 編編輯器排版。徹底清除 M205 菜單 + 角色權限（M204 為現行啟用版本）、媒體庫刪除圖片時顯示 🔄 [文件名] 刪除中... 覆蓋層、文章編輯保存時自動比對修改字段（提示「此次修改了 N 處」，無修改不觸發後端）、編輯器有序列表懸掛縮進 CSS、新增 HTML 源碼按鈕（工具列 <> 圖標，textarea 模式直接編輯 HTML） |
| v1.9.4 | 2026-07-22 | 權限歸類修正 + 幻燈片顯隱控制。修正 M210 pcode: M200→M610、幻燈片新增顯示/隱藏開關（status 字段，關閉後不返回到公開 API）、移除新增對話框中冗餘的分組 ID 文字輸入框、切換分組時自動計算排序序號 |
| v1.9.3 | 2026-07-22 | 表單提交 API 安全加固。移除舊 POST /api/v1/messages、移除 /api/v1/forms/submit/:formId、移除公開 GET /api/v1/forms/active、新增 POST /api/v1/f/:token（16位隨機 token 隱蔽化端點）。五層安全防護：隨機路徑+Honeypot+Origin校驗+可選Turnstile+速率限制 |
| v1.9.2 | 2026-07-22 | 表單管理系統 + Settings Tab 修正。新增表單管理頁面（M210 權限）、支持創建/編輯/刪除多個表單、每個表單可配置專屬 Webhook URL、is_active 開關控制側邊欄展示、活躍表單自動注入擴展內容側邊欄、FormSubmissions 顯示表單名稱 |
| v1.9.1 | 2026-07-22 | FormSubmissions UI 統一、批量刪除+批量狀態更新、form_key 篩選下拉、Settings Tab 重構（5 Tab 導航） |
| v1.9.0 | 2026-07-22 | 統一表單系統（取代留言管理）。新增 ay_form_submission 表、公開端點 POST /api/v1/forms/submit、管理端 CRUD + 統計、釘釘 ActionCard 推送、前端瀑布流網格佈局 |


## 語言選擇優先級

> **Rust 優先原則**：旨在效率和性能的提升，Rust 語言為首選實現語言。
> 但當 TypeScript 在以下方面更優時，可次之使用：
> - Cloudflare 生態環境匹配度（Workers 原生支持、綁定兼容性）
> - 插件/庫生態成熟度（Hono、D1 binding、Vectorize 等）
> - 代碼合理性與可維護性（類型安全、開發效率）
> - 社區支持與文檔完整性

| 場景 | 推薦語言 | 原因 |
|------|----------|------|
| Worker 後端業務邏輯 | TypeScript | Cloudflare Workers 原生支持，Hono 框架 + D1/KV/Queue binding 無縫集成 |
| 高性能計算/數據處理 | Rust | 編譯為 WASM，零成本抽象，內存安全 |
| 前端 SPA | TypeScript | React + Vite 生態，TSX 類型安全 |
| 密碼學/簽名算法 | Rust → WASM | 性能敏感場景優先 Rust，編譯為 WASM 在 Workers 中調用 |

---

## 環境與工具

| 工具 | 版本/路徑 | 備註 |
|------|-----------|------|
| wrangler | 4.113.0 | `D:\AI\Cache\pnpm-home\wrangler.CMD`（npm 全局安裝至 `D:\AI\Cache\npm-global`，junction 映射至 pnpm-home；pnpm 全局安裝因 Windows 原生二進制鎖定不可用）。**注意**：4.112.0+ 在 Windows 上 Worker/Pages 部署有 `.wrangler/tmp` 寫入權限 bug（`Access is denied`），部署請使用本地 `node node_modules/wrangler/bin/wrangler.js`（4.111.0） |
| pnpm | 11.5.1 | `D:\AI\Cache\pnpm-home`（全局緩存 `D:\AI\Cache\pnpm`） |
| Node.js | >= 18 | 系統 PATH |
| PowerShell | pwsh.exe 7 | 禁止寫入 C 盤，所有工具/緩存存放 `D:\AI` |
| Cloudflare API Token | 環境變量 `CLOUDFLARE_API_TOKEN` | — |
| JWT_SECRET | Secrets Store | Store ID: `aef7c32e26c84aedb4b2a5938128ca23`，異步綁定 `JWT_SECRET_STORE` |
| TZ | `Asia/Hong_Kong` | wrangler.jsonc vars，代碼中用 `toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' })` 獲取 HK 時間 |

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
│   ├── wrangler.jsonc          # Pages 部署配置（pages_build_output_dir: deploy）
│   └── package.json
├── migrations/                 # D1 遷移（冪等語法，當前 0001-0012）
└── wrangler.jsonc              # Worker 配置（bindings + cron + cache + placement）
```

> **注意**：早期 Rust 原型遺留（`src/model/`、`src/service/`、`src/util/`、`Cargo.toml`）已於 v1.7.0 清理刪除。當前使用 `src/services/` 和 `src/utils/`（`.ts`）。

---

## Cloudflare 資源

| 資源 | 標識 | 說明 |
|------|------|------|
| Worker | `rust-cms` | 內部 Service Binding，**公網 URL 已禁用**（`workers_dev: false`） |
| D1（主庫） | `endoscopy-cms` | ID: `c824a999-6a14-4878-bc43-2f3de023cbde`（認證/用戶/角色/菜單/站點註冊表） |
| D1（smile） | `smile-cms` | ID: `f59320b5-b1f2-47cf-8b32-e341e1c5da48` |
| D1（vision） | `vision-cms` | ID: `a49903a9-098e-43cd-934c-9bad2466d8ae` |
| KV | `CONFIG_CACHE` / `TOKEN_BLACKLIST` / `API_CACHE` | 邏輯分離（CONFIG_CACHE 與 API_CACHE 共用 namespace） |
| Queues | `publish-queue` → `publish-dlq` | 定時發布，Cron 每 15 分鐘掃描 |
| Vectorize | `article-semantic-search` | 768 維 cosine，多語言語義搜索 |
| Workers AI | `@cf/baai/bge-base-en-v1.5` | XLM-RoBERTa 嵌入模型，支持中文 |
| Rate Limiting | `PUBLIC_API_LIMIT`(60/min) / `ADMIN_API_LIMIT`(300/min) / `LOGIN_LIMIT`(5/min) / `FORM_LIMIT`(1/10s) | 零網絡開銷 |
| Flagship | `Flagship-service`（app: `Rustcms-service`） | 真混合模式：Flagship 優先（`getBooleanValue`），失敗回退 D1；Flagship 模式下開關只讀 |
| Secrets Store | `default_secrets_store`（ID: `aef7c32e26c84aedb4b2a5938128ca23`） | 異步綁定（`await env.X.get()`），存儲 JWT_SECRET + CF_API_TOKEN + TURNSTILE_SECRET_KEY + S3_ACCESS_KEY + S3_SECRET_KEY |
| Workers Cache | `cache.enabled: true` | 聲明式邊緣緩存，公開 GET 自動緩存（配置 3600s / 內容 300s），排除 /admin/* 及 /auth/*，Vary: X-Site-Id 多站點分區 |
| Smart Placement | `placement.mode: smart` | Worker 自動部署靠近 D1 的數據中心，降低數據庫延遲 |
| Pages | `cms-admin` | 管理後台 SPA，域名 `cms.cmermedical.com.hk` |
| Service Binding | Pages `cms-admin` → Worker `rust-cms` | 零延遲內部通信，前端通過 `functions/api/v1/[[path]].ts` 代理 |
| GitHub | `https://github.com/vikim540/CloudflareCMS.git` | 賬號 `waicun_lee@outlook.com`（Account ID: `f5d4e94cb23f69f8ae69baedff94f2ba`） |

---

## 硬約束

### 數據庫

- 表前綴 `ay_` 不變，**可按需修改/新增表結構和字段**
- SQL 始終 `.bind()` 參數化，**禁止字符串拼接**
- 新增表/字段用冪等語法：`CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN`
- 遷移文件編號需唯一（當前存在重複編號 0003/0004，後續新增從 0013 開始）

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
- **代碼一致性（不留手尾）**：重構/遷移/重命名時，必須同步更新所有牽連引用（數據庫、前端、遷移文件、版本文本、文檔）。子菜單 `mcode` 應與父菜單 `pcode` 分組前綴對齊（如 M500 系統管理下的子菜單應為 M50x，而非保留舊分組的 M308）。禁止「改了一處、留一處」造成日後維護時的認知負擔與疑問遐想空間

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

> **v1.8.4 修復**：`err()` 函數原邏輯 `code >= 2000 ? 401 : 400` 導致 2001（密碼錯誤）和 2007（Turnstile 失敗）也返回 401，前端誤判為「登錄已過期」。現改用 `AUTH_ERROR_CODES` 白名單，僅 2002/2003/2004/2006 返回 401。

| 狀態碼 | code | 含義 | 前端行為 |
|--------|------|------|----------|
| 401 | 2002/2003/2004/2006 | 未認證/Token 過期/已登出/用戶禁用 | 重定向 login |
| 403 | 2005 | 權限拒絕 | 彈出 toast 提示（**不重定向**） |
| 400 | 2001/2007 | 密碼錯誤/Turnstile 人機驗證失敗 | 登錄頁提示重試 |

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
- **版本更新通知**（v1.5.9+）：Dashboard 掛載時 `useEffect` 自動 POST `/notify/version-check`，後端用 KV 去重（`notified_version:{version}`）確保每版本只推送一次，格式為釘釘 ActionCard markdown（帶 emoji + 換行，與 `changes` 字段一致）

### 定時發布

- 文章 `date` 字段作為發布時間，`status='0'` 為草稿
- Cron 每 15 分鐘掃描 24 小時內待發布文章，投遞延遲消息到 Queue
- 已過期草稿直接在 Cron 中發布（兜底）

### 語義搜索

- 文章創建/更新時自動索引（標題+正文剝離 HTML，截斷 2000 字）
- 流程：搜索詞 → Workers AI 嵌入 → Vectorize 查詢 → 閾值 0.5 過濾 → D1 取完整文章
- 重建索引：`POST /api/v1/admin/vectorize/reindex`

### 邊緣緩存（Workers Cache，v1.7.0）

- v1.7.0 起：用 Cloudflare Workers Cache（聲明式邊緣緩存）取代原 KV API 響應緩存中間件
- 公開 GET 請求自動邊緣緩存：配置類（`/company`、`/site`、`/nav`、`/sorts`）TTL 3600s，其他公開數據 TTL 300s，`stale-while-revalidate=60`
- 管理接口（`/api/v1/admin/*`）因 Authorization 頭自動被 Workers Cache 繞過
- **認證接口（`/api/v1/auth/*`）v1.7.6 新增排除**：`/auth/profile` 返回用戶專屬權限數據，嚴禁跨用戶快取。v1.7.6 前因 `Cache-Control: public` 導致邊緣快取以 URL+X-Site-Id 為 key（不含 Authorization），管理員 profile 被快取後普通用戶拿到管理員權限列表，側邊欄顯示全部菜單
- `/auth/profile` 響應顯式設置 `Cache-Control: no-store`（防禦性雙保險）
- 多站點通過 `Vary: X-Site-Id` 實現緩存分區，防止跨站污染
- 搜索結果（`/api/v1/search`）不緩存（實時性要求高）
- `clearContentCache` / `clearConfigCache` 保留用於清除 KV 中殘留的配置緩存條目（`config:all` 等）

### 香港本地化（v1.5.4）

- 公司信息：移除 QQ/郵編/ICP，新增 WhatsApp，標籤香港化（商業登記證號碼、董事/公司秘書）
- 站點信息：移除 ICP 備案號（與公司重複）、主題模板（headless 無模板）
- 系統設置：搜索引擎驗證從百度推送改為 Google/Bing 站點驗證
- 公開 API：`GET /api/v1/company` 過濾敏感字段僅返回聯繫信息

### Cloudflare Turnstile 人機驗證（v1.5.6，v1.8.6 重構）

- **配置**：DB `ay_config` 表 2 條記錄（sorting 35-36，安全配置分組）— `turnstile_enabled`（開關）/ `turnstile_site_key`（站點密鑰）。**密鑰存儲在 Secrets Store**（v1.8.6 遷移，原 D1 `turnstile_secret_key` 已被 0010 遷移清空）
- **後端**：`src/services/auth.ts` `verifyTurnstile()` 調用 Cloudflare siteverify API 驗證 token；`handleLogin` 接收 `turnstileSecret` 參數（從 `TURNSTILE_SECRET_STORE` 讀取），開關開啟時強制驗證（網絡異常時放行避免故障）
- **前端**：`Login.tsx` 動態載入 Turnstile 腳本（explicit 模式），掛載時拉取 `/auth/turnstile-config` 判斷是否啟用，登錄失敗自動 reset widget
- **公開端點**：`GET /api/v1/auth/turnstile-config` 返回 `{ enabled, siteKey }`（secret key 不返回）

### Secrets Store 密鑰管理（v1.7.0，v1.8.6/v1.8.7 擴展）

- **架構**：JWT_SECRET、CF_API_TOKEN、TURNSTILE_SECRET_KEY、S3_ACCESS_KEY、S3_SECRET_KEY 存儲在 Cloudflare Secrets Store（帳號級別，跨 Worker 共享）
- **綁定**：wrangler.jsonc `secrets_store_secrets` 配置，異步訪問（`await env.JWT_SECRET_STORE.get()`），與原同步 `env.JWT_SECRET` 不兼容
- **Store**：`default_secrets_store`（ID: `aef7c32e26c84aedb4b2a5938128ca23`），CLI 管理 `wrangler secrets-store secret create <store-id> --name <name> --value <value> --scopes workers --remote`
- **代碼變更**：`requireAuth`、`handleLogin`、`handleCreateSite` 均改為 `await c.env.JWT_SECRET_STORE.get()` / `await c.env.CF_API_TOKEN_STORE.get()` / `await c.env.TURNSTILE_SECRET_STORE.get()`；S3 憑證通過 `S3Secrets` 參數傳遞（`S3_ACCESS_KEY_STORE` / `S3_SECRET_KEY_STORE`），`config.ts` 注入虛擬配置項（`***` 遮罩），寫入路由至 Secrets Store（`put()`）
- **SecretsStoreSecretWritable**：`@cloudflare/workers-types` v5 僅聲明 `get()`，運行時亦支持 `put()`，`storage.ts` 導出 `SecretsStoreSecretWritable` 接口補充類型聲明

### 全局錯誤追蹤（v1.7.0）

- **ErrorBoundary**：`admin/src/components/ErrorBoundary.tsx` 包裹所有路由，捕獲 React 渲染異常顯示 fallback UI
- **GlobalErrorToast**：`admin/src/components/GlobalErrorToast.tsx` 固定左下角紅色邊框彈框，手動關閉，用於測試階段非開發者用戶反饋 bug
- **集成**：`api.ts` 攔截非 401 錯誤調用 `showGlobalError(title, message, detail?)`，401 通過 `CustomEvent` 觸發導航至 login

### 安全加固（v1.8.3）

> **P0-P3 防禦縱深**，通用 HTTP 安全標準（非 Cloudflare 特有）。

- **P0 安全 HTTP 響應頭**：`src/index.ts` 中間件統一設置 6 個頭（X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / HSTS / CSP）。API 的 CSP 為 `default-src 'none'`（最嚴格，只返回 JSON）。前端 SPA 通過 `admin/public/_headers` 設置獨立 CSP（允許 Turnstile 腳本+iframe+connect-src、允許 https 圖片源）。**v1.8.4 修復**：`connect-src` 必須包含 `https://challenges.cloudflare.com`，否則 Turnstile JS 無法發起 API 調用獲取 token。`src/utils/response.ts` 的 `err()` 函數僅對 `AUTH_ERROR_CODES`（2002/2003/2004/2006）返回 HTTP 401，其他錯誤（如 2001 密碼錯誤、2007 Turnstile 失敗）返回 400，避免前端誤判為「登錄已過期」
- **P1 HTML 淨化**：`src/utils/sanitize.ts` 提供 `sanitizeHtml()`（保留富文本標籤，移除 `<script>`/危險標籤/`on*` 事件/`javascript:` 協議）和 `stripHtmlTags()`（剝離所有標籤）。整合到 `handleCreateContent` + `handleUpdateContent`，content 字段用 sanitizeHtml，description/keywords 用 stripHtmlTags
- **P2 輸入長度校驗**：`FIELD_LENGTH_LIMITS` 常量定義 18 個字段最大長度（新聞網站場景，略寬），`validateFieldLengths()` 超長返回明確錯誤。請求體大小限制 2MB（排除 `multipart/form-data` 文件上傳）
- **P3 文件上傳 MIME 白名單**：`src/services/storage.ts` 的 `ALLOWED_MIME_TYPES` Set，僅允許圖片/視頻/音頻/PDF/文本/ZIP，非白名單返回 1001 錯誤

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
cd admin; & 'D:\AI\Cache\pnpm-home\wrangler.CMD' pages deploy deploy --project-name=cms-admin --commit-dirty=true
# 若 wrangler 4.112.0 遇到 Windows .wrangler/tmp 寫入權限 bug，改用本地版本：
# cd admin; node '../node_modules/wrangler/bin/wrangler.js' pages deploy deploy --project-name=cms-admin --commit-dirty=true

# ===== 數據庫 =====
# 遷移（主庫 endoscopy-cms）
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 migrations apply endoscopy-cms --remote

# 執行 SQL（主庫 endoscopy-cms）
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 execute endoscopy-cms --remote --command "SELECT * FROM ay_config LIMIT 5"

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
11. **版本更新後 Dashboard 自動推送釘釘 webhook 通知（KV 去重，無需手動）？**
12. **新增內容寫入接口是否整合 sanitizeHtml/stripHtmlTags 淨化？（XSS 防禦）**
13. **新增上傳端點是否检查 MIME 白名單？（文件上傳安全）**

---

## 儀表盤同步更新規則（強制）

> **每次修改代碼後，必須同步更新 `admin/src/pages/Dashboard.tsx` 中的三個 Tab。**

### 版本更新 Tab

- 新增版本條目到 `VERSIONS` 數組頂部，設 `latest: true`，舊版本移除 `latest`
- 格式：`{ version: 'vX.Y.Z', date: 'YYYY-MM-DD HH:mm:ss', icon: 'emoji', latest: true, changes: '簡述' }`
- 版本號：主版本（架構變更）/ 次版本（功能新增）/ 修訂號（Bug 修復）
- **時間戳規則（強制）**：`date` 字段必須使用 `git log` 中對應 commit 的真實時間戳（`git log --format='%ci'`），時區為 Asia/Hong_Kong（UTC+8）。禁止手動估算或編造時間。獲取方式：`git log --all --pretty=format:'%h|%ci|%s' | grep 'vX.Y.Z'`。無 git commit 記錄的歷史版本，時間需確保版本順序遞減（新版 > 舊版）

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
