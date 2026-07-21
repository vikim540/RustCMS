import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { cn, formatDate } from '../lib/utils'
import { LoadingState, EmptyState, ErrorState } from '../components/StateDisplay'

/** 留言狀態: '0'=待審核, '1'=已審核 */
type MessageStatus = '0' | '1'

/** 留言數據結構 */
interface Message {
  id: number
  contacts: string
  mobile: string
  content: string
  user_ip: string
  status: MessageStatus
  recontent: string
  create_time: string
  acode: string
}

/** 留言詳情（可能含更多欄位） */
interface MessageDetail extends Message {
  email?: string
  address?: string
  job?: string
}

/** 狀態篩選選項 */
const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: '0', label: '待審核' },
  { key: '1', label: '已審核' },
] as const

/** 根據狀態取得徽章樣式 */
function getStatusBadge(status: MessageStatus): { label: string; className: string } {
  switch (status) {
    case '1':
      return { label: '已審核', className: 'bg-green-100 text-green-700' }
    case '0':
      return { label: '待審核', className: 'bg-amber-100 text-amber-700' }
    default:
      return { label: '未知', className: 'bg-gray-100 text-gray-600' }
  }
}

export default function Messages() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // 詳情對話框狀態
  const [detailTarget, setDetailTarget] = useState<MessageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // 回覆對話框狀態
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)
  const [replyForm, setReplyForm] = useState({ recontent: '', status: '1' as MessageStatus })
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  /** 載入留言列表 */
  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') {
        params.set('status', statusFilter)
      }
      const query = params.toString() ? `?${params.toString()}` : ''
      const res = await api.get<Message[]>(`/admin/messages${query}`)
      setMessages(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  /** 切換狀態篩選 */
  const handleFilterChange = (key: string) => {
    setStatusFilter(key)
  }

  /** 查看詳情 */
  const handleViewDetail = async (id: number) => {
    setDetailLoading(true)
    setDetailTarget(null)
    setActionError('')
    try {
      const res = await api.get<MessageDetail>(`/admin/messages/${id}`)
      setDetailTarget(res.data ?? null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '載入詳情失敗')
    } finally {
      setDetailLoading(false)
    }
  }

  /** 開啟回覆對話框 */
  const openReply = (msg: Message) => {
    setReplyTarget(msg)
    setReplyForm({
      recontent: msg.recontent ?? '',
      status: '1',
    })
    setActionError('')
  }

  /** 提交回覆 */
  const handleReply = async () => {
    if (!replyTarget) return

    setSaving(true)
    setActionError('')
    try {
      await api.put(`/admin/messages/${replyTarget.id}`, {
        recontent: replyForm.recontent,
        status: replyForm.status,
      })
      setReplyTarget(null)
      await fetchMessages()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '回覆失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除留言 */
  const handleDelete = async (id: number) => {
    if (!window.confirm('確定要刪除此留言嗎?')) return
    setActionLoading(id)
    try {
      await api.del(`/admin/messages/${id}`)
      await fetchMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">留言管理</h1>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 狀態篩選 */}
      <div className="flex gap-1 mb-4 border-b">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => handleFilterChange(filter.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              statusFilter === filter.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* 加載中 */}
      {loading && <LoadingState text="載入中..." />}

      {/* 空狀態 */}
      {!loading && messages.length === 0 && !error && (
        <EmptyState icon="💬" text="暫無留言數據" />
      )}

      {/* 留言表格 */}
      {!loading && messages.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">聯繫人</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">手機</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">內容</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">IP</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">狀態</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">時間</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((item) => {
                  const badge = getStatusBadge(item.status)
                  return (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                      <td className="px-4 py-3 font-medium">{item.contacts || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.mobile || '-'}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="text-muted-foreground truncate block">
                          {item.content || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                        {item.user_ip || '-'}
                      </td>
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
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {formatDate(item.create_time)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleViewDetail(item.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="查看詳情"
                          >
                            <span className="text-sm">👁️</span>
                            詳情
                          </button>
                          <button
                            onClick={() => openReply(item)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="回覆"
                          >
                            <span className="text-sm">💬</span>
                            回覆
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={actionLoading === item.id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            title="刪除"
                          >
                            <span className="text-sm">🗑️</span>
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 詳情對話框 */}
      {(detailTarget || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">留言詳情</h2>
              <button
                onClick={() => {
                  setDetailTarget(null)
                  setDetailLoading(false)
                }}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4">
              {detailLoading ? (
                <LoadingState text="載入中..." />
              ) : detailTarget ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">聯繫人：</span>
                      <span className="font-medium">{detailTarget.contacts || '-'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">手機：</span>
                      <span className="font-medium">{detailTarget.mobile || '-'}</span>
                    </div>
                    {detailTarget.email && (
                      <div>
                        <span className="text-muted-foreground">郵箱：</span>
                        <span className="font-medium">{detailTarget.email}</span>
                      </div>
                    )}
                    {detailTarget.address && (
                      <div>
                        <span className="text-muted-foreground">地址：</span>
                        <span className="font-medium">{detailTarget.address}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">IP：</span>
                      <span className="font-mono text-xs">{detailTarget.user_ip || '-'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">時間：</span>
                      <span className="text-xs">{formatDate(detailTarget.create_time)}</span>
                    </div>
                  </div>
                  <div className="border-t pt-3">
                    <span className="text-sm text-muted-foreground block mb-1">留言內容</span>
                    <p className="text-sm whitespace-pre-wrap bg-secondary/30 rounded p-3">
                      {detailTarget.content || '（無內容）'}
                    </p>
                  </div>
                  {detailTarget.recontent && (
                    <div className="border-t pt-3">
                      <span className="text-sm text-muted-foreground block mb-1">回覆內容</span>
                      <p className="text-sm whitespace-pre-wrap bg-green-50 rounded p-3">
                        {detailTarget.recontent}
                      </p>
                    </div>
                  )}
                  <div className="border-t pt-3 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">狀態：</span>
                    {(() => {
                      const badge = getStatusBadge(detailTarget.status)
                      return (
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded text-xs font-medium',
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      )
                    })()}
                  </div>
                </div>
              ) : (
                <ErrorState message="載入失敗" />
              )}
              {actionError && (
                <p className="mt-3 text-sm text-destructive flex items-center gap-1.5">
                  <span className="mr-1">⚠️</span>
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t sticky bottom-0 bg-white">
              <button
                onClick={() => {
                  setDetailTarget(null)
                  setDetailLoading(false)
                }}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
              >
                關閉
              </button>
              {detailTarget && (
                <button
                  onClick={() => {
                    const msg = detailTarget
                    setDetailTarget(null)
                    openReply(msg)
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                >
                  <span>💬</span>
                  回覆
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 回覆對話框 */}
      {replyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">回覆留言</h2>
              <button
                onClick={() => setReplyTarget(null)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 原始留言 */}
              <div className="bg-secondary/30 rounded p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  {replyTarget.contacts} ({replyTarget.mobile || '無手機'})
                </div>
                <p className="text-sm whitespace-pre-wrap">
                  {replyTarget.content || '（無內容）'}
                </p>
              </div>
              {/* 回覆內容 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">回覆內容</label>
                <textarea
                  value={replyForm.recontent}
                  onChange={(e) =>
                    setReplyForm((f) => ({ ...f, recontent: e.target.value }))
                  }
                  rows={4}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  placeholder="請輸入回覆內容..."
                  autoFocus
                />
              </div>
              {/* 狀態 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">狀態</label>
                <select
                  value={replyForm.status}
                  onChange={(e) =>
                    setReplyForm((f) => ({ ...f, status: e.target.value as MessageStatus }))
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                >
                  <option value="1">已審核</option>
                  <option value="0">待審核</option>
                </select>
              </div>
              {actionError && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <span className="mr-1">⚠️</span>
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t">
              <button
                onClick={() => setReplyTarget(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleReply}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? (
                  <span className="animate-spin inline-block">🔄</span>
                ) : (
                  <span>✅</span>
                )}
                {saving ? '保存中...' : '確認回覆'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
