import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LoadingState, EmptyState, ErrorState } from '../components/StateDisplay'

interface FormConfig {
  id: number
  fcode: string
  form_name: string
  description: string
  is_active: string
  sorting: number
  status: string
  webhook_url: string | null
  create_time: string
  submission_count: number
}

export default function FormManager() {
  const [forms, setForms] = useState<FormConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editTarget, setEditTarget] = useState<FormConfig | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const fetchForms = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<FormConfig[]>('/admin/forms/config')
      setForms(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加載失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchForms() }, [fetchForms])

  const handleToggleActive = async (form: FormConfig) => {
    const newActive = form.is_active === '1' ? '0' : '1'
    try {
      await api.put(`/admin/forms/config/${form.id}`, { is_active: newActive })
      setForms((prev) => prev.map((f) => f.id === form.id ? { ...f, is_active: newActive } : f))
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失敗')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確認刪除此表單？已提交的數據不會被刪除。')) return
    try {
      await api.del(`/admin/forms/config/${id}`)
      setForms((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    }
  }

  if (loading) return <LoadingState text="載入表單列表..." />
  if (error && forms.length === 0) return <ErrorState message={error} onRetry={fetchForms} />

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="text-xl">📝</span>
          表單管理
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增表單
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>{error}
        </div>
      )}

      {/* 表格 */}
      {forms.length === 0 ? (
        <EmptyState icon="📭" text="尚未創建任何表單" />
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">表單代碼</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">表單名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">API 端點</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">展示</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">提交數</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((form) => (
                  <tr key={form.id} className="border-b last:border-0 hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">{form.id}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-secondary/50 rounded font-mono text-xs">{form.fcode}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{form.form_name}</div>
                      {form.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{form.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        POST /api/v1/forms/submit/{form.id}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(form)}
                        className={cn(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          form.is_active === '1' ? 'bg-primary' : 'bg-muted',
                        )}
                      >
                        <span className={cn(
                          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                          form.is_active === '1' ? 'translate-x-5' : 'translate-x-1',
                        )} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{form.submission_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditTarget(form)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          <span className="text-sm">✏️</span> 編輯
                        </button>
                        {form.id !== 1 && (
                          <button
                            onClick={() => handleDelete(form.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <span className="text-sm">🗑️</span> 刪除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 新增/編輯對話框 */}
      {(showCreate || editTarget) && (
        <FormEditDialog
          target={editTarget}
          onClose={() => { setShowCreate(false); setEditTarget(null) }}
          onSuccess={() => { setShowCreate(false); setEditTarget(null); fetchForms() }}
        />
      )}
    </div>
  )
}

function FormEditDialog({
  target, onClose, onSuccess,
}: {
  target: FormConfig | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [fcode, setFcode] = useState(target?.fcode || '')
  const [formName, setFormName] = useState(target?.form_name || '')
  const [description, setDescription] = useState(target?.description || '')
  const [sorting, setSorting] = useState(target?.sorting || 255)
  const [webhookUrl, setWebhookUrl] = useState(target?.webhook_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!fcode.trim()) { setError('請填寫表單代碼'); return }
    if (!formName.trim()) { setError('請填寫表單名稱'); return }
    setSaving(true)
    setError('')
    try {
      const body = { fcode: fcode.trim(), form_name: formName.trim(), description, sorting, webhook_url: webhookUrl }
      if (target) {
        await api.put(`/admin/forms/config/${target.id}`, body)
      } else {
        await api.post('/admin/forms/config', body)
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">{target ? '編輯表單' : '新增表單'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground">❌</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">表單代碼 <span className="text-destructive">*</span></label>
            <input
              value={fcode}
              onChange={(e) => setFcode(e.target.value)}
              placeholder="如：appointment"
              disabled={!!target}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">用於 API 標識，創建後不可修改</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">表單名稱 <span className="text-destructive">*</span></label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="如：預約表單"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">描述</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="表單用途說明"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">排序</label>
            <input
              type="number"
              value={sorting}
              onChange={(e) => setSorting(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">專屬 Webhook URL（可選）</label>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="留空則使用全局 webhook"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm font-mono"
            />
          </div>
          {error && (
            <div className="px-4 py-2 text-sm text-destructive bg-destructive/10 rounded-md">{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors">取消</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving && <span className="animate-spin inline-block">🔄</span>}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
