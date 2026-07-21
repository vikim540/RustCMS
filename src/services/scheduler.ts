/**
 * 定時發布服務 - 基於 Cloudflare Queues + Cron Triggers
 *
 * PbootCMS 表結構 (ay_content) 沒有獨立的 publish_date 字段,
 * 復用現有的 date 字段作為發布時間。邏輯如下:
 *   - status = '0' (草稿) 且 date 在未來 → 不出現在公開 API
 *   - 當 date 到達時, cron 任務將 status 改為 '1' (已發布)
 *
 * 工作流程:
 *   1. Cron 觸發器每 15 分鐘執行 handleScheduledPublish
 *   2. 掃描未來 24 小時內待發布的草稿, 投遞到 Queue (帶延遲)
 *   3. 同時兜底: 已過期但仍為草稿的文章直接發布
 *   4. Queue 消費者 handleQueuePublish 執行實際的 status 更新
 *
 * wrangler.jsonc 配置:
 *   - queues.producers: PUBLISH_QUEUE → publish-queue
 *   - queues.consumers: publish-queue (max_batch_size=10, DLQ=publish-dlq)
 *   - triggers.crons: 每 15 分鐘執行一次
 *
 * 表結構 (ay_content, PbootCMS 3.2.12):
 *   - id (integer)     主鍵
 *   - title (text)      標題
 *   - status (text)     狀態: '1'=已發布, '0'=草稿, '-1'=回收站
 *   - date (text)       日期時間, 格式 'YYYY-MM-DD HH:mm:ss'
 *   - scode (text)      欄目編碼
 *   - acode (text)      站點標識（站點 ID，如 endoscopy/smile/vision）
 */
import type { D1Database, Queue } from '@cloudflare/workers-types';
import { okData, ok, err } from '../utils/response';
import { nowStr } from '../utils/datetime';

/** Queue 消息載荷: 定時發布任務 */
export interface PublishMessage {
  /** 待發布文章 ID */
  articleId: number;
  /** 動作類型 (目前僅 'publish') */
  action: 'publish';
  /** 預定發布時間 (YYYY-MM-DD HH:mm:ss) */
  scheduledAt: string;
  /** 站點 ID（多站點架構，Queue 消費者用於路由到正確數據庫） */
  siteId?: string;
}

/** Queue 最大延遲秒數 (24 小時, Cloudflare Queues 限制) */
const MAX_QUEUE_DELAY_SECONDS = 86400;

/**
 * 驗證日期時間格式是否為 YYYY-MM-DD HH:mm:ss。
 * 同時校驗日期有效性 (月份 1-12, 日 1-31, 時 0-23, 分秒 0-59)。
 * @param dateStr 待驗證的日期字符串
 * @returns 是否合法
 */
