import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { cn, formatDate } from '../lib/utils'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 日誌數據結構 */
interface LogItem {
  id: number
  create_time: string
  username: string
  event: string
  level: string
  user_ip: string
  os: string
  browser: string
}

/**
 * 日誌類型標籤頁定義
 * 後端 level 參數: admin=系統日誌, content=內容日誌, security=安全日誌, error=錯誤日誌, notify=通知日誌, all=全部
 */
const LOG_TABS = [
  { key: 'all', label: '📋 全部' },
  { key: 'content', label: '📝 內容日誌' },
  { key: 'security', label: '🔐 安全日誌' },
  { key: 'error', label: '❌ 錯誤日誌' },
  { key: 'admin', label: '🛡️ 系統日誌' },
  { key: 'notify', label: '🔔 通知日誌' },
] as const

/** 每頁條數 */
const PAGE_SIZE = 20

/** 根據等級取得徽章樣式 */
function getLevelBadge(level: string): { label: string; className: string } {
  switch (level) {
    case 'admin':
      return { label: '系統', className: 'bg-blue-100 text-blue-700' }
    case 'content':
      return { label: '內容', className: 'bg-cyan-100 text-cyan-700' }
    case 'security':
      return { label: '安全', className: 'bg-orange-100 text-orange-700' }
    case 'error':
      return { label: '錯誤', className: 'bg-red-100 text-red-700' }
    case 'spider':
      return { label: '蜘蛛', className: 'bg-purple-100 text-purple-700' }
    case 'mail_success':
      return { label: '郵件成功', className: 'bg-green-100 text-green-700' }
    case 'mail_error':
      return { label: '郵件失敗', className: 'bg-red-100 text-red-700' }
    case 'webhook_success':
      return { label: 'Webhook成功', className: 'bg-green-100 text-green-700' }
    case 'webhook_error':
      return { label: 'Webhook失敗', className: 'bg-red-100 text-red-700' }
    default:
      return { label: level || '未知', className: 'bg-gray-100 text-gray-600' }
  }
}

/** 計算分頁頁碼（含省略號） */
function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total]
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total]
  }
  return [1, '...', current - 1, current, current + 1, '...', total]
}

export default function Logs() {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [clearing, setClearing] = useState(false)

  /** 載入日誌列表 */
  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pagesize', String(PAGE_SIZE))
      if (activeTab !== 'all') {
        params.set('level', activeTab)
      }
      const res = await api.get<LogItem[]>(`/admin/logs?${params.toString()}`)
      setLogs(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [page, activeTab])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  /** 切換標籤 */
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setPage(1)
  }

  /** 清除日誌 */
  const handleClear = async () => {
    const tabLabel = LOG_TABS.find((t) => t.key === activeTab)?.label ?? '當前'
    if (!window.confirm(`確定要清除${tabLabel}的所有日誌嗎?此操作不可恢復。`)) return
    setClearing(true)
    setError('')
    try {
      const type = activeTab === 'all' ? 'all' : activeTab
      await api.post('/admin/logs/clear', { type })
      setPage(1)
      await fetchLogs()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除失敗')
    } finally {
      setClearing(false)
    }
  }

  // 分頁計算
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageNumbers = getPageNumbers(page, totalPages)

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-2xl">📜</span>
            系統日誌
          </h1>
          <p className="text-sm text-muted-foreground mt-1">查看系統操作記錄及通知日誌</p>
        </div>
        <button
          onClick={handleClear}
          disabled={clearing || logs.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {clearing ? <span className="animate-spin inline-block">🔄</span> : <span>🗑️</span>}
          {clearing ? '清除中...' : '清除日誌'}
        </button>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span>⚠️</span>
          {error}
        </div>
      )}

      {/* 類型標籤 */}
      <div className="flex gap-1 mb-4 border-b">
        {LOG_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 加載中 */}
      {loading && <LoadingState text="載入中..." />}

      {/* 空狀態 */}
      {!loading && logs.length === 0 && !error && (
        <EmptyState icon="📜" text="暫無日誌記錄" />
      )}

      {/* 日誌表格 */}
      {!loading && logs.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">時間</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">用戶</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">事件</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">等級</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">IP</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">操作系統</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">瀏覽器</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((item) => {
                  const badge = getLevelBadge(item.level)
                  return (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(item.create_time)}
                      </td>
                      <td className="px-4 py-3">{item.username || '-'}</td>
                      <td className="px-4 py-3">{item.event || '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded text-xs font-medium',
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                        {item.user_ip || '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.os || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.browser || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 分頁 */}
          {!loading && logs.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                共 {total} 條,第 {page}/{totalPages} 頁
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一頁
                </button>
                {pageNumbers.map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                      ...
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={cn(
                        'min-w-[32px] px-2 py-1.5 text-sm border rounded-md transition-colors',
                        p === page
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'hover:bg-accent',
                      )}
                    >
                      {p}
                    </button>
                  ),
                )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
