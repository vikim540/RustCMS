import { useEffect, useState, useCallback, useMemo } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { cn, formatDate } from '../lib/utils'

/** 內容狀態: '1'=已發布, '0'=草稿, '-1'=回收站 */
type ContentStatus = '1' | '0' | '-1'

/** 內容數據結構 */
interface Content {
  id: number
  title: string
  scode: string
  content: string
  date: string
  status: ContentStatus
  istop: string
  isrecommend: string
  isheadline: string
  visits: number
  keywords: string
  description: string
  sorting: number
  author: string
  source: string
  /** 修改時間 */
  update_time: string
  /** 標籤（逗號分隔字串） */
  tags: string
  /** 縮圖 */
  ico: string
  /** 多圖（逗號分隔） */
  pics: string
  /** 外鏈 */
  outlink: string
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

/** 欄目下拉選項（含層級） */
interface CategoryOption {
  scode: string
  name: string
  depth: number
}

/** 模型數據結構 */
interface Model {
  id: number
  name: string
  mcode: string
  type: string // "1"=單頁, "2"=列表
  urlname: string
  status: string // "1"=啟用, "0"=禁用
  issystem: string
}

/** 每頁條數可選項 */
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

/** 預設每頁條數 */
const DEFAULT_PAGE_SIZE = 20

/** 狀態標籤頁定義 */
const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: '1', label: '已發布' },
  { key: '0', label: '草稿' },
  { key: '-1', label: '回收站' },
] as const

