/**
 * 模型管理 / 擴展字段管理 / 內容自定義字段 / 內容回收站 服務
 *
 * 表結構注意事項 (來自 migrations/0001_init.sql):
 *   - ay_model:       內容模型表 (無 sorting 字段, 無 acode 字段; 有 issystem 字段標識系統模型)
 *   - ay_extfield:    擴展字段定義表 (有 sorting 字段, 無 acode 字段, 無時間字段)
 *   - ay_content_ext: 內容擴展字段值表 (extid, contentid + 3 個硬編碼列 ext_price/ext_type/ext_color
 *                     + 通過 ALTER TABLE 動態新增的 ext_* 列)
 *   - ay_content:     文章表 (回收站通過 status='-1' 標識; status='1'=已發布, status='0'=草稿)
 *
 * 安全規則:
 *   - 所有 SQL 使用參數化查詢 (.bind()), 禁止字符串拼接用戶輸入到 SQL 值位置
 *   - 動態列名 (ALTER TABLE / 動態 UPDATE/INSERT) 必須通過 /^ext_[a-zA-Z0-9_]+$/ 驗證
 *   - 擴展字段名自動添加 ext_ 前綴, 確保與硬編碼列命名一致
 */
import type { D1Database } from '@cloudflare/workers-types';
import { okData, okList, ok, err, notFound, createMeta } from '../utils/response';
import { fromQuery, offset, type Pagination } from '../utils/pagination';
import { nowStr } from '../utils/datetime';

/** 擴展字段列名合法性校驗 (僅允許 ext_ 前綴 + 字母數字下劃線) */
const EXT_FIELD_PATTERN = /^ext_[a-zA-Z0-9_]+$/;

/** 校驗動態列名是否合法 (用於 ALTER TABLE / 動態 UPDATE/INSERT 中的列名) */
function isValidExtColumn(name: string): boolean {
  return EXT_FIELD_PATTERN.test(name);
}

// ============================================================================
// 模塊 1: 內容模型管理 (ay_model)
// 注意: ay_model 無 sorting 字段, 列表按 id ASC 排序
// ============================================================================

/**
 * 自動生成 mcode (取最大數字 mcode + 1, 默認從 6 開始)
 * PbootCMS 默認系統模型 mcode 為 1~5, 新增模型從 6 開始
 */
async function generateMcode(db: D1Database): Promise<string> {
  const last = await db.prepare(
    'SELECT mcode FROM ay_model ORDER BY CAST(mcode AS INTEGER) DESC LIMIT 1',
  ).first<{ mcode: string }>();
  if (!last || !last.mcode) return '6';
  const num = parseInt(last.mcode, 10);
  return isNaN(num) ? '6' : String(num + 1);
}

/** 後台模型列表 (分頁, 支持 status 篩選; ay_model 無 sorting 字段, 按 id ASC 排序) */
export async function handleListModels(
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

  const listSql = `SELECT * FROM ay_model ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_model ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 獲取全部啟用模型 (不分頁, 用於下拉選擇) */
export async function handleListModelAll(db: D1Database): Promise<Response> {
  const result = await db.prepare(
    "SELECT * FROM ay_model WHERE status = '1' ORDER BY id ASC",
  ).all();
  return okData(result.results, '成功');
}

/** 後台模型詳情 */
export async function handleGetModel(db: D1Database, id: number): Promise<Response> {
  const row = await db.prepare('SELECT * FROM ay_model WHERE id = ?').bind(id).first();
  if (!row) return notFound('模型不存在');
  return okData(row, '成功');
}

/** 新增模型 (自動生成 mcode, issystem 固定為 '0') */
export async function handleCreateModel(
  db: D1Database,
  body: { name?: string; type?: string; urlname?: string; listtpl?: string; contenttpl?: string; status?: string },
): Promise<Response> {
  const name = body.name;
  if (!name) return err('缺少 name 參數', 1001);

  const now = nowStr();
  const mcode = await generateMcode(db);

  const result = await db.prepare(
    "INSERT INTO ay_model (mcode, name, type, urlname, listtpl, contenttpl, status, issystem, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, '0', ?, ?)",
  ).bind(
    mcode,
    name,
    body.type || '2',
    body.urlname || '',
    body.listtpl || '',
    body.contenttpl || '',
    body.status || '1',
    now,
    now,
  ).run();

  if (result.meta.changes > 0) {
    return ok('模型創建成功');
  }
  return err('模型創建失敗', 1005);
}

/** 修改模型 (白名單字段動態 UPDATE; 系統模型禁止修改 type) */
export async function handleUpdateModel(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  // 查詢模型是否存在及是否系統模型
  const existing = await db.prepare('SELECT * FROM ay_model WHERE id = ?').bind(id).first<{ issystem?: string }>();
  if (!existing) return notFound('模型不存在');

  const now = nowStr();
  const allowedFields = ['name', 'type', 'urlname', 'listtpl', 'contenttpl', 'status'];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      // 系統模型 (issystem='1') 禁止修改 type
      if (field === 'type' && existing.issystem === '1') {
        continue;
      }
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

  const sql = `UPDATE ay_model SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('模型更新成功');
}

