/**
 * 擴展業務服務 (8 個模塊)
 * 包含: 單頁 / 友情連結 / 幻燈片 / 標籤 / 自定義標籤 / 留言 / 站點信息 / 公司信息
 *
 * 表結構注意事項 (來自 migrations/0001_init.sql):
 *   - ay_single: 無 acode 字段, 時間字段為 createtime/updatetime (無下劃線)
 *   - ay_label:  無 acode 字段
 *   - ay_link / ay_slide / ay_tags: 有 acode, 無 status 字段
 *   - ay_site / ay_company: 有 acode, 無時間字段
 *   - ay_message: 有 acode, 有 status 字段
 *
 * 所有 SQL 均使用 D1 binding 的參數化查詢, 禁止字符串拼接值
 */
import type { D1Database, KVNamespace, ExecutionContext, Flagship } from '@cloudflare/workers-types';
import { okData, okList, ok, err, notFound, createMeta } from '../utils/response';
import { fromQuery, offset, type Pagination } from '../utils/pagination';
import { triggerNotify, type NotifyField } from './notify';
import { nowStr } from '../utils/datetime';

/** 簡易 User-Agent 解析 (用於留言記錄客戶端信息) */
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
  else if (/MSIE|Trident/.test(ua)) bs = 'IE';

  return { os, bs };
}

// ============================================================================
// 模塊 1: 單頁管理 (ay_single)
// 注意: 無 acode 字段, 時間字段為 createtime/updatetime
// ============================================================================

