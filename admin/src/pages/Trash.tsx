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

/** 文章關聯的靜態資源（與後端 ContentResource 對齊） */
interface ContentResource {
  key: string
  url: string
  source: string
  shared: boolean
  sharedWith: string[]
}

/** 永久刪除確認 Modal 狀態 */
interface DeleteModalState {
  id: number
  title: string
  loading: boolean
  images: ContentResource[]
  deleteResources: boolean
  deleting: boolean
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
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null)

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

  /** 開啟永久刪除確認 Modal（先拉取關聯靜態資源） */
  const handlePermanentDelete = async (id: number, title: string) => {
    setDeleteModal({
      id,
      title,
      loading: true,
      images: [],
      deleteResources: true,
      deleting: false,
    })
    try {
      const res = await api.get<{ title: string; images: ContentResource[] }>(
        `/admin/contents/${id}/resources`,
      )
      setDeleteModal((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              title: res.data?.title ?? title,
              images: res.data?.images ?? [],
            }
          : null,
      )
    } catch {
      setDeleteModal((prev) => (prev ? { ...prev, loading: false, images: [] } : null))
    }
  }

  /** 確認永久刪除 */
  const confirmPermanentDelete = async () => {
    if (!deleteModal) return
    const { id, deleteResources } = deleteModal
    setDeleteModal((prev) => (prev ? { ...prev, deleting: true } : null))
    setActionLoading(id)
    try {
      const url = deleteResources
        ? `/admin/contents/${id}/permanent?delete_resources=true`
        : `/admin/contents/${id}/permanent`
      await api.del(url)
      setDeleteModal(null)
      await fetchContents()
    } catch (err) {
      setError(err instanceof Error ? err.message : '永久刪除失敗')
      setDeleteModal((prev) => (prev ? { ...prev, deleting: false } : null))
    } finally {
      setActionLoading(null)
    }
  }

  // 分頁計算
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageNumbers = getPageNumbers(page, totalPages)

  // ===== Modal 衍生變量 =====
  const modalImages = deleteModal?.images ?? []
  const sharedCount = modalImages.filter((i) => i.shared).length
  const deletableCount = modalImages.length - sharedCount

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
                          onClick={() => handlePermanentDelete(item.id, item.title)}
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

      {/* ===== 永久刪除確認 Modal ===== */}
      {deleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !deleteModal.deleting && setDeleteModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span>🗑️</span>
                永久刪除確認
              </h2>
              {!deleteModal.deleting && (
                <button
                  onClick={() => setDeleteModal(null)}
                  className="text-muted-foreground hover:text-foreground text-xl leading-none"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* 文章標題 */}
              <div className="mb-3">
                <span className="text-sm text-muted-foreground">文章：</span>
                <span className="text-sm font-medium ml-1">
                  {deleteModal.title || '(無標題)'}
                </span>
              </div>

              {/* 警告 */}
              <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">
                <span className="shrink-0 text-base">⚠️</span>
                <span>
                  永久刪除後無法恢復，資料庫記錄將被清除。
                  {deleteModal.loading
                    ? '正在載入關聯的靜態資源...'
                    : modalImages.length > 0
                      ? '以下為該文章關聯的靜態圖片資源：'
                      : '此文章沒有關聯的靜態資源。'}
                </span>
              </div>

              {/* 載入中 */}
              {deleteModal.loading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <div className="animate-spin h-6 w-6 border-2 border-muted border-t-primary rounded-full mr-2" />
                  載入資源中...
                </div>
              )}

              {/* 縮圖網格 */}
              {!deleteModal.loading && modalImages.length > 0 && (
                <>
                  {/* 統計摘要 */}
                  <div className="mb-3 flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      共 <span className="font-medium text-foreground">{modalImages.length}</span> 張圖片
                    </span>
                    {sharedCount > 0 && (
                      <span className="text-amber-600">
                        其中 {sharedCount} 張被其他內容引用（將保留）
                      </span>
                    )}
                    {deletableCount > 0 && (
                      <span className="text-red-600">
                        {deletableCount} 張將被刪除
                      </span>
                    )}
                  </div>

                  {/* 圖片網格 */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {modalImages.map((img) => (
                      <div
                        key={img.key}
                        className={`relative rounded-lg overflow-hidden border-2 ${
                          img.shared ? 'border-amber-400' : 'border-transparent'
                        }`}
                      >
                        {/* 縮圖 */}
                        <div className="aspect-square bg-secondary/30">
                          <img
                            src={img.url}
                            alt={img.key}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              const target = e.currentTarget
                              target.style.display = 'none'
                              const parent = target.parentElement
                              if (parent) {
                                parent.classList.add('flex', 'items-center', 'justify-center')
                                parent.innerHTML = '<span class="text-2xl opacity-40">🖼️</span>'
                              }
                            }}
                          />
                        </div>

                        {/* 來源標籤 */}
                        <div className="absolute top-1 left-1">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                            {img.source}
                          </span>
                        </div>

                        {/* 共用標籤 */}
                        {img.shared && (
                          <div className="absolute top-1 right-1">
                            <span
                              className="inline-block px-1.5 py-0.5 text-[10px] bg-amber-500 text-white rounded"
                              title={`被引用：${img.sharedWith.join(', ')}`}
                            >
                              共用
                            </span>
                          </div>
                        )}

                        {/* 檔名 */}
                        <div className="px-1.5 py-1 text-[10px] text-muted-foreground truncate">
                          {img.key.split('/').pop()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 共用詳情 */}
                  {sharedCount > 0 && (
                    <div className="mt-3 px-4 py-2.5 bg-amber-50 rounded-lg text-xs text-amber-700">
                      <span className="font-medium">📌 共用圖片（將保留不刪除）：</span>
                      <ul className="mt-1 space-y-0.5">
                        {modalImages
                          .filter((i) => i.shared)
                          .map((i) => (
                            <li key={i.key}>
                              {i.key.split('/').pop()} — 被{' '}
                              {i.sharedWith.join('、')} 引用
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {/* 無圖片 */}
              {!deleteModal.loading && modalImages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <span className="text-3xl mb-2">📭</span>
                  <span className="text-sm">此文章沒有關聯的靜態圖片資源</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!deleteModal.loading && (
              <div className="px-6 py-4 border-t space-y-3">
                {/* 一併刪除靜態資源開關 */}
                {modalImages.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={deleteModal.deleteResources}
                      onChange={(e) =>
                        setDeleteModal((prev) =>
                          prev ? { ...prev, deleteResources: e.target.checked } : null,
                        )
                      }
                      disabled={deleteModal.deleting}
                      className="w-4 h-4 rounded accent-red-600"
                    />
                    <span className="text-sm">
                      一併刪除靜態資源
                      {deleteModal.deleteResources && deletableCount > 0 && (
                        <span className="text-red-600 ml-1">
                          （將刪除 {deletableCount} 張，保留 {sharedCount} 張共用圖片）
                        </span>
                      )}
                      {deleteModal.deleteResources && sharedCount === modalImages.length && (
                        <span className="text-amber-600 ml-1">
                          （所有圖片均被引用，不會刪除任何圖片）
                        </span>
                      )}
                    </span>
                  </label>
                )}

                {/* 操作按鈕 */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setDeleteModal(null)}
                    disabled={deleteModal.deleting}
                    className="px-4 py-2 text-sm border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmPermanentDelete}
                    disabled={deleteModal.deleting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleteModal.deleting ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />
                        刪除中...
                      </>
                    ) : (
                      <>
                        <span>🗑️</span>
                        確認永久刪除
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