/** 刪除模型 (系統模型禁止刪除; 有欄目引用時禁止刪除) */
export async function handleDeleteModel(db: D1Database, id: number): Promise<Response> {
  const existing = await db.prepare('SELECT * FROM ay_model WHERE id = ?').bind(id).first<{ mcode?: string; issystem?: string }>();
  if (!existing) return notFound('模型不存在');

  // 系統模型禁止刪除
  if (existing.issystem === '1') {
    return err('系統模型禁止刪除', 1007);
  }

  // 檢查是否有欄目使用此模型 (ay_content_sort.mcode)
  if (existing.mcode) {
    const sortCount = await db.prepare(
      'SELECT COUNT(*) as total FROM ay_content_sort WHERE mcode = ?',
    ).bind(existing.mcode).first<{ total: number }>();
    if (sortCount && sortCount.total > 0) {
      return err('該模型下存在欄目,無法刪除', 1008);
    }
  }

  await db.prepare('DELETE FROM ay_model WHERE id = ?').bind(id).run();
  return ok('模型刪除成功');
}

// ============================================================================
// 模塊 2: 擴展字段管理 (ay_extfield)
// 注意: 無 acode 字段, 無時間字段; 有 sorting 字段
// ============================================================================

/** 後台擴展字段列表 (分頁, 支持 mcode 篩選, ORDER BY sorting ASC, id ASC)
 *  默認僅顯示啟用字段（status='1'），傳 include_disabled=1 可顯示全部 */
