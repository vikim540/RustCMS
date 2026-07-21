import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 回收站內容數據結構 */
interface TrashContent {
  id: number
  title: string
  scode: string
  update_time: string
}

/** 欄目（分類）樹節點 */
interface Category {
  id: number
  name: string
  scode: string
  pcode: string
  status: string
  children?: Category[]
}

/** 每頁條數 */
const PAGE_SIZE = 20

/** 將欄目樹扁平化為 scode -> name 的映射 */
function flattenCategories(
  categories: Category[],
  map: Record<string, string> = {},
): Record<string, string> {
  for (const cat of categories) {
    map[cat.scode] = cat.name
    if (cat.children && cat.children.length > 0) {
      flattenCategories(cat.children, map)
    }
  }
  return map
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

export default function Trash() {
  const [contents, setContents] = useState<TrashContent[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 載入欄目樹（僅一次）
  useEffect(() => {
    api
      .get<Category[]>('/admin/sorts')
      .then((res) => setCategories(res.data ?? []))
      .catch(() => {})
  }, [])

  /** 載入回收站內容列表 */
  const fetchContents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pagesize', String(PAGE_SIZE))
      const res = await api.get<TrashContent[]>(`/admin/contents/trash?${params.toString()}`)
      setContents(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    fetchContents()
  }, [fetchContents])

  // 欄目映射（scode -> name）
  const categoryMap = flattenCategories(categories)

  /** 還原內容 */
  const handleRestore = async (id: number) => {
    if (!window.confirm('確定要還原此內容嗎?')) return
    setActionLoading(id)
    try {
      await api.post(`/admin/contents/${id}/restore`)
      await fetchContents()
    } catch (err) {
      setError(err instanceof Error ? err.message : '還原失敗')
    } finally {
      setActionLoading(null)
    }
  }

  /** 永久刪除 */
  const handlePermanentDelete = async (id: number) => {
    if (!window.confirm('永久刪除後無法恢復,確定要刪除嗎?')) return
    setActionLoading(id)
    try {
      await api.del(`/admin/contents/${id}/permanent`)
      await fetchContents()
    } catch (err) {
      setError(err instanceof Error ? err.message : '永久刪除失敗')
    } finally {
      setActionLoading(null)
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
            <span className="text-xl">🗑️</span>
            回收站
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            已刪除的內容可在此還原或永久刪除
          </p>
        </div>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 加載中 */}
      {loading && <LoadingState text="載入中..." />}

      {/* 空狀態 */}
      {!loading && contents.length === 0 && !error && (
        <EmptyState icon="🗑️" text="回收站為空" />
      )}

      {/* 內容表格 */}
      {!loading && contents.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">欄目</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">刪除時間</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {contents.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                    <td className="px-4 py-3 font-medium">{item.title || '(無標題)'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {categoryMap[item.scode] ?? item.scode ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(item.update_time)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleRestore(item.id)}
                          disabled={actionLoading === item.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
                          title="還原"
                        >
                          <span className="text-sm">🔄</span>
                          還原
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(item.id)}
                          disabled={actionLoading === item.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          title="永久刪除"
                        >
                          <span className="text-sm">🗑️</span>
                          永久刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分頁 */}
          {!loading && contents.length > 0 && (
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
                      className={
                        p === page
                          ? 'min-w-[32px] px-2 py-1.5 text-sm border rounded-md bg-primary text-primary-foreground border-primary'
                          : 'min-w-[32px] px-2 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors'
                      }
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