/** 根據狀態取得徽章樣式 */
function getStatusBadge(status: ContentStatus): { label: string; className: string } {
  switch (status) {
    case '1':
      return { label: '已發布', className: 'bg-green-100 text-green-700' }
    case '0':
      return { label: '草稿', className: 'bg-gray-100 text-gray-600' }
    case '-1':
      return { label: '回收站', className: 'bg-red-100 text-red-700' }
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

/** 將欄目樹扁平化為下拉選項列表（含層級縮排） */
function flattenCategoriesForSelect(
  categories: Category[],
  depth = 0,
  acc: CategoryOption[] = [],
): CategoryOption[] {
  for (const cat of categories) {
    acc.push({ scode: cat.scode, name: cat.name, depth })
    if (cat.children && cat.children.length > 0) {
      flattenCategoriesForSelect(cat.children, depth + 1, acc)
    }
  }
  return acc
}

/** 將 tags 字串解析為陣列（支援中英文逗號） */
function parseTags(tags: string): string[] {
  if (!tags) return []
  return tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
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

export default function Contents() {
  const [contents, setContents] = useState<Content[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [scodeFilter, setScodeFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [models, setModels] = useState<Model[]>([])
  // 排序內聯編輯
  const [editingSortId, setEditingSortId] = useState<number | null>(null)
  const [sortValue, setSortValue] = useState('')

  // 從 URL query 讀取 mcode（模型分類）
  const [searchParams, setSearchParams] = useSearchParams()
  const mcode = searchParams.get('mcode') || ''

  // 載入模型列表（僅一次），用於構建 mcode -> name 映射與模型標籤頁
  useEffect(() => {
    api
      .get<Model[]>('/admin/models/all')
      .then((res) => setModels(res.data ?? []))
      .catch(() => {})
  }, [])

  // 載入欄目樹（依當前 mcode 過濾，只顯示該模型下的欄目）
  useEffect(() => {
    const path = mcode
      ? `/admin/sorts?mcode=${encodeURIComponent(mcode)}`
      : '/admin/sorts'
    api
      .get<Category[]>(path)
      .then((res) => setCategories(res.data ?? []))
      .catch(() => {})
  }, [mcode])

  // 當 mcode 變化時重置欄目篩選與頁碼，避免跨模型誤用舊條件
  useEffect(() => {
    setScodeFilter('')
    setPage(1)
  }, [mcode])

  // 載入內容列表
  const fetchContents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pagesize', String(pageSize))
      if (activeTab !== 'all') {
        params.set('status', activeTab)
      }
      if (searchKeyword) {
        params.set('keyword', searchKeyword)
      }
      if (scodeFilter) {
        params.set('scode', scodeFilter)
      }
      if (mcode) {
        params.set('mcode', mcode)
      }
      const res = await api.get<Content[]>(`/admin/contents?${params.toString()}`)
      setContents(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, activeTab, searchKeyword, scodeFilter, mcode])

  useEffect(() => {
    fetchContents()
  }, [fetchContents])

  // 切換頁碼、篩選或每頁條數時清空選擇，避免跨頁誤操作
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, pageSize, activeTab, searchKeyword, scodeFilter, mcode])

  // 欄目映射（scode -> name）
  const categoryMap = useMemo(() => flattenCategories(categories), [categories])
  // 欄目下拉選項
  const categoryOptions = useMemo(
    () => flattenCategoriesForSelect(categories),
    [categories],
  )
  // 模型映射（mcode -> name）
  const modelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of models) {
      map[m.mcode] = m.name
    }
    return map
  }, [models])
  // 列表型且啟用的模型（用於模型標籤頁）
  const listModels = useMemo(
    () => models.filter((m) => m.type === '2' && m.status === '1'),
    [models],
  )
  // 當前模型名稱（用於頁面標題：如「文章管理」）
  const currentModelName = mcode ? (modelMap[mcode] ?? '') : ''
  const pageTitle = currentModelName ? `${currentModelName}管理` : '內容管理'

  // 搜尋
  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearchKeyword(keyword)
  }

  // 切換狀態標籤
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setPage(1)
  }

  // 切換模型分類（寫入 URL query 參數 mcode）
  const handleModelTabChange = (code: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (code) {
        next.set('mcode', code)
      } else {
        next.delete('mcode')
      }
      return next
    })
    setPage(1)
  }

  // 切換欄目篩選
  const handleScodeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setScodeFilter(e.target.value)
    setPage(1)
  }

  // 切換每頁條數
  const handlePageSizeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setPageSize(Number(e.target.value))
    setPage(1)
  }

  // 軟刪除（移至回收站）
  const handleDelete = async (id: number) => {
    if (!confirm('確定要將此內容移至回收站?')) return
    setActionLoading(id)
    try {
      await api.del(`/admin/contents/${id}`)
      await fetchContents()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setActionLoading(null)
    }
  }

  // 從回收站還原
  const handleRestore = async (id: number) => {
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

  // 永久刪除
  const handlePermanentDelete = async (id: number) => {
    if (!confirm('永久刪除後無法恢復,確定要刪除嗎?')) return
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

  // 切換置頂（呼叫 PUT /admin/contents/:id）
  const handleToggleTop = async (item: Content) => {
    setActionLoading(item.id)
    try {
      const newValue = item.istop === '1' ? '0' : '1'
      await api.put(`/admin/contents/${item.id}`, { istop: newValue })
      // 本地更新狀態，避免完整重新拉取
      setContents((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, istop: newValue } : c)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '切換置頂失敗')
    } finally {
      setActionLoading(null)
    }
  }

  // 切換推薦（呼叫 PUT /admin/contents/:id）
  const handleToggleRecommend = async (item: Content) => {
    setActionLoading(item.id)
    try {
      const newValue = item.isrecommend === '1' ? '0' : '1'
      await api.put(`/admin/contents/${item.id}`, { isrecommend: newValue })
      setContents((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, isrecommend: newValue } : c)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '切換推薦失敗')
    } finally {
      setActionLoading(null)
    }
  }

  // 內聯修改排序（數值越小越靠前，參考 PbootCMS sorting ASC 邏輯）
  const handleSortSave = async (id: number) => {
    const val = parseInt(sortValue, 10)
    if (isNaN(val) || val < 0 || val > 9999) {
      setEditingSortId(null)
      return
    }
    setEditingSortId(null)
    if (val === contents.find((c) => c.id === id)?.sorting) return
    setActionLoading(id)
    try {
      await api.put(`/admin/contents/${id}`, { sorting: val })
      setContents((prev) =>
        prev.map((c) => (c.id === id ? { ...c, sorting: val } : c)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '排序更新失敗')
    } finally {
      setActionLoading(null)
    }
  }

  // 單列勾選 / 取消勾選
  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // 全選 / 取消全選（當前頁）
  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = contents.length > 0 && contents.every((c) => prev.has(c.id))
      const next = new Set(prev)
      if (allSelected) {
        // 取消當前頁選擇
        for (const c of contents) next.delete(c.id)
      } else {
        // 選擇當前頁全部
        for (const c of contents) next.add(c.id)
      }
      return next
    })
  }

  // 批量刪除（逐筆呼叫 DELETE）
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`確定要將選中的 ${selectedIds.size} 項內容移至回收站?`)) return
    setBatchLoading(true)
    setError('')
    let failed = 0
    const ids = Array.from(selectedIds)
    await Promise.all(
      ids.map(async (id) => {
        try {
          await api.del(`/admin/contents/${id}`)
        } catch {
          failed += 1
        }
      }),
    )
    setBatchLoading(false)
    if (failed > 0) {
      setError(`批量刪除完成，失敗 ${failed} 項`)
    }
    setSelectedIds(new Set())
    await fetchContents()
  }

  // 分頁計算
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageNumbers = getPageNumbers(page, totalPages)

  // 全選 / 部分選中狀態
  const allSelected = contents.length > 0 && contents.every((c) => selectedIds.has(c.id))
  const someSelected = contents.some((c) => selectedIds.has(c.id))

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{pageTitle}</h1>
        <Link
          to={
            mcode
              ? `/contents/new?mcode=${encodeURIComponent(mcode)}`
              : '/contents/new'
          }
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新建內容
        </Link>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* 模型分類標籤 */}
      <div className="flex gap-1 mb-4 border-b overflow-x-auto">
        <button
          onClick={() => handleModelTabChange('')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
            mcode === ''
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          全部
        </button>
        {listModels.map((m) => (
          <button
            key={m.mcode}
            onClick={() => handleModelTabChange(m.mcode)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              mcode === m.mcode
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {m.name}列表
          </button>
        ))}
      </div>

      {/* 狀態標籤 */}
      <div className="flex gap-1 mb-4 border-b">
        {STATUS_TABS.map((tab) => (
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

      {/* 搜尋與欄目篩選欄 */}
      <form onSubmit={handleSearch} className="mb-4 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋標題或關鍵字..."
            className="w-full pl-9 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
          />
        </div>
        {/* 欄目篩選下拉 */}
        <div className="relative">
          <select
            value={scodeFilter}
            onChange={handleScodeChange}
            className="appearance-none pl-3 pr-8 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm bg-white min-w-[160px]"
          >
            <option value="">全部欄目</option>
            {categoryOptions.map((opt) => (
              <option key={opt.scode} value={opt.scode}>
                {opt.depth === 0 ? opt.name : `${'— '.repeat(opt.depth)}${opt.name}`}
              </option>
            ))}
          </select>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">⬇️</span>
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-accent transition-colors text-sm"
        >
          搜尋
        </button>
      </form>

      {/* 批量操作欄 */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center justify-between px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-md">
          <span className="text-sm text-blue-700">已選 {selectedIds.size} 項</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchDelete}
              disabled={batchLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              <span className="text-sm">🗑️</span>
              批量刪除
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={batchLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground bg-white border rounded-md hover:bg-accent transition-colors"
            >
              取消選擇
            </button>
          </div>
        </div>
      )}

      {/* 內容表格 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary/50">
                <th className="px-3 py-3 text-left w-10">
                  <button
                    onClick={handleToggleSelectAll}
                    className="inline-flex items-center"
                    title={allSelected ? '取消全選' : '全選當前頁'}
                  >
                    {allSelected ? (
                      <span className="text-primary">✅</span>
                    ) : someSelected ? (
                      <span className="text-primary opacity-50">☑️</span>
                    ) : (
                      <span className="text-muted-foreground">⬜</span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">標題</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">欄目</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">狀態</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground" title="點擊數值可修改，數值越小越靠前">排序 ↕</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">訪問量</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">置頂</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">推薦</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">日期</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    載入中...
                  </td>
                </tr>
              ) : contents.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    暫無數據
                  </td>
                </tr>
              ) : (
                contents.map((item) => {
                  const badge = getStatusBadge(item.status)
                  const isTrash = item.status === '-1'
                  const isSelected = selectedIds.has(item.id)
                  const tags = parseTags(item.tags)
                  const formattedDate = formatDate(item.date)
                  const formattedUpdate = formatDate(item.update_time)
                  const showUpdate =
                    formattedUpdate !== '-' && formattedUpdate !== formattedDate
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'border-b last:border-0 hover:bg-accent/50 transition-colors',
                        isSelected && 'bg-blue-50/50',
                        item.istop === '1' && !isSelected && 'bg-blue-50/30',
                        item.isrecommend === '1' && item.istop !== '1' && !isSelected && 'bg-orange-50/30',
                      )}
                    >
                      {/* 勾選框 */}
                      <td className="px-3 py-3">
                        <button
                          onClick={() => handleToggleSelect(item.id)}
                          className="inline-flex items-center"
                          title={isSelected ? '取消選擇' : '選擇'}
                        >
                          {isSelected ? (
                            <span className="text-primary">✅</span>
                          ) : (
                            <span className="text-muted-foreground">⬜</span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                      {/* 標題（含標記徽章與標籤） */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Link
                              to={`/contents/${item.id}`}
                              className="text-foreground hover:text-primary hover:underline"
                            >
                              {item.title}
                            </Link>
                            {/* 標記徽章 */}
                            {item.istop === '1' && (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                                置頂
                              </span>
                            )}
                            {item.isrecommend === '1' && (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">
                                推薦
                              </span>
                            )}
                            {item.isheadline === '1' && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                                <span className="text-[10px]">📰</span>
                                頭條
                              </span>
                            )}
                          </div>
                          {/* 標籤徽章 */}
                          {tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {tags.slice(0, 5).map((tag, idx) => (
                                <span
                                  key={`${tag}-${idx}`}
                                  className="inline-block px-1.5 py-0 rounded text-[10px] bg-gray-100 text-gray-500 border border-gray-200"
                                >
                                  {tag}
                                </span>
                              ))}
                              {tags.length > 5 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{tags.length - 5}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {categoryMap[item.scode] ?? item.scode ?? '-'}
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
                      {/* 排序（點擊可內聯修改，數值越小越靠前） */}
                      <td className="px-4 py-3">
                        {editingSortId === item.id ? (
                          <input
                            type="number"
                            value={sortValue}
                            onChange={(e) => setSortValue(e.target.value)}
                            onBlur={() => handleSortSave(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleSortSave(item.id)
                              }
                              if (e.key === 'Escape') setEditingSortId(null)
                            }}
                            className="w-16 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring text-center"
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => {
                              setEditingSortId(item.id)
                              setSortValue(String(item.sorting ?? 0))
                            }}
                            disabled={actionLoading === item.id || isTrash}
                            className={cn(
                              'px-2 py-1 rounded transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed',
                              item.sorting === 0
                                ? 'text-amber-600 font-medium'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                            )}
                            title="點擊修改排序（數值越小越靠前）"
                          >
                            {item.sorting ?? 0}
                          </button>
                        )}
                      </td>
                      {/* 訪問量 */}
                      <td className="px-4 py-3 text-muted-foreground">{item.visits ?? 0}</td>
                      {/* 置頂切換鈕 */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleTop(item)}
                          disabled={actionLoading === item.id || isTrash}
                          className={cn(
                            'inline-flex items-center justify-center p-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                            item.istop === '1'
                              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                              : 'text-muted-foreground hover:bg-accent',
                          )}
                          title={item.istop === '1' ? '取消置頂' : '置頂'}
                        >
                          <span className="text-sm">📌</span>
                        </button>
                      </td>
                      {/* 推薦切換鈕 */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleRecommend(item)}
                          disabled={actionLoading === item.id || isTrash}
                          className={cn(
                            'inline-flex items-center justify-center p-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                            item.isrecommend === '1'
                              ? 'text-orange-600 bg-orange-50 hover:bg-orange-100'
                              : 'text-muted-foreground hover:bg-accent',
                          )}
                          title={item.isrecommend === '1' ? '取消推薦' : '推薦'}
                        >
                          <span className="text-sm">⭐</span>
                        </button>
                      </td>
                      {/* 日期（發佈時間 + 修改時間） */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <div className="flex flex-col">
                          <span>{formattedDate}</span>
                          {showUpdate && (
                            <span className="text-[10px] text-muted-foreground/70">
                              修改: {formattedUpdate}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isTrash ? (
                            <>
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
                            </>
                          ) : (
                            <>
                              <Link
                                to={`/contents/${item.id}`}
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
                                title="移至回收站"
                              >
                                <span className="text-sm">🗑️</span>
                                刪除
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分頁 */}
        {!loading && contents.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                共 {total} 條，第 {page}/{totalPages} 頁
              </span>
              {/* 每頁條數選擇器 */}
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">每頁</span>
                <div className="relative">
                  <select
                    value={pageSize}
                    onChange={handlePageSizeChange}
                    className="appearance-none pl-2 pr-7 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm bg-white"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-xs">⬇️</span>
                </div>
                <span className="text-sm text-muted-foreground">條</span>
              </div>
            </div>
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
    </div>
  )
}
