/**
 * 存儲服務
 * 支持 S3 兼容存儲 (Cloudflare R2 / AWS S3 / MinIO 等)
 *
 * 存儲配置保存在 ay_config 表中:
 *   storage_type   - 存儲類型 (s3/r2/local)
 *   s3_endpoint    - S3 端點
 *   s3_access_key  - 訪問密鑰
 *   s3_secret_key  - 密鑰
 *   s3_bucket      - 存儲桶名
 *   s3_region      - 區域
 *   s3_public_url  - 公共訪問 URL
 */
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { okData, ok, err, createMeta } from '../utils/response';
import { type S3Config, type S3Object, s3PutObject, s3GetObject, s3DeleteObject, s3PresignedUrl, s3ListObjects } from '../utils/s3sig';
import { getAllConfigs, clearConfigCache } from './config';

// ============================================================================
// 媒體庫引用追蹤 (受 Go 版 MediaController 啟發)
// ============================================================================

/** 文件引用欄位白名單: 定義哪些表/欄位可能包含文件路徑 */
interface FileRefColumn {
  col: string;
  label: string;
}
interface FileRefTable {
  table: string;
  idCol: string;
  nameCol: string;
  columns: FileRefColumn[];
}

/** FILE_REFS 是整個媒體庫中「哪些欄位可能含有文件路徑」的唯一權威定義。
 *  getUsedPaths() 和 findUsages() 都從這裡讀取，修改欄位只需改此一處。 */
const FILE_REFS: FileRefTable[] = [
  { table: 'ay_content', idCol: 'id', nameCol: 'title', columns: [{ col: 'ico', label: '封面' }, { col: 'pics', label: '多圖' }, { col: 'enclosure', label: '附件' }] },
  { table: 'ay_content_sort', idCol: 'id', nameCol: 'name', columns: [{ col: 'ico', label: '圖標' }, { col: 'pic', label: '圖片' }] },
  { table: 'ay_slide', idCol: 'id', nameCol: 'title', columns: [{ col: 'pic', label: '輪播圖' }] },
  { table: 'ay_link', idCol: 'id', nameCol: 'name', columns: [{ col: 'logo', label: 'Logo' }] },
  { table: 'ay_site', idCol: 'id', nameCol: 'name', columns: [{ col: 'logo', label: 'Logo' }] },
  { table: 'ay_company', idCol: 'id', nameCol: 'name', columns: [{ col: 'weixin', label: 'WeChat 二維碼' }, { col: 'whatsapp', label: 'WhatsApp 二維碼' }, { col: 'blicense', label: '商業登記證' }] },
];

