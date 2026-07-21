/**
 * 全局錯誤通知系統 — 左下角固定錯誤堆疊
 *
 * 設計目的：項目上線測試後，非開發者用戶不會使用 F12 開發者工具，
 * 需要一個固定的、可見的錯誤通知系統，將後端/前端錯誤直接呈現給用戶。
 *
 * 特性：
 * - 固定在頁面左下角，不遮擋主內容區
 * - 紅色邊框深色主題，與現有 UI 風格一致
 * - 長時間固定顯示（不自動消失），必須手動關閉
 * - 支持多個錯誤堆疊顯示（從下往上排列，最新在上方）
 * - 每個錯誤：標題（🔴 錯誤）、簡短描述、可展開的技術詳情、時間戳
 *
 * 對外暴露 `showGlobalError(title, message, detail?)` 函數，
 * 可在組件外（如 api.ts、ErrorBoundary）直接調用。
 */

import { useEffect, useState } from 'react'

/** 單個錯誤條目 */
interface ErrorEntry {
  /** 唯一 ID（用於 React key 與手動關閉） */
  id: string
  /** 標題（簡短，如「API 請求失敗」） */
  title: string
  /** 用戶可理解的簡短描述 */
  message: string
  /** 技術詳情（可選，如完整錯誤堆棧、請求 URL 等），默認折疊 */
  detail?: string
  /** 時間戳（ISO 字符串，顯示時格式化） */
  timestamp: string
}

/** 內部錯誤隊列（模塊級，組件外可讀寫） */
let errorQueue: ErrorEntry[] = []
/** 訂閱者回調列表（模塊級觀察者模式） */
const subscribers = new Set<() => void>()

/** 通知所有訂閱者重新渲染 */
function notifySubscribers() {
  subscribers.forEach((cb) => cb())
}

/**
 * 對外暴露的錯誤推送函數。
 * 可在組件外（api.ts、ErrorBoundary 等）直接調用。
 *
 * @param title   標題（簡短，如「API 請求失敗」）
 * @param message 用戶可理解的簡短描述
 * @param detail  技術詳情（可選，默認折疊）
 */
export function showGlobalError(title: string, message: string, detail?: string): void {
  const entry: ErrorEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    message,
    detail,
    timestamp: new Date().toISOString(),
  }
  // 最多保留 5 條，防止無限堆積遮擋屏幕
  errorQueue = [entry, ...errorQueue].slice(0, 5)
  // 同時輸出到控制台，方便開發者除錯
  console.error(`[GlobalError] ${title}: ${message}`, detail ?? '')
  notifySubscribers()
}

/** 清除單個錯誤（用戶手動關閉） */
function dismissError(id: string): void {
  errorQueue = errorQueue.filter((e) => e.id !== id)
  notifySubscribers()
}

/** 清除所有錯誤 */
function dismissAll(): void {
  errorQueue = []
  notifySubscribers()
}

/** 將 ISO 時間戳格式化為 HH:MM:SS */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  } catch {
    return iso
  }
}

/** 單個錯誤卡片（支持展開/折疊技術詳情） */
function ErrorCard({ entry }: { entry: ErrorEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = Boolean(entry.detail)

  return (
    <div className="border border-red-500/60 bg-slate-900/95 text-slate-100 rounded-lg shadow-2xl shadow-red-900/30 w-80 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* 標題欄 */}
      <div className="flex items-start gap-2 px-3 py-2.5 border-b border-red-500/40 bg-red-950/40">
        <span className="text-base leading-none mt-0.5">🔴</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-200 truncate">{entry.title}</p>
          <p className="text-xs text-slate-300 mt-0.5 break-words">{entry.message}</p>
        </div>
        <button
          onClick={() => dismissError(entry.id)}
          className="text-slate-400 hover:text-white text-sm leading-none shrink-0 px-1"
          aria-label="關閉"
          title="關閉此通知"
        >
          ✕
        </button>
      </div>

      {/* 技術詳情（可折疊） */}
      {hasDetail && (
        <div className="border-t border-red-500/20">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
          >
            <span className="flex items-center gap-1">
              <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
              <span>技術詳情</span>
            </span>
            <span className="text-[10px] text-slate-500">{formatTime(entry.timestamp)}</span>
          </button>
          {expanded && (
            <pre className="px-3 pb-2.5 pt-0.5 text-[11px] text-red-300/90 bg-slate-950/60 whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono leading-relaxed">
              {entry.detail}
            </pre>
          )}
        </div>
      )}

      {/* 無詳情時顯示時間戳 */}
      {!hasDetail && (
        <div className="px-3 py-1 text-[10px] text-slate-500 border-t border-red-500/20">
          {formatTime(entry.timestamp)}
        </div>
      )}
    </div>
  )
}

/** 全局錯誤通知容器（固定左下角） */
export default function GlobalErrorToast() {
  // 訂閱模塊級錯誤塊級錯誤隊列，隊列變化時觸發重新渲染
  const [, setTick] = useState(0)
  useEffect(() => {
    const cb = () => setTick((t) => t + 1)
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  }, [])

  if (errorQueue.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-[200] flex flex-col gap-2 max-h-[80vh] overflow-y-auto">
      {/* 頂部「清除全部」按鈕（多於 1 條時顯示） */}
      {errorQueue.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={dismissAll}
            className="text-[11px] text-slate-400 hover:text-white bg-slate-900/80 border border-slate-700 rounded px-2 py-0.5 transition-colors"
          >
            清除全部
          </button>
        </div>
      )}
      {/* 錯誤堆疊：最新在上方 */}
      {errorQueue.map((entry) => (
        <ErrorCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