/** 後台單頁列表 (分頁, ORDER BY sorting ASC, id ASC) */
export async function handleAdminListSingles(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const off = offset(pagination);

  const listSql = 'SELECT * FROM ay_single ORDER BY sorting ASC, id ASC LIMIT ? OFFSET ?';
  const listResult = await db.prepare(listSql).bind(pagination.pagesize, off).all();

  const countResult = await db.prepare('SELECT COUNT(*) as total FROM ay_single').first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 後台單頁詳情 */
export async function handleAdminGetSingle(db: D1Database, id: number): Promise<Response> {
  const row = await db.prepare('SELECT * FROM ay_single WHERE id = ?').bind(id).first();
  if (!row) return notFound('單頁不存在');
  return okData(row, '成功');
}

/** 新增單頁 */
export async function handleCreateSingle(
  db: D1Database,
  body: { scode?: string; title?: string; keywords?: string; description?: string; content?: string; sorting?: number; status?: string },
): Promise<Response> {
  const title = body.title;
  if (!title) return err('缺少 title 參數', 1001);

  const now = nowStr();
  const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

  const result = await db.prepare(
    "INSERT INTO ay_single (scode, title, keywords, description, content, sorting, status, createtime, updatetime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    body.scode || '',
    title,
    body.keywords || '',
    body.description || '',
    body.content || '',
    sorting,
    body.status || '1',
    now,
    now,
  ).run();

  if (result.meta.changes > 0) {
    return ok('單頁創建成功');
  }
  return err('單頁創建失敗', 1005);
}

/** 修改單頁 (白名單字段動態 UPDATE) */
export async function handleUpdateSingle(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = nowStr();
  const allowedFields = ['scode', 'title', 'keywords', 'description', 'content', 'sorting', 'status'];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('updatetime = ?');
  binds.push(now);
  binds.push(id);

  const sql = `UPDATE ay_single SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('單頁更新成功');
}

/** 刪除單頁 */
export async function handleDeleteSingle(db: D1Database, id: number): Promise<Response> {
  await db.prepare('DELETE FROM ay_single WHERE id = ?').bind(id).run();
  return ok('單頁刪除成功');
}

/** 公開單頁列表 (僅啟用) */
export async function handleListSingles(db: D1Database): Promise<Response> {
  const result = await db.prepare(
    "SELECT * FROM ay_single WHERE status = '1' ORDER BY sorting ASC, id ASC",
  ).all();
  return okData(result.results, '成功');
}

/** 公開單頁詳情 (按 scode 查詢) */
export async function handleSingleDetail(db: D1Database, scode: string): Promise<Response> {
  const row = await db.prepare(
    "SELECT * FROM ay_single WHERE scode = ? AND status = '1' LIMIT 1",
  ).bind(scode).first();
  if (!row) return notFound('單頁不存在');
  return okData(row, '成功');
}

// ============================================================================
// 模塊 2: 友情連結 (ay_link)
// ============================================================================

/** 後台友情連結列表 (分頁, 支持 gid 篩選) */
export async function handleAdminListLinks(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const gid = params.get('gid') || '';

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (gid) {
    conditions.push('gid = ?');
    binds.push(gid);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const off = offset(pagination);

  const listSql = `SELECT * FROM ay_link ${whereClause} ORDER BY sorting ASC, id ASC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_link ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 新增友情連結 */
export async function handleCreateLink(
  db: D1Database,
  body: { gid?: string; name?: string; link?: string; logo?: string; sorting?: number },
  acode: string = 'endoscopy',
): Promise<Response> {
  const name = body.name;
  if (!name) return err('缺少 name 參數', 1001);

  const now = nowStr();
  const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

  const result = await db.prepare(
    'INSERT INTO ay_link (acode, gid, name, link, logo, sorting, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    acode,
    body.gid || '1',
    name,
    body.link || '',
    body.logo || '',
    sorting,
    now,
    now,
  ).run();

  if (result.meta.changes > 0) {
    return ok('友情連結創建成功');
  }
  return err('友情連結創建失敗', 1005);
}

/** 修改友情連結 (白名單字段動態 UPDATE) */
export async function handleUpdateLink(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = nowStr();
  const allowedFields = ['gid', 'name', 'link', 'logo', 'sorting'];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('update_time = ?');
  binds.push(now);
  binds.push(id);

  const sql = `UPDATE ay_link SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('友情連結更新成功');
}

/** 刪除友情連結 */
export async function handleDeleteLink(db: D1Database, id: number): Promise<Response> {
  await db.prepare('DELETE FROM ay_link WHERE id = ?').bind(id).run();
  return ok('友情連結刪除成功');
}

/** 公開友情連結列表 (支持 gid 篩選) */
export async function handleListLinks(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const gid = params.get('gid') || '';

  if (gid) {
    const result = await db.prepare(
      'SELECT * FROM ay_link WHERE gid = ? ORDER BY sorting ASC, id ASC',
    ).bind(gid).all();
    return okData(result.results, '成功');
  }

  const result = await db.prepare(
    'SELECT * FROM ay_link ORDER BY sorting ASC, id ASC',
  ).all();
  return okData(result.results, '成功');
}

// ============================================================================
// 模塊 3: 幻燈片 (ay_slide)
// ============================================================================

/** 後台幻燈片列表 (分頁, 支持 gid 篩選) */
export async function handleAdminListSlides(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const gid = params.get('gid') || '';

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (gid) {
    conditions.push('gid = ?');
    binds.push(gid);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const off = offset(pagination);

  const listSql = `SELECT * FROM ay_slide ${whereClause} ORDER BY sorting ASC, id ASC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_slide ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 新增幻燈片 */
export async function handleCreateSlide(
  db: D1Database,
  body: { gid?: string; pic?: string; pic_mobile?: string; link?: string; title?: string; subtitle?: string; button_text?: string; sorting?: number },
  acode: string = 'endoscopy',
): Promise<Response> {
  const now = nowStr();
  const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

  const result = await db.prepare(
    'INSERT INTO ay_slide (acode, gid, pic, pic_mobile, link, title, subtitle, button_text, sorting, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    acode,
    body.gid || '1',
    body.pic || '',
    body.pic_mobile || '',
    body.link || '',
    body.title || '',
    body.subtitle || '',
    body.button_text || '',
    sorting,
    now,
    now,
  ).run();

  if (result.meta.changes > 0) {
    return ok('幻燈片創建成功');
  }
  return err('幻燈片創建失敗', 1005);
}

/** 修改幻燈片 (白名單字段動態 UPDATE) */
export async function handleUpdateSlide(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = nowStr();
  const allowedFields = ['gid', 'pic', 'pic_mobile', 'link', 'title', 'subtitle', 'button_text', 'sorting'];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('update_time = ?');
  binds.push(now);
  binds.push(id);

  const sql = `UPDATE ay_slide SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('幻燈片更新成功');
}

/** 批量更新幻燈片排序 */
export async function handleBatchUpdateSlideSorting(
  db: D1Database,
  items: { id: number; sorting: number }[],
): Promise<Response> {
  const stmts = items.map((item) =>
    db.prepare('UPDATE ay_slide SET sorting = ? WHERE id = ?').bind(item.sorting, item.id),
  );
  await db.batch(stmts);
  return ok('排序更新成功');
}

/** 刪除幻燈片 */
export async function handleDeleteSlide(db: D1Database, id: number): Promise<Response> {
  await db.prepare('DELETE FROM ay_slide WHERE id = ?').bind(id).run();
  return ok('幻燈片刪除成功');
}

/** 公開幻燈片列表 (支持 gid 篩選) */
export async function handleListSlides(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const gid = params.get('gid') || '';

  if (gid) {
    const result = await db.prepare(
      'SELECT * FROM ay_slide WHERE gid = ? ORDER BY sorting ASC, id ASC',
    ).bind(gid).all();
    return okData(result.results, '成功');
  }

  const result = await db.prepare(
    'SELECT * FROM ay_slide ORDER BY sorting ASC, id ASC',
  ).all();
  return okData(result.results, '成功');
}

// ============================================================================
// 模塊 4: 標籤管理 (ay_tags)
// ============================================================================

/** 後台標籤列表 (分頁, 支持 keyword 搜索 name) */
export async function handleAdminListTags(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const keyword = params.get('keyword') || '';

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (keyword) {
    conditions.push('name LIKE ?');
    binds.push(`%${keyword}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const off = offset(pagination);

  const listSql = `SELECT * FROM ay_tags ${whereClause} ORDER BY sorting ASC, id ASC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_tags ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 新增標籤 */
export async function handleCreateTag(
  db: D1Database,
  body: { name?: string; link?: string; sorting?: number },
  acode: string = 'endoscopy',
): Promise<Response> {
  const name = body.name;
  if (!name) return err('缺少 name 參數', 1001);

  const now = nowStr();
  const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

  const result = await db.prepare(
    'INSERT INTO ay_tags (acode, name, link, sorting, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(acode, name, body.link || '', sorting, now, now).run();

  if (result.meta.changes > 0) {
    return ok('標籤創建成功');
  }
  return err('標籤創建失敗', 1005);
}

/** 修改標籤 (白名單字段動態 UPDATE) */
export async function handleUpdateTag(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = nowStr();
  const allowedFields = ['name', 'link', 'sorting'];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('update_time = ?');
  binds.push(now);
  binds.push(id);

  const sql = `UPDATE ay_tags SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('標籤更新成功');
}

/** 刪除標籤 */
export async function handleDeleteTag(db: D1Database, id: number): Promise<Response> {
  await db.prepare('DELETE FROM ay_tags WHERE id = ?').bind(id).run();
  return ok('標籤刪除成功');
}

/** 公開標籤列表 */
export async function handleListTags(db: D1Database): Promise<Response> {
  const result = await db.prepare(
    'SELECT * FROM ay_tags ORDER BY sorting ASC, id ASC',
  ).all();
  return okData(result.results, '成功');
}

// ============================================================================
// 模塊 5: 留言管理 (ay_message)
// 註: 原模塊5「自定義標籤」已移除 — headless CMS 無模板引擎，功能與 config API 重疊
// ============================================================================

/** 後台留言列表 (分頁, ORDER BY id DESC, 支持 status 篩選) */
export async function handleAdminListMessages(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const status = params.get('status') || '';

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (status) {
    conditions.push('status = ?');
    binds.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const off = offset(pagination);

  const listSql = `SELECT * FROM ay_message ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_message ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 後台留言詳情 */
export async function handleAdminGetMessage(db: D1Database, id: number): Promise<Response> {
  const row = await db.prepare(
    'SELECT * FROM ay_message WHERE id = ?',
  ).bind(id).first();
  if (!row) return notFound('留言不存在');
  return okData(row, '成功');
}

/** 回復留言 / 更新留言狀態 (字段: recontent, status) */
export async function handleUpdateMessage(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = nowStr();
  const allowedFields = ['recontent', 'status'];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('update_time = ?');
  binds.push(now);
  binds.push(id);

  const sql = `UPDATE ay_message SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('留言更新成功');
}

/** 刪除留言 */
export async function handleDeleteMessage(db: D1Database, id: number): Promise<Response> {
  await db.prepare('DELETE FROM ay_message WHERE id = ?').bind(id).run();
  return ok('留言刪除成功');
}

/**
 * 公開留言提交
 * 實現基於 KV 的簡易速率限制: 同一 IP 60 秒內只能提交一次
 * 參考 Go 版 front.go Message() 方法: 保存後觸發郵件 + Webhook 通知
 * @param kv KV 命名空間 (用於速率限制, 傳 null 則跳過速率限制)
 * @param userIp 訪問者 IP
 * @param userAgent 訪問者 User-Agent (用於解析 os/bs)
 * @param sourceUrl 來源頁面 URL (Referer)
 * @param body { contacts, mobile, content }
 * @param acode 站點區域代碼 (默認 'endoscopy')
 */
export async function handleSubmitMessage(
  db: D1Database,
  kv: KVNamespace | null,
  ctx: ExecutionContext | null,
  flags: Flagship | undefined,
  userIp: string,
  userAgent: string,
  sourceUrl: string,
  body: { contacts?: string; mobile?: string; content?: string },
  acode: string = 'endoscopy',
): Promise<Response> {
  const content = body.content;
  if (!content) return err('缺少 content 參數', 1001);
  if (!body.contacts && !body.mobile) {
    return err('請至少填寫聯繫人或手機號', 1001);
  }

  // 簡易速率限制: 同一 IP 60 秒內只能提交一次
  const RATE_KEY = `rate:msg:${userIp}`;
  const RATE_TTL = 60;
  if (kv) {
    const last = await kv.get(RATE_KEY);
    if (last) {
      return err('提交過於頻繁,請稍後再試', 1006);
    }
  }

  const { os, bs } = parseUserAgent(userAgent);
  const now = nowStr();

  // status 預設為 '1' (與表默認一致), 實際是否需要審核可由後續配置決定
  const result = await db.prepare(
    'INSERT INTO ay_message (acode, contacts, mobile, content, user_ip, user_os, user_bs, recontent, status, uid, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).bind(
    acode,
    body.contacts || '',
    body.mobile || '',
    content,
    userIp || '',
    os,
    bs,
    '',
    '1',
    now,
    now,
  ).run();

  if (result.meta.changes > 0) {
    // 寫入速率限制標記
    if (kv) {
      await kv.put(RATE_KEY, '1', { expirationTtl: RATE_TTL });
    }

    // 觸發郵件 + Webhook 通知 (參考 Go 版 front.go Message() 通知邏輯)
    // 使用 ctx.waitUntil 保持通知異步執行的生命週期 (否則 Workers 響應返回後會終止)
    const fields: NotifyField[] = [
      { label: '聯繫人', value: body.contacts || '' },
      { label: '手機', value: body.mobile || '' },
      { label: '留言內容', value: content },
    ];
    const notifyPromise = triggerNotify(db, kv, flags, 'message', '在線留言', fields, userIp, userAgent, sourceUrl, acode);
    if (ctx) {
      ctx.waitUntil(notifyPromise);
    } else {
      notifyPromise.catch(() => {});
    }

    return ok('留言提交成功');
  }
  return err('留言提交失敗', 1005);
}

// ============================================================================
// 模塊 7: 站點信息 (ay_site) - 單記錄
// ============================================================================

/** 站點字段白名單（香港本地化：移除 icp 內地備案、theme 模板） */
const SITE_FIELDS = [
  'name', 'title', 'subtitle', 'domain', 'keywords', 'description',
  'logo', 'copyright', 'statistical', 'lang',
];

/** 獲取或創建站點信息 (FirstOrCreate) */
async function getOrCreateSite(db: D1Database, acode: string = 'endoscopy'): Promise<Record<string, unknown>> {
  const existing = await db.prepare('SELECT * FROM ay_site LIMIT 1').first();
  if (existing) return existing;

  // 不存在則創建空記錄
  await db.prepare(
    'INSERT INTO ay_site (acode, name, title, subtitle, domain, keywords, description, logo, copyright, statistical, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(acode, '', '', '', '', '', '', '', '', '', 'zh-hk').run();
  return (await db.prepare('SELECT * FROM ay_site LIMIT 1').first())!;
}

/** 後台獲取站點信息 */
export async function handleAdminGetSite(db: D1Database): Promise<Response> {
  const site = await getOrCreateSite(db);
  return okData(site, '成功');
}

/** 後台更新站點信息 (白名單字段動態 UPDATE) */
export async function handleAdminUpdateSite(
  db: D1Database,
  body: Record<string, unknown>,
): Promise<Response> {
  // 確保記錄存在
  await getOrCreateSite(db);

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of SITE_FIELDS) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  const sql = `UPDATE ay_site SET ${sets.join(', ')}`;
  await db.prepare(sql).bind(...binds).run();

  return ok('站點信息更新成功');
}

// ============================================================================
// 模塊 8: 公司信息 (ay_company) - 單記錄
// ============================================================================

/** 公司字段白名單（香港本地化：移除 postcode 郵編、qq、icp，新增 whatsapp） */
const COMPANY_FIELDS = [
  'name', 'address', 'contact', 'mobile', 'phone',
  'fax', 'email', 'weixin', 'whatsapp', 'blicense', 'other', 'legal', 'business',
];

/** 獲取或創建公司信息 (FirstOrCreate) */
async function getOrCreateCompany(db: D1Database, acode: string = 'endoscopy'): Promise<Record<string, unknown>> {
  const existing = await db.prepare('SELECT * FROM ay_company LIMIT 1').first();
  if (existing) return existing;

  // 不存在則創建空記錄
  await db.prepare(
    'INSERT INTO ay_company (acode, name, address, contact, mobile, phone, fax, email, weixin, whatsapp, blicense, other, legal, business) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(acode, '', '', '', '', '', '', '', '', '', '', '', '', '').run();
  return (await db.prepare('SELECT * FROM ay_company LIMIT 1').first())!;
}

/** 後台獲取公司信息 */
export async function handleAdminGetCompany(db: D1Database): Promise<Response> {
  const company = await getOrCreateCompany(db);
  return okData(company, '成功');
}

/** 公開公司信息（過濾敏感字段，僅返回前台需要的聯繫信息） */
export async function getPublicCompany(db: D1Database): Promise<Record<string, unknown>> {
  const row = await db
    .prepare('SELECT name, address, contact, mobile, phone, fax, email, weixin, whatsapp, other, business FROM ay_company LIMIT 1')
    .first();
  return row ?? {};
}

/** 後台更新公司信息 (白名單字段動態 UPDATE) */
export async function handleAdminUpdateCompany(
  db: D1Database,
  body: Record<string, unknown>,
): Promise<Response> {
  // 確保記錄存在
  await getOrCreateCompany(db);

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of COMPANY_FIELDS) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(val);
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  const sql = `UPDATE ay_company SET ${sets.join(', ')}`;
  await db.prepare(sql).bind(...binds).run();

  return ok('公司信息更新成功');
}