function isValidDateTime(dateStr: string): boolean {
  if (!dateStr) return false;
  // 格式校驗: YYYY-MM-DD HH:mm:ss
  const regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(regex);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const n = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  if (n.month < 1 || n.month > 12) return false;
  if (n.day < 1 || n.day > 31) return false;
  if (n.hour > 23) return false;
  if (n.minute > 59) return false;
  if (n.second > 59) return false;
  // 進一步驗證日期真實性 (如 2 月 30 日)
  const d = new Date(`${n.year}-${n.month}-${n.day}T${n.hour}:${n.minute}:${n.second}Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * 記錄日誌到 ay_syslog 表。
 * @param db     D1 數據庫
 * @param level  日誌級別
 * @param event  日誌事件描述
 */
async function logEvent(db: D1Database, level: string, event: string): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO ay_syslog (level, event, ip, create_time) VALUES (?, ?, ?, ?)',
    )
      .bind(level, event.slice(0, 200), '127.0.0.1', nowStr())
      .run();
  } catch {
    // 日誌寫入失敗不影響主流程
  }
}

// ============================================================================
// 核心函數
// ============================================================================

/**
 * Cron 定時任務處理器: 每 15 分鐘執行一次。
 *
 * 職責:
 * 1. 掃描未來 24 小時內待發布的草稿文章, 投遞延遲消息到 Queue
 *    (Queue 會在預定時間觸發 handleQueuePublish)
 * 2. 兜底處理: 已過期但仍為草稿的文章直接更新為已發布
 *    (覆蓋 Queue 消息丟失、或定時超過 24 小時的場景)
 *
 * @param db    D1 數據庫 binding
 * @param queue Cloudflare Queue binding (可為 null, 本地開發無 Queue 時兜底走直接 UPDATE)
 */
export async function handleScheduledPublish(
  db: D1Database,
  queue: Queue<PublishMessage> | null,
  siteId: string = 'endoscopy',
): Promise<void> {
  // 1. 掃描未來 24 小時內待發布的草稿文章, 投遞延遲消息到 Queue
  let upcoming: Array<{ id: number; date: string }> = [];
  try {
    const result = await db.prepare(
      `SELECT id, date FROM ay_content
       WHERE status = '0'
       AND date > datetime('now', '+8 hours')
       AND date <= datetime('now', '+8 hours', '+24 hours')`,
    ).all<{ id: number; date: string }>();
    upcoming = result.results || [];
  } catch (e) {
    console.error('handleScheduledPublish: 查詢待發布文章失敗:', e);
  }

  // 2. 為每篇文章計算延遲並投遞到 Queue
  for (const article of upcoming) {
    if (!article.date) continue;
    const targetTime = new Date(article.date.replace(' ', 'T')).getTime();
    const delaySeconds = Math.floor((targetTime - Date.now()) / 1000);

    // 延遲必須在 0 ~ 86400 秒之間 (Cloudflare Queues delaySeconds 限制)
    if (delaySeconds >= 0 && delaySeconds <= MAX_QUEUE_DELAY_SECONDS) {
      if (queue) {
        try {
          await queue.send(
            { articleId: article.id, action: 'publish', scheduledAt: article.date, siteId },
            { delaySeconds: Math.floor(delaySeconds) },
          );
        } catch (e) {
          console.error(`handleScheduledPublish: 文章 ${article.id} 投遞 Queue 失敗:`, e);
          // Queue 投遞失敗不阻塞, 兜底 UPDATE 會處理
        }
      }
    }
  }

  // 3. 兜底處理: 已過期但仍為草稿的文章直接發布
  //    覆蓋場景: Queue 消息丟失、定時超過 24 小時、本地開發無 Queue
  try {
    const result = await db.prepare(
      `UPDATE ay_content SET status = '1'
       WHERE status = '0'
       AND date <= datetime('now', '+8 hours') AND date != ''`,
    ).run();

    const changes = result.meta?.changes ?? 0;
    if (changes > 0) {
      await logEvent(db, 'publish', `兜底定時發布: ${changes} 篇文章已過期, 直接發布`);
    }
  } catch (e) {
    console.error('handleScheduledPublish: 兜底發布失敗:', e);
  }
}

/**
 * Queue 消費者: 處理單篇文章的定時發布。
 * 由 Cloudflare Queue 在延遲到達後觸發。
 *
 * 職責:
 * 1. 將文章 status 從 '0' (草稿) 更新為 '1' (已發布)
 * 2. 記錄發布事件日誌
 *
 * @param db      D1 數據庫 binding
 * @param message Queue 消息, 包含 articleId 和 scheduledAt
 */
export async function handleQueuePublish(
  db: D1Database,
  message: PublishMessage,
): Promise<void> {
  const { articleId } = message;

  try {
    const result = await db.prepare(
      "UPDATE ay_content SET status = '1' WHERE id = ? AND status = '0'",
    )
      .bind(articleId)
      .run();

    const changes = result.meta?.changes ?? 0;
    if (changes > 0) {
      await logEvent(
        db,
        'publish',
        `定時發布成功: 文章 ${articleId} (預定時間 ${message.scheduledAt})`,
      );
    } else {
      // 文章可能已被兜底邏輯發布, 或已被手動發布/刪除, 不視為錯誤
      console.log(`handleQueuePublish: 文章 ${articleId} 無需發布 (可能已發布或不存在)`);
    }
  } catch (e) {
    console.error(`handleQueuePublish: 文章 ${articleId} 發布失敗:`, e);
    await logEvent(db, 'publish_error', `定時發布失敗: 文章 ${articleId} - ${e instanceof Error ? e.message : '未知錯誤'}`);
    // 重新拋出讓 Queue 自動重試 (wrangler.jsonc 配置 max_retries=3)
    throw e;
  }
}

/**
 * API: 設置文章定時發布。
 * 將文章設為草稿狀態, 並設定未來的發布時間。
 * 若 Queue 可用且延遲在 24 小時內, 立即投遞延遲消息。
 *
 * @param db          D1 數據庫 binding
 * @param queue       Cloudflare Queue binding (可為 null)
 * @param id          文章 ID
 * @param publishDate 發布時間 (YYYY-MM-DD HH:mm:ss)
 * @returns 統一 API 響應
 */
export async function handleScheduleArticle(
  db: D1Database,
  queue: Queue<PublishMessage> | null,
  id: number,
  publishDate: string,
  siteId: string = 'endoscopy',
): Promise<Response> {
  if (!id || id <= 0) {
    return err('文章 ID 無效', 1001);
  }

  // 1. 驗證發布時間格式
  if (!isValidDateTime(publishDate)) {
    return err('發布時間格式無效, 應為 YYYY-MM-DD HH:mm:ss', 1001);
  }

  // 2. 檢查文章是否存在
  const article = await db.prepare(
    "SELECT id, title, status FROM ay_content WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; title: string; status: string }>();

  if (!article) {
    return err('文章不存在', 1004);
  }

  // 3. 更新文章: 設定發布時間並標記為草稿 (等待定時發布)
  try {
    await db.prepare(
      'UPDATE ay_content SET date = ?, status = ?, update_time = ? WHERE id = ?',
    )
      .bind(publishDate, '0', nowStr(), id)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`定時發布設置失敗: ${msg}`, 1005);
  }

  // 4. 若 Queue 可用且延遲在 24 小時內, 立即投遞延遲消息
  let queued = false;
  if (queue) {
    const targetTime = new Date(publishDate.replace(' ', 'T')).getTime();
    const delaySeconds = Math.floor((targetTime - Date.now()) / 1000);

    if (delaySeconds >= 0 && delaySeconds <= MAX_QUEUE_DELAY_SECONDS) {
      try {
        await queue.send(
          { articleId: id, action: 'publish', scheduledAt: publishDate, siteId },
          { delaySeconds: Math.floor(delaySeconds) },
        );
        queued = true;
      } catch (e) {
        // Queue 投遞失敗不影響設置結果, cron 兜底會處理
        console.error(`handleScheduleArticle: 文章 ${id} Queue 投遞失敗:`, e);
      }
    }
    // 延遲超過 24 小時: 不投遞 Queue, 依賴 cron 掃描 (每次掃描未來 24h 窗口)
  }

  await logEvent(
    db,
    'schedule',
    `定時發布設置: 文章 ${id}「${article.title}」預定 ${publishDate}${queued ? ' (已入隊)' : ' (待 cron 掃描)'}`,
  );

  return okData(
    {
      id,
      publishDate,
      status: '0',
      queued,
    },
    queued ? '定時發布已設置, 將通過隊列準時發布' : '定時發布已設置, 將由定時任務發布',
  );
}

/**
 * API: 獲取待定時發布的文章列表。
 * 查詢所有狀態為草稿且發布時間在未來的文章, 按發布時間升序排列。
 *
 * @param db D1 數據庫 binding
 * @returns 統一 API 響應, data 為文章列表
 */
export async function handleListScheduled(
  db: D1Database,
): Promise<Response> {
  try {
    const result = await db.prepare(
      `SELECT id, title, date, scode FROM ay_content
       WHERE status = '0'
       AND date > datetime('now', '+8 hours')
       ORDER BY date ASC`,
    ).all<{ id: number; title: string; date: string; scode: string }>();

    return okData(result.results || [], '成功');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知錯誤';
    return err(`查詢定時發布列表失敗: ${msg}`, 1005);
  }
}