export async function handleListExtFields(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const mcode = params.get('mcode') || '';
  const includeDisabled = params.get('include_disabled') === '1';

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (mcode) {
    conditions.push('mcode = ?');
    binds.push(mcode);
  }
  if (!includeDisabled) {
    conditions.push("status = '1'");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const off = offset(pagination);

  const listSql = `SELECT * FROM ay_extfield ${whereClause} ORDER BY sorting ASC, id ASC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_extfield ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 新增擴展字段 (自動添加 ext_ 前綴; 插入記錄後 ALTER TABLE 添加物理列) */
export async function handleCreateExtField(
  db: D1Database,
  body: { mcode?: string; name?: string; field?: string; type?: string; description?: string; value?: string; scode?: string; required?: string; sorting?: number; status?: string },
): Promise<Response> {
  const name = body.name;
  const fieldRaw = body.field;
  if (!name) return err('缺少 name 參數', 1001);
  if (!fieldRaw) return err('缺少 field 參數', 1001);

  // 自動添加 ext_ 前綴 (與硬編碼列 ext_price/ext_type/ext_color 命名一致)
  let fieldName = fieldRaw;
  if (!fieldName.startsWith('ext_')) {
    fieldName = `ext_${fieldName}`;
  }

  // 校驗列名合法性 (防止 SQL 注入: 列名無法參數化, 必須白名單校驗)
  if (!isValidExtColumn(fieldName)) {
    return err('字段名只能包含字母、數字和下劃線, 且必須以 ext_ 開頭', 1002);
  }

  try {
    const sorting = typeof body.sorting === 'number' ? body.sorting : 255;

    // 1. 插入擴展字段定義記錄
    const result = await db.prepare(
      'INSERT INTO ay_extfield (mcode, name, field, type, description, value, scode, required, sorting, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      body.mcode || '',
      name,
      fieldName,
      body.type || '1',
      body.description || '',
      body.value || '',
      body.scode || '',
      body.required || '0',
      sorting,
      body.status || '1',
    ).run();

    if (result.meta.changes === 0) {
      return err('擴展字段創建失敗', 1005);
    }

    // 2. 檢查 ay_content_ext 表中是否已存在該列 (冪等處理)
    const columns = await db.prepare('PRAGMA table_info(ay_content_ext)').all();
    const columnExists = columns.results.some((col: unknown) => {
      return (col as { name?: string }).name === fieldName;
    });

    // 3. 不存在則 ALTER TABLE 添加物理列 (SQLite ALTER TABLE ADD COLUMN)
    if (!columnExists) {
      await db.prepare(`ALTER TABLE ay_content_ext ADD COLUMN ${fieldName} TEXT`).run();
    }

    return ok('擴展字段創建成功');
  } catch (e) {
    return err(`擴展字段創建失敗: ${(e as Error).message}`, 1005);
  }
}

/** 修改擴展字段 (白名單字段動態 UPDATE; 禁止修改 field 列名 — SQLite 無法重命名列) */
export async function handleUpdateExtField(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const allowedFields = ['name', 'description', 'value', 'scode', 'required', 'sorting', 'status'];

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

  binds.push(id);
  const sql = `UPDATE ay_extfield SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('擴展字段更新成功');
}

/** 刪除擴展字段（物理刪除定義 + 嘗試 DROP COLUMN + 清理數據）
 *  注意：SQLite 3.35.0+ 支持 ALTER TABLE DROP COLUMN，D1 基於較新版本應支持
 *  若 DROP COLUMN 失敗（舊版本），則將列值設為 NULL 並物理刪除字段定義 */
export async function handleDeleteExtField(db: D1Database, id: number): Promise<Response> {
  // 1. 查找字段定義
  const field = await db.prepare('SELECT field FROM ay_extfield WHERE id = ?').bind(id).first<{ field: string }>();
  if (!field) return notFound('擴展字段不存在');

  const columnName = field.field;

  // 2. 安全校驗列名（防止 SQL 注入，列名無法參數化）
  if (!isValidExtColumn(columnName)) {
    return err('字段名不合法，無法刪除', 1001);
  }

  // 3. 嘗試 DROP COLUMN（SQLite 3.35.0+）
  try {
    await db.prepare(`ALTER TABLE ay_content_ext DROP COLUMN ${columnName}`).run();
  } catch {
    // DROP COLUMN 失敗 → 清理該列的數據為 NULL（保留物理列但清空數據）
    try {
      await db.prepare(`UPDATE ay_content_ext SET ${columnName} = NULL`).run();
    } catch {
      /* 忽略，可能列不存在 */
    }
  }

  // 4. 物理刪除字段定義
  await db.prepare('DELETE FROM ay_extfield WHERE id = ?').bind(id).run();

  return ok('擴展字段已徹底刪除');
}

/** 批量更新擴展字段排序 */
export async function handleBatchUpdateExtFieldSorting(
  db: D1Database,
  items: Array<{ id: number; sorting: number }>,
): Promise<Response> {
  if (!Array.isArray(items) || items.length === 0) {
    return err('沒有需要更新的排序', 1001);
  }

  const stmt = db.prepare('UPDATE ay_extfield SET sorting = ? WHERE id = ?');
  const batchPromises = items.map((item) =>
    stmt.bind(Math.max(0, Math.floor(item.sorting)), item.id).run(),
  );
  await Promise.all(batchPromises);

  return ok(`批量更新 ${items.length} 項排序成功`);
}

// ============================================================================
// 模塊 3: 內容自定義字段集成 (ay_content_ext + ay_extfield)
// ============================================================================

/**
 * 根據欄目 scode 獲取關聯的擴展字段定義
 * 流程: scode -> ay_content_sort.mcode -> ay_extfield (status='1')
 * 過濾: extfield.scode 為空 = 適用所有欄目; 否則目標 scode 需在 scode 逗號分隔列表中
 */
export async function handleGetContentExtFields(
  db: D1Database,
  scode: string,
): Promise<Response> {
  // 通過欄目 scode 查找關聯的模型 mcode
  const sort = await db.prepare(
    'SELECT mcode FROM ay_content_sort WHERE scode = ? LIMIT 1',
  ).bind(scode).first<{ mcode?: string }>();

  if (!sort || !sort.mcode) {
    return okData([], '成功');
  }

  // 查詢該模型下所有啟用的擴展字段
  const result = await db.prepare(
    "SELECT * FROM ay_extfield WHERE mcode = ? AND status = '1' ORDER BY sorting ASC, id ASC",
  ).bind(sort.mcode).all();

  // 過濾: scode 為空 = 適用所有欄目; 否則目標 scode 需在 scode 逗號分隔列表中
  const allFields = result.results as Array<Record<string, unknown>>;
  const fields = allFields.filter((row) => {
    const fieldScode = typeof row.scode === 'string' ? row.scode : '';
    if (!fieldScode) return true; // 空 = 適用所有欄目
    // scode 可能是逗號分隔列表 (如 "1,3,5")
    const scodeList = fieldScode.split(',').map((s) => s.trim()).filter(Boolean);
    return scodeList.includes(scode);
  });

  return okData(fields, '成功');
}

/** 獲取內容的擴展字段值 (返回 field_name -> value 映射, 僅 ext_ 前綴字段) */
export async function handleGetContentExt(
  db: D1Database,
  contentId: number,
): Promise<Response> {
  const row = await db.prepare(
    'SELECT * FROM ay_content_ext WHERE contentid = ? LIMIT 1',
  ).bind(contentId).first<Record<string, unknown>>();

  if (!row) {
    return okData({}, '成功');
  }

  // 構建 field_name -> value 的映射 (僅 ext_ 前綴字段, 排除 extid/contentid)
  const extMap: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('ext_')) {
      extMap[key] = value;
    }
  }

  return okData(extMap, '成功');
}

