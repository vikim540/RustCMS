/**
 * 通知服務 - Webhook 推送 + 郵件通知
 * 參考 pbootcms-go 的 webhook.go 和 mailer.go 實現
 *
 * 郵件發送: MailChannels / Resend HTTP API (免費第三方接入)
 *           Email Service 僅 Workers Paid 可用，本項目使用免費方案
 * Webhook:  釘釘 ActionCard / 企業微信 Markdown / 通用 JSON
 *
 * - Flagship 開關：mail_enabled / webhook_enabled（標準化架構）
 *   - getFlagEnabled({ DB, 'Flagship-service' }, 'mail_enabled') 檢查開關
 *   關閉後，對應通知邏輯完全不執行，後台也不顯示相關按鈕
 */
import type { D1Database, KVNamespace, Flagship } from '@cloudflare/workers-types';
import { okData, ok, err } from '../utils/response';
import { getFlagEnabled } from './flags';
import { nowStr } from '../utils/datetime';

/** 通知字段 (label + value 鍵值對) */
export interface NotifyField {
  label: string;
  value: string;
}

/** 通知元信息 */
export interface NotifyMeta {
  ip: string;
  os: string;
  browser: string;
  sourceUrl?: string;
  timestamp?: string;
}

function parseUserAgent(ua: string): { os: string; bs: string } {
  let os = 'Unknown';
  let bs = 'Unknown';
  if (!ua) return { os, bs };
  if (/Windows NT 10/.test(ua)) os = 'Windows 10';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (/Edg\//.test(ua)) bs = 'Edge';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) bs = 'Chrome';
  else if (/Firefox\//.test(ua)) bs = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) bs = 'Safari';
  return { os, bs };
}

function cfg(configs: Record<string, string>, key: string, defaultValue = ''): string {
  return configs[key] ?? defaultValue;
}

function normalizeIp(ip: string): string {
  return ip === '::1' ? '127.0.0.1' : ip;
}

// ============================================================================
// Webhook 推送
// ============================================================================

type WebhookPlatform = 'dingtalk' | 'wecom' | 'generic';

function detectPlatform(url: string): WebhookPlatform {
  if (url.includes('oapi.dingtalk.com')) return 'dingtalk';
  if (url.includes('qyapi.weixin.qq.com')) return 'wecom';
  return 'generic';
}

function buildDingTalkActionCard(formName: string, fields: NotifyField[], meta: NotifyMeta, detailUrl: string): Record<string, unknown> {
  const ts = meta.timestamp || nowStr();
  const ip = normalizeIp(meta.ip);
  let text = `#### ${formName}\n\n> **時間**: ${ts}\n\n> **IP**: ${ip}`;
  if (meta.os && meta.os !== 'Unknown') text += `  |  **系統**: ${meta.os}`;
  if (meta.browser && meta.browser !== 'Unknown') text += `  |  **瀏覽器**: ${meta.browser}`;
  text += '\n\n';
  if (meta.sourceUrl) text += `> **來源**: ${meta.sourceUrl}\n\n---\n`;
  for (const f of fields) { if (f.value) text += `**${f.label}**: ${f.value}\n\n`; }
  return { msgtype: 'actionCard', actionCard: { title: formName, text, singleTitle: '查看詳情', singleURL: detailUrl, hideAvatar: '0' } };
}

function buildWeComMarkdown(formName: string, fields: NotifyField[], meta: NotifyMeta): Record<string, unknown> {
  const ts = meta.timestamp || nowStr();
  const ip = normalizeIp(meta.ip);
  let content = `### ${formName}\n\n**時間**: ${ts}\n**IP**: ${ip}`;
  if (meta.os && meta.os !== 'Unknown') content += `  |  **系統**: ${meta.os}`;
  if (meta.browser && meta.browser !== 'Unknown') content += `  |  **瀏覽器**: ${meta.browser}`;
  content += '\n';
  if (meta.sourceUrl) content += `**來源**: ${meta.sourceUrl}\n`;
  content += '\n';
  for (const f of fields) { if (f.value) content += `**${f.label}**: ${f.value}\n`; }
  return { msgtype: 'markdown', markdown: { content } };
}

function buildGenericPayload(formName: string, fields: NotifyField[], meta: NotifyMeta): Record<string, unknown> {
  return { form_name: formName, timestamp: meta.timestamp || nowStr(), ip: normalizeIp(meta.ip), os: meta.os, browser: meta.browser, source_url: meta.sourceUrl || '', fields };
}

interface RobotResponse { errcode?: number; errmsg?: string; }

export async function sendWebhook(
  configs: Record<string, string>,
  category: 'message' | 'form' | 'comment',
  formName: string,
  fields: NotifyField[],
  meta: NotifyMeta,
  detailUrl: string,
): Promise<{ success: boolean; error?: string }> {
  const webhookUrl = cfg(configs, 'webhook_url');
  if (!webhookUrl) return { success: false, error: 'webhook_url 未配置' };
  const switchKey = `webhook_${category}`;
  if (cfg(configs, switchKey) !== '1') return { success: false, error: `${switchKey} 未啟用` };

  const platform = detectPlatform(webhookUrl);
  let payload: Record<string, unknown>;
  switch (platform) {
    case 'dingtalk': payload = buildDingTalkActionCard(formName, fields, meta, detailUrl); break;
    case 'wecom': payload = buildWeComMarkdown(formName, fields, meta); break;
    default: payload = buildGenericPayload(formName, fields, meta); break;
  }

  try {
    const resp = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
    if (platform === 'dingtalk' || platform === 'wecom') {
      const result = (await resp.json()) as RobotResponse;
      if (result.errcode && result.errcode !== 0) return { success: false, error: result.errmsg || `errcode: ${result.errcode}` };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '未知錯誤' };
  }
}

// ============================================================================
// 郵件通知
// ============================================================================

export function buildNotifyEmailHtml(siteName: string, siteLogo: string, formName: string, fields: NotifyField[], meta: NotifyMeta): string {
  const ts = meta.timestamp || nowStr();
  const ip = normalizeIp(meta.ip);
  const fieldRows = fields.filter((f) => f.value).map((f) => `<tr><td style="padding:8px 16px;color:#6b7280;font-size:14px;white-space:nowrap;border-bottom:1px solid #f3f4f6;">${f.label}</td><td style="padding:8px 16px;color:#1f2937;font-size:14px;word-break:break-all;border-bottom:1px solid #f3f4f6;">${f.value}</td></tr>`).join('');
  const logoHtml = siteLogo ? `<img src="${siteLogo}" alt="Logo" style="height:32px;max-width:120px;object-fit:contain;" />` : `<span style="font-size:20px;font-weight:700;color:#fff;">${siteName || 'CMS'}</span>`;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;min-height:100vh;"><tr><td align="center" style="padding:24px 12px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:24px 32px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="left">${logoHtml}</td><td align="right" style="color:rgba(255,255,255,0.85);font-size:12px;">${ts}</td></tr></table></td></tr>
<tr><td style="padding:24px 32px 8px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#1f2937;">${formName}</h1><p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">您收到一條新的通知，請及時處理</p></td></tr>
<tr><td style="padding:8px 32px 16px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">${fieldRows}</table></td></tr>
<tr><td style="padding:0 32px 16px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:12px 16px;">
<tr><td style="padding:4px 0;font-size:13px;color:#6b7280;"><span style="display:inline-block;width:70px;color:#9ca3af;">來源 IP</span><span style="color:#374151;font-weight:500;">${ip}</span></td></tr>
<tr><td style="padding:4px 0;font-size:13px;color:#6b7280;"><span style="display:inline-block;width:70px;color:#9ca3af;">操作系統</span><span style="color:#374151;font-weight:500;">${meta.os || 'Unknown'}</span><span style="display:inline-block;width:60px;color:#9ca3af;margin-left:16px;">瀏覽器</span><span style="color:#374151;font-weight:500;">${meta.browser || 'Unknown'}</span></td></tr>
${meta.sourceUrl ? `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280;"><span style="display:inline-block;width:70px;color:#9ca3af;">來源頁面</span><span style="color:#4f46e5;word-break:break-all;">${meta.sourceUrl}</span></td></tr>` : ''}
</table></td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #f3f4f6;"><p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">此郵件由 ${siteName || 'CMS系統'} 自動發送，請勿直接回覆。<br/>&copy; ${new Date().getFullYear()} ${siteName || 'CMS'}. All rights reserved.</p></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * 發送郵件通知
 * 使用 MailChannels / Resend HTTP API (免費第三方接入)
 */
export async function sendNotifyMail(
  configs: Record<string, string>,
  to: string,
  subject: string,
  htmlBody: string,
): Promise<{ success: boolean; error?: string }> {
  if (!to) return { success: false, error: '收件人為空' };
  const fromEmail = cfg(configs, 'mail_from', 'noreply@example.com');
  const fromName = cfg(configs, 'mail_from_name', 'CMS 系統');
  const recipients = to.split(',').map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) return { success: false, error: '收件人為空' };

  try {
    const provider = cfg(configs, 'mail_provider', 'mailchannels');
    const apiKey = cfg(configs, 'mail_api_key');

    if (provider === 'resend') {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: recipients, subject, html: htmlBody }),
      });
      if (!resp.ok) return { success: false, error: `Resend: ${resp.status}` };
      return { success: true };
    }

    // MailChannels (默認，免費)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const resp = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personalizations: [{ to: recipients.map((email) => ({ email })) }],
        from: { email: fromEmail, name: fromName },
        subject,
        content: [{ type: 'text/html', value: htmlBody }],
      }),
    });
    if (!resp.ok) return { success: false, error: `MailChannels: ${resp.status}` };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '未知錯誤' };
  }
}

