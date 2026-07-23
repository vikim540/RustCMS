# Quill 編輯器二次開發插件集

> 本目錄包含所有 Quill 編輯器的自定義擴展功能，作為獨立模組備份。
> 若未來需要更換編輯器（如 TipTap/ProseMirror/EditorJS），可參考此處邏輯移植。

## 文件結構

| 檔案 | 功能 | 核心導出 |
|------|------|----------|
| `faqPlugin.ts` | FAQ 問答群組（含 Google microdata + JSON-LD 雙重 SEO） | `registerFaqPlugin()`, `matchFaqElement()`, `faqPluginCSS` |
| `videoPlugin.ts` | 視頻 iframe 嵌入（保留完整屬性 title/allow/referrerpolicy） | `registerVideoPlugin()`, `matchVideoIframe()` |
| `listPlugin.ts` | 有序列表懸掛縮進 + softBreak 鍵盤綁定 | `registerListPlugin()`, `listPluginCSS` |
| `htmlCleanup.ts` | HTML 清理（移除 Quill 專有屬性）+ 工具列按鈕 CSS | `cleanupQuillHtml()`, `toolbarButtonCSS` |

## 插件註冊流程

```
1. loadQuill()          — 載入 Quill JS/CSS（cdnjs CDN）
2. new Quill()          — 創建編輯器實例
3. registerFaqPlugin()  — 註冊 FAQ 群組 BlockEmbed blot
4. registerVideoPlugin()— 覆蓋內建 video blot
5. registerListPlugin() — 註冊 softBreak 鍵盤綁定
6. clipboard.addMatcher() — 註冊 FAQ + iframe 剪貼簿匹配器
7. 注入 CSS             — listPluginCSS + faqPluginCSS + toolbarButtonCSS
8. 工具列按鈕           — 視頻🎥 / FAQ❓ / HTML源碼<> 按鈕 + 事件綁定
```

## 各插件詳情

### faqPlugin.ts — FAQ 問答群組

**生成 HTML 結構（含 microdata）：**
```html
<div class="faq" itemscope itemtype="https://schema.org/FAQPage">
  <details class="faq-item" itemprop="mainEntity" itemscope itemtype="https://schema.org/Question">
    <summary class="faq-question">
      <h3 class="faq-title" itemprop="name">問題文字</h3>
    </summary>
    <div class="faq-answer" itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
      <div itemprop="text">答案 HTML</div>
    </div>
  </details>
</div>
```

**SEO 雙重覆蓋：**
- microdata：HTML 中嵌入 itemscope/itemtype/itemprop，前端 Nuxt 直接讀取
- JSON-LD：後端 `extractFaqJson()` 另外生成 `<script type="application/ld+json">`，API 響應 `faqJson` 欄位

**向後兼容：**
- 舊格式（獨立 `<details class="faq-item">`）自動包裝為單項群組
- clipboard matcher 同時處理新舊兩種格式

### videoPlugin.ts — 視頻 iframe

**解決問題：** Quill 內建 video blot 僅保留 `src`，丟失 `title`/`allow`/`referrerpolicy` 等屬性

**值類型：**
- `string`：純 URL（向後兼容）
- `object`：`{ src, title, allow, referrerpolicy, width, height }`

### listPlugin.ts — 有序列表

**CSS：** 懸掛縮進（`padding-left: 2.5em; list-style-position: outside`），序號在外、內容左對齊

**鍵盤：** `Shift+Enter` 在有序列表內插入軟換行（`\n`），實現「標題+縮進內容」排版

### htmlCleanup.ts — HTML 清理

**保存時清理 Quill 專有屬性：**
- `data-list="ordered/bullet"` → 移除（外部不需要）
- `<span class="ql-ui">` → 移除（空標記元素）
- `contenteditable="false"` → 移除（內部控制用）

確保 `<ol>/<ul>/<li>` 在任何前端（Nuxt/其他）都能正確渲染序號。

## 可移植性說明

| 原始 Quill 概念 | TipTap 對應 | ProseMirror 對應 |
|------------------|-------------|------------------|
| BlockEmbed blot | Node (atom) | NodeSpec (atom: true) |
| clipboard matcher | handlePaste plugin | handlePaste plugin |
| blot create/value | NodeView | NodeSpec toDOM/fromDOM |
| toolbar handler | Extension button | MenuButton |
| CSS | 可直接複用 | 可直接複用 |
