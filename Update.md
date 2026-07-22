\# Update.md — 項目更新列表

> \*\*當前版本：\*\*v1.9.4\*\*（2026-07-22）



\---



\## 版本更新記錄（憑證）



> 每次正式版本更新必須記錄於此，作為開發憑證。日常瑣碎修改無需頻繁記錄。



| 版本 | 日期 | 摘要 |

|------|------|------|

| v1.9.4 | 2026-07-22 | 權限歸類修正 + 幻燈片顯隱控制。修正 M210 (表單管理) pcode: M200→M610（歸入基礎內容，與側邊欄一致，修正前 Roles.tsx 權限樹中 M210 錯誤顯示在「文章內容」下）。幻燈片新增顯示/隱藏開關（status 字段，關閉後不返回到公開 API）、公開 API handleListSlides 增加 status='1' 過濾、移除新增對話框中冗餘的分組 ID 文字輸入框、切換分組時自動計算排序序號（動態自增） |

| v1.9.3 | 2026-07-22 14:01:06 | 表單提交 API 安全加固。移除舊 POST /api/v1/messages（留言系統）、移除 POST /api/v1/forms/submit/:formId（標準化路徑易被掃描）、移除公開 GET /api/v1/forms/active（暴露表單結構）、新增 POST /api/v1/f/:token（16位隨機 token 隱蔽化端點，62^16 種組合）。五層安全防護：1.隨機路徑 2.Honeypot 蜜罐字段（\_hp） 3.Origin/Referer 校驗（allowed\_origins 配置） 4.可選 Turnstile（turnstile\_enabled 每表單獨立控制） 5.速率限制 1次/10秒。新增 ay\_form 字段：submit\_token/turnstile\_enabled/allowed\_origins。FormManager 新增 📋 複製端點 + 🔄 重新生成 token 按鈕 + 安全配置區域 |

| v1.9.2 | 2026-07-22 11:59:05 | 表單管理系統 + Settings Tab 修正。新增表單管理頁面（基礎內容→表單管理，M210 權限）、支持創建/編輯/刪除多個表單（每個表單有獨立 API 端點 POST /api/v1/forms/submit/:formId）、每個表單可配置專屬 Webhook URL、is\_active 開關控制側邊欄展示、活躍表單自動注入擴展內容側邊欄（按表單名稱顯示，點擊自動篩選提交記錄）、FormSubmissions 顯示表單名稱（取代原始 form\_key）、Settings WebAPI 獨立 Tab、修正其他配置重複問題、ay\_form 表擴展字段（description/is\_active/sorting/status/webhook\_url）、遷移 0003 修正（ay\_role\_level 取代 ay\_role\_permission、菜單 ID 衝突修復 id=55） |

| v1.9.1 | 2026-07-22 | FormSubmissions UI 統一（p-6/text-2xl font-bold/標準按鈕 class/標準對話框結構）、批量刪除+批量狀態更新（checkbox+batch端點）、form\_key 篩選下拉（多表單類型）、Settings Tab 重構（5 Tab 導航：功能開關/基本配置/安全配置/存儲配置/通知配置，通知配置中 Webhook 獨立 section） |

| v1.9.0 | 2026-07-22 | 統一表單系統（取代留言管理）。新增 ay\_form\_submission 表（動態 JSON 存儲）、公開端點 POST /api/v1/forms/submit（接收任意 JSON 結構表單）、管理端 CRUD + 統計、釘釘 ActionCard 推送到客服群（form\_webhook\_url 配置，與系統更新 webhook 分離）、前端瀑布流網格佈局（auto-fill minmax 響應式）+ 週分隔 HR + 搜索/狀態/排序、菜單 M204 統一為自定義表單、M205 舊佔位禁用 |

| v1.8.8 | 2026-07-22 | Quill 編輯器載入修復（CSP script-src 缺少 cdnjs.cloudflare.com 導致腳本被阻擋）、全局錯誤通知一鍵複製重構（api.ts buildTechReport 捕獲調用堆疊/文件位置/行號/請求響應體，UI 保持簡短但複製內容包含完整技術診斷信息） |

| v1.8.7 | 2026-07-22 | S3 憑證遷移 Secrets Store（s3\_access\_key/s3\_secret\_key）、遷移文件合併（15→1 冪等）、MIME 白名單安全修復（移除 SVG+空值繞過）、sanitize.ts regex 繞過修復、site.ts schema drift 修復、刪除移動端殘留、sorting 衝突修復、TypeScript 9 個預存編譯錯誤修復（ExportedHandler 泛型/js-md5 導入/ArrayBuffer/類型推斷） |

| v1.8.6 | 2026-07-22 | Turnstile 密鑰遷移至 Secrets Store（修復 v1.7.0 遺留）。遷移 0010 清空了 D1 中 turnstile\_secret\_key 但代碼未同步更新，auth.ts 改為從 TURNSTILE\_SECRET\_STORE 讀取。wrangler.jsonc 新增綁定，重新啟用 Turnstile |

| v1.8.5 | 2026-07-22 | 緊急修復：Turnstile secret key 為空導致所有賬號無法登錄。verifyTurnstile() 在 secret key 為空時返回 false 拒絕所有登錄，改為放行（return true）與網絡異常邏輯一致。臨時停用 Turnstile（turnstile\_enabled=0） |

| v1.8.4 | 2026-07-21 | 緊急修復 v1.8.3 回歸 bug：CSP connect-src 缺少 challenges.cloudflare.com 導致 Turnstile API 調用被阻擋、err() 函數 code>=2000 一律返回 401 導致 Turnstile 失敗(2007)/密碼錯誤(2001)被前端誤判為「登錄已過期」。修復：\_headers connect-src 加入 Turnstile 域名、response.ts err() 改用 AUTH\_ERROR\_CODES 白名單（僅 2002/2003/2004/2006 返回 401） |