// ============================================================================
// 綜合通知觸發
// ============================================================================

async function getSiteInfo(db: D1Database): Promise<{ name: string; logo: string; domain: string }> {
  const site = await db.prepare('SELECT name, title, logo, domain FROM ay_site WHERE acode = ? LIMIT 1').bind('cn').first<{ name?: string; title?: string; logo?: string; domain?: string }>();
  return { name: site?.title || site?.name || 'CMS', logo: site?.logo || '', domain: site?.domain || '' };
}

function buildAdminUrl(domain: string, category: string): string {
  const base = domain ? `https://${domain.replace(/^https?:\/\//, '')}` : '';
  const path = category === 'comment' ? '/admin/member/comment/index' : category === 'form' ? '/admin/content/form/index' : '/admin/content/message/index';
  return `${base}${path}`;
}

/**
 * 始終從 D1 讀取配置 (避免 KV 緩存過時, 特別是 webhook/mail 配置)
 */
async function loadConfigsFromDB(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT name, value FROM ay_config').all<{ name: string; value: string }>();
  const map: Record<string, string> = {};
  for (const row of result.results) { map[row.name] = row.value; }
  return map;
}

export async function triggerNotify(
  db: D1Database,
  kv: KVNamespace | null,
  flags: Flagship | null,
  category: 'message' | 'form' | 'comment',
  formName: string,
  fields: NotifyField[],
  ip: string,
  userAgent: string,
  sourceUrl?: string,
): Promise<void> {
  try {
    // 始終從 D1 讀取配置 (不依賴 KV 緩存, 確保 webhook/mail 配置最新)
    const configs = await loadConfigsFromDB(db);
    const { os, bs } = parseUserAgent(userAgent);
    const meta: NotifyMeta = { ip, os, browser: bs, sourceUrl, timestamp: nowStr() };
    const site = await getSite(db);
    const detailUrl = buildAdminUrl(site.domain, category);

    // 功能開關：統一使用 flags.ts 標準化服務
    const flagEnv = { DB: db, 'Flagship-service': flags ?? undefined };
    const mailEnabled = await getFlagEnabled(flagEnv, 'mail_enabled');
    const webhookEnabled = await getFlagEnabled(flagEnv, 'webhook_enabled');

    // 郵件通知
    if (mailEnabled) {
      const mailSwitch = category === 'message' ? 'message_send_mail' : category === 'form' ? 'form_send_mail' : 'comment_send_mail';
      const mailTo = cfg(configs, 'message_send_to');
      if (cfg(configs, mailSwitch) === '1' && mailTo) {
        const html = buildNotifyEmailHtml(site.name, site.logo, formName, fields, meta);
        const result = await sendNotifyMail(configs, mailTo, `新通知：${formName}`, html);
        await logNotify(db, 'mail', result.success, result.error || `${formName} -> ${mailTo}`);
      }
    }

    // Webhook 推送
    if (webhookEnabled) {
      const webhookResult = await sendWebhook(configs, category, formName, fields, meta, detailUrl);
      if (webhookResult.success || (webhookResult.error && !webhookResult.error.includes('未啟用'))) {
        await logNotify(db, 'webhook', webhookResult.success, webhookResult.error || `${formName} -> webhook`);
      }
    }
  } catch (e) {
    console.error('通知觸發失敗:', e);
  }
}

