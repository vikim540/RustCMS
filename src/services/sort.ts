/**
 * 欄目管理服務
 * 遞歸 CTE 查詢子孫欄目 + 內存遞歸構建樹
 */
import type { D1Database } from '@cloudflare/workers-types';
import { okData, ok, err, notFound, createMeta } from '../utils/response';
import { nowStr } from '../utils/datetime';

/** 欄目記錄 */
interface ContentSort {
  id: number;
  acode: string;
  mcode: string;
  pcode: string;
  scode: string;
  name: string;
  subname?: string;
  listtpl?: string;
  contenttpl?: string;
  ico?: string;
  pic?: string;
  title?: string;
  keywords?: string;
  description?: string;
  filename?: string;
  sorting: number;
  status: string;
  outlink?: string;
  def1?: string;
  def2?: string;
  def3?: string;
  create_time?: string;
  update_time?: string;
  gtype: string;
  gid: string;
  urlname?: string;
  [key: string]: unknown;
}

/** 欄目樹節點 (含子欄目) */
interface ContentSortNode extends ContentSort {
  children: ContentSortNode[];
}

/** 獲取欄目列表 (平鋪, 可選按 mcode 過濾) */
async function listSorts(db: D1Database, status?: string, mcode?: string): Promise<ContentSort[]> {
  let sql: string;
  let binds: (string | undefined)[];
  if (status && mcode) {
    sql = 'SELECT * FROM ay_content_sort WHERE acode = ? AND status = ? AND mcode = ? ORDER BY sorting ASC, id ASC';
    binds = ['cn', status, mcode];
  } else if (status) {
    sql = 'SELECT * FROM ay_content_sort WHERE acode = ? AND status = ? ORDER BY sorting ASC, id ASC';
    binds = ['cn', status];
  } else if (mcode) {
    sql = 'SELECT * FROM ay_content_sort WHERE acode = ? AND mcode = ? ORDER BY sorting ASC, id ASC';
    binds = ['cn', mcode];
  } else {
    sql = 'SELECT * FROM ay_content_sort WHERE acode = ? ORDER BY sorting ASC, id ASC';
    binds = ['cn'];
  }
  const result = await db.prepare(sql).bind(...binds).all<ContentSort>();
  return result.results;
}

/** 構建欄目樹 (內存遞歸) */
function buildSortTree(sorts: ContentSort[], parentCode: string): ContentSortNode[] {
  return sorts
    .filter((s) => s.pcode === parentCode)
    .map((s) => ({
      ...s,
      children: buildSortTree(sorts, s.scode),
    }));
}

/** 獲取欄目樹 API (公開,僅啟用) */
export async function handleSortTree(db: D1Database): Promise<Response> {
  const sorts = await listSorts(db, '1');
  const tree = buildSortTree(sorts, '0');
  return okData(tree, '成功');
}

/** 獲取欄目樹 API (管理後台,含禁用, 可選按 mcode 過濾) */
export async function handleSortTreeAll(db: D1Database, mcode?: string): Promise<Response> {
  const sorts = await listSorts(db, undefined, mcode);
  const tree = buildSortTree(sorts, '0');
  return okData(tree, '成功');
}

/** 獲取欄目導航 (公開接口,同樹接口) */
export async function handleNav(db: D1Database): Promise<Response> {
  return handleSortTree(db);
}

/** 獲取單個欄目詳情 */
export async function handleSortDetail(db: D1Database, scode: string): Promise<Response> {
  const stmt = db.prepare(
    "SELECT * FROM ay_content_sort WHERE acode = ? AND status = '1' AND (scode = ? OR filename = ? OR urlname = ?) LIMIT 1",
  ).bind('cn', scode, scode, scode);
  const sort = await stmt.first<ContentSort>();
  if (!sort) return notFound('欄目不存在');
  return okData(sort, '成功');
}

/** 新增欄目 */
export async function handleCreateSort(
  db: D1Database,
  body: { name?: string; pcode?: string; mcode?: string; scode?: string; [key: string]: unknown },
): Promise<Response> {
  const name = body.name;
  if (!name) return err('缺少 name 參數', 1001);

  const pcode = body.pcode || '0';
  const mcode = body.mcode || '2';
  const now = nowStr();

  // 計算同級欄目的最大排序值 + 1（默認從 1 開始）
  const maxResult = await db
    .prepare('SELECT MAX(sorting) as maxSorting FROM ay_content_sort WHERE acode = ? AND pcode = ?')
    .bind('cn', pcode)
    .first<{ maxSorting: number | null }>();
  const newSorting = (maxResult?.maxSorting ?? 0) + 1;

  // 先插入,取得自增 ID 後再回填 scode
  const result = await db.prepare(
    "INSERT INTO ay_content_sort (acode, mcode, pcode, scode, name, sorting, status, gtype, gid, create_time, update_time) VALUES (?, ?, ?, '', ?, ?, '1', '4', '', ?, ?)",
  ).bind('cn', mcode, pcode, name, newSorting, now, now).run();

  if (result.meta.changes > 0) {
    // 用自增 ID 作為 scode (與 PbootCMS 風格一致)
    const newId = result.meta.last_row_id as number;
    await db.prepare('UPDATE ay_content_sort SET scode = ? WHERE id = ?')
      .bind(String(newId), newId).run();
    return ok('欄目創建成功');
  }
  return err('欄目創建失敗', 1005);
}

