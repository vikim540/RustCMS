/**
 * 自定義表單服務 — 統一表單提交系統
 *
 * 取代舊的留言管理（ay_message），支持任意 JSON 結構的表單數據。
 * 公開端點接收表單提交 → 存入 D1 → 推送釘釘客服群通知。
 * 管理端提供列表/詳情/狀態更新/刪除。
 */

import type { D1Database, KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { ok, okData, okList, err } from '../utils/response';
import { nowStr } from '../utils/datetime';

/** 表單提交狀態 */
const STATUS_LABELS: Record<string, string> = {
  '0': '待處理',
  '1': '已處理',
  '2': '已封存',
};

/** 簡易 UA 解析（避免與 extra.ts 循環依賴） */
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

/** 從表單數據中提取常用搜索字段 */
function extractField(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = body[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (typeof val === 'number') return String(val);
  }
  return '';
}

/** 從 D1 讀取表單 webhook URL */
async function getFormWebhookUrl(db: D1Database, kv: KVNamespace | null): Promise<string> {
  // 先從 KV 緩存讀
  if (kv) {
    const cached = await kv.get('config:all');
    if (cached) {
      try {
        const configs = JSON.parse(cached) as Record<string, string>;
        if (configs.form_webhook_url) return configs.form_webhook_url;
      } catch { /* ignore */ }
    }
  }
  // 回退到 D1
  const row = await db.prepare("SELECT value FROM ay_config WHERE name = 'form_webhook_url'").first<{ value: string }>();
  return row?.value || '';
}

/** 推送釘釘 ActionCard 通知到客服群 */
async function pushFormDingTalk(
  db: D1Database,
  kv: KVNamespace | null,
  formData: Record<string, unknown>,
  name: string,
  formKey: string,
  timestamp: string,
  ip: string,
): Promise<void> {
  const webhookUrl = await getFormWebhookUrl(db, kv);
  if (!webhookUrl) return;

  // 構建 markdown 內容（精簡文本，不dump原始JSON）
  let content = `#### 📋 新表單提交\n\n> **時間**: ${timestamp}\n\n> **IP**: ${ip}\n\n---\n\n`;
  for (const [key, value] of Object.entries(formData)) {
    if (value === undefined || value === null || value === '') continue;
    content += `**${key}**: ${value}\n\n`;
  }

  const payload = {
    msgtype: 'actionCard',
    actionCard: {
      title: `📋 新表單提交 - ${name || '未知'}`,
      text: content,
      hideAvatar: '0',
    },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const result = await res.json() as { errcode?: number; errmsg?: string };
    if (result.errcode !== 0) {
      console.error('[FormDingTalk] 推送失敗:', result.errmsg);
    }
  } catch (e) {
    console.error('[FormDingTalk] 網絡錯誤:', e);
  }
}

/** 表單提交數據結構 */
type FormBody = Record<string, unknown>;

// ===== 公開端點 =====

/**
 * 處理表單提交（公開端點，Form Rate Limit）
 * 接受任意 JSON 結構，存入 D1，推送釘釘客服群
 */
export async function handleSubmitForm(
  db: D1Database,
  kv: KVNamespace | null,
  ctx: ExecutionContext | null,
  body: FormBody,
  userIp: string,
  userAgent: string,
  sourceUrl: string,
  acode: string,
): Promise<Response> {
  // 提取 form_key（可選，從 body 中移除避免存入 data）
  const formKey = typeof body._form_key === 'string' ? body._form_key : 'general';
  delete body._form_key;

  // 驗證：至少有一些數據
  if (Object.keys(body).length === 0) {
    return err('表單數據不能為空', 1001);
  }

  // 簡易速率限制：同一 IP 60 秒內只能提交一次
  const RATE_KEY = `rate:form:${userIp}`;
  if (kv) {
    const last = await kv.get(RATE_KEY);
    if (last) return err('提交過於頻繁,請稍後再試', 1006);
  }

  // 提取常用搜索字段
  const name = extractField(body, ['name', '姓名', '聯繫人', 'contacts', 'username']);
  const tel = extractField(body, ['tel', 'phone', 'mobile', '手機', '電話', '聯絡電話']);
  const email = extractField(body, ['email', '郵箱', '電郵', '電子郵件']);

  const { os, bs } = parseUserAgent(userAgent);
  const now = nowStr();
  const dataJson = JSON.stringify(body);

  const result = await db.prepare(
    `INSERT INTO ay_form_submission (acode, form_key, data, name, tel, email, status, user_ip, user_os, user_bs, source_url, create_time)
     VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, ?, ?, ?)`,
  ).bind(acode, formKey, dataJson, name, tel, email, userIp || '', os, bs, sourceUrl || '', now).run();

  if (result.meta.changes > 0) {
    // 速率限制寫入
    if (kv) {
      await kv.put(RATE_KEY, '1', { expirationTtl: 60 });
    }
    // 異步推送釘釘通知
    if (ctx) {
      ctx.waitUntil(pushFormDingTalk(db, kv, body, name, formKey, now, userIp));
    }
    return ok('表單提交成功');
  }
  return err('表單提交失敗', 1005);
}

// ===== 管理端 =====

/** 表單提交列表項 */
interface SubmissionListItem {
  id: number;
  form_key: string;
  name: string;
  tel: string;
  email: string;
  status: string;
  status_label: string;
  source_url: string;
  create_time: string;
  // 預覽：前幾個字段的摘要
  preview: string;
}

/** 列表查詢（分頁 + 搜索 + 狀態篩選 + 排序） */
export async function handleListSubmissions(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));
  const pagesize = Math.min(200, Math.max(1, parseInt(params.get('pagesize') || '50', 10)));
  const status = params.get('status') || '';
  const search = (params.get('search') || '').trim();
  const formKey = params.get('form_key') || '';
  const sort = params.get('sort') || 'newest';

  const where: string[] = [];
  const binds: (string | number)[] = [];

  if (status) {
    where.push('status = ?');
    binds.push(status);
  }
  if (formKey) {
    where.push('form_key = ?');
    binds.push(formKey);
  }
  if (search) {
    where.push('(name LIKE ? OR tel LIKE ? OR email LIKE ?)');
    const pattern = `%${search}%`;
    binds.push(pattern, pattern, pattern);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = sort === 'oldest' ? 'ORDER BY create_time ASC' : 'ORDER BY create_time DESC';
  const offset = (page - 1) * pagesize;

  // 總數
  const countRow = await db.prepare(
    `SELECT COUNT(*) as total FROM ay_form_submission ${whereClause}`,
  ).bind(...binds).first<{ total: number }>();
  const total = countRow?.total || 0;

  // 列表
  const rows = await db.prepare(
    `SELECT id, form_key, name, tel, email, status, source_url, create_time, data
     FROM ay_form_submission ${whereClause} ${orderBy} LIMIT ? OFFSET ?`,
  ).bind(...binds, pagesize, offset).all<{
    id: number; form_key: string; name: string; tel: string; email: string;
    status: string; source_url: string; create_time: string; data: string;
  }>();

  const items: SubmissionListItem[] = rows.results.map((r) => {
    // 生成預覽：從 data 中提取前 3 個字段的摘要
    let preview = '';
    try {
      const data = JSON.parse(r.data) as Record<string, unknown>;
      const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '');
      preview = entries.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' | ');
    } catch { /* ignore */ }

    return {
      id: r.id,
      form_key: r.form_key,
      name: r.name || '',
      tel: r.tel || '',
      email: r.email || '',
      status: r.status,
      status_label: STATUS_LABELS[r.status] || '未知',
      source_url: r.source_url || '',
      create_time: r.create_time || '',
      preview,
    };
  });

  return okList(items, { page, pagesize, total });
}

