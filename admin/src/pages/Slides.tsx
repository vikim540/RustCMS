import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import ImageCompressDialog from '../components/ImageCompressDialog'
import UploadProgressOverlay from '../components/UploadProgressOverlay'
import { useImageUpload } from '../hooks/useImageUpload'
import { LoadingState, EmptyState } from '../components/StateDisplay'

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
  status: string
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

/** 幻燈片分組數據結構（後端 ay_slide_group 表） */
interface SlideGroup {
  id: number
  gid: string
  name: string
  sorting: number
}

/** 獲取分組顯示名稱（從後端拉取的映射中查找，找不到時 fallback） */
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
  const [activeGroup, setActiveGroup] = useState<string>('1')
  const [groups, setGroups] = useState<SlideGroup[]>([])
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupNameInput, setGroupNameInput] = useState('')
  const [newGroupMode, setNewGroupMode] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  // 圖片上傳狀態
  const [uploadTarget, setUploadTarget] = useState<'desktop' | 'mobile' | null>(null)
  const desktopFileRef = useRef<HTMLInputElement>(null)
  const mobileFileRef = useRef<HTMLInputElement>(null)
  // 壓縮對話框狀態：記錄待壓縮的圖片及其目標欄位
  const [pendingSlideImage, setPendingSlideImage] = useState<{ file: File; target: 'desktop' | 'mobile' } | null>(null)

  // ─── 拖拽排序狀態 ────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [sortingUpdate, setSortingUpdate] = useState(false)
  // 手動修改排序的 dirty 記錄（id → 新排序值），保存按鈕統一提交
  const [dirtySorts, setDirtySorts] = useState<Record<number, number>>({})

  // ─── 上傳 hook（統一壓縮+上傳+進度+錯誤處理） ──────────
  // autoCompress=false：圖片已通過 ImageCompressDialog 壓縮，非圖片無需壓縮
  const { uploading, progress, error: uploadError, uploadSingle, clearError } = useImageUpload({
    autoCompress: false,
  })

  /** 壓縮對話框確認後的上傳回調 */
  const handleSlideCompressConfirm = async (compressedFiles: File[]) => {
    if (!pendingSlideImage || compressedFiles.length === 0) {
      setPendingSlideImage(null)
      return
    }
    const compressed = compressedFiles[0]
    const { target } = pendingSlideImage
    setPendingSlideImage(null)
    clearError()

    setUploadTarget(target)
    const url = await uploadSingle(compressed)
    setUploadTarget(null)

    if (url) {
      if (target === 'desktop') {
        setForm((f) => ({ ...f, pic: url }))
      } else {
        setForm((f) => ({ ...f, pic_mobile: url }))
      }
    }
  }

  /** 桌面版圖片上傳 — 彈出壓縮對話框 */
  const handleDesktopUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (desktopFileRef.current) desktopFileRef.current.value = ''
    // 非圖片直接上傳，圖片走壓縮對話框
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      clearError()
      setUploadTarget('desktop')
      const url = await uploadSingle(file)
      setUploadTarget(null)
      if (url) setForm((f) => ({ ...f, pic: url }))
      return
    }
    setPendingSlideImage({ file, target: 'desktop' })
  }

  /** 移動端圖片上傳 — 彈出壓縮對話框 */
  const handleMobileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (mobileFileRef.current) mobileFileRef.current.value = ''
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      clearError()
      setUploadTarget('mobile')
      const url = await uploadSingle(file)
      setUploadTarget(null)
      if (url) setForm((f) => ({ ...f, pic_mobile: url }))
      return
    }
    setPendingSlideImage({ file, target: 'mobile' })
  }

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

  // 從後端載入分組列表（取代原 localStorage 方案，所有賬號共享）
  const fetchGroups = useCallback(async () => {
    try {
      const res = await api.get<SlideGroup[]>('/admin/slides/groups')
      setGroups(res.data ?? [])
    } catch {
      // 靜默失敗，不阻塞幻燈片載入
    }
  }, [])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  // 從 groups 派生 gid → name 映射（供 UI 查找）
  const groupNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const g of groups) {
      map[g.gid] = g.name
    }
    return map
  }, [groups])

  // 提取所有唯一分組 ID（合併分組表 + 幻燈片實際使用的 gid，按數值排序）
  const uniqueGroups = useMemo(() => {
    const set = new Set<string>()
    for (const g of groups) set.add(g.gid)
    for (const s of slides) set.add(s.gid ?? '0')
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a, 10)
      const nb = parseInt(b, 10)
      if (isNaN(na) || isNaN(nb)) return a.localeCompare(b)
      return na - nb
    })
  }, [groups, slides])

  // 按當前選中分組過濾幻燈片，並按 sorting ASC 排序展示（拖到第一則顯示第一）
  const filteredSlides = useMemo(() => {
    const list = activeGroup === 'all'
      ? slides
      : slides.filter((s) => (s.gid ?? '0') === activeGroup)
    return [...list].sort((a, b) => (a.sorting ?? 0) - (b.sorting ?? 0))
  }, [slides, activeGroup])

  // 保存分組名稱（調用後端 API，所有賬號共享）
  const handleSaveGroupName = async (gid: string) => {
    const name = groupNameInput.trim()
    try {
      await api.put(`/admin/slides/groups/${gid}`, { name })
      await fetchGroups()
    } catch {
      // 失敗時不更新本地狀態
    }
    setEditingGroupId(null)
  }

  // 新增分組 — 後端自動生成 gid，名稱可選
  const handleAddGroup = async () => {
    const name = newGroupName.trim()
    try {
      const res = await api.post<{ gid: string }>('/admin/slides/groups', { name })
      await fetchGroups()
      setNewGroupMode(false)
      setNewGroupName('')
      // 自動切換到新分組
      if (res.data?.gid) {
        setActiveGroup(res.data.gid)
      }
    } catch {
      // 失敗時保持新增模式，用戶可重試
    }
  }

  /** 開啟新增對話框 — 默認分組 1，排序自增 */
  const openCreate = () => {
    setEditTarget(null)
    // 默認分組：當前選中的分組，若為 'all' 則用 '1'
    const defaultGid = activeGroup !== 'all' ? activeGroup : '1'
    // 計算該分組下的最大排序值 + 1（自增序號）
    const groupSlides = slides.filter((s) => (s.gid ?? '0') === defaultGid)
    const maxSorting = groupSlides.length > 0
      ? Math.max(...groupSlides.map((s) => s.sorting ?? 0))
      : 0
    setForm({
      ...EMPTY_FORM,
      gid: defaultGid,
      sorting: maxSorting + 1,
    })
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

  /** 切換顯示/隱藏 */
  const handleToggleVisibility = async (item: Slide) => {
    const newStatus = item.status === '0' ? '1' : '0'
    // 本地即時更新
    setSlides((prev) => prev.map((s) => s.id === item.id ? { ...s, status: newStatus } : s))
    try {
      await api.put(`/admin/slides/${item.id}`, { status: newStatus })
    } catch {
      // 失敗時回滾
      setSlides((prev) => prev.map((s) => s.id === item.id ? { ...s, status: item.status } : s))
      setError('更新顯示狀態失敗')
    }
  }

  /** 拖拽開始 */
  const handleDragStart = (id: number) => {
    setDraggingId(id)
  }

  /** 拖拽經過某行 */
  const handleDragOver = (e: React.DragEvent, id: number) => {
    e.preventDefault()
    if (id !== draggingId) setDragOverId(id)
  }

  /** 拖拽放下 — 重新排序 */
  const handleDrop = async (targetId: number) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null)
      setDragOverId(null)
      return
    }
    // 取得當前列表的排序順序
    const ordered = [...filteredSlides]
    const fromIdx = ordered.findIndex((s) => s.id === draggingId)
    const toIdx = ordered.findIndex((s) => s.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return
    // 移動元素
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    // 重新分配 sorting 值（從 1 開始，而非 0）
    const items = ordered.map((s, idx) => ({ id: s.id, sorting: idx + 1 }))
    // 先本地更新 UI
    setSlides((prev) => {
      const updates = new Map(items.map((i) => [i.id, i.sorting]))
      return prev.map((s) =>
        updates.has(s.id) ? { ...s, sorting: updates.get(s.id)! } : s,
      )
    })
    setDraggingId(null)
    setDragOverId(null)
    // 異步更新後端
    setSortingUpdate(true)
    try {
      await api.put('/admin/slides/batch-sorting', { items })
    } catch {
      // 失敗時重新載入
      await fetchSlides()
    } finally {
      setSortingUpdate(false)
    }
  }

  /** 手動修改排序值 — 僅標記 dirty，等待保存按鈕統一提交 */
  const handleSortingInput = (id: number, newSorting: number) => {
    // 更新本地顯示
    setSlides((prev) =>
      prev.map((s) => (s.id === id ? { ...s, sorting: newSorting } : s)),
    )
    // 標記為 dirty（等待保存按鈕提交）
    setDirtySorts((prev) => ({ ...prev, [id]: newSorting }))
  }

  /** 批量保存所有修改的排序值 */
  const handleSaveSorts = async () => {
    const items = Object.entries(dirtySorts).map(([id, sorting]) => ({
      id: Number(id),
      sorting,
    }))
    if (items.length === 0) return

    setSortingUpdate(true)
    try {
      await api.put('/admin/slides/batch-sorting', { items })
      setDirtySorts({})
    } catch {
      // 失敗時重新載入以恢復正確狀態
      await fetchSlides()
      setDirtySorts({})
    } finally {
      setSortingUpdate(false)
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
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddGroup()
                  if (e.key === 'Escape') {
                    setNewGroupMode(false)
                    setNewGroupName('')
                  }
                }}
                placeholder="分組名稱（可選）"
                className="px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring w-32"
                autoFocus
              />
              <button
                onClick={handleAddGroup}
                className="px-2 py-1 bg-primary text-primary-foreground rounded-md text-xs hover:opacity-90"
                title="確認新增"
              >
                ✅
              </button>
              <button
                onClick={() => { setNewGroupMode(false); setNewGroupName('') }}
                className="px-2 py-1 bg-secondary text-secondary-foreground rounded-md text-xs hover:bg-accent"
                title="取消"
              >
                ❌
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewGroupMode(true)}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-secondary/50 text-muted-foreground hover:bg-accent border border-dashed border-slate-300 transition-colors"
              title="新增分組（ID自動遞增）"
            >
              ➕ 新增分組
            </button>
          )}
        </div>
      )}

      {/* 加載中 */}
      {loading && <LoadingState text="載入中..." />}

      {/* 空狀態 */}
      {!loading && slides.length === 0 && !error && (
        <>
          <EmptyState icon="🖼️" text="尚未創建任何幻燈片" />
          <div className="flex justify-center -mt-16 pb-8">
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
            >
              <span className="mr-1">➕</span>
              新增幻燈片
            </button>
          </div>
        </>
      )}

      {/* 當前分組無數據 */}
      {!loading && slides.length > 0 && filteredSlides.length === 0 && (
        <EmptyState icon="📭" text="此分組下暫無幻燈片" />
      )}

      {/* 幻燈片表格 */}
      {!loading && filteredSlides.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          {/* 排序更新提示 */}
          {sortingUpdate && (
            <div className="px-4 py-2 bg-blue-50 text-blue-600 text-xs flex items-center gap-2 border-b border-blue-100">
              <span className="animate-spin inline-block">🔄</span>
              正在更新排序...
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-2 py-3 w-8"></th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">分組</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">桌面版圖片</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">移動端圖片</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">副標題</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">連結</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">顯示</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlides.map((item) => (
                  <tr
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(item.id)}
                    onDragOver={(e) => handleDragOver(e, item.id)}
                    onDrop={() => handleDrop(item.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                    className={cn(
                      'border-b last:border-0 hover:bg-accent/50 transition-colors',
                      draggingId === item.id && 'opacity-40',
                      dragOverId === item.id && 'bg-blue-50 border-t-2 border-t-blue-400',
                    )}
                  >
                    <td className="px-2 py-3 text-center cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500" title="拖拽排序">
                      ⋮⋮
                    </td>
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
                          className="w-32 h-18 rounded border bg-gray-50 object-contain"
                          style={{ maxHeight: '72px' }}
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
                          className="rounded border bg-gray-50"
                          style={{ maxWidth: '72px', maxHeight: '128px', width: 'auto', height: 'auto' }}
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
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        value={item.sorting ?? 0}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0
                          handleSortingInput(item.id, val)
                        }}
                        className={cn(
                          'w-14 px-1.5 py-1 text-center border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 hover:border-blue-300',
                          dirtySorts[item.id] !== undefined
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-slate-200',
                        )}
                        title={dirtySorts[item.id] !== undefined ? '已修改，點擊「保存排序」提交' : '修改排序值'}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleVisibility(item)}
                        className={cn(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          (item.status ?? '1') === '1' ? 'bg-primary' : 'bg-muted',
                        )}
                        title={(item.status ?? '1') === '1' ? '點擊隱藏（不顯示到 API）' : '點擊顯示'}
                      >
                        <span className={cn(
                          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                          (item.status ?? '1') === '1' ? 'translate-x-5' : 'translate-x-1',
                        )} />
                      </button>
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
          <div className="px-4 py-2 bg-slate-50 text-xs text-muted-foreground border-t flex items-center gap-2 flex-wrap">
            <span>💡 提示：</span>
            <span>拖拽 <span className="font-mono text-slate-500">⋮⋮</span> 圖示可調整順序（即時生效）</span>
            <span className="text-slate-300">|</span>
            <span>修改排序輸入框後，點擊「保存排序」提交</span>
            {/* 有未保存的排序修改時顯示保存按鈕 */}
            {Object.keys(dirtySorts).length > 0 && (
              <button
                onClick={handleSaveSorts}
                disabled={sortingUpdate}
                className="ml-auto inline-flex items-center gap-1 px-3 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {sortingUpdate ? '⏳ 保存中...' : `💾 保存排序（${Object.keys(dirtySorts).length} 項）`}
              </button>
            )}
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
                  桌面版圖片 <span className="text-destructive">*</span>
                  <span className="ml-1 text-xs text-muted-foreground font-normal">（自動壓縮為 WebP）</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.pic}
                    onChange={(e) => setForm((f) => ({ ...f, pic: e.target.value }))}
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                    placeholder="圖片網址或點擊上傳"
                  />
                  <input
                    ref={desktopFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleDesktopUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => desktopFileRef.current?.click()}
                    disabled={uploading && uploadTarget === 'desktop'}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {uploading && uploadTarget === 'desktop' ? <span className="animate-spin">🔄</span> : <span>📷</span>}
                    {uploading && uploadTarget === 'desktop' ? '上傳中...' : '上傳'}
                  </button>
                </div>
                {/* 上傳進度條（已改為屏幕居中覆蓋層，見頁面底部 UploadProgressOverlay） */}
                {form.pic && (
                  <div className="mt-2 rounded border bg-gray-50 p-2 flex items-center justify-center" style={{ maxHeight: '160px' }}>
                    <img
                      src={form.pic}
                      alt="預覽"
                      className="rounded object-contain"
                      style={{ maxHeight: '150px', maxWidth: '100%' }}
                    />
                  </div>
                )}
              </div>
              {/* 手機版圖片 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  手機版圖片
                  <span className="ml-1 text-xs text-muted-foreground font-normal">（自動壓縮為 WebP）</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.pic_mobile}
                    onChange={(e) => setForm((f) => ({ ...f, pic_mobile: e.target.value }))}
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                    placeholder="手機版圖片網址（可選）"
                  />
                  <input
                    ref={mobileFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleMobileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => mobileFileRef.current?.click()}
                    disabled={uploading && uploadTarget === 'mobile'}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {uploading && uploadTarget === 'mobile' ? <span className="animate-spin">🔄</span> : <span>📱</span>}
                    {uploading && uploadTarget === 'mobile' ? '上傳中...' : '上傳'}
                  </button>
                </div>
                {/* 上傳進度條（已改為屏幕居中覆蓋層，見頁面底部 UploadProgressOverlay） */}
                {form.pic_mobile && (
                  <div className="mt-2 rounded border bg-gray-50 p-2 flex items-center justify-center" style={{ maxHeight: '160px' }}>
                    <img
                      src={form.pic_mobile}
                      alt="移動端預覽"
                      className="rounded object-contain"
                      style={{ maxHeight: '150px', maxWidth: '100%' }}
                    />
                  </div>
                )}
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
                  <select
                    value={uniqueGroups.includes(form.gid) ? form.gid : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        const newGid = e.target.value
                        // 動態計算新分組下的排序序號（最大值 + 1）
                        const groupSlides = slides.filter((s) => (s.gid ?? '0') === newGid)
                        const maxSorting = groupSlides.length > 0
                          ? Math.max(...groupSlides.map((s) => s.sorting ?? 0))
                          : 0
                        setForm((f) => ({ ...f, gid: newGid, sorting: maxSorting + 1 }))
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm bg-white"
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

      {/* ─── 圖片壓縮對話框 ──────────────────────────────── */}
      {pendingSlideImage && (
        <ImageCompressDialog
          files={[pendingSlideImage.file]}
          onConfirm={handleSlideCompressConfirm}
          onCancel={() => setPendingSlideImage(null)}
        />
      )}

      {/* 上傳進度 + 錯誤（屏幕居中覆蓋層，統一組件） */}
      <UploadProgressOverlay
        uploading={uploading}
        progress={progress}
        error={uploadError}
        onClearError={clearError}
      />
    </div>
  )
}
