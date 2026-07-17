/**
 * 語義搜索服務 - 基於 Cloudflare Vectorize + Workers AI
 *
 * 使用 @cf/baai/bge-base-zh-v1.5 嵌入模型 (768 維, 中文優化),
 * 將 ay_content 表中的文章索引到 Vectorize, 提供語義相似度搜索能力。
 *
 * 表結構 (ay_content, PbootCMS 3.2.12):
 *   - id (integer)          主鍵
 *   - title (text)           標題
 *   - content (text)         正文, 可能含 HTML
 *   - description (text)     摘要
 *   - scode (text)           欄目編碼
 *   - status (text)          狀態: '1'=已發布, '0'=草稿, '-1'=回收站
 *   - acode (text)           區域編碼, 固定 'cn'
 *   - date (text)            發布時間
 *   - ico (text)             縮略圖
 *
 * Vectorize 文檔 ID 規則: 'article-' + articleId
 * 向量元數據: { articleId: number, scode: string }
 */
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { okData, err } from '../utils/response';

/** 嵌入模型名稱 (768 維, 中文優化) */
const EMBEDDING_MODEL = '@cf/baai/bge-base-zh-v1.5';

/** 嵌入向量維度 */
const EMBEDDING_DIMENSIONS = 768;

/** 索引文本最大字符數 (避免超出模型 token 限制) */
const MAX_INDEX_TEXT_LENGTH = 2000;

/** 默認語義搜索返回數量 */
const DEFAULT_TOP_K = 10;

/** 默認相似度閾值 (低於此值的結果將被過濾) */
const DEFAULT_THRESHOLD = 0.7;

/** 批量重建索引時每批處理的文章數 */
const REINDEX_BATCH_SIZE = 50;

/** Workers AI 嵌入模型響應類型 */
interface EmbeddingResponse {
  shape?: number[];
  data?: number[][];
}

/** 語義搜索結果項 */
export interface SemanticSearchResult {
  id: number;
  title: string;
  description: string;
  scode: string;
  date: string;
  ico: string;
  score: number;
}

/** Vectorize 查詢返回的單條匹配 */
interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: { articleId?: number; scode?: string };
}

/** Vectorize 查詢返回結果 */
interface VectorizeQueryResult {
  matches?: VectorizeMatch[];
  count?: number;
}

/** 當前時間字符串 (YYYY-MM-DD HH:mm:ss) */
function nowStr(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 移除 HTML 標籤, 提取純文本內容。
 * 對齊 PbootCMS/Go 版 strip_tags 邏輯, 同時壓縮多餘空白。
 * @param html 原始 HTML 字符串
 * @returns 純文本
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 構建用於嵌入的索引文本: 標題 + 摘要 + 正文純文本, 截斷到最大長度。
 * @param title     文章標題
 * @param description 文章摘要
 * @param content   文章正文 (可能含 HTML)
 * @returns 組合後的純文本
 */
function buildIndexText(title: string, description: string, content: string): string {
  const plainContent = stripHtml(content);
  const parts: string[] = [];
  if (title) parts.push(title);
  if (description) parts.push(description);
  if (plainContent) parts.push(plainContent);
  const combined = parts.join('\n');
  return combined.length > MAX_INDEX_TEXT_LENGTH
    ? combined.slice(0, MAX_INDEX_TEXT_LENGTH)
    : combined;
}

/**
 * 調用 Workers AI 生成文本嵌入向量。
 * @param ai   Workers AI binding
 * @param text 待嵌入的文本
 * @returns 768 維浮點數向量, 若失敗則返回 null
 */
async function generateEmbedding(ai: Ai, text: string): Promise<number[] | null> {
  if (!text) return null;
  try {
    const response = (await ai.run(EMBEDDING_MODEL, { text: [text] })) as EmbeddingResponse;
    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      return null;
    }
    const vector = response.data[0];
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`generateEmbedding: 向量維度異常, 期望 ${EMBEDDING_DIMENSIONS}, 實際 ${vector?.length ?? 0}`);
      return null;
    }
    return vector;
  } catch (e) {
    console.error('generateEmbedding: Workers AI 調用失敗:', e);
    return null;
  }
}

// ============================================================================
// 核心函數
// ============================================================================

