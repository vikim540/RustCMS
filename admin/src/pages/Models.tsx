import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 模型數據結構 */
interface Model {
  id: number
  name: string
  mcode: string
  type: string // "1"=單頁, "2"=列表
  urlname: string
  status: string
  issystem: string // "1"=系統模型，不可刪除
}

/** 模型表單 */
interface ModelForm {
  name: string
  type: string
  urlname: string
  status: string
}

/** 空表單初始值 */
const EMPTY_FORM: ModelForm = {
  name: '',
  type: '2',
  urlname: '',
  status: '1',
}

/** 模型類型選項: 1=單頁, 2=列表 */
const TYPE_OPTIONS = [
  { value: '1', label: '單頁' },
  { value: '2', label: '列表' },
]

/** 取得模型類型顯示文字 */
function getTypeLabel(type: string): string {
  return type === '1' ? '單頁' : type === '2' ? '列表' : type
}

export default function Models() {
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Model | null>(null)
  const [form, setForm] = useState<ModelForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  /** 載入模型列表 */
  const fetchModels = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Model[]>('/admin/models')
      setModels(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setActionError('')
    setModalOpen(true)
  }

  /** 開啟編輯對話框 */
  const openEdit = (item: Model) => {
    setEditTarget(item)
    setForm({
      name: item.name ?? '',
      type: item.type ?? '2',
      urlname: item.urlname ?? '',
      status: item.status ?? '1',
    })
    setActionError('')
    setModalOpen(true)
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setActionError('模型名稱不能為空')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        urlname: form.urlname.trim(),
        status: form.status,
      }
      if (editTarget) {
        await api.put(`/admin/models/${editTarget.id}`, payload)
      } else {
        await api.post('/admin/models', payload)
      }
      setModalOpen(false)
      await fetchModels()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除模型 */
  const handleDelete = async (item: Model) => {
    if (item.issystem === '1') return
    if (!window.confirm(`確定要刪除模型「${item.name}」嗎?`)) return
    setActionLoading(item.id)
    try {
      await api.del(`/admin/models/${item.id}`)
      await fetchModels()
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
        <div>
          <h1 className="text-2xl font-bold">模型管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理內容模型，用於定義不同類型的內容結構</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增模型
        </button>
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
      {!loading && models.length === 0 && !error && (
        <>
          <EmptyState icon="📦" text="尚未創建任何模型" />
          <div className="flex justify-center -mt-16 pb-8">
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
            >
              <span className="mr-1">➕</span>
              新增模型
            </button>
          </div>
        </>
      )}

      {/* 模型表格 */}
      {!loading && models.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">代碼</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">類型</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">URL名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">狀態</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {models.map((item) => {
                  const isSystem = item.issystem === '1'
                  return (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{item.name}</span>
                          {isSystem && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                              <span className="text-[10px]">🔒</span>
                              系統
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{item.mcode}</td>
                      <td className="px-4 py-3 text-muted-foreground">{getTypeLabel(item.type)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.urlname || '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-block px-2 py-0.5 rounded text-xs font-medium',
                            item.status === '1'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500',
                          )}
                        >
                          {item.status === '1' ? '啟用' : '禁用'}
                        </span>
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
                            disabled={actionLoading === item.id || isSystem}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors disabled:opacity-50',
                              isSystem
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-red-600 hover:bg-red-50',
                            )}
                            title={isSystem ? '系統模型不可刪除' : '刪除'}
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

      {/* 新增/編輯對話框 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">{editTarget ? '編輯模型' : '新增模型'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 名稱 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  名稱 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="請輸入模型名稱"
                  autoFocus
                />
              </div>
              {/* 代碼（自動生成，僅編輯時顯示） */}
              {editTarget && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">模型代碼</label>
                  <input
                    type="text"
                    value={editTarget.mcode}
                    disabled
                    className="w-full px-3 py-2 border rounded-md bg-gray-50 text-muted-foreground font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">代碼由系統自動生成，不可修改</p>
                </div>
              )}
              {!editTarget && (
                <div>
                  <p className="text-xs text-muted-foreground">
                    模型代碼將在創建後由系統自動生成
                  </p>
                </div>
              )}
              {/* 類型 + 狀態 */}
              <div className="grid grid-cols-2 gap-4">
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
                <div>
                  <label className="block text-sm font-medium mb-1.5">狀態</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                  >
                    <option value="1">啟用</option>
                    <option value="0">禁用</option>
                  </select>
                </div>
              </div>
              {/* URL名稱 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">URL名稱</label>
                <input
                  type="text"
                  value={form.urlname}
                  onChange={(e) => setForm((f) => ({ ...f, urlname: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="URL別名（可選）"
                />
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