/** ay_media_mark 建表 SQL (冪等) */
const MEDIA_MARK_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ay_media_mark (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  create_time TEXT NOT NULL DEFAULT (datetime('now'))
);`;

/** 確保 ay_media_mark 表存在 (冪等執行) */
async function ensureMediaMarkTable(db: D1Database): Promise<void> {
  await db.prepare(MEDIA_MARK_TABLE_SQL).run().catch(() => {});
}

/** 標準化文件路徑: 將 URL 或路徑統一為無前導斜線的相對路徑格式。
 *  包含路徑穿越防護: 拒絕包含 .. 的路徑。 */
function normalizeFilePath(val: string): string {
  if (!val) return '';
  let p = val.trim();
  if (!p) return '';
  // 如果是完整 URL, 提取 pathname 部分
  if (p.startsWith('http://') || p.startsWith('https://')) {
    try {
      const u = new URL(p);
      p = u.pathname;
    } catch {
      return '';
    }
  }
  // 去除前導斜線和 ./
  p = p.replace(/^\/+/, '').replace(/^\.\//, '');
  // 路徑穿越防護
  if (p.includes('..')) return '';
  return p;
}

/** 將逗號分隔的多值欄位 (如 ay_content.pics) 逐一拆分並加入集合。
 *  對齊 PbootCMS PHP 原版 explode(',', $value['pics']) 邏輯。 */
function addPathsToSet(set: Set<string>, val: string): void {
  if (!val) return;
  for (const p of val.split(',')) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const np = normalizeFilePath(trimmed);
    if (np) {
      set.add(np);
      set.add('/' + np);
    }
  }
}

/** 從 HTML 內容中提取 img src 引用路徑並加入集合 */
function extractSrcPaths(html: string, set: Set<string>): void {
  if (!html) return;
  const regex = /src=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const src = match[1];
    // 只收集包含 uploads/ 或 upload/ 的路徑 (過濾外部 URL)
    if (src.includes('uploads/') || src.includes('upload/')) {
      const np = normalizeFilePath(src);
      if (np) {
        set.add(np);
        set.add('/' + np);
      }
    }
  }
}

/** 判斷欄位值是否包含目標路徑 (支援逗號分隔的多值欄位) */
function pathMatchesField(fieldVal: string, np: string): boolean {
  if (!fieldVal || !np) return false;
  for (const p of fieldVal.split(',')) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const fv = normalizeFilePath(trimmed);
    if (fv && fv === np) {
      return true;
    }
  }
  return false;
}

/** 判斷 HTML 內容中是否引用了目標圖片路徑 */
function containsImgSrc(html: string, np: string): boolean {
  if (!html || !np) return false;
  return html.includes(np) || html.includes('/' + np);
}

/** 文件使用位置信息 */
export interface MediaUsage {
  table: string;
  id: number;
  name: string;
  field: string;
}

/** 掃描所有 FILE_REFS 表, 收集所有文件 URL/路徑到一個 Set。
 *  同時掃描 ay_content.content HTML 中的 img src 路徑。
 *  同時掃描 ay_label.value 中可能含有的 HTML img src。
 *  @returns Set<string> - 已標準化的路徑集合 (包含帶/不帶前導斜線兩種形式) */
export async function getUsedPaths(db: D1Database): Promise<Set<string>> {
  const used = new Set<string>();

  for (const rt of FILE_REFS) {
    const cols = rt.columns.map((c) => c.col).join(', ');
    // 表名和列名來自硬編碼白名單, 安全使用
    const sql = `SELECT ${cols} FROM ${rt.table}`;
    try {
      const result = await db.prepare(sql).all<Record<string, string>>();
      if (result.results) {
        for (const row of result.results) {
          for (const c of rt.columns) {
            const val = row[c.col];
            if (val) {
              addPathsToSet(used, val);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`getUsedPaths: 查詢 ${rt.table} 失敗`, e);
    }
  }

  // 掃描 ay_content.content HTML 中的 img src 引用
  try {
    const result = await db.prepare('SELECT content FROM ay_content').all<{ content: string }>();
    if (result.results) {
      for (const row of result.results) {
        if (row.content) {
          extractSrcPaths(row.content, used);
        }
      }
    }
  } catch (e) {
    console.warn('getUsedPaths: 查詢 ay_content.content 失敗', e);
  }

  // 掃描 ay_label.value 中可能含有的 HTML img src (自定義標籤可能含圖片)
  try {
    const result = await db.prepare('SELECT value FROM ay_label').all<{ value: string }>();
    if (result.results) {
      for (const row of result.results) {
        if (row.value) {
          // 標籤值可能含 HTML 實體編碼的 &quot;, 先解碼再提取
          const decoded = row.value.replace(/&quot;/g, '"');
          extractSrcPaths(decoded, used);
        }
      }
    }
  } catch (e) {
    console.warn('getUsedPaths: 查詢 ay_label.value 失敗', e);
  }

  return used;
}

/** 查找指定文件 URL 在數據庫中的所有使用位置。
 *  搜索所有 FILE_REFS 表, 以及 ay_content.content 和 ay_label.value 中的 HTML 引用。
 *  @returns 使用位置數組 { table, id, name, field } */
export async function findUsages(db: D1Database, fileUrl: string): Promise<MediaUsage[]> {
  const usages: MediaUsage[] = [];
  const np = normalizeFilePath(fileUrl);
  if (!np) return usages;

  for (const rt of FILE_REFS) {
    const cols = [rt.idCol, rt.nameCol, ...rt.columns.map((c) => c.col)];
    const selectStr = cols.join(', ');
    // 表名和列名來自硬編碼白名單, 安全使用
    const sql = `SELECT ${selectStr} FROM ${rt.table}`;
    try {
      const result = await db.prepare(sql).all<Record<string, string>>();
      if (result.results) {
        for (const row of result.results) {
          const id = Number(row[rt.idCol]) || 0;
          const name = row[rt.nameCol] || '';
          for (const c of rt.columns) {
            const val = row[c.col];
            if (val && pathMatchesField(val, np)) {
              usages.push({ table: rt.table, id, name, field: c.label });
            }
          }
        }
      }
    } catch (e) {
      console.warn(`findUsages: 查詢 ${rt.table} 失敗`, e);
    }
  }

  // 特殊處理: ay_content.content 正文中的 HTML img src
  try {
    const result = await db.prepare('SELECT id, title, content FROM ay_content').all<{ id: number; title: string; content: string }>();
    if (result.results) {
      for (const row of result.results) {
        if (row.content && containsImgSrc(row.content, np)) {
          usages.push({ table: 'ay_content', id: row.id, name: row.title, field: '正文' });
        }
      }
    }
  } catch (e) {
    console.warn('findUsages: 查詢 ay_content.content 失敗', e);
  }

  // 特殊處理: ay_label.value 中的 HTML img src (自定義標籤可能含圖片)
  try {
    const result = await db.prepare('SELECT id, name, value FROM ay_label').all<{ id: number; name: string; value: string }>();
    if (result.results) {
      for (const row of result.results) {
        if (row.value) {
          const decoded = row.value.replace(/&quot;/g, '"');
          if (containsImgSrc(decoded, np)) {
            usages.push({ table: 'ay_label', id: row.id, name: row.name, field: '標籤值' });
          }
        }
      }
    }
  } catch (e) {
    console.warn('findUsages: 查詢 ay_label.value 失敗', e);
  }

  return usages;
}

/** 快速檢查文件 URL 是否在任何地方被引用。
 *  通過 getUsedPaths 收集所有引用後進行 Set 查找。 */
export async function checkFileUsed(db: D1Database, fileUrl: string): Promise<boolean> {
  const used = await getUsedPaths(db);
  const np = normalizeFilePath(fileUrl);
  if (!np) return false;
  return used.has(np) || used.has('/' + np);
}

/** 獲取所有已標記保護的文件路徑集合 */
async function getMarkedPaths(db: D1Database): Promise<Set<string>> {
  await ensureMediaMarkTable(db);
  const marked = new Set<string>();
  try {
    const result = await db.prepare('SELECT path FROM ay_media_mark').all<{ path: string }>();
    if (result.results) {
      for (const row of result.results) {
        const np = normalizeFilePath(row.path);
        if (np) {
          marked.add(np);
          marked.add('/' + np);
        }
      }
    }
  } catch (e) {
    console.warn('getMarkedPaths: 查詢失敗', e);
  }
  return marked;
}

/** 從配置中獲取 S3 配置 */
export async function getS3Config(db: D1Database, kv: KVNamespace): Promise<S3Config | null> {
  const configs = await getAllConfigs(db, kv);
  const endpoint = configs['s3_endpoint'];
  const accessKey = configs['s3_access_key'];
  const secretKey = configs['s3_secret_key'];
  const bucket = configs['s3_bucket'];
  const region = configs['s3_region'] || 'auto';
  const publicUrl = configs['s3_public_url'] || '';

  if (!endpoint || !accessKey || !secretKey || !bucket) {
    return null;
  }

  return { endpoint, accessKey, secretKey, bucket, region, publicUrl };
}

/** 從文件名推斷 Content-Type（當 file.type 為空時的兜底方案） */
function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
    ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/** 根據 MIME 類型推斷文件擴展名（當文件名無擴展名時的防禦性兜底） */
function extFromContentType(contentType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
    'image/svg+xml': 'svg', 'image/x-icon': 'ico',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json',
    'application/zip': 'zip',
  };
  return mimeToExt[contentType] || '';
}

/** 生成文件 key — 始終保留文件擴展名，確保 R2/S3 對象可被正確識別 */
function generateKey(filename: string, prefix = 'uploads', contentType = ''): string {
  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  let ext = filename.split('.').pop() || '';
  // 防禦性兜底：文件名無擴展名時，從 Content-Type 推斷（避免生成 blob 無擴展名 key）
  if (!ext && contentType) {
    ext = extFromContentType(contentType);
  }
  const randomStr = Math.random().toString(36).slice(2, 10);
  // 安全化文件名（去除特殊字符），保留擴展名
  const baseName = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50) || 'file';
  // 擴展名單獨拼接，確保即使原文件名無擴展名也能從 Content-Type 推斷
  const safeExt = ext ? `.${ext}` : '';
  return `${prefix}/${datePath}/${randomStr}_${baseName}${safeExt}`;
}

/** 處理文件上傳 */
export async function handleUpload(
  db: D1Database,
  kv: KVNamespace,
  request: Request,
): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return err('缺少 file 文件', 1001);
  }

  // 限制文件大小 10MB
  if (file.size > 10 * 1024 * 1024) {
    return err('文件大小超過 10MB 限制', 1001);
  }

  // P3: 文件類型白名單校驗（防上傳可執行文件）
  const detectedType = file.type || guessContentType(file.name);
  const ALLOWED_MIME_TYPES = new Set([
    // 圖片
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/bmp', 'image/svg+xml', 'image/x-icon',
    // 視頻
    'video/mp4', 'video/webm', 'video/quicktime',
    // 音頻
    'audio/mpeg', 'audio/wav',
    // 文檔
    'application/pdf',
    // 文本
    'text/plain', 'text/csv',
    // 壓縮包
    'application/zip',
  ]);
  if (detectedType && !ALLOWED_MIME_TYPES.has(detectedType)) {
    return err(`不支援的文件類型: ${detectedType || '未知'}，僅允許圖片/視頻/音頻/PDF/文本/ZIP`, 1001);
  }

  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置，請在系統設置中配置存儲參數', 1005);
  }

  const contentType = file.type || guessContentType(file.name);
  const key = generateKey(file.name, 'uploads', contentType);
  const data = await file.arrayBuffer();

  try {
    const url = await s3PutObject(s3Config, key, data, contentType);

    // 媒體庫文件不寫入 ay_content 表，避免污染內容管理列表
    // 媒體庫通過 S3 ListObjects 直接列出，無需在內容表中記錄
    return okData({ url, key, filename: file.name, size: file.size, contentType }, '上傳成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`上傳失敗: ${msg}`, 1005);
  }
}

/** 處理文件下載 (代理模式) */
export async function handleDownload(
  db: D1Database,
  kv: KVNamespace,
  key: string,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置', 1005);
  }

  try {
    const { data, contentType } = await s3GetObject(s3Config, key);
    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`下載失敗: ${msg}`, 1004);
  }
}

/** 處理文件刪除 */
export async function handleDelete(
  db: D1Database,
  kv: KVNamespace,
  key: string,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置', 1005);
  }

  try {
    await s3DeleteObject(s3Config, key);
    return ok('刪除成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`刪除失敗: ${msg}`, 1005);
  }
}

/** 生成預簽名 URL */
export async function handlePresignedUrl(
  db: D1Database,
  kv: KVNamespace,
  key: string,
  expires: number,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置', 1005);
  }

  try {
    const url = await s3PresignedUrl(s3Config, key, expires);
    return okData({ url }, '成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`生成預簽名 URL 失敗: ${msg}`, 1005);
  }
}

/** 測試 S3 連接 */
export async function handleTestStorage(
  db: D1Database,
  kv: KVNamespace,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置，請先填寫所有必填項', 1001);
  }

  try {
    // 嘗試上傳一個測試文件
    const testKey = '_test/connection_test.txt';
    const testData = new TextEncoder().encode('Cloudflare CMS storage test - ' + new Date().toISOString());
    const url = await s3PutObject(s3Config, testKey, testData.buffer, 'text/plain');

    // 清理測試文件
    await s3DeleteObject(s3Config, testKey).catch(() => {});

    return okData({
      connected: true,
      endpoint: s3Config.endpoint,
      bucket: s3Config.bucket,
      region: s3Config.region,
    }, 'S3 連接測試成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`S3 連接測試失敗: ${msg}`, 1005);
  }
}

/** 獲取存儲配置 */
export async function handleGetStorageConfig(
  db: D1Database,
  kv: KVNamespace,
): Promise<Response> {
  const configs = await getAllConfigs(db, kv);
  const storageConfig = {
    storage_type: configs['storage_type'] || 's3',
    s3_endpoint: configs['s3_endpoint'] || '',
    s3_access_key: configs['s3_access_key'] ? '***' : '',
    s3_secret_key: configs['s3_secret_key'] ? '***' : '',
    s3_bucket: configs['s3_bucket'] || '',
    s3_region: configs['s3_region'] || 'auto',
    s3_public_url: configs['s3_public_url'] || '',
  };
  return okData(storageConfig, '成功');
}

/** 獲取媒體庫公開配置（僅返回非敏感字段，供所有有媒體庫權限的用戶生成圖片 URL）
 *  v1.7.4：解決非超管用戶無法載入 /admin/storage/config（requireSuperAdmin）導致圖片預覽為空
 */
export async function handleGetMediaPublicConfig(
  db: D1Database,
  kv: KVNamespace,
): Promise<Response> {
  const configs = await getAllConfigs(db, kv);
  return okData({
    s3_public_url: configs['s3_public_url'] || '',
    s3_endpoint: configs['s3_endpoint'] || '',
    s3_bucket: configs['s3_bucket'] || '',
  }, '成功');
}

/** 更新存儲配置 */
export async function handleUpdateStorageConfig(
  db: D1Database,
  kv: KVNamespace,
  body: Record<string, string>,
): Promise<Response> {
  const fields = [
    'storage_type', 's3_endpoint', 's3_access_key', 's3_secret_key',
    's3_bucket', 's3_region', 's3_public_url',
  ];

  for (const field of fields) {
    if (body[field] !== undefined) {
      // 密鑰字段如果是 *** 則不更新
      if (field === 's3_secret_key' && body[field] === '***') {
        continue;
      }
      // ay_config 表結構: id, name, value, type, sorting, description
      const existing = await db.prepare(
        'SELECT id FROM ay_config WHERE name = ?',
      ).bind(field).first<{ id: number }>();

      if (existing) {
        await db.prepare(
          'UPDATE ay_config SET value = ? WHERE id = ?',
        ).bind(body[field], existing.id).run();
      } else {
        await db.prepare(
          'INSERT INTO ay_config (name, value, type, sorting, description) VALUES (?, ?, ?, ?, ?)',
        ).bind(field, body[field], '2', '89', '').run();
      }
    }
  }

  // 清除配置緩存
  await clearConfigCache(kv);

  return ok('存儲配置已更新');
}

/** 列出 R2/S3 存儲桶中的文件 (包含使用狀態和標記狀態) */
export async function handleListMedia(
  db: D1Database,
  kv: KVNamespace,
  params: URLSearchParams,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置，請先在存儲設置中配置', 1005);
  }

  const prefix = params.get('prefix') || 'uploads/';
  const maxKeys = Math.min(parseInt(params.get('pagesize') || '50', 10), 200);
  const cursor = params.get('cursor') || '';

  try {
    const result = await s3ListObjects(s3Config, prefix, maxKeys, cursor);

    // 為每個文件附加 isUsed 和 isMarked 狀態
    const usedPaths = await getUsedPaths(db);
    const markedPaths = await getMarkedPaths(db);

    const enrichedFiles = result.files.map((f) => {
      const np = normalizeFilePath(f.key);
      return {
        ...f,
        isUsed: np ? (usedPaths.has(np) || usedPaths.has('/' + np)) : false,
        isMarked: np ? (markedPaths.has(np) || markedPaths.has('/' + np)) : false,
      };
    });

    return okData({
      files: enrichedFiles,
      isTruncated: result.isTruncated,
      nextCursor: result.nextCursor,
    }, '成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`列出文件失敗: ${msg}`, 1005);
  }
}

/** 刪除 R2/S3 存儲桶中的文件。
 *  刪除前檢查文件是否被引用, 若被引用且未指定 force 則拒絕刪除。 */
export async function handleDeleteMedia(
  db: D1Database,
  kv: KVNamespace,
  key: string,
  force = false,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置', 1005);
  }

  // 刪除前檢查文件是否被引用 (除非指定了 force)
  if (!force) {
    const isUsed = await checkFileUsed(db, key);
    if (isUsed) {
      const usages = await findUsages(db, key);
      const usageSummary = usages
        .slice(0, 10)
        .map((u) => `${u.table}#${u.id}(${u.field})`)
        .join(', ');
      return err(
        `文件正在被 ${usages.length} 處引用, 無法刪除。引用位置: ${usageSummary}。如需強制刪除, 請添加 force=1 參數`,
        1009,
      );
    }
  }

  try {
    await s3DeleteObject(s3Config, key);
    // 同時清除該文件的標記記錄 (如有)
    await ensureMediaMarkTable(db);
    await db.prepare('DELETE FROM ay_media_mark WHERE path = ?').bind(key).run().catch(() => {});
    return ok('刪除成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`刪除失敗: ${msg}`, 1005);
  }
}

