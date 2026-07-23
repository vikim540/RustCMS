/**
 * 回收站頁面（v1.9.19 批量操作版）
 *
 * 唯一回收站實現 — Contents.tsx 中的「回收站」入口已改為連結到此頁。
 * 支援 mcode 查詢參數篩選特定模型下的回收站內容。
 * 永久刪除使用獨立 DeleteConfirmModal 組件（帶靜態資源縮圖預覽 + S3 清理）。
 * v1.9.19: 新增多選批量還原 / 批量永久刪除。
 */
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatDate, type Category, flattenCategories, getPageNumbers } from '../lib/utils'
import { LoadingState, EmptyState } from '../components/StateDisplay'
import DeleteConfirmModal from '../components/DeleteConfirmModal'

/** 回收站內容數據結構 */
interface TrashContent {
  id: number
  title: string
  scode: string
  update_time: string
}

/** 每頁條數 */
const PAGE_SIZE = 20

export default function Trash() {
  const [searchParams] = useSearchParams()
  const mcode = searchParams.get('mcode') || ''

  const [contents, setContents] = useState<TrashContent[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ id: number; title: string } | null>(null)

  // 批量操作狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)

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
      if (mcode) params.set('mcode', mcode)
      const res = await api.get<TrashContent[]>(`/admin/contents/trash?${params.toString()}`)
      setContents(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [page, mcode])

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

  // ===== 批量操作 =====

  /** 切換選中狀態 */
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 全選 / 取消全選（當前頁） */
  const toggleSelectAll = () => {
    if (contents.every((c) => selectedIds.has(c.id))) {
      // 取消全選當前頁
      setSelectedIds((prev) => {
        const next = new Set(prev)
        contents.forEach((c) => next.delete(c.id))
        return next
      })
    } else {
      // 全選當前頁
      setSelectedIds((prev) => {
        const next = new Set(prev)
        contents.forEach((c) => next.add(c.id))
        return next
      })
    }
  }

  /** 批量還原 */
  const handleBatchRestore = async () => {
    if (selectedIds.size === 0) return
    if (!window.confirm(`確定要還原選中的 ${selectedIds.size} 項內容嗎?`)) return
    setBatchLoading(true)
    setError('')
    const ids = Array.from(selectedIds)
    let failed = 0
    for (const id of ids) {
      try {
        await api.post(`/admin/contents/${id}/restore`)
      } catch {
        failed++
      }
    }
    setSelectedIds(new Set())
    setBatchLoading(false)
    if (failed > 0) {
      setError(`批量還原完成，失敗 ${failed} 項`)
    }
    await fetchContents()
  }

  /** 批量永久刪除（逐條調用，不清理 S3 資源） */
  const handleBatchPermanentDelete = async () => {
    if (selectedIds.size === 0) return
    if (!window.confirm(`確定要永久刪除選中的 ${selectedIds.size} 項內容嗎?\n\n⚠️ 此操作不可逆，刪除後無法恢復。\n（不會自動清理 S3 圖片資源，如需清理請逐條使用永久刪除）`)) return
    setBatchLoading(true)
    setError('')
    const ids = Array.from(selectedIds)
    let failed = 0
    for (const id of ids) {
      try {
        await api.del(`/admin/contents/${id}/permanent`)
      } catch {
        failed++
      }
    }
    setSelectedIds(new Set())
    setBatchLoading(false)
    if (failed > 0) {
      setError(`批量永久刪除完成，失敗 ${failed} 項`)
    }
    await fetchContents()
  }

  /** 清除選中（翻頁或刷新時保留跨頁選擇，僅手動清除） */
  const clearSelection = () => setSelectedIds(new Set())

  // 分頁計算
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageNumbers = getPageNumbers(page, totalPages)

  // 選中狀態輔助
  const allSelected = contents.length > 0 && contents.every((c) => selectedIds.has(c.id))
  const someSelected = contents.some((c) => selectedIds.has(c.id))

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-xl">🗑️</span>
            回收站
            {mcode && (
              <Link
                to={`/contents?mcode=${mcode}`}
                className="text-sm font-normal text-muted-foreground hover:text-primary transition-colors ml-2"
              >
                ← 返回列表
              </Link>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            已刪除的內容可在此還原或永久刪除
            {mcode && '（僅顯示當前模型的回收站內容）'}
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

      {/* 批量操作欄 */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-md">
          <span className="text-sm text-blue-700 font-medium">
            已選 {selectedIds.size} 項
          </span>
          <div className="h-4 w-px bg-blue-200" />
          <button
            onClick={handleBatchRestore}
            disabled={batchLoading}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>🔄</span>
            批量還原
          </button>
          <button
            onClick={handleBatchPermanentDelete}
            disabled={batchLoading}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>🗑️</span>
            批量永久刪除
          </button>
          <div className="h-4 w-px bg-blue-200" />
          <button
            onClick={clearSelection}
            disabled={batchLoading}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            取消選擇
          </button>
          {batchLoading && (
            <span className="text-sm text-muted-foreground animate-pulse">處理中...</span>
          )}
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
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && someSelected
                      }}
                      onChange={toggleSelectAll}
                      disabled={batchLoading}
                      className="w-4 h-4 cursor-pointer accent-blue-600"
                      title="全選 / 取消全選（當前頁）"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">欄目</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">刪除時間</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {contents.map((item) => {
                  const isSelected = selectedIds.has(item.id)
                  return (
                    <tr
                      key={item.id}
                      className={`border-b last:border-0 hover:bg-accent/50 transition-colors ${
                        isSelected ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          disabled={batchLoading}
                          className="w-4 h-4 cursor-pointer accent-blue-600"
                        />
                      </td>
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
                            disabled={actionLoading === item.id || batchLoading}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
                            title="還原"
                          >
                            <span className="text-sm">🔄</span>
                            還原
                          </button>
                          <button
                            onClick={() => setDeleteModal({ id: item.id, title: item.title })}
                            disabled={actionLoading === item.id || batchLoading}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            title="永久刪除"
                          >
                            <span className="text-sm">🗑️</span>
                            永久刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 分頁 */}
          {!loading && contents.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  共 {total} 條,第 {page}/{totalPages} 頁
                </span>
                {selectedIds.size > 0 && (
                  <span className="text-sm text-blue-600">
                    （已跨頁選 {selectedIds.size} 項）
                  </span>
                )}
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

      {/* 永久刪除確認 Modal（帶靜態資源縮圖預覽 + S3 清理選項） */}
      {deleteModal && (
        <DeleteConfirmModal
          contentId={deleteModal.id}
          title={deleteModal.title}
          onClose={() => setDeleteModal(null)}
          onSuccess={() => {
            setDeleteModal(null)
            fetchContents()
          }}
        />
      )}
    </div>
  )
}