async function logNotify(db: D1Database, type: 'mail' | 'webhook', success: boolean, message: string): Promise<void> {
  try {
    const level = success ? `${type}_success` : `${type}_error`;
    await db.prepare('INSERT INTO ay_syslog (level, event, ip, create_time) VALUES (?, ?, ?, ?)').bind(level, message.slice(0, 200), '127.0.0.1', nowStr()).run();
  } catch { /* ignore */ }
}

// ============================================================================
// 測試接口
// ============================================================================

export async function handleTestMail(db: D1Database, kv: KVNamespace, body: { to?: string }): Promise<Response> {
  const to = body.to;
  if (!to) return err('缺少收件人 to 參數', 1001);
  const configs = await loadConfigsFromDB(db);
  const site = await getSite(db);
  const ts = nowStr();
  const fields: NotifyField[] = [
    { label: '測試類型', value: '郵件配置驗證' },
    { label: '收件地址', value: to },
    { label: '發送時間', value: ts },
  ];
  const meta: NotifyMeta = { ip: '127.0.0.1', os: 'Server', browser: 'Test', timestamp: ts };
  const html = buildNotifyEmailHtml(site.name, site.logo, '郵件測試通知', fields, meta);
  const result = await sendNotifyMail(configs, to, '測試郵件 - CMS 系統通知', html);
  await logNotify(db, 'mail', result.success, result.error || `測試郵件 -> ${to}`);
  return result.success ? ok('測試郵件發送成功') : err(`郵件發送失敗: ${result.error}`, 1005);
}

