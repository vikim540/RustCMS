import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

/** 菜單節點 */
interface MenuItem {
  id: number
  mcode: string
  pcode: string
  name: string
  url: string
  ico: string
  sorting: number
  status: string
  shortcut: string
  type: string
  children?: MenuItem[]
}

/** 菜單表單 */
interface MenuForm {
  name: string
  url: string
  ico: string
  sorting: number
  status: string
  pcode: string
}

/** 空表單初始值 */
const EMPTY_FORM: MenuForm = {
  name: '',
  url: '',
  ico: '',
  sorting: 255,
  status: '1',
  pcode: '0',
}

/** 將樹展平為選項列表，用於父菜單下拉選擇 */
function flattenForSelect(
  nodes: MenuItem[],
  depth = 0,
  acc: { mcode: string; name: string; depth: number }[] = [],
): { mcode: string; name: string; depth: number }[] {
  for (const node of nodes) {
    acc.push({ mcode: node.mcode, name: node.name, depth })
    if (node.children?.length) {
      flattenForSelect(node.children, depth + 1, acc)
    }
  }
  return acc
}

/** 遞迴收集所有子節點 mcode（含自身） */
function collectAllMcodes(nodes: MenuItem[]): string[] {
  const result: string[] = []
  for (const node of nodes) {
    result.push(node.mcode)
    if (node.children?.length) {
      result.push(...collectAllMcodes(node.children))
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
}: {
  node: MenuItem
  depth: number
  expanded: Set<string>
  onToggle: (mcode: string) => void
  onEdit: (node: MenuItem) => void
  onDelete: (node: MenuItem) => void
}) {
  const hasChildren = !!node.children && node.children.length > 0
  const isOpen = expanded.has(node.mcode)

  return (
    <>
      <tr className="border-b last:border-b-0 hover:bg-accent/40 transition-colors">
        {/* 名稱（含展開按鈕和縮進） */}
        <td className="py-3 px-4">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => onToggle(node.mcode)}
                className="mr-1.5 p-0.5 rounded hover:bg-accent transition-colors shrink-0"
                aria-label={isOpen ? '收起' : '展開'}
              >
                {isOpen ? <span>⬇️</span> : <span>➡️</span>}
              </button>
            ) : (
              <span className="inline-block w-5 mr-1.5 shrink-0" />
            )}
            {node.ico && <span className="mr-1.5 text-sm">{node.ico}</span>}
            <span className={cn('truncate', depth === 0 ? 'font-semibold' : 'font-medium')}>
              {node.name}
            </span>
            {hasChildren && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({node.children!.length})
              </span>
            )}
          </div>
        </td>
        {/* 權限鍵 (mcode) */}
        <td className="py-3 px-4">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-700">
            🔑 {node.mcode}
          </span>
        </td>
        {/* URL */}
        <td className="py-3 px-4 text-sm text-muted-foreground">
          {node.url ? (
            <span className="font-mono text-xs">{node.url}</span>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </td>
        {/* 排序 */}
        <td className="py-3 px-4 text-sm text-muted-foreground">{node.sorting}</td>
        {/* 狀態 */}
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
        {/* 操作 */}
        <td className="py-3 px-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(node)}
              className="p-1.5 rounded hover:bg-accent transition-colors"
              title="編輯菜單"
            >
              <span>✏️</span>
            </button>
            <button
              onClick={() => onDelete(node)}
              className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="刪除菜單（同時刪除子菜單）"
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
          />
        ))}
    </>
  )
}

