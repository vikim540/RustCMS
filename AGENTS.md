# AGENTS.md - 項目約束與開發規範

> 本文件是 AI 編程代理和開發者的強制約束文件。所有代碼生成、修改、審查必須遵守以下規則。

---

## 項目概述

TypeScript + Hono + Cloudflare Workers CMS，基於 PbootCMS 3.2.12 數據庫結構，前後端完全分離的純 API 後端，部署在 Cloudflare Workers 上，配合獨立靜態生成層輸出全靜態頁面。

> **技術棧說明**：項目最初規劃 Rust（workers-rs），實際運行的是 TypeScript + Hono。`src/lib.rs` 等 Rust 文件為原型對照，未配置構建、未作為入口。後端入口為 `src/index.ts`。

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
| KV | `CONFIG_CACHE`（`69737778474044ada68b6f34db79f8cb`）、`TOKEN_BLACKLIST`（`31e1d191d5664d2fa39a72dd9cae6906`） |
| Pages | `cms-admin`（管理後台 SPA） |
| GitHub | `https://github.com/vikim540/RustCMS.git` |
| 賬號 | `waicun_lee@outlook.com`（Account ID: `f5d4e94cb23f69f8ae69baedff94f2ba`） |

開發文檔位於 `docs/` 目錄（00-06 共 7 份）。

---

## 硬約束

### 1. 數據庫零改動

- **禁止**修改/刪除/重命名 PbootCMS 原版任何表結構或字段，表前綴 `ay_` 不變
- **允許**冪等操作：`CREATE INDEX IF NOT EXISTS`、`INSERT ... WHERE NOT EXISTS`（配置行、模型、欄目、文章）
- **允許**新增表（僅限 Go 版已驗證：`ay_area`, `ay_role_area`, `ay_301_redirect`, `ay_media_mark`, `ay_content_ext`）

### 2. 技術棧

- 後端：**TypeScript + Hono**，運行於 Cloudflare Workers 原生運行時
- 數據庫：**D1**（`db.prepare().bind().all()`，禁止字符串拼接 SQL）
- 緩存：**KV**（`config:all` 配置緩存 + JWT 黑名單 + 速率限制）
- 存儲：**R2**（S3 兼容，AWS SigV4 簽名）
- 前端：**React 18 + Vite + Tailwind CSS**（Cloudflare Pages）
- 序列化：原生 JSON

### 3. 禁止依賴

| 禁止 | 替代 |
|------|------|
| `sqlx` / 數據庫驅動 | D1 binding API |
| `jsonwebtoken` | Web Crypto API 自實現 HS256 |
| `bcrypt` / `argon2` | 雙 MD5（`md5(md5(password))`） |
| `nodemailer` / SMTP 庫 | MailChannels / Resend HTTP API |
| `node-fetch` / `axios` | 全局 `fetch()` |
| 圖片處理庫 / 模板引擎 | 無（水印交靜態生成層） |

### 4. 密碼方案

雙 MD5：`md5(md5(password))`，與 PbootCMS/Go 版兼容，常量時間比較防時序攻擊。

### 5. 前後端分離

- Worker 只返回 JSON，禁止渲染 HTML
- 管理後台 SPA 部署在 Pages（`cms-admin`），禁止打包進 Worker
- 前端通過 Pages Functions（`admin/functions/api/v1/[[path]].ts`）同域代理 API

---

## 代碼規範

### TypeScript

1. 命名：camelCase（函數/變量）、PascalCase（接口/類型）、UPPER_SNAKE_CASE（常量）
2. 模塊：`index.ts`（路由薄）→ `services/*.ts`（業務厚）→ `utils/*.ts`（純函數）
3. 錯誤處理：service 返回 `Response`，`try/catch` 包裹外部調用，禁止未捕獲異常
4. SQL：`.bind()` 參數化，禁止拼接
5. 異步：D1/KV/R2/fetch 均 `async/await`
6. 類型：嚴格 TS，禁止 `any`（用 `unknown` + 斷言）
7. 註釋：公共函數 JSDoc，複雜邏輯行內註釋

### 統一響應格式

```jsonc
{ "code": 0, "msg": "成功", "data": {}, "meta": { "page": 1, "pagesize": 20, "total": 100 } }
```

### API 路由

