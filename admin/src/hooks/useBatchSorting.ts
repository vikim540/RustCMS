/**
 * 統一批量排序 Hook
 *
 * 設計參考：Slides.tsx 的 dirty tracking + batch-sorting 模式
 * 適用場景：欄目管理、擴展字段、幻燈片等需要批量修改排序的列表頁
 *
 * 使用方式：
 *   const { dirtySorts, markDirty, saveSorts, isSaving, clearDirty, dirtyCount } = useBatchSorting({
 *     endpoint: '/admin/sorts/batch-sorting',
 *     onSuccess: () => fetchTree(),
 *     onError: () => fetchTree(),  // 失敗時重新載入
 *   })
 */
import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface UseBatchSortingOptions {
  /** 批量排序 API 端點，如 '/admin/sorts/batch-sorting' */
  endpoint: string
  /** 保存成功後的回調（通常是重新載入列表） */
  onSuccess?: () => void | Promise<void>
  /** 保存失敗後的回調（通常是重新載入列表以恢復正確狀態） */
  onError?: () => void | Promise<void>
}

interface BatchSortItem {
  id: number
  sorting: number
}

export function useBatchSorting(options: UseBatchSortingOptions) {
  const { endpoint, onSuccess, onError } = options
  const [dirtySorts, setDirtySorts] = useState<Record<number, number>>({})
  const [isSaving, setIsSaving] = useState(false)
  // 防止並發保存
  const savingRef = useRef(false)

  /** 標記某個項目的排序為已修改 */
  const markDirty = useCallback((id: number, newSorting: number) => {
    setDirtySorts((prev) => ({ ...prev, [id]: newSorting }))
  }, [])

  /** 清除所有 dirty 標記 */
  const clearDirty = useCallback(() => {
    setDirtySorts({})
  }, [])

  /** 批量保存所有修改的排序值 */
  const saveSorts = useCallback(async () => {
    const items: BatchSortItem[] = Object.entries(dirtySorts).map(([id, sorting]) => ({
      id: Number(id),
      sorting,
    }))
    if (items.length === 0 || savingRef.current) return

    savingRef.current = true
    setIsSaving(true)
    try {
      await api.put(endpoint, { items })
      setDirtySorts({})
      if (onSuccess) await onSuccess()
    } catch {
      // 失敗時清除 dirty 並重新載入
      setDirtySorts({})
      if (onError) await onError()
    } finally {
      setIsSaving(false)
      savingRef.current = false
    }
  }, [dirtySorts, endpoint, onSuccess, onError])

  /** 檢查某個 id 是否有 dirty 標記 */
  const isDirty = useCallback((id: number) => id in dirtySorts, [dirtySorts])

  /** 獲取某個 id 的 dirty 排序值（若存在） */
  const getDirtyValue = useCallback((id: number) => dirtySorts[id], [dirtySorts])

  return {
    dirtySorts,
    dirtyCount: Object.keys(dirtySorts).length,
    isSaving,
    markDirty,
    clearDirty,
    saveSorts,
    isDirty,
    getDirtyValue,
  }
}