/** 獲取文件詳情: S3 文件信息 + 是否被使用 + 使用位置 + 是否標記保護 */
export async function handleMediaDetail(
  db: D1Database,
  kv: KVNamespace,
  key: string,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置', 1005);
  }

  // 通過 ListObjects 獲取文件元數據 (避免下載整個文件)
  let fileInfo: S3Object | null = null;
  try {
    const result = await s3ListObjects(s3Config, key, 1, '');
    fileInfo = result.files.find((f) => f.key === key) || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`獲取文件信息失敗: ${msg}`, 1005);
  }

  if (!fileInfo) {
    return err('文件不存在', 1004);
  }

  // 檢查使用狀態
  const isUsed = await checkFileUsed(db, key);
  const usages = await findUsages(db, key);

  // 檢查標記狀態
  await ensureMediaMarkTable(db);
  const mark = await db.prepare('SELECT id, create_time FROM ay_media_mark WHERE path = ?')
    .bind(key)
    .first<{ id: number; create_time: string }>();
  const isMarked = !!mark;

  // 推斷文件類別
  const ext = key.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'svg', 'ico'];
  const docExts = ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'txt', 'csv'];
  const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'];
  const category = imageExts.includes(ext) ? 'image'
    : docExts.includes(ext) ? 'document'
    : videoExts.includes(ext) ? 'video'
    : 'other';

  return okData({
    key: fileInfo.key,
    size: fileInfo.size,
    lastModified: fileInfo.lastModified,
    etag: fileInfo.etag,
    ext,
    category,
    isUsed,
    usageCount: usages.length,
    usages,
    isMarked,
    markedAt: mark?.create_time || null,
  }, '成功');
}

