import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { cn, formatDate } from '../lib/utils'
import { LoadingState, EmptyState, ErrorState } from '../components/StateDisplay'

/** 表單提交列表項 */
interface Submission {
  id: number
  form_key: string
  name: string
  tel: string
  email: string
  status: string
  status_label: string
  source_url: string
  create_time: string
  preview: string
}

/** 表單提交詳情 */
interface SubmissionDetail extends Submission {
  data: Record<string, unknown>
  user_ip: string
  user_os: string
  user_bs: string
  acode: string
}

/** form_key 列表項 */
interface FormKeyItem {
  form_key: string
  count: number
  form_name: string | null
  fcode: string | null
}

const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: '0', label: '待處理', className: 'bg-amber-100 text-amber-700' },
  { value: '1', label: '已處理', className: 'bg-green-100 text-green-700' },
  { value: '2', label: '已封存', className: 'bg-gray-100 text-gray-500' },
] as const

const STATUS_BADGES: Record<string, string> = {
  '0': 'bg-amber-100 text-amber-700',
  '1': 'bg-green-100 text-green-700',
  '2': 'bg-gray-100 text-gray-500',
}

const STATUS_DOT: Record<string, string> = {
  '0': 'bg-amber-500',
  '1': 'bg-green-500',
  '2': 'bg-gray-400',
}

