/**
 * 內容管理服務
 * CRUD + 軟刪除 + 定時發布 + 子孫欄目篩選
 */
import type { D1Database } from '@cloudflare/workers-types';
import { okData, okList, ok, err, notFound, createMeta } from '../utils/response';
import { fromQuery, offset, type Pagination } from '../utils/pagination';
import { getDescendantScodes } from './sort';
import { handleSaveContentExt } from './model';
import { nowStr } from '../utils/datetime';
import { sanitizeHtml, stripHtmlTags } from '../utils/sanitize';

/** P2: 字段長度限制（合理略寬，新聞網站場景） */
const FIELD_LENGTH_LIMITS: Record<string, number> = {
  title: 200, subtitle: 200, filename: 100, titlecolor: 20,
  author: 100, source: 100, outlink: 500,
  ico: 500, pics: 2000, picstitle: 500,
  tags: 200, keywords: 200, description: 500,
  gtype: 10, gid: 50, gnote: 200, urlname: 100, enclosure: 500,
};

/** 校驗字段長度，返回錯誤消息或 null */
function validateFieldLengths(body: Record<string, unknown>): string | null {
  for (const [field, maxLen] of Object.entries(FIELD_LENGTH_LIMITS)) {
    const val = body[field];
    if (typeof val === 'string' && val.length > maxLen) {
      return `字段 ${field} 超過最大長度 ${maxLen} 字（當前 ${val.length} 字）`;
    }
  }
  return null;
}

