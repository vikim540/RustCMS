/**
 * Quill HTML 清理工具
 *
 * 功能：清理 Quill 專有 HTML 屬性，確保輸出標準 HTML 可在任何前端正確渲染
 *
 * 移除：
 * - data-list="ordered"/"bullet" 屬性（Quill 用於內部列表類型識別，外部不需要）
 * - <span class="ql-ui" contenteditable="false"></span> 空標記元素（Quill 用 CSS 渲染序號，外部 CSS 不存在時為空）
 * - contenteditable="false" 屬性（Quill 內部編輯控制用）
 *
 * 保留：
 * - <ol>/<ul>/<li> 標準結構（瀏覽器原生渲染序號/符號）
 * - <strong>/<a>/<img> 等富文本標籤
 * - <details>/<summary> FAQ 塊（含 microdata 屬性）
 * - <iframe> 視頻嵌入
 *
 * 應用時機：保存文章時（從編輯器取 HTML 後、發送 API 前）
 *
 * 可移植性：與編輯器無關，適用於任何包含 Quill 屬性的 HTML
 */

/**
 * 清理 Quill 專有 HTML 屬性
 * @param html 原始 Quill HTML
 * @returns 清理後的標準 HTML
 */
export function cleanupQuillHtml(html: string): string {
  if (!html) return ''
  return html
    // 移除 Quill data-list 屬性（ordered/bullet/check）
    .replace(/\s+data-list="[^"]*"/gi, '')
    // 移除 Quill 的 ql-ui 空標記 span（列表序號佔位元素，無內容）
    .replace(/<span\s+class="ql-ui"[^>]*>\s*<\/span>/gi, '')
    // 移除 contenteditable="false" 屬性（Quill 內部控制，外部不需要）
    .replace(/\s+contenteditable="false"/gi, '')
}

/** 工具列按鈕 CSS（自定義按鈕圖標） */
export const toolbarButtonCSS = `
  /* HTML 源碼按鈕 + FAQ 按鈕 + 視頻按鈕 */
  .ql-toolbar .ql-video-picker::after { content: "🎥"; font-size: 14px; }
  .ql-toolbar .ql-html-source::after { content: "<>"; font-family: monospace; font-size: 14px; }
  .ql-toolbar .ql-faq-picker::after { content: "❓"; font-size: 14px; }
`