/**
 * 索引單篇文章到 Vectorize。
 * 用於文章創建/更新時實時同步語義向量。
 *
 * @param ai        Workers AI binding
 * @param index     Vectorize 索引 binding
 * @param articleId 文章 ID
 * @param title     文章標題
 * @param content   文章正文 (可能含 HTML)
 * @param scode     欄目編碼
 */
export async function indexArticle(
  ai: Ai,
  index: VectorizeIndex,
  articleId: number,
  title: string,
  content: string,
  scode: string,
): Promise<void> {
  const combinedText = buildIndexText(title, '', content);
  const embedding = await generateEmbedding(ai, combinedText);
  if (!embedding) {
    console.warn(`indexArticle: 文章 ${articleId} 嵌入生成失敗, 跳過索引`);
    return;
  }
  await index.upsert([
    {
      id: `article-${articleId}`,
      values: embedding,
      metadata: { articleId, scode },
    },
  ]);
}

/**
 * 從 Vectorize 刪除指定文章的向量。
 * 用於文章刪除/移入回收站時清理語義索引。
 *
 * @param index     Vectorize 索引 binding
 * @param articleId 文章 ID
 */
export async function deleteArticleVector(
  index: VectorizeIndex,
  articleId: number,
): Promise<void> {
  await index.deleteByIds([`article-${articleId}`]);
}

/**
 * 語義搜索: 將查詢文本轉為嵌入向量, 在 Vectorize 中檢索相似文章,
 * 再從 D1 讀取完整文章數據, 返回帶相似度分數的結果列表。
 *
 * @param ai        Workers AI binding
 * @param index     Vectorize 索引 binding
 * @param db        D1 數據庫 binding
 * @param query     用戶搜索查詢文本
 * @param topK      返回結果數量上限 (默認 10)
 * @param threshold 相似度閾值, 低於此值的結果被過濾 (默認 0.7)
 * @returns 統一 API 響應, data 為 SemanticSearchResult[]
 */
export async function semanticSearch(
  ai: Ai,
  index: VectorizeIndex,
  db: D1Database,
  query: string,
  topK?: number,
  threshold?: number,
): Promise<Response> {
  if (!query || !query.trim()) {
    return err('搜索關鍵詞不能為空', 1001);
  }

  const effectiveTopK = topK && topK > 0 ? topK : DEFAULT_TOP_K;
  const effectiveThreshold = threshold !== undefined && threshold >= 0 ? threshold : DEFAULT_THRESHOLD;

  // 1. 將查詢文本轉為嵌入向量
  const queryVector = await generateEmbedding(ai, query.trim());
  if (!queryVector) {
    return err('查詢向量化失敗, 請稍後重試', 1005);
  }

  // 2. 在 Vectorize 中檢索相似向量
  let queryResult: VectorizeQueryResult;
  try {
    queryResult = (await index.query(queryVector, {
      topK: effectiveTopK,
      returnMetadata: 'all',
      returnValues: false,
    })) as VectorizeQueryResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`Vectorize 查詢失敗: ${msg}`, 1005);
  }

  const matches = queryResult.matches || [];
  if (matches.length === 0) {
    return okData([], '未找到匹配結果');
  }

  // 3. 按相似度閾值過濾, 並提取 articleId
  const filtered = matches.filter(
    (m) => m.score >= effectiveThreshold && m.metadata && typeof m.metadata.articleId === 'number',
  );

  if (filtered.length === 0) {
    return okData([], '未找到足夠相似的結果');
  }

  // 4. 從 D1 讀取完整文章數據 (僅已發布的中文文章)
  const articleIds = filtered.map((m) => (m.metadata as { articleId: number }).articleId);
  const placeholders = articleIds.map(() => '?').join(',');
  const scoreMap = new Map<number, number>();
  for (const m of filtered) {
    const aid = (m.metadata as { articleId: number }).articleId;
    scoreMap.set(aid, m.score);
  }

  let rows: Array<{
    id: number;
    title: string;
    description: string;
    scode: string;
    date: string;
    ico: string;
  }>;
  try {
    const result = await db.prepare(
      `SELECT id, title, description, scode, date, ico FROM ay_content WHERE id IN (${placeholders}) AND status = '1' AND acode = 'cn'`,
    )
      .bind(...articleIds)
      .all<{
        id: number;
        title: string;
        description: string;
        scode: string;
        date: string;
        ico: string;
      }>();
    rows = result.results || [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`文章數據查詢失敗: ${msg}`, 1005);
  }

  // 5. 合併相似度分數並按分數降序排列
  const searchResults: SemanticSearchResult[] = rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      scode: row.scode || '',
      date: row.date || '',
      ico: row.ico || '',
      score: scoreMap.get(row.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  return okData(searchResults, `找到 ${searchResults.length} 條匹配結果`);
}

