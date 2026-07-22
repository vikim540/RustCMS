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
  formName: string,
  timestamp: string,
  ip: string,
  overrideWebhookUrl?: string,
): Promise<void> {
  // 優先使用表單專屬 webhook，否則使用全局 webhook
  const webhookUrl = overrideWebhookUrl || await getFormWebhookUrl(db, kv);
  if (!webhookUrl) return;

  // 構建 markdown 內容（精簡文本，不dump原始JSON）
  let content = `#### 📋 ${formName} - 新提交\n\n> **時間**: ${timestamp}\n\n> **IP**: ${ip}\n\n---\n\n`;
  for (const [key, value] of Object.entries(formData)) {
    if (value === undefined || value === null || value === '') continue;
    content += `**${key}**: ${value}\n\n`;
  }

  const payload = {
    msgtype: 'actionCard',
    actionCard: {
      title: `📋 ${formName} - ${name || '未知'}`,
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
 * @param formId 可選 — 指定表單 ID（POST /forms/submit/:formId）
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
  formId?: number,
): Promise<Response> {
  // 如果指定了 formId，查找表單配置
  let formKey = '1'; // 默認通用表單 ID
  let formName = '通用表單';
  let formWebhookUrl = ''; // 空 = 使用全局 webhook

  if (formId) {
    const form = await db.prepare(
      'SELECT id, fcode, form_name, is_active, status, webhook_url FROM ay_form WHERE id = ?',
    ).bind(formId).first<{ id: number; fcode: string; form_name: string; is_active: string; status: string; webhook_url: string | null }>();

    if (!form) {
      return err('指定的表單不存在', 1004);
    }
    if (form.status !== '1' || form.is_active !== '1') {
      return err('該表單已停用，不接受提交', 1003);
    }
    formKey = String(form.id);
    formName = form.form_name;
    formWebhookUrl = form.webhook_url || '';
  } else {
    // 無 formId 時，兼容舊的 _form_key 字段
    const oldKey = typeof body._form_key === 'string' ? body._form_key : '';
    delete body._form_key;
    if (oldKey) {
      // 嘗試按 fcode 查找
      const form = await db.prepare(
        'SELECT id, form_name FROM ay_form WHERE fcode = ? AND status = \'1\'',
      ).bind(oldKey).first<{ id: number; form_name: string }>();
      if (form) {
        formKey = String(form.id);
        formName = form.form_name;
      }
    }
  }

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
    // 異步推送釘釘通知（使用表單專屬 webhook 或全局 webhook）
    if (ctx) {
      ctx.waitUntil(pushFormDingTalk(db, kv, body, name, formName, now, userIp, formWebhookUrl));
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

/** 獲取所有 form_key 列表（JOIN ay_form 獲取表單名稱） */
export async function handleListFormKeys(db: D1Database): Promise<Response> {
  const rows = await db.prepare(
    `SELECT s.form_key, COUNT(*) as count, f.form_name, f.fcode
     FROM ay_form_submission s
     LEFT JOIN ay_form f ON CAST(s.form_key AS INTEGER) = f.id
     GROUP BY s.form_key
     ORDER BY s.form_key`,
  ).all<{ form_key: string; count: number; form_name: string | null; fcode: string | null }>();
  return okData(rows.results);
}

// ===== 表單配置管理 =====

/** 表單配置列表 */
export async function handleListForms(db: D1Database): Promise<Response> {
  const rows = await db.prepare(
    `SELECT f.id, f.fcode, f.form_name, f.description, f.is_active, f.sorting, f.status,
            f.webhook_url, f.create_time, f.update_time,
            (SELECT COUNT(*) FROM ay_form_submission s WHERE CAST(s.form_key AS INTEGER) = f.id) as submission_count
     FROM ay_form f
     ORDER BY f.sorting ASC, f.id ASC`,
  ).all();
  return okData(rows.results);
}

/** 創建表單 */
export async function handleCreateForm(
  db: D1Database,
  body: { fcode?: string; form_name?: string; description?: string; is_active?: string; sorting?: number; webhook_url?: string },
): Promise<Response> {
  if (!body.form_name) return err('請填寫表單名稱', 1001);
  if (!body.fcode) return err('請填寫表單代碼', 1001);

  // 檢查 fcode 唯一性
  const existing = await db.prepare('SELECT id FROM ay_form WHERE fcode = ?').bind(body.fcode).first();
  if (existing) return err('表單代碼已存在', 1003);

  const now = nowStr();
  const result = await db.prepare(
    `INSERT INTO ay_form (fcode, form_name, description, is_active, sorting, status, webhook_url, create_time, update_time)
     VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?)`,
  ).bind(
    body.fcode, body.form_name, body.description || '',
    body.is_active || '1', body.sorting || 255, body.webhook_url || '', now, now,
  ).run();

  if (result.meta.changes > 0) {
    return okData({ id: result.meta.last_row_id });
  }
  return err('創建失敗', 1005);
}

/** 更新表單 */
export async function handleUpdateForm(
  db: D1Database,
  id: number,
  body: { fcode?: string; form_name?: string; description?: string; is_active?: string; sorting?: number; status?: string; webhook_url?: string },
): Promise<Response> {
  const sets: string[] = [];
  const binds: (string | number)[] = [];

  if (body.fcode !== undefined) { sets.push('fcode = ?'); binds.push(body.fcode); }
  if (body.form_name !== undefined) { sets.push('form_name = ?'); binds.push(body.form_name); }
  if (body.description !== undefined) { sets.push('description = ?'); binds.push(body.description); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); binds.push(body.is_active); }
  if (body.sorting !== undefined) { sets.push('sorting = ?'); binds.push(body.sorting); }
  if (body.status !== undefined) { sets.push('status = ?'); binds.push(body.status); }
  if (body.webhook_url !== undefined) { sets.push('webhook_url = ?'); binds.push(body.webhook_url); }

  if (sets.length === 0) return err('沒有需要更新的字段', 1001);

  sets.push('update_time = ?');
  binds.push(nowStr());
  binds.push(id);

  const result = await db.prepare(
    `UPDATE ay_form SET ${sets.join(', ')} WHERE id = ?`,
  ).bind(...binds).run();

  if (result.meta.changes === 0) return err('表單不存在', 1004);
  return ok('更新成功');
}

/** 刪除表單（不刪除已提交的數據） */
export async function handleDeleteForm(db: D1Database, id: number): Promise<Response> {
  // 不允許刪除默認通用表單（id=1）
  if (id === 1) return err('不允許刪除默認通用表單', 1003);
  const result = await db.prepare('DELETE FROM ay_form WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return err('表單不存在', 1004);
  return ok('表單已刪除');
}

/** 獲取活躍表單列表（用於側邊欄動態展示） */
export async function handleListActiveForms(db: D1Database): Promise<Response> {
  const rows = await db.prepare(
    `SELECT id, fcode, form_name, description
     FROM ay_form
     WHERE is_active = '1' AND status = '1'
     ORDER BY sorting ASC, id ASC`,
  ).all();
  return okData(rows.results);
}