/** 保存內容的擴展字段值 (Upsert: 存在則 UPDATE, 不存在則 INSERT; 動態 SQL) */
export async function handleSaveContentExt(
  db: D1Database,
  contentId: number,
  extData: Record<string, unknown>,
): Promise<Response> {
  // 過濾並校驗字段名 (必須匹配 ext_ 前綴模式), 收集合法字段和值
  const fields: string[] = [];
  const values: (string | number)[] = [];

  for (const [key, value] of Object.entries(extData)) {
    // 跳過空值
    if (value === undefined || value === null) continue;
    // 校驗列名合法性 (防止 SQL 注入: 列名無法參數化)
    if (!isValidExtColumn(key)) continue;
    // 僅接受字符串/數字類型值
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    fields.push(key);
    values.push(value);
  }

  if (fields.length === 0) {
    return err('沒有需要保存的擴展字段', 1001);
  }

  try {
    // 檢查是否已有記錄
    const existing = await db.prepare(
      'SELECT extid FROM ay_content_ext WHERE contentid = ?',
    ).bind(contentId).first();

    if (existing) {
      // 動態 UPDATE: UPDATE ay_content_ext SET ext_xxx=?, ext_yyy=? WHERE contentid=?
      const setClause = fields.map((f) => `${f} = ?`).join(', ');
      await db.prepare(
        `UPDATE ay_content_ext SET ${setClause} WHERE contentid = ?`,
      ).bind(...values, contentId).run();
    } else {
      // 動態 INSERT: INSERT INTO ay_content_ext (contentid, ext_xxx, ext_yyy) VALUES (?, ?, ?)
      const placeholders = fields.map(() => '?').join(', ');
      await db.prepare(
        `INSERT INTO ay_content_ext (contentid, ${fields.join(', ')}) VALUES (?, ${placeholders})`,
      ).bind(contentId, ...values).run();
    }

    return ok('擴展字段保存成功');
  } catch (e) {
    return err(`擴展字段保存失敗: ${(e as Error).message}`, 1005);
  }
}