/**
 * 批量重建索引: 將所有已發布文章重新索引到 Vectorize。
 * 用於初次部署或索引數據丟失後的全量重建。
 * 分批處理 (每批 50 篇), 避免單次請求超時。
 *
 * @param ai    Workers AI binding
 * @param index Vectorize 索引 binding
 * @param db    D1 數據庫 binding
 * @returns 統一 API 響應, data 為 { indexed, failed, total }
 */
export async function reindexAllArticles(
  ai: Ai,
  index: VectorizeIndex,
  db: D1Database,
): Promise<Response> {
  // 1. 查詢所有已發布文章
  let articles: Array<{
    id: number;
    title: string;
    content: string;
    description: string;
    scode: string;
  }>;
  try {
    const result = await db.prepare(
      "SELECT id, title, content, description, scode FROM ay_content WHERE status = '1' AND acode = 'cn'",
    ).all<{
      id: number;
      title: string;
      content: string;
      description: string;
      scode: string;
    }>();
    articles = result.results || [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`查詢文章失敗: ${msg}`, 1005);
  }

  if (articles.length === 0) {
    return okData({ indexed: 0, failed: 0, total: 0 }, '沒有已發布的文章需要索引');
  }

  // 2. 分批處理, 每批 REINDEX_BATCH_SIZE 篇
  let indexed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < articles.length; i += REINDEX_BATCH_SIZE) {
    const batch = articles.slice(i, i + REINDEX_BATCH_SIZE);

    // 為當前批次構建索引文本並批量生成嵌入
    const texts = batch.map((a) => buildIndexText(a.title, a.description, a.content));

    // 逐條生成嵌入 (Workers AI 支持批量, 但為穩定性逐條處理)
    const vectors: Array<{ id: string; values: number[]; metadata: { articleId: number; scode: string } } | null> = [];
    for (let j = 0; j < batch.length; j++) {
      const article = batch[j];
      const embedding = await generateEmbedding(ai, texts[j]);
      if (embedding) {
        vectors.push({
          id: `article-${article.id}`,
          values: embedding,
          metadata: { articleId: article.id, scode: article.scode || '' },
        });
        indexed++;
      } else {
        vectors.push(null);
        failed++;
        errors.push(`文章 ${article.id} 嵌入生成失敗`);
      }
    }

    // 批量 upsert 有效向量到 Vectorize
    const validVectors = vectors.filter((v): v is { id: string; values: number[]; metadata: { articleId: number; scode: string } } => v !== null);
    if (validVectors.length > 0) {
      try {
        await index.upsert(validVectors);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知錯誤';
        console.error(`reindexAllArticles: 批次 ${i / REINDEX_BATCH_SIZE + 1} upsert 失敗:`, msg);
        // upsert 失敗不影響後續批次, 但記錄錯誤
        failed += validVectors.length;
        indexed -= validVectors.length;
        errors.push(`批次 upsert 失敗: ${msg}`);
      }
    }
  }

  // 3. 記錄重建日誌到 ay_syslog
  try {
    await db.prepare(
      'INSERT INTO ay_syslog (level, event, ip, create_time) VALUES (?, ?, ?, ?)',
    )
      .bind(
        'reindex',
        `重建索引完成: 成功 ${indexed}, 失敗 ${failed}, 總計 ${articles.length}`,
        '127.0.0.1',
        nowStr(),
      )
      .run();
  } catch {
    // 日誌寫入失敗不影響主流程
  }

  return okData(
    {
      indexed,
      failed,
      total: articles.length,
      errors: errors.slice(0, 20),
    },
    `重建索引完成: 成功 ${indexed} 篇, 失敗 ${failed} 篇`,
  );
}