/** 詳情查詢 */
export async function handleGetSubmission(db: D1Database, id: number): Promise<Response> {
  const row = await db.prepare(
    `SELECT id, acode, form_key, data, name, tel, email, status, user_ip, user_os, user_bs, source_url, create_time
     FROM ay_form_submission WHERE id = ?`,
  ).bind(id).first();

  if (!row) return err('表單記錄不存在', 1004);

  // 解析 data JSON
  let parsedData: Record<string, unknown> = {};
  try {
    parsedData = JSON.parse(row.data as string) as Record<string, unknown>;
  } catch { /* ignore */ }

  return okData({
    ...row,
    data: parsedData,
    status_label: STATUS_LABELS[row.status as string] || '未知',
  });
}

/** 更新狀態（標記為已處理/已封存） */
export async function handleUpdateSubmissionStatus(
  db: D1Database,
  id: number,
  status: string,
): Promise<Response> {
  if (!['0', '1', '2'].includes(status)) {
    return err('無效狀態值（0=待處理, 1=已處理, 2=已封存）', 1001);
  }

  const result = await db.prepare(
    'UPDATE ay_form_submission SET status = ? WHERE id = ?',
  ).bind(status, id).run();

  if (result.meta.changes === 0) {
    return err('表單記錄不存在', 1004);
  }
  return ok('狀態更新成功');
}