/** 切換文件標記狀態 (標記保護/取消標記)。
 *  如果 ay_media_mark 中已存在該路徑, 則刪除 (取消標記);
 *  如果不存在, 則插入 (標記為保護)。 */
export async function handleToggleMediaMark(
  db: D1Database,
  key: string,
): Promise<Response> {
  if (!key) {
    return err('缺少文件路徑 key', 1001);
  }

  await ensureMediaMarkTable(db);

  const existing = await db.prepare('SELECT id FROM ay_media_mark WHERE path = ?')
    .bind(key)
    .first<{ id: number }>();

  if (existing) {
    // 已存在 → 刪除 (取消標記)
    await db.prepare('DELETE FROM ay_media_mark WHERE id = ?').bind(existing.id).run();
    return okData({ marked: false }, '已取消標記');
  } else {
    // 不存在 → 插入 (標記為保護)
    await db.prepare('INSERT INTO ay_media_mark (path) VALUES (?)').bind(key).run();
    return okData({ marked: true }, '已標記為保護');
  }
}

/** 清理未使用的文件。
 *  列出 S3 中所有文件, 檢查哪些未被引用且未標記, 然後刪除。
 *  - 已使用的文件始終跳過
 *  - 已標記的文件在 force=false 時跳過, force=true 時也會刪除
 *  @returns { cleaned, skipped, total } */