/** 遞歸 CTE 查詢子孫欄目 scode */
export async function getDescendantScodes(db: D1Database, scode: string): Promise<string[]> {
  const sql = `
    WITH RECURSIVE descendants AS (
      SELECT scode FROM ay_content_sort WHERE scode = ? AND acode = 'cn' AND status = '1'
      UNION ALL
      SELECT s.scode FROM ay_content_sort s
      INNER JOIN descendants d ON s.pcode = d.scode
      WHERE s.acode = 'cn' AND s.status = '1'
    )
    SELECT scode FROM descendants
  `;
  const result = await db.prepare(sql).bind(scode).all<{ scode: string }>();
  return result.results.map((r) => r.scode);
}

/** 修改欄目 (白名單字段動態 UPDATE) */
export async function handleUpdateSort(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  const now = nowStr();

  const allowedFields = [
    'name', 'subname', 'mcode', 'pcode', 'scode', 'listtpl', 'contenttpl',
    'ico', 'pic', 'title', 'keywords', 'description', 'filename',
    'sorting', 'status', 'outlink', 'def1', 'def2', 'def3', 'urlname',
  ];

  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const field of allowedFields) {
    const val = body[field];
    if (val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
      sets.push(`${field} = ?`);
      binds.push(String(val));
    }
  }

  if (sets.length === 0) {
    return err('沒有需要更新的字段', 1001);
  }

  sets.push('update_time = ?');
  binds.push(now);
  binds.push(id);

  const sql = `UPDATE ay_content_sort SET ${sets.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...binds).run();

  return ok('欄目更新成功');
}

/** 刪除欄目（級聯處理：子欄目 + 關聯內容 + 擴展字段值） */
export async function handleDeleteSort(db: D1Database, id: number): Promise<Response> {
  // 1. 查找欄目
  const sort = await db.prepare('SELECT id, scode FROM ay_content_sort WHERE id = ?').bind(id).first<{ id: number; scode: string }>();
  if (!sort) return notFound('欄目不存在');

  // 2. 遞歸 CTE 查詢所有子孫欄目（不限 status，確保禁用的子欄目也被清理）
  const descendantSql = `
    WITH RECURSIVE descendants AS (
      SELECT id, scode FROM ay_content_sort WHERE id = ?
      UNION ALL
      SELECT s.id, s.scode FROM ay_content_sort s
      INNER JOIN descendants d ON s.pcode = d.scode
    )
    SELECT id, scode FROM descendants
  `;
  const descendantResult = await db.prepare(descendantSql).bind(id).all<{ id: number; scode: string }>();
  const allSorts = descendantResult.results;
  const allScodes = allSorts.map((s) => s.scode).filter(Boolean);
  const allIds = allSorts.map((s) => s.id);

  // 3. 刪除所有關聯內容（含擴展字段值）
  if (allScodes.length > 0) {
    // 先刪除擴展字段值
    const extPlaceholder = allScodes.map(() => '?').join(',');
    await db.prepare(`DELETE FROM ay_content_ext WHERE contentid IN (SELECT id FROM ay_content WHERE scode IN (${extPlaceholder}))`)
      .bind(...allScodes).run().catch(() => {});
    // 再刪除內容（物理刪除，不進回收站）
    await db.prepare(`DELETE FROM ay_content WHERE scode IN (${extPlaceholder})`)
      .bind(...allScodes).run();
  }

  // 4. 刪除所有欄目（自身 + 子孫）
  const idPlaceholder = allIds.map(() => '?').join(',');
  await db.prepare(`DELETE FROM ay_content_sort WHERE id IN (${idPlaceholder})`)
    .bind(...allIds).run();

  return ok(`欄目刪除成功（共刪除 ${allIds.length} 個欄目）`);
}

/** 批量更新欄目排序 */
export async function handleBatchUpdateSortSorting(
  db: D1Database,
  items: Array<{ id: number; sorting: number }>,
): Promise<Response> {
  if (!Array.isArray(items) || items.length === 0) {
    return err('沒有需要更新的排序', 1001);
  }

  // 逐條更新（D1 不支持 CASE WHEN 批量更新）
  const stmt = db.prepare('UPDATE ay_content_sort SET sorting = ? WHERE id = ?');
  const batchPromises = items.map((item) =>
    stmt.bind(Math.max(0, Math.floor(item.sorting)), item.id).run(),
  );
  await Promise.all(batchPromises);

  return ok(`批量更新 ${items.length} 項排序成功`);
}