/** ISO 週範圍（週一 ~ 週日） */
function getWeekRange(dateStr: string): { key: string; label: string; sortKey: number } {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return { key: 'unknown', label: '未知時間', sortKey: 0 }
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay()
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`
  return {
    key: `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`,
    label: `${fmt(monday)} ~ ${fmt(sunday)}`,
    sortKey: monday.getTime(),
  }
}

function formatTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return isToday ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

export default function FormSubmissions() {
  const [searchParams] = useSearchParams()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [formKeyFilter, setFormKeyFilter] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<SubmissionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [stats, setStats] = useState({ total: 0, pending: 0, processed: 0, archived: 0 })
  const [formKeys, setFormKeys] = useState<FormKeyItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)

  const PAGESIZE = 50

  const fetchSubmissions = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 1) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(pageNum), pagesize: String(PAGESIZE), sort: sortBy })
      if (statusFilter) params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      if (formKeyFilter) params.set('form_key', formKeyFilter)
      const res = await api.get<Submission[]>(`/admin/forms/submissions?${params.toString()}`)
      const data = Array.isArray(res.data) ? res.data : []
      if (append) setSubmissions((prev) => [...prev, ...data])
      else setSubmissions(data)
      setTotal(res.meta?.total || 0)
      setHasMore(data.length === PAGESIZE && pageNum * PAGESIZE < (res.meta?.total || 0))
      setPage(pageNum)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加載失敗')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [search, statusFilter, sortBy, formKeyFilter])

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<{ total: number; pending: number; processed: number; archived: number }>('/admin/forms/submissions/stats')
      setStats(res.data ?? { total: 0, pending: 0, processed: 0, archived: 0 })
    } catch { /* ignore */ }
  }, [])

  const fetchFormKeys = useCallback(async () => {
    try {
      const res = await api.get<FormKeyItem[]>('/admin/forms/submissions/form-keys')
      setFormKeys(res.data ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchSubmissions(1); fetchStats(); fetchFormKeys() }, [fetchSubmissions, fetchStats, fetchFormKeys])

  // 從 URL 讀取 form_key 參數（側邊欄動態表單點擊時帶入）
  useEffect(() => {
    const urlFormKey = searchParams.get('form_key')
    if (urlFormKey && urlFormKey !== formKeyFilter) {
      setFormKeyFilter(urlFormKey)
    }
  }, [searchParams]) // eslint-disable-line

  // form_key → form_name 映射（用於卡片和詳情中顯示表單名稱）
  const formNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const fk of formKeys) {
      if (fk.form_name) map[fk.form_key] = fk.form_name
    }
    return map
  }, [formKeys])

  useEffect(() => { const t = setTimeout(() => fetchSubmissions(1), 300); return () => clearTimeout(t) }, [search]) // eslint-disable-line
  useEffect(() => { fetchSubmissions(1) }, [statusFilter, sortBy, formKeyFilter]) // eslint-disable-line

  const handleViewDetail = async (id: number) => {
    setDetailLoading(true); setSelectedDetail(null)
    try {
      const res = await api.get<SubmissionDetail>(`/admin/forms/submissions/${id}`)
      setSelectedDetail(res.data ?? null)
      if (res.data?.status === '0') {
        await api.put(`/admin/forms/submissions/${id}`, { status: '1' })
        setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status: '1', status_label: '已處理' } : s))
        fetchStats()
      }
    } catch (err) { setError(err instanceof Error ? err.message : '獲取詳情失敗') }
    finally { setDetailLoading(false) }
  }

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await api.put(`/admin/forms/submissions/${id}`, { status })
      setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status, status_label: STATUS_FILTERS.find((f) => f.value === status)?.label || s.status_label } : s))
      if (selectedDetail?.id === id) setSelectedDetail({ ...selectedDetail, status, status_label: STATUS_FILTERS.find((f) => f.value === status)?.label || selectedDetail.status_label })
      fetchStats()
    } catch (err) { setError(err instanceof Error ? err.message : '狀態更新失敗') }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確認刪除此表單記錄？此操作不可恢復。')) return
    try {
      await api.del(`/admin/forms/submissions/${id}`)
      setSubmissions((prev) => prev.filter((s) => s.id !== id))
      setSelectedDetail(null)
      fetchStats()
    } catch (err) { setError(err instanceof Error ? err.message : '刪除失敗') }
  }

  /** 批量刪除 */
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`確認刪除選中的 ${ids.length} 條記錄？此操作不可恢復。`)) return
    setBatchLoading(true)
    try {
      await api.post('/admin/forms/submissions/batch', { action: 'delete', ids })
      setSubmissions((prev) => prev.filter((s) => !selectedIds.has(s.id)))
      setSelectedIds(new Set())
      fetchStats()
    } catch (err) { setError(err instanceof Error ? err.message : '批量刪除失敗') }
    finally { setBatchLoading(false) }
  }

  /** 批量更新狀態 */
  const handleBatchStatus = async (status: string) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBatchLoading(true)
    try {
      await api.post('/admin/forms/submissions/batch', { action: 'status', ids, status })
      setSubmissions((prev) => prev.map((s) => selectedIds.has(s.id) ? { ...s, status, status_label: STATUS_FILTERS.find((f) => f.value === status)?.label || s.status_label } : s))
      setSelectedIds(new Set())
      fetchStats()
    } catch (err) { setError(err instanceof Error ? err.message : '批量更新失敗') }
    finally { setBatchLoading(false) }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === submissions.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(submissions.map((s) => s.id)))
  }

  /** 按週分組 */
  const groupedByWeek = useMemo(() => {
    const groups: { weekKey: string; weekLabel: string; sortKey: number; items: Submission[] }[] = []
    for (const sub of submissions) {
      const { key, label, sortKey } = getWeekRange(sub.create_time)
      let group = groups.find((g) => g.weekKey === key)
      if (!group) { group = { weekKey: key, weekLabel: label, sortKey, items: [] }; groups.push(group) }
      group.items.push(sub)
    }
    return groups.sort((a, b) => b.sortKey - a.sortKey)
  }, [submissions])

  if (loading) return <LoadingState text="載入表單列表..." />
  if (error && submissions.length === 0) return <ErrorState message={error} onRetry={() => fetchSubmissions(1)} />

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="text-xl">📝</span>
          自定義表單
        </h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-md border border-amber-200">
            待處理 {stats.pending}
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-md border border-green-200">
            已處理 {stats.processed}
          </span>
        </div>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>{error}
        </div>
      )}

      {/* 工具欄 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索姓名 / 電話 / 郵箱..."
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {formKeys.length > 1 && (
          <select
            value={formKeyFilter}
            onChange={(e) => setFormKeyFilter(e.target.value)}
            className="px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
          >
            <option value="">全部表單類型</option>
            {formKeys.map((fk) => (
              <option key={fk.form_key} value={fk.form_key}>{fk.form_name || fk.form_key} ({fk.count})</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'px-3 py-1.5 text-sm rounded transition-colors',
                statusFilter === f.value
                  ? 'bg-white shadow-sm font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest')}
          className="px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
        >
          <option value="newest">最新優先</option>
          <option value="oldest">最早優先</option>
        </select>
      </div>

      {/* 批量操作欄 */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-blue-700">已選 {selectedIds.size} 項</span>
            <button onClick={toggleSelectAll} className="text-xs text-blue-600 hover:underline">
              {selectedIds.size === submissions.length ? '取消全選' : '全選當前頁'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBatchStatus('1')}
              disabled={batchLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50"
            >
              標記已處理
            </button>
            <button
              onClick={() => handleBatchStatus('2')}
              disabled={batchLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              批量封存
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={batchLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              {batchLoading ? '🔄 處理中...' : '🗑️ 批量刪除'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {submissions.length === 0 ? (
        <EmptyState icon="📭" text="暫無表單提交記錄" />
      ) : (
        <div className="space-y-6">
          {groupedByWeek.map((group) => (
            <div key={group.weekKey}>
              {/* 週分隔線 */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs font-medium text-muted-foreground px-2">{group.weekLabel}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              {/* 卡片網格 */}
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                {group.items.map((sub) => (
                  <SubmissionCard
                    key={sub.id}
                    submission={sub}
                    formName={formNameMap[sub.form_key] || sub.form_key}
                    selected={selectedIds.has(sub.id)}
                    onToggle={() => toggleSelect(sub.id)}
                    onClick={() => handleViewDetail(sub.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 載入更多 */}
      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            onClick={() => fetchSubmissions(page + 1, true)}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loadingMore ? '🔄 載入中...' : `載入更多（剩餘 ${total - submissions.length} 條）`}
          </button>
        </div>
      )}

      {/* 詳情對話框 */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-8 flex items-center gap-3">
            <span className="inline-block animate-spin">🔄</span>
            <span className="text-sm text-muted-foreground">載入詳情...</span>
          </div>
        </div>
      )}
      {selectedDetail && (
        <SubmissionDetailModal
          detail={selectedDetail}
          formName={formNameMap[selectedDetail.form_key] || selectedDetail.form_key}
          onClose={() => setSelectedDetail(null)}
          onUpdateStatus={(status) => handleUpdateStatus(selectedDetail.id, status)}
          onDelete={() => handleDelete(selectedDetail.id)}
        />
      )}
    </div>
  )
}

/** 表單卡片 */
function SubmissionCard({
  submission, formName, selected, onToggle, onClick,
}: {
  submission: Submission
  formName: string
  selected: boolean
  onToggle: () => void
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        'bg-white rounded-lg border overflow-hidden transition-all',
        selected ? 'border-primary ring-2 ring-primary/20' : 'hover:shadow-md hover:border-primary/30',
      )}
    >
      {/* 頂部：勾選框 + 狀態點 + 時間 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
          <div className={cn('w-2 h-2 rounded-full', STATUS_DOT[submission.status] || 'bg-gray-400')} />
        </label>
        <span className="text-xs text-muted-foreground">{formatTime(submission.create_time)}</span>
      </div>
      {/* 中間：點擊區域 */}
      <div onClick={onClick} className="px-4 pb-3 cursor-pointer">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-foreground truncate">{submission.name || '未署名'}</span>
          <span className={cn(
            'inline-block px-2 py-0.5 rounded text-xs font-medium',
            STATUS_BADGES[submission.status] || 'bg-gray-100 text-gray-500',
          )}>
            {submission.status_label}
          </span>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          {submission.tel && (
            <div className="flex items-center gap-1">
              <span>📞</span><span className="truncate">{submission.tel}</span>
            </div>
          )}
          {submission.email && (
            <div className="flex items-center gap-1">
              <span>📧</span><span className="truncate">{submission.email}</span>
            </div>
          )}
          {submission.preview && (
            <div className="flex items-start gap-1">
              <span>📋</span>
              <span className="truncate text-muted-foreground/70">{submission.preview}</span>
            </div>
          )}
        </div>
        {submission.form_key !== '1' && submission.form_key !== 'general' && (
          <div className="mt-2 pt-2 border-t border-gray-50">
            <span className="inline-block px-1.5 py-0.5 bg-secondary/50 rounded text-[10px] text-muted-foreground">
              {formName}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** 詳情對話框 */
function SubmissionDetailModal({
  detail, formName, onClose, onUpdateStatus, onDelete,
}: {
  detail: SubmissionDetail
  formName: string
  onClose: () => void
  onUpdateStatus: (status: string) => void
  onDelete: () => void
}) {
  const dataEntries = useMemo(() => {
    return Object.entries(detail.data).filter(([, v]) => v !== undefined && v !== null && v !== '')
  }, [detail.data])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 頭部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{detail.name || '未署名'}</h2>
            <span className={cn(
              'inline-block px-2 py-0.5 rounded text-xs font-medium',
              STATUS_BADGES[detail.status] || 'bg-gray-100 text-gray-500',
            )}>
              {detail.status_label}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground">❌</button>
        </div>

        {/* 表單數據 */}
        <div className="px-5 py-4 space-y-2">
          {detail.form_key !== '1' && detail.form_key !== 'general' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span>表單類型:</span>
              <span className="px-2 py-0.5 bg-secondary/50 rounded">{formName}</span>
            </div>
          )}
          {dataEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">無數據</p>
          ) : (
            dataEntries.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 py-2 border-b last:border-b-0">
                <span className="text-sm font-medium text-muted-foreground min-w-[80px] shrink-0 pt-0.5">{key}</span>
                <span className="text-sm text-foreground break-all flex-1">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* 元數據 */}
        <div className="px-5 py-3 bg-secondary/30 border-t text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>提交時間</span>
            <span className="text-foreground">{formatDate(detail.create_time)}</span>
          </div>
          {detail.user_ip && (
            <div className="flex justify-between">
              <span>IP 位址</span>
              <span className="text-foreground font-mono">{detail.user_ip}</span>
            </div>
          )}
          {(detail.user_os || detail.user_bs) && (
            <div className="flex justify-between">
              <span>客戶端</span>
              <span className="text-foreground">{detail.user_os} / {detail.user_bs}</span>
            </div>
          )}
          {detail.source_url && (
            <div className="flex justify-between gap-2">
              <span className="shrink-0">來源</span>
              <a href={detail.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                {detail.source_url}
              </a>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center gap-2 px-5 py-4 border-t sticky bottom-0 bg-white">
          {detail.status !== '0' && (
            <button onClick={() => onUpdateStatus('0')} className="px-3 py-2 text-xs border rounded-md hover:bg-accent transition-colors">
              標記待處理
            </button>
          )}
          {detail.status !== '1' && (
            <button onClick={() => onUpdateStatus('1')} className="px-3 py-2 text-xs border rounded-md hover:bg-accent transition-colors">
              標記已處理
            </button>
          )}
          {detail.status !== '2' && (
            <button onClick={() => onUpdateStatus('2')} className="px-3 py-2 text-xs border rounded-md hover:bg-accent transition-colors">
              封存
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onDelete} className="inline-flex items-center gap-1 px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors">
            🗑️ 刪除
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity">
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