/** 公開內容列表 API（僅返回摘要字段，排除 content 正文，減小響應體積） */
export async function handleListContents(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const scode = params.get('scode') || '';
  const keyword = params.get('keyword') || '';
  const istop = params.get('istop');
  const isrecommend = params.get('isrecommend');
  const order = params.get('order') || 'date';

  // 列表字段（僅排除 content 正文，其餘字段全部返回）
  const summaryFields = 'c.id, c.acode, c.scode, c.subscode, c.title, c.titlecolor, c.subtitle, c.filename, c.author, c.source, c.outlink, c.date, c.ico, c.pics, c.picstitle, c.tags, c.enclosure, c.keywords, c.description, c.sorting, c.status, c.istop, c.isrecommend, c.isheadline, c.visits, c.likes, c.oppose, c.create_user, c.update_user, c.create_time, c.update_time, c.gtype, c.gid, c.gnote, c.urlname';

  const conditions: string[] = ["c.status = '1'", "c.scode != ''"];
  const binds: (string | number)[] = [];

  // 欄目篩選 (含子孫欄目)
  if (scode) {
    const scodes = await getDescendantScodes(db, scode);
    if (scodes.length === 0) {
      return okList([], createMeta(pagination.page, pagination.pagesize, 0), '成功');
    }
    const placeholders = scodes.map(() => '?').join(',');
    conditions.push(`c.scode IN (${placeholders})`);
    binds.push(...scodes);
  }

  // 關鍵詞搜索
  if (keyword) {
    conditions.push('(c.title LIKE ? OR c.tags LIKE ?)');
    const kw = `%${keyword}%`;
    binds.push(kw, kw);
  }

  // 置頂篩選
  if (istop) {
    conditions.push('c.istop = ?');
    binds.push(istop);
  }

  // 推薦篩選
  if (isrecommend) {
    conditions.push('c.isrecommend = ?');
    binds.push(isrecommend);
  }

  // 排序（PbootCMS 邏輯：置頂 > 推薦 > 頭條 > 自定義排序 > 日期 > ID）
  const orderClause = order === 'visits' ? 'c.visits DESC, c.id DESC'
    : order === 'sorting' ? 'c.istop DESC, c.isrecommend DESC, c.isheadline DESC, c.sorting ASC, c.id DESC'
    : 'c.istop DESC, c.isrecommend DESC, c.isheadline DESC, c.sorting ASC, c.date DESC, c.id DESC';

  const whereClause = conditions.join(' AND ');
  const off = offset(pagination);

  // 查詢列表（摘要字段，排除 content 正文）
  const listSql = `SELECT ${summaryFields} FROM ay_content c WHERE ${whereClause} ORDER BY ${orderClause} LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  // 查詢總數
  const countSql = `SELECT COUNT(*) as total FROM ay_content c WHERE ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 內容詳情 (公開接口，支持數字 ID 或 slug/filename 查詢)
 *  v1.7.9+：前端 Nuxt 靜態打包需要通過 slug 查詢文章詳情
 *  - 參數為純數字 → 按 id 查詢
 *  - 參數為非數字字符串 → 按 filename (slug) 查詢
 *  ⚠️ slug 對應的是 ay_content.filename 字段（PbootCMS 約定），不是 urlname
 *     urlname 在 PbootCMS 中用於欄目（ay_content_sort.urlname），文章層面很少使用
 *
 *  v1.8.1+：參考 PbootCMS ParserModel.getContent()，欄目名稱和擴展字段直接平鋪到 content 對象中
 *  - sortname / sortfilename：來自 ay_content_sort（PbootCMS 用 b.name as sortname）
 *  - ext_*：來自 ay_content_ext，僅合併有值的字段（null 不返回，避免一堆無用 null）
 *  - prev/next：限制在同欄目（含子孫欄目）範圍內（PbootCMS getSubScodes 邏輯）
 */
export async function handleContentDetail(
  db: D1Database,
  idOrSlug: string,
  track: boolean,
): Promise<Response> {
  const isNumericId = /^\d+$/.test(idOrSlug);
  let content: Record<string, unknown> & { visits?: number; id?: number } | null;

  if (isNumericId) {
    content = await db.prepare(
      "SELECT * FROM ay_content WHERE id = ? AND status = '1'",
    ).bind(Number(idOrSlug)).first();
  } else {
    // slug 查詢（filename 字段，已有索引 idx_content_filename）
    content = await db.prepare(
      "SELECT * FROM ay_content WHERE filename = ? AND status = '1'",
    ).bind(idOrSlug).first();
  }

  if (!content) return notFound('內容不存在');

  const contentId = content.id as number;
  const contentScode = (content.scode as string) || '';

  // 累加訪問量
  if (track) {
    await db.prepare('UPDATE ay_content SET visits = visits + 1 WHERE id = ?').bind(contentId).run();
    content.visits = (content.visits || 0) + 1;
  }

  // 查詢歸屬欄目名稱，平鋪到 content 對象（參考 PbootCMS: b.name as sortname, b.filename as sortfilename）
  if (contentScode) {
    const sortInfo = await db.prepare(
      'SELECT name, subname, filename, mcode, pcode FROM ay_content_sort WHERE scode = ? LIMIT 1',
    ).bind(contentScode).first<Record<string, unknown>>();
    if (sortInfo) {
      content.sortname = sortInfo.name || '';
      content.subsortname = sortInfo.subname || '';
      content.sortfilename = sortInfo.filename || '';
      content.mcode = sortInfo.mcode || '';
      content.pcode = sortInfo.pcode || '';
    }
  }

  // 查詢自定義擴展字段值，將有值的 ext_* 字段平鋪到 content 對象（參考 PbootCMS: e.* JOIN）
  // 僅合併非 null 的字段，避免返回一堆無用的 null（如 ext_price/ext_type 等硬編碼列）
  const extRow = await db.prepare(
    'SELECT * FROM ay_content_ext WHERE contentid = ? LIMIT 1',
  ).bind(contentId).first<Record<string, unknown>>();
  if (extRow) {
    for (const [key, value] of Object.entries(extRow)) {
      if (key.startsWith('ext_') && value !== null && value !== undefined && value !== '') {
        content[key] = value;
      }
    }
  }

  // 查詢上一篇/下一篇（限制在同欄目及子孫欄目範圍內，參考 PbootCMS getSubScodes 邏輯）
  let prev: Record<string, unknown> | null = null;
  let next: Record<string, unknown> | null = null;

  if (contentScode) {
    const scodeList = await getDescendantScodes(db, contentScode);
    if (scodeList.length > 0) {
      const placeholders = scodeList.map(() => '?').join(',');
      // 上一篇：同欄目樹範圍內 id 比當前小的最近一篇
      prev = await db.prepare(
        `SELECT id, title, filename, date FROM ay_content WHERE id < ? AND status = '1' AND scode IN (${placeholders}) ORDER BY id DESC LIMIT 1`,
      ).bind(contentId, ...scodeList).first();
      // 下一篇：同欄目樹範圍內 id 比當前大的最近一篇
      next = await db.prepare(
        `SELECT id, title, filename, date FROM ay_content WHERE id > ? AND status = '1' AND scode IN (${placeholders}) ORDER BY id ASC LIMIT 1`,
      ).bind(contentId, ...scodeList).first();
    }
  }

  return okData({ content, prev, next }, '成功');
}

/** 批量獲取內容列表（靜態打包專用，pagesize 最大 500）
 *  與 handleListContents 區別：放寬 pagesize 上限，專供 Nuxt 靜態生成時批量拉取
 *  前端使用：先調用此端點獲取所有文章 ID/slug 列表，再逐一調用詳情 API 獲取正文
 */
export async function handleListAllContents(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const pagesize = Math.min(500, Math.max(1, parseInt(params.get('pagesize') || '200', 10) || 200));
  const scode = params.get('scode') || '';
  const order = params.get('order') || 'date';

  // 摘要字段（同列表 API，排除 content 正文）
  const summaryFields = 'c.id, c.acode, c.scode, c.subscode, c.title, c.titlecolor, c.subtitle, c.filename, c.author, c.source, c.outlink, c.date, c.ico, c.pics, c.picstitle, c.tags, c.enclosure, c.keywords, c.description, c.sorting, c.status, c.istop, c.isrecommend, c.isheadline, c.visits, c.likes, c.oppose, c.create_user, c.update_user, c.create_time, c.update_time, c.gtype, c.gid, c.gnote, c.urlname';

  const conditions: string[] = ["c.status = '1'", "c.scode != ''"];
  const binds: (string | number)[] = [];

  // 欄目篩選 (含子孫欄目)
  if (scode) {
    const scodes = await getDescendantScodes(db, scode);
    if (scodes.length === 0) {
      return okList([], createMeta(page, pagesize, 0), '成功');
    }
    const placeholders = scodes.map(() => '?').join(',');
    conditions.push(`c.scode IN (${placeholders})`);
    binds.push(...scodes);
  }

  // 排序
  const orderClause = order === 'visits' ? 'c.visits DESC, c.id DESC'
    : order === 'sorting' ? 'c.istop DESC, c.isrecommend DESC, c.isheadline DESC, c.sorting ASC, c.id DESC'
    : 'c.istop DESC, c.isrecommend DESC, c.isheadline DESC, c.sorting ASC, c.date DESC, c.id DESC';

  const whereClause = conditions.join(' AND ');
  const off = (page - 1) * pagesize;

  const listSql = `SELECT ${summaryFields} FROM ay_content c WHERE ${whereClause} ORDER BY ${orderClause} LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_content c WHERE ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(page, pagesize, total), '成功');
}

/** 後台內容詳情（無 status 過濾、無訪問量追蹤、不被 Workers Cache 緩存）
 *  專供編輯頁面載入使用，確保讀到最新數據，避免邊緣緩存導致字段為空
 */
export async function handleAdminContentDetail(
  db: D1Database,
  id: number,
): Promise<Response> {
  const content = await db.prepare(
    'SELECT * FROM ay_content WHERE id = ?',
  ).bind(id).first();

  if (!content) return notFound('內容不存在');
  return okData({ content }, '成功');
}

/** 後台內容列表 (含草稿和回收站, 支持按模型 mcode 過濾)
 *  參考 PbootCMS/Go 版邏輯: 通過 mcode 過濾欄目, 再按欄目查內容
 *  Go版: query.Where("scode IN (SELECT scode FROM ay_content_sort WHERE mcode = ?)", mcode)
 */
export async function handleAdminListContents(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const scode = params.get('scode') || '';
  const mcode = params.get('mcode') || '';
  const keyword = params.get('keyword') || '';
  const status = params.get('status') || '1';

  const conditions: string[] = ["scode != ''"];
  const binds: (string | number)[] = [];

  // 狀態篩選
  if (status === 'all') {
    conditions.push("status >= '0'");
  } else if (status === 'trash') {
    conditions.push("status = '-1'");
  } else {
    conditions.push('status = ?');
    binds.push(status);
  }

  // 模型篩選 (按 mcode 過濾欄目, 參考 Go 版子查詢)
  if (mcode) {
    conditions.push('scode IN (SELECT scode FROM ay_content_sort WHERE mcode = ?)');
    binds.push(mcode);
  }

  // 欄目篩選（含子孫欄目，與公開 API 邏輯一致）
  if (scode) {
    const scodes = await getDescendantScodes(db, scode);
    if (scodes.length === 0) {
      return okList([], createMeta(pagination.page, pagination.pagesize, 0), '成功');
    }
    const placeholders = scodes.map(() => '?').join(',');
    conditions.push(`scode IN (${placeholders})`);
    binds.push(...scodes);
  }

  if (keyword) {
    conditions.push('(title LIKE ? OR tags LIKE ?)');
    const kw = `%${keyword}%`;
    binds.push(kw, kw);
  }

  const whereClause = conditions.join(' AND ');
  const off = offset(pagination);

  // 後台列表需要返回所有字段（含 content 正文，供預覽/編輯）
  const listSql = `SELECT * FROM ay_content WHERE ${whereClause} ORDER BY istop DESC, isrecommend DESC, isheadline DESC, sorting ASC, date DESC, id DESC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_content WHERE ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 新增內容 (含擴展字段保存，全字段寫入) */
export async function handleCreateContent(
  db: D1Database,
  body: { title?: string; scode?: string; content?: string; date?: string; status?: string; istop?: string; isrecommend?: string; isheadline?: string; sorting?: string; ext_fields?: Record<string, unknown>; [key: string]: unknown },
  acode: string = 'endoscopy',
  operator: string = '',
): Promise<Response> {
  const title = body.title;
  if (!title) return err('缺少 title 參數', 1001);

  // P2: 字段長度校驗
  const lengthError = validateFieldLengths(body);
  if (lengthError) return err(lengthError, 1001);

  const scode = body.scode || '';
  const now = nowStr();
  const date = body.date || now;

  // P1: HTML 淨化（content 用 sanitizeHtml 保留富文本，description/keywords 剝離標籤）
  const safeContent = sanitizeHtml(body.content || '');
  const safeDescription = stripHtmlTags(body.description || '');
  const safeKeywords = stripHtmlTags(body.keywords || '');

  // 全字段 INSERT（與前端表單字段一一對應，避免創建時丟失 author/source/ico/filename 等）
  const result = await db.prepare(
    "INSERT INTO ay_content (acode, scode, title, titlecolor, subtitle, filename, author, source, outlink, ico, content, tags, keywords, description, date, status, istop, isrecommend, isheadline, sorting, visits, likes, oppose, gtype, gid, create_user, update_user, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '4', '', ?, ?, ?, ?)",
  ).bind(
    acode, scode, title,
    body.titlecolor || '',
    body.subtitle || '',
    body.filename || '',
    body.author || '',
    body.source || '',
    body.outlink || '',
    body.ico || '',
    safeContent,
    body.tags || '',
    safeKeywords,
    safeDescription,
    date,
    body.status || '1',
    body.istop || '0',
    body.isrecommend || '0',
    body.isheadline || '0',
    body.sorting || '255',
    operator, operator,
    now, now,
  ).run();

  if (result.meta.changes > 0) {
    // 保存擴展字段 (如果存在且為對象)
    const extFields = body.ext_fields;
    if (extFields && typeof extFields === 'object' && Object.keys(extFields).length > 0) {
      const contentId = result.meta.last_row_id;
      if (contentId) {
        await handleSaveContentExt(db, contentId, extFields);
      }
    }
    return ok('內容創建成功');
  }
  return err('內容創建失敗', 1005);
}

/** 修改內容 (白名單字段動態 UPDATE, 含擴展字段保存) */
export async function handleUpdateContent(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
  operator: string = '',
): Promise<Response> {
  try {
    // P2: 字段長度校驗
    const lengthError = validateFieldLengths(body);
    if (lengthError) return err(lengthError, 1001);

    const now = nowStr();

    const allowedFields = [
      'title', 'titlecolor', 'subtitle', 'filename', 'scode', 'subscode',
      'author', 'source', 'outlink', 'date', 'ico', 'pics', 'picstitle',
      'content', 'tags', 'enclosure', 'keywords', 'description',
      'sorting', 'status', 'istop', 'isrecommend', 'isheadline',
      'gtype', 'gid', 'gnote', 'urlname',
    ];

    const sets: string[] = [];
    const binds: (string | number)[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        let val = body[field];
        // sorting 為整數類型，其餘為字串
        if (field === 'sorting' && typeof val === 'number') {
          sets.push(`${field} = ?`);
          binds.push(String(val));
        } else if (typeof val === 'string') {
          // P1: HTML 淨化（content 保留富文本標籤，description/keywords 剝離標籤）
          if (field === 'content') {
            val = sanitizeHtml(val);
          } else if (field === 'description' || field === 'keywords') {
            val = stripHtmlTags(val);
          }
          sets.push(`${field} = ?`);
          binds.push(val);
        }
        // null/undefined/object 類型跳過，避免寫入異常
      }
    }

    if (sets.length > 0) {
      sets.push('update_user = ?');
      binds.push(operator);
      sets.push('update_time = ?');
      binds.push(now);
      binds.push(id);
      const sql = `UPDATE ay_content SET ${sets.join(', ')} WHERE id = ?`;
      await db.prepare(sql).bind(...binds).run();
    }

    // 保存擴展字段 (如果存在且為對象)
    const extFields = body.ext_fields;
    if (extFields && typeof extFields === 'object' && Object.keys(extFields).length > 0) {
      await handleSaveContentExt(db, id, extFields as Record<string, unknown>);
    }

    return ok('內容更新成功');
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    return err(`內容更新失敗: ${errorMsg}`, 1005);
  }
}

/** 刪除內容 (軟刪除到回收站: status='-1') */
export async function handleDeleteContent(db: D1Database, id: number): Promise<Response> {
  const now = nowStr();
  const result = await db.prepare(
    "UPDATE ay_content SET status = '-1', update_time = ? WHERE id = ? AND CAST(status AS INTEGER) >= 0",
  ).bind(now, id).run();

  if (result.meta.changes > 0) {
    return ok('已移入回收站');
  }
  return err('內容不存在或已在回收站中', 1004);
}

// 注意: handleRestoreContent 和 handlePermanentDeleteContent 已移至 ./model.ts
// model.ts 版本包含更嚴格的 status 守衛條件, 確保回收站操作安全

/**
 * 獲取所有歷史標籤（從 ay_content.tags 字段提取，去重排序）
 * 用於內容編輯器的標籤快速補充功能
 */
export async function handleAllContentTags(db: D1Database): Promise<Response> {
  try {
    const result = await db.prepare(
      "SELECT tags FROM ay_content WHERE tags IS NOT NULL AND tags != '' AND CAST(status AS INTEGER) >= 0",
    ).all<{ tags: string }>();

    // 提取、分割、去重
    const tagSet = new Set<string>();
    for (const row of result.results) {
      if (!row.tags) continue;
      const parts = row.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      for (const tag of parts) {
        tagSet.add(tag);
      }
    }

    const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return okData(tags, '成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`獲取標籤列表失敗: ${msg}`, 1005);
  }
}
