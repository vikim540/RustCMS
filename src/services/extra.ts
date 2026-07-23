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
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { okData, okList, ok, err, notFound, createMeta } from '../utils/response';
import { fromQuery, offset, type Pagination } from '../utils/pagination';
import { nowStr } from '../utils/datetime';

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
  body: { gid?: string; pic?: string; pic_mobile?: string; link?: string; title?: string; subtitle?: string; button_text?: string; sorting?: number; status?: string },
  acode: string = 'endoscopy',
): Promise<Response> {
  const now = nowStr();
  const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

  const result = await db.prepare(
    'INSERT INTO ay_slide (acode, gid, pic, pic_mobile, link, title, subtitle, button_text, sorting, status, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
    body.status || '1',
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
  const allowedFields = ['gid', 'pic', 'pic_mobile', 'link', 'title', 'subtitle', 'button_text', 'sorting', 'status'];

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

/** 公開幻燈片列表 (支持 gid 篩選，僅返回 status='1' 的可見幻燈片) */
export async function handleListSlides(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const gid = params.get('gid') || '';

  if (gid) {
    const result = await db.prepare(
      `SELECT * FROM ay_slide WHERE gid = ? AND (status = '1' OR status IS NULL) ORDER BY sorting ASC, id ASC`,
    ).bind(gid).all();
    return okData(result.results, '成功');
  }

  const result = await db.prepare(
    `SELECT * FROM ay_slide WHERE (status = '1' OR status IS NULL) ORDER BY sorting ASC, id ASC`,
  ).all();
  return okData(result.results, '成功');
}

// ============================================================================
// 模塊 3b: 幻燈片分組 (ay_slide_group)
// 存儲 gid → name 映射，讓所有賬號共享分組名稱（取代原 localStorage 方案）
// ============================================================================

/** 獲取所有幻燈片分組（按 sorting ASC 排序） */
export async function handleListSlideGroups(db: D1Database): Promise<Response> {
  const result = await db.prepare(
    'SELECT * FROM ay_slide_group ORDER BY sorting ASC, CAST(gid AS INTEGER) ASC, id ASC',
  ).all();
  return okData(result.results, '成功');
}

/** 新增幻燈片分組（gid 唯一，自動計算下一個可用 ID） */
export async function handleCreateSlideGroup(
  db: D1Database,
  body: { gid?: string; name?: string; sorting?: number },
): Promise<Response> {
  const now = nowStr();

  // 若未指定 gid，自動計算下一個可用數字 ID
  let gid = (body.gid || '').trim();
  if (!gid) {
    const row = await db.prepare(
      'SELECT MAX(CAST(gid AS INTEGER)) as maxGid FROM ay_slide_group',
    ).first<{ maxGid: number | null }>();
    gid = String((row?.maxGid ?? 0) + 1);
  }

  // 檢查 gid 是否已存在
  const existing = await db.prepare(
    'SELECT id FROM ay_slide_group WHERE gid = ?',
  ).bind(gid).first();
  if (existing) {
    return err('分組 ID 已存在', 1002);
  }

  const name = (body.name || '').trim() || `分組 ${gid}`;
  const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

  await db.prepare(
    'INSERT INTO ay_slide_group (gid, name, sorting, create_time, update_time) VALUES (?, ?, ?, ?, ?)',
  ).bind(gid, name, sorting, now, now).run();

  return okData({ gid, name, sorting }, '分組創建成功');
}

/** 更新幻燈片分組名稱（按 gid 查找） */
export async function handleUpdateSlideGroup(
  db: D1Database,
  gid: string,
  body: { name?: string; sorting?: number },
): Promise<Response> {
  const now = nowStr();
  const sets: string[] = [];
  const binds: (string | number)[] = [];

  const name = (body.name || '').trim();
  if (name) {
    sets.push('name = ?');
    binds.push(name);
  }
  if (typeof body.sorting === 'number') {
    sets.push('sorting = ?');
    binds.push(body.sorting);
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('update_time = ?');
  binds.push(now);
  binds.push(gid);

  const sql = `UPDATE ay_slide_group SET ${sets.join(', ')} WHERE gid = ?`;
  const result = await db.prepare(sql).bind(...binds).run();

  if (result.meta.changes === 0) {
    return err('分組不存在', 1004);
  }
  return ok('分組更新成功');
}

/** 刪除幻燈片分組（按 gid 查找，不刪除關聯的幻燈片） */
export async function handleDeleteSlideGroup(db: D1Database, gid: string): Promise<Response> {
  const result = await db.prepare(
    'DELETE FROM ay_slide_group WHERE gid = ?',
  ).bind(gid).run();

  if (result.meta.changes === 0) {
    return err('分組不存在', 1004);
  }
  return ok('分組刪除成功');
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
