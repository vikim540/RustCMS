import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useBatchSorting } from '../hooks/useBatchSorting'
import { BatchSortSaveBar, SortInput } from '../components/BatchSortSaveBar'

/** 模型數據（用於篩選下拉） */
interface Model {
  id: number
  name: string
  mcode: string
}

/** 欄目數據（用於「適用欄目」多選） */
interface Category {
  id: number
  name: string
  scode: string
  pcode: string
  mcode: string
  status: string
  children?: Category[]
}

/** 擴展欄位數據結構 */
interface ExtField {
  id: number
  name: string
  field: string
  type: string // 1-10
  mcode: string
  value: string
  scode: string // 適用欄目，逗號分隔（空=全展示）
  required: string
  sorting: number
}

/** 擴展欄位表單 */
interface ExtFieldForm {
  name: string
  field: string
  type: string
  mcode: string
  value: string
  scode: string[] // 適用欄目 scode 列表
  required: string
  sorting: number
}

/** 空表單初始值 */
const EMPTY_FORM: ExtFieldForm = {
  name: '',
  field: '',
  type: '1',
  mcode: '',
  value: '',
  scode: [],
  required: '0',
  sorting: 0,
}

/** 欄位類型選項 */
const TYPE_OPTIONS = [
  { value: '1', label: '單行文本' },
  { value: '2', label: '多行文本' },
  { value: '3', label: '單選' },
  { value: '4', label: '多選' },
  { value: '5', label: '單圖' },
  { value: '6', label: '附件' },
  { value: '7', label: '日期' },
  { value: '8', label: '編輯器' },
  { value: '9', label: '下拉' },
  { value: '10', label: '多圖' },
]

/** 需要選項值的類型（3=單選, 4=多選, 9=下拉） */
const OPTION_TYPES = new Set(['3', '4', '9'])