export async function handleTestWebhook(db: D1Database, kv: KVNamespace, body: { category?: 'message' | 'form' | 'comment' }): Promise<Response> {
  const configs = await loadConfigsFromDB(db);
  const webhookUrl = cfg(configs, 'webhook_url');
  if (!webhookUrl) return err('webhook_url 未配置', 1001);
  const category = body.category || 'message';
  const site = await getSite(db);
  const detailUrl = buildAdminUrl(site.domain, category);
  const ts = nowStr();
  const fields: NotifyField[] = [
    { label: '測試類型', value: 'Webhook 推送驗證' },
    { label: '目標平台', value: detectPlatform(webhookUrl) },
    { label: '推送時間', value: ts },
  ];
  const meta: NotifyMeta = { ip: '127.0.0.1', os: 'Server', browser: 'Test', timestamp: ts };
  const testConfigs = { ...configs, [`webhook_${category}`]: '1' };
  const result = await sendWebhook(testConfigs, category, 'Webhook 測試通知', fields, meta, detailUrl);
  await logNotify(db, 'webhook', result.success, result.error || `測試 Webhook -> ${webhookUrl}`);
  return result.success ? ok('測試 Webhook 推送成功') : err(`Webhook 推送失敗: ${result.error}`, 1005);
}

/**
 * 版本更新通知已廢棄（v1.5.9 移除）。
 * 原因：與開發者手動推送的釘釘 webhook 重複，造成兩次推送（第二次無格式）。
 * 版本更新通知改為由開發者在部署腳本中手動推送（markdown 格式 + emoji）。
 */