- 前綴 `/api/v1/`，RESTful
- 公開：`/api/v1/{resource}`（無認證）
- 管理：`/api/v1/admin/{resource}`（JWT `requireAuth`）
- 通知測試：`/api/v1/admin/notify/test-mail`、`/api/v1/admin/notify/test-webhook`

---

## 業務邏輯約束

### 內容按模型分類（參考 PbootCMS/Go mcode 邏輯）

- 側邊欄動態生成模型子菜單（`type='2'` 列表型模型）
- 後端子查詢過濾：`scode IN (SELECT scode FROM ay_content_sort WHERE mcode = ?)`
- 欄目查詢支持 `?mcode=` 參數；新建內容根據 URL `mcode` 預選欄目
- 內容管理僅管理有編輯器的文章，**不混入媒體庫資源**

### 圖片上傳支持外鏈

縮略圖、Quill 編輯器、擴展字段圖片均支持：① 上傳 R2（`POST /admin/upload`）② 手動輸入外鏈 URL。

### CORS 動態域名校驗

中間件從 KV 讀取 `api_cors_origins`，配置白名單則僅允許列出的 Origin（含 `Vary: Origin` + `Credentials`），未配置則允許 `*`。後台「系統設置 > WebAPI」配置。

### 通知服務（Webhook + 郵件）

- **Webhook**（`src/services/notify.ts`）：自動檢測平台（釘釘 ActionCard / 企業微信 Markdown / 通用 JSON），分項開關 `webhook_message|form|comment`
- **郵件**（`src/services/notify.ts`）：HTTP API 發信（MailChannels / Resend），Workers 無 TCP socket 故不用 SMTP 直連；配置 `mail_provider|api_key|from|from_name`；HTML 模板含漸層 header / 字段表格 / 來源信息 / footer
- 通知日誌復用 `ay_syslog`（`level` = `mail_success|mail_error|webhook_success|webhook_error`），異步觸發不阻塞主流程

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
| 郵件 | `Smtp.php` | `mail/mailer.go` SMTP | `src/services/notify.ts` HTTP API |

---

## 環境與工具

### 環境位置

| 工具 | 位置 |
|------|------|
| wrangler 4.96.0 | `D:\AI\Cache\pnpm-home\wrangler.CMD` |
| pnpm | `D:\AI\Cache\pnpm-home` |
| Node.js >= 18 | 系統 PATH |
| Cloudflare API Token | 環境變量 `CLOUDFLARE_API_TOKEN` |
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
# 後端 Worker
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' deploy --dry-run   # 驗證
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' deploy              # 部署

# 前端 Pages
cd admin; npx vite build
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' pages deploy build --project-name=cms-admin

# Secret 管理
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' secret put JWT_SECRET
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' secret list
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
& 'D:\AI\Cache\pnpm-home\wrangler.CMD' d1 export rust-cms-db --remote --output schema.sql --no-data
```

### Git

```powershell
git status --short
git add -A
git commit -m '✨ feat: 描述'
git push origin main
git log --oneline -10
```

### 依賴更新

```powershell
# 後端依賴
npm install
npm update

# 前端依賴
cd admin
pnpm install
pnpm update
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
2. 是否修改了數據庫表結構？是則停止
3. 是否引入禁止依賴？
4. SQL 是否參數化？
5. 響應格式是否統一 `{code,msg,data}`？
6. 配置修改後是否清除 KV 緩存（`clearConfigCache`）？
7. 熱點數據是否走 KV？
8. 通知服務是否異步觸發（留言/表單/評論）？

---

## 性能預算

| 指標 | 限制 | 目標 |
|------|------|------|
| Worker 體積 | 3MB（gzip 1MB） | ≤ 500KB（gzip ≤ 100KB） |
| 單請求 CPU | 10ms（免費）/ 50ms（付費） | ≤ 5ms |
| D1 日寫入 | 100,000 行 | KV 緩存減少寫入 |
| KV 日讀取 | 100,000 次 | 合理 TTL |

---

## 文件修改記錄

| 日期 | 修改內容 | 修改人 |
|------|---------|--------|
| 2026-07-16 | 初始創建 | AI Assistant |
| 2026-07-17 | 技術棧更正為 TS+Hono；補充通知/CORS/模型分類/圖片外鏈；精簡重構全文；補充環境位置與命令 | AI Assistant |