export async function handleCleanUnused(
  db: D1Database,
  kv: KVNamespace,
  force = false,
): Promise<Response> {
  const s3Config = await getS3Config(db, kv);
  if (!s3Config) {
    return err('S3 存儲未配置', 1005);
  }

  // 獲取所有已使用路徑和已標記路徑
  const usedPaths = await getUsedPaths(db);
  const markedPaths = await getMarkedPaths(db);

  // 分頁列出 S3 中所有文件並清理
  let cursor = '';
  let total = 0;
  let cleaned = 0;
  let skipped = 0;
  const errors: string[] = [];
  const deletedKeys: string[] = [];

  do {
    const result = await s3ListObjects(s3Config, 'uploads/', 200, cursor);
    total += result.files.length;

    for (const file of result.files) {
      const np = normalizeFilePath(file.key);
      if (!np) {
        skipped++;
        continue;
      }

      const isUsed = usedPaths.has(np) || usedPaths.has('/' + np);
      const isMarked = markedPaths.has(np) || markedPaths.has('/' + np);

      // 已使用的文件始終跳過
      if (isUsed) {
        skipped++;
        continue;
      }
      // 已標記的文件在非 force 模式下跳過
      if (isMarked && !force) {
        skipped++;
        continue;
      }

      // 執行刪除
      try {
        await s3DeleteObject(s3Config, file.key);
        cleaned++;
        deletedKeys.push(file.key);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知錯誤';
        console.warn(`handleCleanUnused: 刪除 ${file.key} 失敗:`, msg);
        errors.push(`${file.key}: ${msg}`);
        skipped++;
      }
    }

    cursor = result.isTruncated ? result.nextCursor : '';
  } while (cursor);

  // 清理已刪除文件的標記記錄 (僅刪除已刪除文件的標記, 保留其他文件的標記)
  if (deletedKeys.length > 0) {
    await ensureMediaMarkTable(db);
    // 分批刪除標記記錄 (避免 SQL 參數過多)
    for (let i = 0; i < deletedKeys.length; i += 50) {
      const batch = deletedKeys.slice(i, i + 50);
      const placeholders = batch.map(() => '?').join(', ');
      await db.prepare(`DELETE FROM ay_media_mark WHERE path IN (${placeholders})`)
        .bind(...batch)
        .run()
        .catch(() => {});
    }
  }

  let msg = `清理完成: 共掃描 ${total} 個文件, 已刪除 ${cleaned} 個, 跳過 ${skipped} 個`;
  if (errors.length > 0) {
    msg += `, ${errors.length} 個失敗`;
  }

  return okData({ cleaned, skipped, total, errors: errors.slice(0, 20) }, msg);
}