/** 取得類型顯示文字 */
function getTypeLabel(type: string): string {
  return TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

/** 將欄目樹扁平化為列表（用於按 mcode 篩選） */
function flattenCategories(cats: Category[], depth = 0): Array<Category & { depth: number }> {
  const result: Array<Category & { depth: number }> = []
  for (const cat of cats) {
    result.push({ ...cat, depth })
    if (cat.children && cat.children.length > 0) {
      result.push(...flattenCategories(cat.children, depth + 1))
    }
  }
  return result
}

export default function ExtFields() {
  const [fields, setFields] = useState<ExtField[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  // 篩選模型
  const [filterMcode, setFilterMcode] = useState('')

  // 批量刪除狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ExtField | null>(null)
  const [form, setForm] = useState<ExtFieldForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  /** 扁平化欄目列表 */
  const flatCategories = useMemo(() => flattenCategories(categories), [categories])

  /** 根據當前選中模型篩選可用欄目 */
  const modelCategories = useMemo(() => {
    if (!form.mcode) return []
    return flatCategories.filter((c) => c.mcode === form.mcode)
  }, [flatCategories, form.mcode])

  /** 載入模型列表（用於篩選和表單下拉） */
  const fetchModels = useCallback(async () => {
    try {
      const res = await api.get<Model[]>('/admin/models')
      setModels(res.data ?? [])
    } catch {
      /* 忽略模型載入錯誤 */
    }
  }, [])

  /** 載入欄目樹（用於「適用欄目」多選） */
  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get<Category[]>('/admin/sorts')
      setCategories(res.data ?? [])
    } catch {
      /* 忽略欄目載入錯誤 */
    }
  }, [])

  /** 載入擴展欄位列表 */
  const fetchFields = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const path = filterMcode
        ? `/admin/extfields?mcode=${encodeURIComponent(filterMcode)}`
        : '/admin/extfields'
      const res = await api.get<ExtField[]>(path)
      setFields(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [filterMcode])

  // 批量排序 hook（dirty tracking 模式）
  const { dirtyCount, isSaving, markDirty, saveSorts, clearDirty, isDirty, getDirtyValue } = useBatchSorting({
    endpoint: '/admin/extfields/batch-sorting',
    onSuccess: () => fetchFields(),
    onError: () => fetchFields(),
  })

  useEffect(() => {
    fetchModels()
    fetchCategories()
  }, [fetchModels, fetchCategories])

  useEffect(() => {
    fetchFields()
  }, [fetchFields])

  // 切換篩選模型時清空選擇和 dirty 排序，避免跨列表誤操作
  useEffect(() => {
    setSelectedIds(new Set())
    clearDirty()
  }, [filterMcode, clearDirty])

  /** 取得模型名稱 */
  const getModelName = (mcode: string): string => {
    return models.find((m) => m.mcode === mcode)?.name ?? mcode ?? '-'
  }

  /** 取得欄目名稱 */
  const getCategoryName = (scode: string): string => {
    const cat = flatCategories.find((c) => c.scode === scode)
    return cat?.name ?? scode
  }

  /** 取得適用欄目顯示文字 */
  const getScodeDisplay = (scode: string): string => {
    if (!scode) return '全展示'
    const scodes = scode.split(',').map((s) => s.trim()).filter(Boolean)
    return scodes.map((s) => getCategoryName(s)).join('、')
  }

  /** 顯示成功消息（3 秒後自動消失） */
  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }, [])

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm({ ...EMPTY_FORM, mcode: filterMcode || models[0]?.mcode || '' })
    setActionError('')
    setModalOpen(true)
  }

  /** 開啟編輯對話框 */
  const openEdit = (item: ExtField) => {
    setEditTarget(item)
    setForm({
      name: item.name ?? '',
      field: item.field ?? '',
      type: item.type ?? '1',
      mcode: item.mcode ?? '',
      value: item.value ?? '',
      scode: item.scode ? item.scode.split(',').map((s) => s.trim()).filter(Boolean) : [],
      required: item.required ?? '0',
      sorting: item.sorting ?? 0,
    })
    setActionError('')
    setModalOpen(true)
  }

  /** 切換模型時清空已選欄目 */
  const handleModelChange = (mcode: string) => {
    setForm((f) => ({ ...f, mcode, scode: [] }))
  }

  /** 切換欄目選中狀態 */
  const toggleScode = (scode: string) => {
    setForm((f) => ({
      ...f,
      scode: f.scode.includes(scode)
        ? f.scode.filter((s) => s !== scode)
        : [...f.scode, scode],
    }))
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setActionError('欄位名稱不能為空')
      return
    }
    if (!form.field.trim()) {
      setActionError('DB列名不能為空')
      return
    }
    if (!form.mcode) {
      setActionError('請選擇所屬模型')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      const payload = {
        name: form.name.trim(),
        field: form.field.trim(),
        type: form.type,
        mcode: form.mcode,
        value: form.value,
        scode: form.scode.join(','), // 逗號分隔字串
        required: form.required,
        sorting: form.sorting,
      }
      if (editTarget) {
        await api.put(`/admin/extfields/${editTarget.id}`, payload)
      } else {
        await api.post('/admin/extfields', payload)
      }
      setModalOpen(false)
      await fetchFields()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除欄位（單條，後端物理刪除） */
  const handleDelete = async (item: ExtField) => {
    if (!window.confirm(`確定要徹底刪除欄位「${item.name}」嗎？此操作將同時刪除已有數據中的該欄位值，無法恢復！`)) return
    setActionLoading(item.id)
    try {
      await api.del(`/admin/extfields/${item.id}`)
      showSuccess('已徹底刪除')
      await fetchFields()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
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

  // 全選 / 取消全選（當前列表）
  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = fields.length > 0 && fields.every((f) => prev.has(f.id))
      const next = new Set(prev)
      if (allSelected) {
        for (const f of fields) next.delete(f.id)
      } else {
        for (const f of fields) next.add(f.id)
      }
      return next
    })
  }

  // 批量刪除（逐條呼叫 DELETE，並行執行）
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!window.confirm(`確定要徹底刪除選中的 ${selectedIds.size} 個欄位嗎？此操作將同時刪除相關數據，無法恢復！`)) return
    setBatchLoading(true)
    setError('')
    const ids = Array.from(selectedIds)
    const results = await Promise.allSettled(
      ids.map((id) => api.del(`/admin/extfields/${id}`)),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    setBatchLoading(false)
    if (failed > 0) {
      setError(`批量刪除完成，失敗 ${failed} 項`)
    } else {
      showSuccess(`已徹底刪除 ${ids.length} 個欄位`)
    }
    setSelectedIds(new Set())
    await fetchFields()
  }

  // 全選 / 部分選中狀態
  const allSelected = fields.length > 0 && fields.every((f) => selectedIds.has(f.id))
  const someSelected = fields.some((f) => selectedIds.has(f.id))

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">模型欄位</h1>
          <p className="text-sm text-muted-foreground mt-1">管理內容模型的自定義擴展欄位，可指定適用欄目</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增欄位
        </button>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 成功提示 */}
      {successMsg && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-md text-sm">
          <span className="shrink-0">✅</span>
          {successMsg}
        </div>
      )}

      {/* 篩選欄 */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>🔽</span>
          <span>所屬模型:</span>
        </div>
        <select
          value={filterMcode}
          onChange={(e) => setFilterMcode(e.target.value)}
          className="px-3 py-1.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white text-sm min-w-[200px]"
        >
          <option value="">全部模型</option>
          {models.map((m) => (
            <option key={m.id} value={m.mcode}>
              {m.name} ({m.mcode})
            </option>
          ))}
        </select>
      </div>

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
              {batchLoading ? '刪除中...' : '批量刪除'}
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

      {/* 加載中 */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <span className="animate-spin inline-block mr-2">🔄</span>
          載入中...
        </div>
      )}

      {/* 空狀態 */}
      {!loading && fields.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-50">🧩</span>
          <p className="mb-3">尚未創建任何擴展欄位</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
          >
            <span className="mr-1">➕</span>
            新增欄位
          </button>
        </div>
      )}

      {/* 欄位表格 */}
      {!loading && fields.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-3 py-3 text-left w-10">
                    <button
                      onClick={handleToggleSelectAll}
                      className="inline-flex items-center"
                      title={allSelected ? '取消全選' : '全選'}
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
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">欄位名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">DB列名</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">類型</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">所屬模型</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">適用欄目</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">必填</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">排序</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((item) => {
                  const isSelected = selectedIds.has(item.id)
                  return (
                  <tr
                    key={item.id}
                    className={cn(
                      'border-b last:border-0 hover:bg-accent/50 transition-colors',
                      isSelected && 'bg-blue-50/50',
                    )}
                  >
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
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{item.field}</td>
                    <td className="px-4 py-3 text-muted-foreground">{getTypeLabel(item.type)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{getModelName(item.mcode)}</td>
                    <td className="px-4 py-3">
                      {item.scode ? (
                        <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                          {getScodeDisplay(item.scode)}
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">
                          全展示
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block px-2 py-0.5 rounded text-xs font-medium',
                          item.required === '1'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-500',
                        )}
                      >
                        {item.required === '1' ? '必填' : '可選'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <SortInput
                        value={item.sorting ?? 0}
                        dirtyValue={getDirtyValue(item.id)}
                        isDirty={isDirty(item.id)}
                        onChange={(v) => markDirty(item.id, v)}
                        disabled={isSaving}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(item)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="編輯"
                        >
                          <span className="text-sm">✏️</span>
                          編輯
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
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

      {/* 批量排序保存欄 */}
      {!loading && fields.length > 0 && (
        <div className="mt-4">
          <BatchSortSaveBar
            dirtyCount={dirtyCount}
            isSaving={isSaving}
            onSave={saveSorts}
            onClear={clearDirty}
          />
        </div>
      )}

      {/* 新增/編輯對話框 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">{editTarget ? '編輯欄位' : '新增欄位'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 欄位名稱 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  欄位名稱 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="顯示名稱，如 產品價格"
                  autoFocus
                />
              </div>
              {/* DB列名 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  DB列名 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.field}
                  onChange={(e) => setForm((f) => ({ ...f, field: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                  placeholder="存儲列名，如 ext_price"
                  disabled={!!editTarget}
                />
                {editTarget && (
                  <p className="text-xs text-muted-foreground mt-1">列名創建後不可修改</p>
                )}
              </div>
              {/* 所屬模型 + 類型 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    所屬模型 <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={form.mcode}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                  >
                    <option value="">請選擇模型</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.mcode}>
                        {m.name} ({m.mcode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">類型</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/* 適用欄目（多選 checkbox，依據所選模型篩選） */}
              <div>
                <label className="block text-sm font-medium mb-1.5">適用欄目</label>
                <p className="text-xs text-muted-foreground mb-2">
                  不勾選則該字段在所有同模型欄目下都顯示。可勾選多個欄目。
                </p>
                <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-1.5">
                  {form.mcode === '' ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">請先選擇所屬模型</p>
                  ) : modelCategories.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">該模型下暫無欄目</p>
                  ) : (
                    modelCategories.map((cat) => (
                      <label
                        key={cat.scode}
                        className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 px-2 py-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={form.scode.includes(cat.scode)}
                          onChange={() => toggleScode(cat.scode)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm" style={{ paddingLeft: `${cat.depth * 16}px` }}>
                          {cat.depth > 0 ? '├ ' : ''}
                          {cat.name}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              {/* 選項值（僅 3/4/9 類型顯示） */}
              {OPTION_TYPES.has(form.type) && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">選項值</label>
                  <input
                    type="text"
                    value={form.value}
                    onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="多個選項以逗號分隔，如 選項一,選項二,選項三"
                  />
                  <p className="text-xs text-muted-foreground mt-1">供單選/多選/下拉使用的選項列表</p>
                </div>
              )}
              {/* 必填 + 排序 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">是否必填</label>
                  <select
                    value={form.required}
                    onChange={(e) => setForm((f) => ({ ...f, required: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                  >
                    <option value="0">可選</option>
                    <option value="1">必填</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">排序</label>
                  <input
                    type="number"
                    value={form.sorting}
                    onChange={(e) => setForm((f) => ({ ...f, sorting: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="數字越小越靠前"
                  />
                </div>
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
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
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
    </div>
  )
}
