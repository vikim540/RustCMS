import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useBatchSorting } from '../hooks/useBatchSorting'
import { BatchSortSaveBar, SortInput } from '../components/BatchSortSaveBar'
import { LoadingState, EmptyState, ErrorState } from '../components/StateDisplay'

/** 欄目節點 */
interface Sort {
  id: number
  name: string
  subname: string
  scode: string
  pcode: string
  mcode: string
  status: string
  sorting: number
  keywords: string
  description: string
  children?: Sort[]
}

/** 內容模型（用於欄目綁定） */
interface ContentModel {
  id: number
  name: string
  mcode: string
  type: string // "1"=單頁, "2"=列表
  status: string
  issystem: string
}

/** 新建欄目表單 */
interface CreateForm {
  name: string
  pcode: string
  mcode: string
}

/** 編輯欄目表單 */
interface EditForm {
  name: string
  subname: string
  sorting: number
  status: string
  keywords: string
  description: string
}

/** 將樹展平為選項列表，用於父欄目下拉選擇 */
function flattenForSelect(
  nodes: Sort[],
  depth = 0,
  acc: { scode: string; name: string; depth: number }[] = [],
): { scode: string; name: string; depth: number }[] {
  for (const node of nodes) {
    acc.push({ scode: node.scode, name: node.name, depth })
    if (node.children?.length) {
      flattenForSelect(node.children, depth + 1, acc)
    }
  }
  return acc
}

/** 將樹遞迴展平為一維列表，用於批量選擇 */
function flattenTree(nodes: Sort[]): Sort[] {
  const result: Sort[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children?.length) {
      result.push(...flattenTree(node.children))
    }
  }
  return result
}

/** 遞迴渲染樹節點行 */
function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  getModelName,
  markDirty,
  isDirty,
  getDirtyValue,
  selectedIds,
  onToggleSelect,
}: {
  node: Sort
  depth: number
  expanded: Set<string>
  onToggle: (scode: string) => void
  onEdit: (node: Sort) => void
  onDelete: (node: Sort) => void
  getModelName: (mcode: string) => string
  markDirty: (id: number, sorting: number) => void
  isDirty: (id: number) => boolean
  getDirtyValue: (id: number) => number | undefined
  selectedIds: Set<number>
  onToggleSelect: (id: number) => void
}) {
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = expanded.has(node.scode)
  const isSelected = selectedIds.has(node.id)

  return (
    <>
      <tr className="border-b last:border-b-0 hover:bg-accent/40 transition-colors">
        <td className="py-3 px-4">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(node.id)}
            className="rounded cursor-pointer"
          />
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => onToggle(node.scode)}
                className="mr-1.5 p-0.5 rounded hover:bg-accent transition-colors shrink-0"
                aria-label={isOpen ? '收起' : '展開'}
              >
                {isOpen ? <span>⬇️</span> : <span>➡️</span>}
              </button>
            ) : (
              <span className="inline-block w-5 mr-1.5 shrink-0" />
            )}
            <span className="font-medium truncate">{node.name}</span>
            {node.subname && (
              <span className="ml-2 text-sm text-muted-foreground truncate">({node.subname})</span>
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
          <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
            {getModelName(node.mcode)}
          </span>
        </td>
        <td className="py-3 px-4">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
              node.status === '1' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
            )}
          >
            {node.status === '1' ? '啟用' : '禁用'}
          </span>
        </td>
        <td className="py-3 px-4">
          <SortInput
            value={node.sorting}
            dirtyValue={getDirtyValue(node.id)}
            isDirty={isDirty(node.id)}
            onChange={(v) => markDirty(node.id, v)}
          />
        </td>
        <td className="py-3 px-4 text-xs text-muted-foreground font-mono">{node.scode}</td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(node)}
              className="p-1.5 rounded hover:bg-accent transition-colors"
              title="編輯"
            >
              <span>✏️</span>
            </button>
            <button
              onClick={() => onDelete(node)}
              className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="刪除"
            >
              <span>🗑️</span>
            </button>
          </div>
        </td>
      </tr>
      {hasChildren &&
        isOpen &&
        node.children!.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            getModelName={getModelName}
            markDirty={markDirty}
            isDirty={isDirty}
            getDirtyValue={getDirtyValue}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        ))}
    </>
  )
}

