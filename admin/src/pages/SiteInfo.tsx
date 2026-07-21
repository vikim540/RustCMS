import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { LoadingState } from '../components/StateDisplay'
import { cn } from '../lib/utils'

/** 站點信息數據結構（香港本地化：移除 icp 內地備案、theme 模板） */
interface SiteInfo {
  name: string
  title: string
  subtitle: string
  domain: string
  keywords: string
  description: string
  logo: string
  copyright: string
  statistical: string
}

/** 空表單初始值 */
const EMPTY_FORM: SiteInfo = {
  name: '',
  title: '',
  subtitle: '',
  domain: '',
  keywords: '',
  description: '',
  logo: '',
  copyright: '',
  statistical: '',
}

export default function SiteInfoPage() {
  const [form, setForm] = useState<SiteInfo>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  /** 載入站點信息 */
  const fetchSiteInfo = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<SiteInfo>('/admin/site')
      if (res.data) {
        setForm({ ...EMPTY_FORM, ...res.data })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入站點信息失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSiteInfo()
  }, [fetchSiteInfo])

  /** 表單欄位更新 */
  const updateField = <K extends keyof SiteInfo>(key: K, value: SiteInfo[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSuccess(false)
  }

  /** 提交保存 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('請輸入站點名稱')
      return
    }

    setSaving(true)
    setError('')
    try {
      await api.put('/admin/site', form)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
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
    <div className="p-6 max-w-3xl">
      {/* 頁首 */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xl text-muted-foreground">🌐</span>
        <h1 className="text-2xl font-bold">站點信息</h1>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-md text-sm">
          <span className="shrink-0">✅</span>
          站點信息已成功保存
        </div>
      )}

      {/* 表單 */}
      <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-lg border p-6">
        {/* 站點名稱 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            站點名稱 <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="請輸入站點名稱"
            required
          />
        </div>

        {/* 標題 + 副標題 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">站點標題</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="SEO 標題"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">副標題</label>
            <input
              type="text"
              value={form.subtitle}
              onChange={(e) => updateField('subtitle', e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="站點副標題"
            />
          </div>
        </div>

        {/* 域名 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">域名</label>
          <input
            type="text"
            value={form.domain}
            onChange={(e) => updateField('domain', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="如：cms.cmermedical.com.hk"
          />
        </div>

        {/* LOGO */}
        <div>
          <label className="block text-sm font-medium mb-1.5">LOGO</label>
          <input
            type="text"
            value={form.logo}
            onChange={(e) => updateField('logo', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="LOGO 圖片網址"
          />
          {form.logo && (
            <img
              src={form.logo}
              alt="LOGO"
              className="mt-2 h-12 rounded border object-contain"
            />
          )}
        </div>

        {/* 關鍵字 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">關鍵字</label>
          <input
            type="text"
            value={form.keywords}
            onChange={(e) => updateField('keywords', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="SEO 關鍵字，逗號分隔"
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

        {/* 版權信息 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">版權信息</label>
          <input
            type="text"
            value={form.copyright}
            onChange={(e) => updateField('copyright', e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="如：© 2026 CMER Medical Center. All rights reserved."
          />
        </div>

        {/* 統計代碼 */}
        <div>
          <label className="block text-sm font-medium mb-1.5">統計代碼</label>
          <textarea
            value={form.statistical}
            onChange={(e) => updateField('statistical', e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono text-xs"
            placeholder="第三方統計代碼（如 Google Analytics）"
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
        </div>
      </form>
    </div>
  )
}
