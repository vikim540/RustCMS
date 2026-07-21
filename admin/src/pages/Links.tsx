import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 友情連結數據結構 */
interface LinkItem {
  id: number
  gid: string
  name: string
  link: string
  logo: string
  sorting: number
}

/** 表單數據 */
interface LinkForm {
  gid: string
  name: string
  link: string
  logo: string
  sorting: number
}

/** 空表單初始值 */
const EMPTY_FORM: LinkForm = {
  gid: '0',
  name: '',
  link: '',
  logo: '',
  sorting: 0,
}

export default function Links() {
  const [links, setLinks] = useState<LinkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LinkItem | null>(null)
  const [form, setForm] = useState<LinkForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  /** 載入友情連結列表 */
  const fetchLinks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<LinkItem[]>('/admin/links')
      setLinks(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setActionError('')
    setModalOpen(true)
  }

  /** 開啟編輯對話框 */
  const openEdit = (item: LinkItem) => {
    setEditTarget(item)
    setForm({
      gid: item.gid ?? '0',
      name: item.name ?? '',
      link: item.link ?? '',
      logo: item.logo ?? '',
      sorting: item.sorting ?? 0,
    })
    setActionError('')
    setModalOpen(true)
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setActionError('名稱不能為空')
      return
    }
    if (!form.link.trim()) {
      setActionError('連結不能為空')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      const payload = {
        gid: form.gid,
        name: form.name.trim(),
        link: form.link.trim(),
        logo: form.logo,
        sorting: form.sorting,
      }
      if (editTarget) {
        await api.put(`/admin/links/${editTarget.id}`, payload)
      } else {
        await api.post('/admin/links', payload)
      }
      setModalOpen(false)
      await fetchLinks()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除連結 */
  const handleDelete = async (id: number) => {
    if (!window.confirm('確定要刪除此友情連結嗎?')) return
    setActionLoading(id)
    try {
      await api.del(`/admin/links/${id}`)
      await fetchLinks()
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
        <h1 className="text-2xl font-bold">友情連結</h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增連結
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
      {!loading && links.length === 0 && !error && (
        <div className="flex flex-col items-center">
          <EmptyState icon="🔗" text="尚未創建任何友情連結" />
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm -mt-10"
          >
            <span className="mr-1">➕</span>
            新增連結
          </button>
        </div>
      )}

      {/* 連結表格 */}
      {!loading && links.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">連結</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">LOGO</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">分組</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {links.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline truncate max-w-xs"
                      >
                        <span className="truncate">{item.link}</span>
                        <span className="text-xs shrink-0">🔗</span>
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {item.logo ? (
                        <img
                          src={item.logo}
                          alt={item.name}
                          className="w-8 h-8 rounded object-contain border"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.sorting ?? 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.gid ?? '0'}</td>
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
                          onClick={() => handleDelete(item.id)}
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
                ))}
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
              <h2 className="text-lg font-semibold">{editTarget ? '編輯連結' : '新增連結'}</h2>
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
                  placeholder="請輸入連結名稱"
                  autoFocus
                />
              </div>
              {/* 連結 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  連結 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.link}
                  onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="https://example.com"
                />
              </div>
              {/* LOGO */}
              <div>
                <label className="block text-sm font-medium mb-1.5">LOGO</label>
                <input
                  type="text"
                  value={form.logo}
                  onChange={(e) => setForm((f) => ({ ...f, logo: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="LOGO 圖片網址（可選）"
                />
              </div>
              {/* 分組 + 排序 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">分組</label>
                  <input
                    type="text"
                    value={form.gid}
                    onChange={(e) => setForm((f) => ({ ...f, gid: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="分組 ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">排序</label>
                  <input
                    type="number"
                    value={form.sorting}
                    onChange={(e) => setForm((f) => ({ ...f, sorting: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
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
