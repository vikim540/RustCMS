/**
 * HTML 淨化工具（輕量級純函數，無需 DOM 依賴）
 *
 * 用於文章正文等富文本字段，防禦 XSS 攻擊：
 * - 移除 <script> 標籤及內容
 * - 移除危險標籤（iframe/object/embed/applet/base/form）
 * - 移除事件處理屬性（onclick/onload/onerror 等）
 * - 移除 javascript: 協議
 * - 移除 data:text/html 協議（保留 data:image/*）
 *
 * 設計原則：白名單優先，保留正常富文本標籤（p/h1-6/img/a/table 等）
 */

/** 移除 <script> 標籤及其內容（含變體大小寫、屬性） */
const SCRIPT_TAG_PATTERN = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi;

/** 移除危險標籤（iframe/object/embed/applet/base/form 等） */
const DANGEROUS_TAGS = /<\/?(iframe|object|embed|applet|base|form|input|textarea|select|button|meta|link|style)\b[^>]*>/gi;

/** 移除所有 on* 事件處理屬性（onclick/onload/onerror 等） */
const EVENT_HANDLER_ATTRS = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** 移除 javascript: 協議的 href/src */
const JS_PROTOCOL_PATTERN = /(\b(?:href|src)\s*=\s*)("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi;

/** 移除 data:text/html 等危險 data 協議（保留 data:image/* 圖片） */
const DANGEROUS_DATA_PATTERN = /(\b(?:href|src)\s*=\s*)("data:(?!image\/)[^"]*"|'data:(?!image\/)[^']*')/gi;

/**
 * 淨化 HTML 富文本（用於文章正文等字段）
 * 保留正常標籤和屬性，僅移除 XSS 攻擊向量
 */
export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(SCRIPT_TAG_PATTERN, '')
    .replace(DANGEROUS_TAGS, '')
    .replace(EVENT_HANDLER_ATTRS, '')
    .replace(JS_PROTOCOL_PATTERN, '$1"#"')
    .replace(DANGEROUS_DATA_PATTERN, '$1"#"');
}

/**
 * 剝離所有 HTML 標籤（用於 description/keywords 等純文本字段）
 * 將 <p>內容</p> → 內容，<br> → 空格
 */
export function stripHtmlTags(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
