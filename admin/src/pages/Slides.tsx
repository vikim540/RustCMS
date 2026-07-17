import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

/** 幻燈片數據結構 */
interface Slide {
  id: number
  gid: string
  pic: string
  pic_mobile: string
  link: string
  title: string
  subtitle: string
  button_text: string
  sorting: number
}

/** 表單數據 */
interface SlideForm {
  gid: string
  pic: string
  pic_mobile: string
  link: string
  title: string
  subtitle: string
  button_text: string
  sorting: number
}

/** 空表單初始值 */
const EMPTY_FORM: SlideForm = {
  gid: '0',
  pic: '',
  pic_mobile: '',
  link: '',
  title: '',
  subtitle: '',
  button_text: '',
  sorting: 0,
}

/** localStorage key for group name mapping */
const GROUP_NAMES_KEY = 'cms_slide_group_names'

/** 從 localStorage 讀取分組名稱映射 */
function loadGroupNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(GROUP_NAMES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/** 保存分組名稱映射到 localStorage */
function saveGroupNames(names: Record<string, string>): void {
  try {
    localStorage.setItem(GROUP_NAMES_KEY, JSON.stringify(names))
  } catch {
    // ignore
  }
}

/** 獲取分組顯示名稱 */
function getGroupDisplayName(gid: string, groupNames: Record<string, string>): string {
  return groupNames[gid] || `分組 ${gid}`
}

export default function Slides() {
  const [slides, setSlides] = useState<Slide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Slide | null>(null)
  const [form, setForm] = useState<SlideForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  // 分組狀態
  const [activeGroup, setActiveGroup] = useState<string>('all')
  const [groupNames, setGroupNames] = useState<Record<string, string>>({})
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupNameInput, setGroupNameInput] = useState('')
  const [newGroupMode, setNewGroupMode] = useState(false)
  const [newGroupId, setNewGroupId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')

  /** 載入幻燈片列表 */
  const fetchSlides = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Slide[]>('/admin/slides')
      setSlides(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSlides()
  }, [fetchSlides])

  // 載入分組名稱
  useEffect(() => {
    setGroupNames(loadGroupNames())
  }, [])

  // 提取所有唯一分組 ID（按數值排序）
  const uniqueGroups = useMemo(() => {
    const set = new Set<string>()
    for (const s of slides) {
      set.add(s.gid ?? '0')
    }
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a, 10)
      const nb = parseInt(b, 10)
      if (isNaN(na) || isNaN(nb)) return a.localeCompare(b)
      return na - nb
    })
  }, [slides])

  // 按當前選中分組過濾幻燈片
  const filteredSlides = useMemo(() => {
    if (activeGroup === 'all') return slides
    return slides.filter((s) => (s.gid ?? '0') === activeGroup)
  }, [slides, activeGroup])

  // 保存分組名稱
  const handleSaveGroupName = (gid: string) => {
    const name = groupNameInput.trim()
    const updated = { ...groupNames }
    if (name) {
      updated[gid] = name
    } else {
      delete updated[gid]
    }
    setGroupNames(updated)
    saveGroupNames(updated)
    setEditingGroupId(null)
  }

  // 新增分組
  const handleAddGroup = () => {
    const gid = newGroupId.trim()
    const name = newGroupName.trim()
    if (!gid || !name) return
    const updated = { ...groupNames, [gid]: name }
    setGroupNames(updated)
    saveGroupNames(updated)
    setNewGroupMode(false)
    setNewGroupId('')
    setNewGroupName('')
  }

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setActionError('')
    setModalOpen(true)
  }

  /** 開啟編輯對話框 */
  const openEdit = (item: Slide) => {
    setEditTarget(item)
    setForm({
      gid: item.gid ?? '0',
      pic: item.pic ?? '',
      pic_mobile: item.pic_mobile ?? '',
      link: item.link ?? '',
      title: item.title ?? '',
      subtitle: item.subtitle ?? '',
      button_text: item.button_text ?? '',
      sorting: item.sorting ?? 0,
    })
    setActionError('')
    setModalOpen(true)
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!form.pic.trim()) {
      setActionError('圖片網址不能為空')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      const payload = {
        gid: form.gid,
        pic: form.pic.trim(),
        pic_mobile: form.pic_mobile,
        link: form.link,
        title: form.title,
        subtitle: form.subtitle,
        button_text: form.button_text,
        sorting: form.sorting,
      }
      if (editTarget) {
        await api.put(`/admin/slides/${editTarget.id}`, payload)
      } else {
        await api.post('/admin/slides', payload)
      }
      setModalOpen(false)
      await fetchSlides()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除幻燈片 */
  const handleDelete = async (id: number) => {
    if (!window.confirm('確定要刪除此幻燈片嗎?')) return
    setActionLoading(id)
    try {
      await api.del(`/admin/slides/${id}`)
      await fetchSlides()
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
        <h1 className="text-2xl font-bold">幻燈片管理</h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增幻燈片
        </button>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 分組標籤欄 */}
      {!loading && slides.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveGroup('all')}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeGroup === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent',
            )}
          >
            全部 <span className="ml-1 opacity-70">({slides.length})</span>
          </button>
          {uniqueGroups.map((gid) => {
            const count = slides.filter((s) => (s.gid ?? '0') === gid).length
            const isActive = activeGroup === gid
            const isEditing = editingGroupId === gid
            return (
              <div key={gid} className="inline-flex items-center">
                {isEditing ? (
                  <div className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={groupNameInput}
                      onChange={(e) => setGroupNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveGroupName(gid)
                        if (e.key === 'Escape') setEditingGroupId(null)
                      }}
                      onBlur={() => handleSaveGroupName(gid)}
                      placeholder="分組名稱"
                      className="px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring w-28"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="inline-flex items-center group">
                    <button
                      onClick={() => setActiveGroup(gid)}
                      className={cn(
                        'px-3 py-1.5 rounded-l-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground hover:bg-accent',
                      )}
                    >
                      {getGroupDisplayName(gid, groupNames)}
                      <span className="ml-1 opacity-70">({count})</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditingGroupId(gid)
                        setGroupNameInput(groupNames[gid] || '')
                      }}
                      className={cn(
                        'px-1.5 py-1.5 rounded-r-md text-xs transition-colors border-l',
                        isActive
                          ? 'bg-primary/80 text-primary-foreground hover:bg-primary/60'
                          : 'bg-secondary/80 text-muted-foreground hover:bg-accent',
                      )}
                      title="編輯分組名稱"
                    >
                      ✏️
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {/* 新增分組 */}
          {newGroupMode ? (
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                placeholder="ID"
                className="px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring w-16"
              />
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddGroup()
                  if (e.key === 'Escape') {
                    setNewGroupMode(false)
                    setNewGroupId('')
                    setNewGroupName('')
                  }
                }}
                placeholder="分組名稱"
                className="px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring w-28"
                autoFocus
              />
              <button
                onClick={handleAddGroup}
                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90"
              >
                ✅
              </button>
              <button
                onClick={() => {
                  setNewGroupMode(false)
                  setNewGroupId('')
                  setNewGroupName('')
                }}
                className="px-2 py-1 text-xs text-muted-foreground hover:bg-accent rounded-md"
              >
                ❌
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewGroupMode(true)}
              className="px-3 py-1.5 rounded-md text-sm text-muted-foreground border border-dashed hover:bg-accent transition-colors"
              title="新增分組名稱映射"
            >
              ➕ 新增分組
            </button>
          )}
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
      {!loading && slides.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-50">🖼️</span>
          <p className="mb-3">尚未創建任何幻燈片</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
          >
            <span className="mr-1">➕</span>
            新增幻燈片
          </button>
        </div>
      )}

      {/* 當前分組無數據 */}
      {!loading && slides.length > 0 && filteredSlides.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-50">📭</span>
          <p>此分組下暫無幻燈片</p>
        </div>
      )}

      {/* 幻燈片表格 */}
      {!loading && filteredSlides.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">分組</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">桌面版圖片</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">移動端圖片</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">副標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">連結</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">排序</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlides.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {getGroupDisplayName(item.gid ?? '0', groupNames)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {item.pic ? (
                        <img
                          src={item.pic}
                          alt={item.title || '幻燈片'}
                          className="w-24 h-14 rounded object-cover border"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">無圖片</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.pic_mobile ? (
                        <img
                          src={item.pic_mobile}
                          alt={item.title || '移動端幻燈片'}
                          className="w-14 h-24 rounded object-cover border"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">無</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{item.title || '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.subtitle || '-'}</td>
                    <td className="px-4 py-3">
                      {item.link ? (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline truncate max-w-[160px]"
                        >
                          <span className="truncate">{item.link}</span>
                          <span className="text-xs shrink-0">🔗</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.sorting ?? 0}</td>
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">{editTarget ? '編輯幻燈片' : '新增幻燈片'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* 桌面版圖片 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  圖片網址 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.pic}
                  onChange={(e) => setForm((f) => ({ ...f, pic: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="桌面版圖片網址"
                  autoFocus
                />
                {form.pic && (
                  <img
                    src={form.pic}
                    alt="預覽"
                    className="mt-2 w-full h-32 rounded object-cover border"
                  />
                )}
              </div>
              {/* 手機版圖片 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">手機版圖片網址</label>
                <input
                  type="text"
                  value={form.pic_mobile}
                  onChange={(e) => setForm((f) => ({ ...f, pic_mobile: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="手機版圖片網址（可選）"
                />
              </div>
              {/* 標題 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">標題</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="幻燈片標題"
                />
              </div>
              {/* 副標題 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">副標題</label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="幻燈片副標題"
                />
              </div>
              {/* 連結 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">連結</label>
                <input
                  type="text"
                  value={form.link}
                  onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="點擊跳轉連結"
                />
              </div>
              {/* 按鈕文字 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">按鈕文字</label>
                <input
                  type="text"
                  value={form.button_text}
                  onChange={(e) => setForm((f) => ({ ...f, button_text: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="如：了解更多"
                />
              </div>
              {/* 分組 + 排序 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    分組
                    <span className="ml-1 text-xs text-muted-foreground font-normal">
                      ({getGroupDisplayName(form.gid, groupNames)})
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={uniqueGroups.includes(form.gid) ? form.gid : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          setForm((f) => ({ ...f, gid: e.target.value }))
                        }
                      }}
                      className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm bg-white"
                    >
                      {uniqueGroups.includes(form.gid) ? null : (
                        <option value="__custom__">自定義: {form.gid}</option>
                      )}
                      {uniqueGroups.map((gid) => (
                        <option key={gid} value={gid}>
                          {getGroupDisplayName(gid, groupNames)} (ID: {gid})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={form.gid}
                      onChange={(e) => setForm((f) => ({ ...f, gid: e.target.value }))}
                      className="w-20 px-2 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm text-center"
                      placeholder="ID"
                      title="直接輸入分組 ID"
                    />
                  </div>
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
