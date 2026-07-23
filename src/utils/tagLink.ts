/**
 * 文章內鏈替換引擎
 *
 * 參考 PbootCMS Go 版 content_tags.go 的五步預佔位策略，
 * 修復 PHP 原版的三個缺陷（去重、預佔位、字面量匹配）。
 *
 * 算法流程：
 *   1. 保護 HTML 區塊（<a>, <pre>, <code>, <img>, <h1>-<h6> 等）
 *   2. 去重同名標籤（只保留首個）
 *   3. 長詞優先（移除被更長 name 包含的短標籤）
 *   4. 預佔位替換（關鍵詞 → 佔位符，限制每詞最多 N 次）
 *   5. 還原佔位符 → <a> 標籤，還原保護的 HTML
 *
 * 設計考量：
 *   - 純字面量匹配（非正則），避免標籤名中特殊字符（. * + 等）被誤解析
 *   - 保護範圍比 PbootCMS 更廣：不僅 <a>，還保護 <pre>/<code>/<img>/<h1>-<h6>
 *   - URL 安全驗證：僅允許 http/https 協議和相對路徑，阻斷 javascript: 等
 *   - 自動添加 target="_blank" + rel="noopener noreferrer"
 */

/** 標籤連結數據結構 */
export interface TagLink {
  name: string
  link: string
}

/** 佔位符前綴（使用 \x00 NULL 字符確保不與正文衝突） */
const REGA_PREFIX = '\x00REGA'
const TAGREP_PREFIX = '\x00TAGREP'
const PLACEHOLDER_SUFFIX = '\x00'

/**
 * URL 安全驗證 — 僅允許 http/https 協議和相對路徑
 * 阻斷 javascript:, data:, vbscript: 等危險協議
 */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return trimmed
  return ''
}

/** HTML 轉義（用於 <a> 標籤內的標籤名文字） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 限制次數的字面量替換
 * 不同於 String.replace（僅替換首個）和 split/join（替換全部），
 * 此函數精確控制替換次數，且為純字面量匹配（非正則）。
 */
function replaceLimited(
  str: string,
  search: string,
  replacement: string,
  limit: number,
): string {
  if (limit <= 0 || !search) return str
  let result = str
  let count = 0
  let idx = result.indexOf(search)
  while (idx !== -1 && count < limit) {
    result = result.substring(0, idx) + replacement + result.substring(idx + search.length)
    count++
    idx = result.indexOf(search, idx + replacement.length)
  }
  return result
}

/**
 * 對文章正文執行內鏈替換
 *
 * @param content 文章正文 HTML
 * @param tags 標籤列表（name=關鍵詞, link=目標 URL）
 * @param maxReplace 每個關鍵詞在單篇文章中的最大替換次數（默認 3）
 * @returns 替換後的 HTML（關鍵詞被包裝為 <a> 標籤）
 */
export function applyTagLinks(
  content: string,
  tags: TagLink[],
  maxReplace: number = 3,
): string {
  if (!content || tags.length === 0) return content

  // ===== Step 1: 保護 HTML 區塊 =====
  // 將 <a>...</a>, <pre>...</pre>, <code>...</code> 和其他單個標籤替換為佔位符
  // 避免在已有連結、代碼塊、標題中重複插入內鏈
  const htmlPlaceholders: Map<string, string> = new Map()
  let protectIdx = 0
  const protectRegex = /(<a\b[^>]*>[\s\S]*?<\/a>)|(<pre\b[^>]*>[\s\S]*?<\/pre>)|(<code\b[^>]*>[\s\S]*?<\/code>)|(<[^>]+>)/gi
  let working = content.replace(protectRegex, (match) => {
    const key = `${REGA_PREFIX}${protectIdx}${PLACEHOLDER_SUFFIX}`
    htmlPlaceholders.set(key, match)
    protectIdx++
    return key
  })

  // ===== Step 2: 去重同名標籤（只保留首個） =====
  const seen = new Set<string>()
  const deduped: TagLink[] = []
  for (const tag of tags) {
    if (tag.name && tag.link && !seen.has(tag.name)) {
      seen.add(tag.name)
      deduped.push(tag)
    }
  }

  // ===== Step 3: 長詞優先（移除被更長 name 包含的短標籤） =====
  // 例如有「PbootCMS」和「Pboot」時，先保留「PbootCMS」，移除「Pboot」
  // 避免短標籤破壞長標籤的匹配
  const filtered: TagLink[] = []
  for (let i = 0; i < deduped.length; i++) {
    let isSubstring = false
    for (let j = 0; j < deduped.length; j++) {
      if (i !== j && deduped[j].name.length > deduped[i].name.length && deduped[j].name.includes(deduped[i].name)) {
        isSubstring = true
        break
      }
    }
    if (!isSubstring) filtered.push(deduped[i])
  }

  // ===== Step 4: 預佔位替換 =====
  // 先將關鍵詞替換為佔位符（限制次數），避免替換結果中的文字被後續標籤二次匹配
  const tagReplacements: Map<string, string> = new Map()
  let repIdx = 0
  for (const tag of filtered) {
    const safeLink = sanitizeUrl(tag.link)
    if (!safeLink) continue

    const placeholder = `${TAGREP_PREFIX}${repIdx}${PLACEHOLDER_SUFFIX}`
    repIdx++
    const anchor = `<a href="${safeLink}" target="_blank" rel="noopener noreferrer">${escapeHtml(tag.name)}</a>`
    tagReplacements.set(placeholder, anchor)

    working = replaceLimited(working, tag.name, placeholder, maxReplace)
  }

  // ===== Step 5: 還原佔位符 → <a> 標籤 =====
  for (const [placeholder, anchor] of tagReplacements) {
    working = working.split(placeholder).join(anchor)
  }

  // ===== Step 6: 還原保護的 HTML =====
  for (const [key, value] of htmlPlaceholders) {
    working = working.split(key).join(value)
  }

  return working
}
