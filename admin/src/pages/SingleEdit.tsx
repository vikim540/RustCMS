import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { LoadingState } from '../components/StateDisplay'
import { cn } from '../lib/utils'

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
  status: string
  sorting: number
}

/** 表單數據 */
interface FormData {
  title: string
  scode: string
  content: string
  keywords: string
  description: string
  status: SingleStatus
  sorting: number
}

/** 空表單初始值 */
const EMPTY_FORM: FormData = {
  title: '',
  scode: '',
  content: '',
  keywords: '',
  description: '',
  status: '1',
  sorting: 0,
}

export default function SingleEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id

  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** 載入單頁詳情（編輯模式） */
  const fetchSingle = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Single>(`/admin/singles/${id}`)
      const data = res.data
      if (data) {
        setForm({
          title: data.title ?? '',
          scode: data.scode ?? '',
          content: data.content ?? '',
          keywords: data.keywords ?? '',
          description: data.description ?? '',
          status: data.status === '1' ? '1' : '0',
          sorting: data.sorting ?? 0,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入單頁失敗')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (isEdit) {
      fetchSingle()
    }
  }, [isEdit, fetchSingle])

  /** 表單欄位更新 */
  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** 提交表單 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('請輸入標題')
      return
    }
    if (!form.scode.trim()) {
      setError('請輸入欄目編碼')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        title: form.title.trim(),
        scode: form.scode.trim(),
        content: form.content,
        keywords: form.keywords,
        description: form.description,
        status: form.status,
        sorting: form.sorting,
      }
      if (isEdit) {
        await api.put(`/admin/singles/${id}`, payload)
      } else {
        await api.post('/admin/singles', payload)
      }
      navigate('/singles')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState text="載入中..." />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* 頁首 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/singles')}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="mr-1">⬅️</span>
          返回
        </button>
        <h1 className="text-2xl font-bold">{isEdit ? '編輯單頁' : '新增單頁'}</h1>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 表單 */}
      <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-lg border p-6">
        {/* 標題 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            標題 <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => updateField('title', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="請輸入單頁標題"
            required
          />
        </div>

        {/* 欄目編碼 + 狀態 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              欄目編碼 <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={form.scode}
              onChange={(e) => updateField('scode', e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="請輸入欄目編碼 (scode)"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">狀態</label>
            <select
              value={form.status}
              onChange={(e) => updateField('status', e.target.value as SingleStatus)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
            >
              <option value="1">已發布</option>
              <option value="0">草稿</option>
            </select>
          </div>
        </div>

        {/* 排序 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">排序</label>
          <input
            type="number"
            value={form.sorting}
            onChange={(e) => updateField('sorting', Number(e.target.value))}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="數字越小越靠前"
          />
        </div>

        {/* 內容 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">內容</label>
          <textarea
            value={form.content}
            onChange={(e) => updateField('content', e.target.value)}
            rows={12}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono text-sm"
            placeholder="請輸入單頁內容（支援 HTML）"
          />
        </div>

        {/* 關鍵字 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">關鍵字</label>
          <input
            type="text"
            value={form.keywords}
            onChange={(e) => updateField('keywords', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="多個關鍵字以逗號分隔"
          />
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">描述</label>
          <textarea
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            placeholder="SEO 描述..."
          />
        </div>

        {/* 操作按鈕 */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <button
            type="submit"
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm disabled:opacity-50',
            )}
          >
            {saving ? <span className="animate-spin inline-block">🔄</span> : <span>💾</span>}
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/singles')}
            className="px-5 py-2 border rounded-md hover:bg-accent transition-colors text-sm"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  )
}