// ============================================================================
// 模塊 4: 內容回收站 (ay_content, status='-1')
// 注意: 回收站操作均帶 status 條件守衛, 確保僅操作回收站中的內容
// ============================================================================

/** 回收站內容列表 (status='-1', 支持 scode/keyword 篩選, ORDER BY update_time DESC, id DESC) */
export async function handleListTrashedContents(
  db: D1Database,
  params: URLSearchParams,
): Promise<Response> {
  const pagination = fromQuery(params);
  const scode = params.get('scode') || '';
  const keyword = params.get('keyword') || '';

  const conditions: string[] = ["status = '-1'"];
  const binds: (string | number)[] = [];

  if (scode) {
    conditions.push('scode = ?');
    binds.push(scode);
  }

  if (keyword) {
    conditions.push('(title LIKE ? OR tags LIKE ?)');
    const kw = `%${keyword}%`;
    binds.push(kw, kw);
  }

  const whereClause = conditions.join(' AND ');
  const off = offset(pagination);

  const listSql = `SELECT * FROM ay_content WHERE ${whereClause} ORDER BY update_time DESC, id DESC LIMIT ? OFFSET ?`;
  const listResult = await db.prepare(listSql).bind(...binds, pagination.pagesize, off).all();

  const countSql = `SELECT COUNT(*) as total FROM ay_content WHERE ${whereClause}`;
  const countResult = await db.prepare(countSql).bind(...binds).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return okList(listResult.results, createMeta(pagination.page, pagination.pagesize, total), '成功');
}

/** 移入回收站 (軟刪除: status='-1'; 僅當 status >= 0 時操作, 避免重複) */
export async function handleTrashContent(db: D1Database, id: number): Promise<Response> {
  const now = nowStr();
  // 僅當 status >= 0 (已發布或草稿) 時才移入回收站
  const result = await db.prepare(
    "UPDATE ay_content SET status = '-1', update_time = ? WHERE id = ? AND CAST(status AS INTEGER) >= 0",
  ).bind(now, id).run();

  if (result.meta.changes > 0) {
    return ok('已移入回收站');
  }
  return err('內容不存在或已在回收站中', 1004);
}

/** 從回收站恢復 (status='0' 恢復為草稿; 僅當 status='-1' 時操作) */
export async function handleRestoreContent(db: D1Database, id: number): Promise<Response> {
  const now = nowStr();
  const result = await db.prepare(
    "UPDATE ay_content SET status = '0', update_time = ? WHERE id = ? AND status = '-1'",
  ).bind(now, id).run();

  if (result.meta.changes > 0) {
    return ok('已恢復為草稿');
  }
  return err('內容不在回收站中', 1004);
}

/** 永久刪除 (物理刪除; 僅允許刪除回收站中的內容; 同步刪除擴展字段) */
export async function handlePermanentDeleteContent(db: D1Database, id: number): Promise<Response> {
  // 僅允許永久刪除回收站中的內容 (status='-1')
  const result = await db.prepare(
    "DELETE FROM ay_content WHERE id = ? AND status = '-1'",
  ).bind(id).run();

  if (result.meta.changes === 0) {
    return err('內容不在回收站中,無法永久刪除', 1004);
  }

  // 同步刪除擴展字段記錄 (容錯: 表可能不存在該 contentid 的記錄)
  await db.prepare('DELETE FROM ay_content_ext WHERE contentid = ?').bind(id).run().catch(() => {});

  return ok('已永久刪除');
}