| v1.8.3 | 2026-07-21 | 安全加固 P0-P3：安全 HTTP 響應頭（CSP/HSTS/X-Frame-Options 等通用標準，Worker 中間件+Pages \_headers）、HTML 淨化防 XSS（sanitize.ts 純函數，整合到內容 CRUD）、輸入長度校驗+2MB 請求體限制、文件上傳 MIME 白名單 |

| v1.8.2 | 2026-07-21 | 清理 ay\_content\_ext 幽靈字段（13個無定義 ext\_\* 列刪除，三庫同步）、媒體庫 WebP blob bug 修復（跳過二次壓縮+後端擴展名推斷）、操作日誌分類重組（7類互斥+新增爬蟲tab）、ImagePreviewWithRemove 統一組件抽象（取代3處重複按鈕） |

| v1.8.1 | 2026-07-21 | 文章詳情 API 重構：參考 PbootCMS ParserModel.getContent() 平鋪模式，欄目名稱(sortname)+擴展字段(ext\_\*)直接合併到 content 對象，移除 sort/extFields/extValues 獨立對象，null 字段不返回，prev/next 改為同欄目樹範圍查詢（getSubScodes 邏輯） |

| v1.8.0 | 2026-07-21 | 新增 GET /admin/sorts/all 端點（無需 M202 權限）、修復非授權用戶欄目下拉為空（ContentEdit/Contents 改用 /all 端點） |

| v1.7.9 | 2026-07-21 | 公開 API 支持 slug 查詢（GET /contents/:idOrSlug 支持數字 ID 或 filename slug）、新增 GET /contents/all 批量端點（pagesize 最大 500，靜態打包專用）、prev/next 返回 filename 字段 |

| v1.7.8 | 2026-07-21 | 版本日誌時間戳修正（26 個版本改用 git commit 真實時間戳，修復 v1.6.4 順序倒置問題）、AGENTS.md 新增版本時間戳強制規則、幻燈片默認打開 gid 1 分組 tab |

| v1.7.7 | 2026-07-21 | 幻燈片分組名稱持久化（新建 ay\_slide\_group 表，取代 localStorage 方案，所有賬號共享分組名稱）、新增 4 個分組管理 API 端點、種子數據 gid 1=首頁輪播/2=費用一覽/3=大腸鏡檢查、site.ts 新站點同步建表 |

| v1.7.6 | 2026-07-21 | 側邊欄權限過濾修復（根因：Workers Cache 邊緣快取 /auth/profile 跨用戶污染，管理員 profile 被快取後普通用戶拿到全部權限）、cache 中間件新增排除 /api/v1/auth/\*、/auth/profile 響應顯式 no-store |

| v1.7.5 | 2026-07-21 | 權限管理三處修復：多站點管理位置修正（mcode M308→M508 對齊 M500 父分組、pcode M300→M500）、角色代碼自動生成（前端移除 rcode 輸入框，後端已自動生成）、用戶創建站點權限丟失修復（handleCreateUser 返回新用戶 ID） |

| v1.7.4 | 2026-07-21 | 媒體庫權限修復（新增 /admin/media/config 端點，M301 權限，解決非超管用戶圖片預覽為空）、存儲配置安全修復（s3\_access\_key 改為 \*\*\* 遮罩） |

| v1.7.3 | 2026-07-21 | 創建文章全字段寫入修復（INSERT 補全 9 字段）、admin 內容詳情端點（無緩存，解決編輯頁字段為空）、webhook 版本通知繞過 Flagship 直接讀 D1、粘貼富文本 base64 圖片轉存媒體庫、Dashboard 版本通知結果日誌 |

| v1.7.2 | 2026-07-21 | Service Binding 配置修復（admin/wrangler.jsonc 補回 services 綁定，解決 PUT 500）、全鏈路錯誤追蹤（後端 try/catch + Pages Function detail 字段 + api.ts 500/!res.ok 處理 + GlobalErrorToast 📋 一鍵複製按鈕 + 默認展開技術詳情） |

| v1.7.1 | 2026-07-21 | 統一❌emoji關閉按鈕、tab切換編輯器內容丟失修復、壓縮卡0%修復、編輯器圖片上傳三合一優化（直開媒體庫+粘貼批量壓縮）、wrangler warning修復 |

| v1.7.0 | 2026-07-21 | Secrets Store 遷移、Flagship 真混合模式、Workers Cache 邊緣緩存、Smart Placement、acode/時區清理、全局錯誤 Toast、代碼清理 |

| v1.6.4 | 2026-07-21 | 前端狀態組件統一化（LoadingState/EmptyState/ErrorState），19 個頁面全部組件化 |

| v1.6.3 | 2026-07-21 | 標題顏色選擇器、操作者自動記錄、AGENTS.md 新增 Rust 優先約束 |

| v1.6.2 | 2026-07-20 | 父欄目文章列表修復、公開 API 字段補全、標籤輸入器升級、Slug 去重 |

| v1.6.1 | 2026-07-20 | 批量排序組件化（useBatchSorting/BatchSortSaveBar/SortInput） |

| v1.6.0 | 2026-07-20 | 多站點架構（3 個 APAC 數據庫 + X-Site-Id 路由） |

| v1.5.9 | 2026-07-20 | 版本更新通知自動推送釘釘 webhook（KV 去重） |

| v1.5.6 | 2026-07-19 | Cloudflare Turnstile 人機驗證 |

| v1.5.5 | 2026-07-19 | JWT 權限實時刷新（無需重新登錄） |

| v1.5.4 | 2026-07-18 | 香港本地化（移除 QQ/郵編/ICP，新增 WhatsApp） |



\---