export default function Menus() {
  const [tree, setTree] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<MenuItem | null>(null)
  const [form, setForm] = useState<MenuForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  /** 拉取菜單樹 */
  const fetchTree = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<MenuItem[]>('/admin/menus')
      const data = Array.isArray(res.data) ? res.data : []
      setTree(data)
      // 預設展開第一層節點
      setExpanded(new Set(data.map((n) => n.mcode)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  /** 切換節點展開/收起 */
  const handleToggle = (mcode: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(mcode)) next.delete(mcode)
      else next.add(mcode)
      return next
    })
  }

  /** 全部展開 / 全部收起 */
  const allMcodes = flattenForSelect(tree).map((o) => o.mcode)
  const allExpanded = allMcodes.length > 0 && allMcodes.every((m) => expanded.has(m))
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(allMcodes))
  }

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setActionError('')
    setModalOpen(true)
  }

  /** 開啟編輯對話框 */
  const openEdit = (node: MenuItem) => {
    setEditTarget(node)
    setForm({
      name: node.name ?? '',
      url: node.url ?? '',
      ico: node.ico ?? '',
      sorting: node.sorting ?? 255,
      status: node.status ?? '1',
      pcode: node.pcode ?? '0',
    })
    setActionError('')
    setModalOpen(true)
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setActionError('菜單名稱不能為空')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url,
        ico: form.ico,
        sorting: form.sorting,
        status: form.status,
        pcode: form.pcode,
      }
      if (editTarget) {
        await api.put(`/admin/menus/${editTarget.id}`, payload)
      } else {
        await api.post('/admin/menus', payload)
      }
      setModalOpen(false)
      await fetchTree()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除菜單 */
  const handleDelete = async (node: MenuItem) => {
    const childCount = node.children?.length ?? 0
    const msg = childCount > 0
      ? `確定要刪除菜單「${node.name}」嗎?此操作將同時刪除 ${childCount} 個子菜單。`
      : `確定要刪除菜單「${node.name}」嗎?`
    if (!window.confirm(msg)) return
    setActionLoading(node.id)
    try {
      await api.del(`/admin/menus/${node.id}`)
      await fetchTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setActionLoading(null)
    }
  }

  const parentOptions = flattenForSelect(tree)
  const totalNodes = collectAllMcodes(tree).length

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">菜單管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理後台菜單結構，菜單的 mcode 即為角色權限的標識鍵
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
          >
            <span className="mr-1">➕</span>
            新增菜單
          </button>
        </div>
      </div>

      {/* 三者關係說明卡片 */}
      <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg px-5 py-3.5 flex items-start gap-3">
        <span className="text-lg shrink-0">💡</span>
        <div className="text-sm text-amber-800">
          <p className="font-medium mb-1">菜單是權限體系的基礎</p>
          <p className="text-amber-600 text-xs leading-relaxed">
            每個菜單都有唯一的 <span className="font-mono font-medium">mcode</span>（如 M101），
            在<span className="font-medium">角色管理</span>中，角色的權限就是選中的菜單 mcode 列表。
            新增菜單後，到角色管理中為對應角色勾選即可賦權。
          </p>
        </div>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>
          {error}
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
      {!loading && tree.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-50">📋</span>
          <p className="mb-3">尚未創建任何菜單</p>
          <p className="text-xs mb-4">菜單是角色權限的基礎，請先創建菜單結構</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
          >
            <span className="mr-1">➕</span>
            新增菜單
          </button>
        </div>
      )}

      {/* 菜單樹表格 */}
      {!loading && tree.length > 0 && (
        <>
          {/* 統計條 */}
          <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span>📊</span>
              共 {tree.length} 個頂級菜單，{totalNodes} 個菜單項
            </span>
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-secondary/50">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      菜單名稱
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      權限鍵 (mcode)
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      URL
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      排序
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      狀態
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
                      onDelete={handleDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 新增/編輯對話框 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
              <div>
                <h2 className="text-lg font-semibold">{editTarget ? '編輯菜單' : '新增菜單'}</h2>
                {editTarget && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    權限鍵: <span className="font-mono text-blue-600">{editTarget.mcode}</span>
                    （系統自動生成，不可修改）
                  </p>
                )}
              </div>
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
                  菜單名稱 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="如：內容管理"
                  autoFocus
                />
              </div>
              {/* 圖標 (emoji) */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  圖標 <span className="text-xs text-muted-foreground font-normal">（emoji）</span>
                </label>
                <input
                  type="text"
                  value={form.ico}
                  onChange={(e) => setForm((f) => ({ ...f, ico: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="如：📄 📋 ⚙️"
                />
                <p className="text-xs text-muted-foreground mt-1">輸入 emoji 字符作為菜單圖標</p>
              </div>
              {/* URL */}
              <div>
                <label className="block text-sm font-medium mb-1.5">URL 路徑</label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
                  placeholder="如：/contents（留空表示僅為分組）"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  對應前端路由路徑，頂級分組菜單可留空
                </p>
              </div>
              {/* 父菜單 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">父菜單</label>
                <select
                  value={form.pcode}
                  onChange={(e) => setForm((f) => ({ ...f, pcode: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                >
                  <option value="0">頂級菜單</option>
                  {parentOptions
                    .filter((opt) => opt.mcode !== editTarget?.mcode)
                    .map((opt) => (
                      <option key={opt.mcode} value={opt.mcode}>
                        {'　'.repeat(opt.depth)}
                        {opt.name} ({opt.mcode})
                      </option>
                    ))}
                </select>
              </div>
              {/* 排序 + 狀態 */}
              <div className="grid grid-cols-2 gap-4">
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

              {/* 權限鍵說明 */}
              {!editTarget && (
                <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2.5 text-xs text-blue-700 flex items-start gap-2">
                  <span className="shrink-0">🔑</span>
                  <span>
                    新增菜單後，系統會自動生成唯一的 mcode（如 M101）。
                    此 mcode 將作為角色權限的標識鍵，在角色管理中用於控制訪問。
                  </span>
                </div>
              )}

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
