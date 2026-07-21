import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 單頁狀態: '1'=已發布, '0'=草稿 */
type SingleStatus = '1' | '0'

/** 單頁數據結構 */
interface Single {
  id: number
  title: string
  scode: string
  content: string
  keywords: string
  description: string
  status: SingleStatus
  sorting: number
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

/** 根據狀態取得徽章樣式 */
function getStatusBadge(status: SingleStatus): { label: string; className: string } {
  switch (status) {
    case '1':
      return { label: '已發布', className: 'bg-green-100 text-green-700' }
    case '0':
      return { label: '草稿', className: 'bg-gray-100 text-gray-600' }
    default:
      return { label: '未知', className: 'bg-gray-100 text-gray-600' }
  }
}

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

export default function Singles() {
  const [singles, setSingles] = useState<Single[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  /** 載入欄目樹（僅一次） */
  useEffect(() => {
    api
      .get<Category[]>('/admin/sorts')
      .then((res) => setCategories(res.data ?? []))
      .catch(() => {})
  }, [])

  /** 載入單頁列表 */
  const fetchSingles = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Single[]>('/admin/singles')
      setSingles(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSingles()
  }, [fetchSingles])

  /** 欄目映射（scode -> name） */
  const categoryMap = flattenCategories(categories)

  /** 刪除單頁 */
  const handleDelete = async (id: number) => {
    if (!window.confirm('確定要刪除此單頁嗎?')) return
    setActionLoading(id)
    try {
      await api.del(`/admin/singles/${id}`)
      await fetchSingles()
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
        <h1 className="text-2xl font-bold">單頁管理</h1>
        <Link
          to="/singles/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增單頁
        </Link>
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
      {!loading && singles.length === 0 && !error && (
        <div className="flex flex-col items-center">
          <EmptyState icon="📄" text="尚未創建任何單頁" />
          <Link
            to="/singles/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm -mt-10"
          >
            <span className="mr-1">➕</span>
            新增單頁
          </Link>
        </div>
      )}

      {/* 單頁表格 */}
      {!loading && singles.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">欄目</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">狀態</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {singles.map((item) => {
                  const badge = getStatusBadge(item.status)
                  return (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/singles/${item.id}`}
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {item.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {categoryMap[item.scode] ?? item.scode ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.sorting ?? 0}</td>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/singles/${item.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="編輯"
                          >
                            <span className="text-sm">✏️</span>
                            編輯
                          </Link>
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
    </div>
  )
}