export default function Categories() {
  const [tree, setTree] = useState<Sort[]>([])
  const [models, setModels] = useState<ContentModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // 新增對話框狀態
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({ name: '', pcode: '0', mcode: '2' })
  const [creating, setCreating] = useState(false)

  // 編輯對話框狀態
  const [editTarget, setEditTarget] = useState<Sort | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    name: '',
    subname: '',
    sorting: 0,
    status: '1',
    keywords: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)

  // 刪除確認對話框狀態
  const [deleteTarget, setDeleteTarget] = useState<Sort | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 操作錯誤反饋
  const [actionError, setActionError] = useState('')

  // 批量選擇
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 批量刪除
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchDeleteProgress, setBatchDeleteProgress] = useState({ current: 0, total: 0 })

  /** 拉取欄目樹 */
  const fetchTree = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Sort[]>('/admin/sorts')
      const data = Array.isArray(res.data) ? res.data : []
      setTree(data)
      // 預設展開第一層節點
      setExpanded(new Set(data.map((n) => n.scode)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加載失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  // 批量排序 hook（在 fetchTree 之後定義，因為需要引用它作為回調）
  const { dirtyCount, isSaving, markDirty, saveSorts, clearDirty, isDirty, getDirtyValue } =
    useBatchSorting({
      endpoint: '/admin/sorts/batch-sorting',
      onSuccess: () => fetchTree(),
      onError: () => fetchTree(),
    })

  /** 拉取模型列表（用於欄目綁定下拉） */
  const fetchModels = useCallback(async () => {
    try {
      const res = await api.get<ContentModel[]>('/admin/models')
      setModels(res.data ?? [])
    } catch {
      /* 忽略模型載入錯誤 */
    }
  }, [])

  /** 取得模型名稱 */
  const getModelName = (mcode: string): string => {
    return models.find((m) => m.mcode === mcode)?.name ?? `模型${mcode}`
  }

  useEffect(() => {
    fetchTree()
    fetchModels()
  }, [fetchTree, fetchModels])

  /** 切換節點展開/收起 */
  const handleToggle = (scode: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(scode)) next.delete(scode)
      else next.add(scode)
      return next
    })
  }

  /** 全部展開 / 全部收起 */
  const allScodes = flattenForSelect(tree).map((o) => o.scode)
  const allExpanded = allScodes.length > 0 && allScodes.every((s) => expanded.has(s))
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(allScodes))
  }

  /** 開啟新增對話框 */
  const openCreate = () => {
    // 預設選擇第一個列表型模型 (type='2')
    const firstListModel = models.find((m) => m.type === '2' && m.status === '1')
    setCreateForm({ name: '', pcode: '0', mcode: firstListModel?.mcode || '2' })
    setActionError('')
    setCreateOpen(true)
  }

  /** 提交新增 */
  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      setActionError('欄目名稱不能為空')
      return
    }
    setCreating(true)
    setActionError('')
    try {
      await api.post('/admin/sorts', {
        name: createForm.name.trim(),
        pcode: createForm.pcode,
        mcode: createForm.mcode,
      })
      setCreateOpen(false)
      await fetchTree()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '創建失敗')
    } finally {
      setCreating(false)
    }
  }

  /** 開啟編輯對話框 */
  const openEdit = (node: Sort) => {
    setEditTarget(node)
    setEditForm({
      name: node.name,
      subname: node.subname || '',
      sorting: node.sorting ?? 0,
      status: node.status ?? '1',
      keywords: node.keywords || '',
      description: node.description || '',
    })
    setActionError('')
  }

  /** 提交編輯 */
  const handleEdit = async () => {
    if (!editTarget) return
    if (!editForm.name.trim()) {
      setActionError('欄目名稱不能為空')
      return
    }
    setSaving(true)
    setActionError('')
    try {
      await api.put(`/admin/sorts/${editTarget.id}`, {
        name: editForm.name.trim(),
        subname: editForm.subname,
        sorting: editForm.sorting,
        status: editForm.status,
        keywords: editForm.keywords,
        description: editForm.description,
      })
      setEditTarget(null)
      await fetchTree()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 確認刪除 */
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setActionError('')
    try {
      await api.del(`/admin/sorts/${deleteTarget.id}`)
      setDeleteTarget(null)
      await fetchTree()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setDeleting(false)
    }
  }

  /** 全部節點（展平，用於全選判斷） */
  const allNodes = useMemo(() => flattenTree(tree), [tree])
  const allSelected = allNodes.length > 0 && allNodes.every((n) => selectedIds.has(n.id))

  /** 全選 / 取消全選 */
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allNodes.map((n) => n.id)))
    }
  }

  /** 切換單個節點選擇 */
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 批量刪除（逐條調用，因為後端刪除是級聯的） */
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBatchDeleting(true)
    setBatchDeleteProgress({ current: 0, total: ids.length })
    setActionError('')
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.del(`/admin/sorts/${ids[i]}`)
      } catch {
        failed++
      }
      setBatchDeleteProgress({ current: i + 1, total: ids.length })
    }
    setBatchDeleting(false)
    setBatchDeleteOpen(false)
    setSelectedIds(new Set())
    clearDirty()
    if (failed > 0) {
      setActionError(`批量刪除完成，${failed} 項刪除失敗`)
    }
    await fetchTree()
  }

  const parentOptions = flattenForSelect(tree)

  return (
    <div className="p-6">
      {/* 頁頭 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">欄目管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理網站欄目分類樹狀結構</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setBatchDeleteOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
            >
              <span className="mr-1">🗑️</span>
              批量刪除（{selectedIds.size}）
            </button>
          )}
          {tree.length > 0 && (
            <button
              onClick={toggleAll}
              className="px-3 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
            >
              {allExpanded ? '全部收起' : '全部展開'}
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
          >
            <span className="mr-1">➕</span>
            新增欄目
          </button>
        </div>
      </div>

      {/* 全局操作錯誤提示 */}
      {actionError && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {actionError}
        </div>
      )}

      {/* 加載中 */}
      {loading && <LoadingState text="加載中..." />}

      {/* 加載錯誤 */}
      {!loading && error && <ErrorState message={error} onRetry={fetchTree} />}

      {/* 空狀態 */}
      {!loading && !error && tree.length === 0 && (
        <>
          <EmptyState icon="🗂️" text="尚未創建任何欄目" />
          <div className="flex justify-center -mt-16 pb-8">
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
            >
              <span className="mr-1">➕</span>
              新增欄目
            </button>
          </div>
        </>
      )}

      {/* 欄目樹表格 */}
      {!loading && !error && tree.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="text-left py-2.5 px-4 w-12">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded cursor-pointer"
                      title="全選/取消全選"
                    />
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    欄目名稱
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    模型
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    狀態
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    排序
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    編碼
                  </th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {tree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    onToggle={handleToggle}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                    getModelName={getModelName}
                    markDirty={markDirty}
                    isDirty={isDirty}
                    getDirtyValue={getDirtyValue}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 批量排序保存欄 */}
      {!loading && !error && tree.length > 0 && (
        <BatchSortSaveBar
          dirtyCount={dirtyCount}
          isSaving={isSaving}
          onSave={saveSorts}
          onClear={clearDirty}
          className="mt-3"
        />
      )}

      {/* 新增欄目對話框 */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">新增欄目</h2>
              <button
                onClick={() => setCreateOpen(false)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 欄目名稱 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  欄目名稱 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="請輸入欄目名稱"
                  autoFocus
                />
              </div>
              {/* 父欄目 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">父欄目</label>
                <select
                  value={createForm.pcode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, pcode: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                >
                  <option value="0">頂級欄目</option>
                  {parentOptions.map((opt) => (
                    <option key={opt.scode} value={opt.scode}>
                      {'　'.repeat(opt.depth)}{opt.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* 內容模型 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  內容模型 <span className="text-destructive">*</span>
                </label>
                <select
                  value={createForm.mcode}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, mcode: e.target.value }))
                  }
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                >
                  {models.length === 0 && (
                    <option value="">載入中...</option>
                  )}
                  {models.filter((m) => m.status === '1').map((m) => (
                    <option key={m.id} value={m.mcode}>
                      {m.name} ({m.type === '1' ? '單頁' : '列表'})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  欄目綁定模型後，編輯內容時將顯示該模型的自定義擴展字段
                </p>
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
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {creating && <span className="animate-spin inline-block">🔄</span>}
                {creating ? '創建中...' : '確認新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯欄目對話框 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">編輯欄目</h2>
              <button
                onClick={() => setEditTarget(null)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 欄目名稱 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  欄目名稱 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {/* 副標題 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">副標題</label>
                <input
                  type="text"
                  value={editForm.subname}
                  onChange={(e) => setEditForm((f) => ({ ...f, subname: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="欄目副標題（可選）"
                />
              </div>
              {/* 排序 & 狀態 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">排序</label>
                  <input
                    type="number"
                    value={editForm.sorting}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, sorting: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">狀態</label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, status: e.target.value }))
                    }
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                  >
                    <option value="1">啟用</option>
                    <option value="0">禁用</option>
                  </select>
                </div>
              </div>
              {/* 關鍵詞 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">關鍵詞</label>
                <input
                  type="text"
                  value={editForm.keywords}
                  onChange={(e) => setEditForm((f) => ({ ...f, keywords: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="SEO 關鍵詞，逗號分隔"
                />
              </div>
              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">描述</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  placeholder="欄目描述"
                />
              </div>
              {actionError && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <span className="mr-1">⚠️</span>
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t sticky bottom-0 bg-white">
              <button
                onClick={() => setEditTarget(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving && <span className="animate-spin inline-block">🔄</span>}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認對話框 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <span className="text-lg text-destructive">⚠️</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">確認刪除</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    確定要刪除欄目「<span className="font-medium text-foreground">{deleteTarget.name}</span>」嗎？
                  </p>
                  {deleteTarget.children && deleteTarget.children.length > 0 && (
                    <p className="text-sm text-destructive mt-2">
                      此欄目下含有子欄目，刪除後可能影響子欄目，請謹慎操作。
                    </p>
                  )}
                </div>
              </div>
              {actionError && (
                <p className="text-sm text-destructive mt-3 flex items-center gap-1.5">
                  <span className="mr-1">⚠️</span>
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {deleting && <span className="animate-spin inline-block">🔄</span>}
                {deleting ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量刪除確認對話框 */}
      {batchDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <span className="text-lg text-destructive">⚠️</span>
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">確認批量刪除</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    確定要刪除選中的{' '}
                    <span className="font-medium text-foreground">{selectedIds.size}</span>{' '}
                    個欄目嗎？
                  </p>
                  <p className="text-sm text-destructive mt-2">
                    ⚠️ 刪除欄目將同時刪除所有子欄目和關聯內容，此操作不可撤銷！
                  </p>
                  {batchDeleting && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-blue-600">
                      <span className="animate-spin inline-block">🔄</span>
                      正在刪除 {batchDeleteProgress.current}/{batchDeleteProgress.total}...
                    </div>
                  )}
                </div>
              </div>
              {actionError && (
                <p className="text-sm text-destructive mt-3 flex items-center gap-1.5">
                  <span className="mr-1">⚠️</span>
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t">
              <button
                onClick={() => setBatchDeleteOpen(false)}
                disabled={batchDeleting}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {batchDeleting && <span className="animate-spin inline-block">🔄</span>}
                {batchDeleting
                  ? `刪除中 ${batchDeleteProgress.current}/${batchDeleteProgress.total}`
                  : '確認批量刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
