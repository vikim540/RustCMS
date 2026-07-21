/**
 * 日期時間工具 — 統一使用香港時區 (UTC+8)
 * 所有存入 D1 的時間字符串均為香港時間，格式 YYYY-MM-DD HH:mm:ss
 *
 * 實現說明：
 *   Cloudflare Workers 的 TZ 環境變量不影響 Date 對象的解析，
 *   Date.getTime() 和 toISOString() 始終基於 UTC。
 *   使用 toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }) 正確獲取香港時間。
 */

/** 當前香港時間字符串 (YYYY-MM-DD HH:mm:ss) */
export function nowStr(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
}

/** 當前香港日期字符串 (YYYY-MM-DD) */
export function todayStr(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).slice(0, 10);
}