/** 刪除表單記錄 */
export async function handleDeleteSubmission(db: D1Database, id: number): Promise<Response> {
  const result = await db.prepare('DELETE FROM ay_form_submission WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) {
    return err('表單記錄不存在', 1004);
  }
  return ok('記錄已刪除');
}

/** 統計（用於儀表盤卡片） */
export async function handleSubmissionStats(db: D1Database): Promise<Response> {
  const row = await db.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = '0' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = '1' THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN status = '2' THEN 1 ELSE 0 END) as archived
     FROM ay_form_submission`,
  ).first<{ total: number; pending: number; processed: number; archived: number }>();

  // 按 form_key 分組統計
  const formKeyRows = await db.prepare(
    `SELECT form_key, COUNT(*) as count
     FROM ay_form_submission
     GROUP BY form_key
     ORDER BY count DESC`,
  ).all<{ form_key: string; count: number }>();

  return okData({
    total: row?.total || 0,
    pending: row?.pending || 0,
    processed: row?.processed || 0,
    archived: row?.archived || 0,
    by_form_key: formKeyRows.results,
  });
}

/** 批量刪除 */
export async function handleBatchDeleteSubmissions(db: D1Database, ids: number[]): Promise<Response> {
  if (!ids.length) return err('請選擇要刪除的記錄', 1001);
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(
    `DELETE FROM ay_form_submission WHERE id IN (${placeholders})`,
  ).bind(...ids).run();
  return ok(`已刪除 ${result.meta.changes} 條記錄`);
}

/** 批量更新狀態 */
export async function handleBatchUpdateStatus(
  db: D1Database,
  ids: number[],
  status: string,
): Promise<Response> {
  if (!ids.length) return err('請選擇要操作的記錄', 1001);
  if (!['0', '1', '2'].includes(status)) {
    return err('無效狀態值', 1001);
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(
    `UPDATE ay_form_submission SET status = ? WHERE id IN (${placeholders})`,
  ).bind(status, ...ids).run();
  return ok(`已更新 ${result.meta.changes} 條記錄`);
}

/** 獲取所有 form_key 列表（用於篩選下拉） */
export async function handleListFormKeys(db: D1Database): Promise<Response> {
  const rows = await db.prepare(
    `SELECT form_key, COUNT(*) as count
     FROM ay_form_submission
     GROUP BY form_key
     ORDER BY form_key`,
  ).all<{ form_key: string; count: number }>();
  return okData(rows.results);
}
