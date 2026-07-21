import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 角色數據結構 */
interface Role {
  id: number
  name: string
  rcode: string
  description: string
  status: string
  /** 該角色被多少用戶引用 */
  userCount?: number
  /** 該角色有多少條權限 */
  levelCount?: number
}

/** 角色詳情（含權限） */
interface RoleDetail {
  role: Role
  levels: string[]
}

/** 角色表單 */
interface RoleForm {
  name: string
  rcode: string
  description: string
  status: string
  levels: string[]
}

/** 空表單初始值 */
const EMPTY_FORM: RoleForm = {
  name: '',
  rcode: '',
  description: '',
  status: '1',
  levels: [],
}

/** 菜單節點（從 /admin/menus 取得） */
interface MenuNode {
  id: number
  mcode: string
  pcode: string
  name: string
  url: string
  ico: string
  sorting: number
  status: string
  children?: MenuNode[]
}

/** 遞迴收集樹中所有 mcode */
function collectAllMcodes(nodes: MenuNode[]): string[] {
  const result: string[] = []
  for (const node of nodes) {
    result.push(node.mcode)
    if (node.children?.length) {
      result.push(...collectAllMcodes(node.children))
    }
  }
  return result
}

/** 遞迴計算樹中已選中的 mcode 數量 */
function countSelected(nodes: MenuNode[], selected: Set<string>): number {
  let count = 0
  for (const node of nodes) {
    if (selected.has(node.mcode)) count++
    if (node.children?.length) {
      count += countSelected(node.children, selected)
    }
  }
  return count
}

/** 遞迴計算樹中所有節點數量 */
function countAll(nodes: MenuNode[]): number {
  let count = 0
  for (const node of nodes) {
    count++
    if (node.children?.length) {
      count += countAll(node.children)
    }
  }
  return count
}

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 菜單樹（權限來源）
  const [menuTree, setMenuTree] = useState<MenuNode[]>([])
  const [menuLoading, setMenuLoading] = useState(true)

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)

  // 權限樹展開狀態（頂級菜單 mcode → 是否展開）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  /** 載入角色列表 */
  const fetchRoles = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Role[]>('/admin/roles')
      setRoles(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 載入菜單樹（權限來源，與菜單管理頁面共用同一 API） */
  const fetchMenuTree = useCallback(async () => {
    setMenuLoading(true)
    try {
      const res = await api.get<MenuNode[]>('/admin/menus')
      const tree = Array.isArray(res.data) ? res.data : []
      setMenuTree(tree)
      // 預設展開所有頂級菜單
      setExpandedGroups(new Set(tree.map((n) => n.mcode)))
    } catch {
      /* 菜單載入失敗時靜默處理，權限樹為空 */
    } finally {
      setMenuLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRoles()
    fetchMenuTree()
  }, [fetchRoles, fetchMenuTree])

  /** 切換頂級分組展開 */
  const toggleGroup = (mcode: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(mcode)) next.delete(mcode)
      else next.add(mcode)
      return next
    })
  }

  /** 切換某菜單權限選擇 */
  const togglePermission = (mcode: string) => {
    setForm((f) => ({
      ...f,
      levels: f.levels.includes(mcode)
        ? f.levels.filter((l) => l !== mcode)
        : [...f.levels, mcode],
    }))
  }

  /** 切換整組權限（頂級菜單及其所有子菜單） */
  const toggleGroupPermissions = (group: MenuNode) => {
    const allMcodes = [group.mcode, ...collectAllMcodes(group.children ?? [])]
    const selectedSet = new Set(form.levels)
    const allSelected = allMcodes.every((m) => selectedSet.has(m))

    setForm((f) => {
      let next = [...f.levels]
      if (allSelected) {
        // 取消整組
        const toRemove = new Set(allMcodes)
        next = next.filter((l) => !toRemove.has(l))
      } else {
        // 選中整組
        for (const m of allMcodes) {
          if (!next.includes(m)) next.push(m)
        }
      }
      return { ...f, levels: next }
    })
  }

  /** 全選所有權限 */
  const selectAllPermissions = () => {
    const allMcodes = collectAllMcodes(menuTree)
    setForm((f) => ({ ...f, levels: allMcodes }))
  }

  /** 清空所有權限 */
  const clearAllPermissions = () => {
    setForm((f) => ({ ...f, levels: [] }))
  }

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setExpandedGroups(new Set(menuTree.map((n) => n.mcode)))
    setActionError('')
    setModalOpen(true)
  }

  /** 開啟編輯對話框（需載入權限詳情） */
  const openEdit = async (item: Role) => {
    setEditTarget(item)
    setForm({
      name: item.name ?? '',
      rcode: item.rcode ?? '',
      description: item.description ?? '',
      status: item.status ?? '1',
      levels: [],
    })
    setExpandedGroups(new Set(menuTree.map((n) => n.mcode)))
    setActionError('')
    setModalOpen(true)
    setDetailLoading(true)
    try {
      const res = await api.get<RoleDetail>(`/admin/roles/${item.id}`)
      if (res.data?.levels) {
        setForm((f) => ({ ...f, levels: res.data!.levels }))
      }
    } catch {
      /* 忽略權限載入錯誤，使用空權限 */
    } finally {
      setDetailLoading(false)
    }
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setActionError('角色名稱不能為空')
      return
    }
    // rcode 由後端自動生成（generateRcode），前端不再提交

    setSaving(true)
    setActionError('')
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        status: form.status,
        levels: form.levels,
      }
      if (editTarget) {
        await api.put(`/admin/roles/${editTarget.id}`, payload)
      } else {
        await api.post('/admin/roles', payload)
      }
      setModalOpen(false)
      await fetchRoles()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除角色 */
  const handleDelete = async (item: Role) => {
    if (!window.confirm(`確定要刪除角色「${item.name}」嗎?`)) return
    setActionLoading(item.id)
    try {
      await api.del(`/admin/roles/${item.id}`)
      await fetchRoles()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setActionLoading(null)
    }
  }

  /** 遞迴渲染權限樹節點 */
  const renderPermissionNode = (node: MenuNode, depth: number): React.ReactNode => {
    const isSelected = form.levels.includes(node.mcode)
    const hasChildren = !!node.children && node.children.length > 0

    // 計算子節點選中狀態
    const childMcodes = hasChildren ? collectAllMcodes(node.children!) : []
    const selectedChildren = childMcodes.filter((m) => form.levels.includes(m)).length
    const isPartial = hasChildren && selectedChildren > 0 && selectedChildren < childMcodes.length

    return (
      <div key={node.mcode}>
        <div
          className={cn(
            'flex items-center gap-2 py-2 px-2 rounded transition-colors hover:bg-accent/40',
            depth > 0 && 'ml-6',
          )}
          style={{ marginLeft: `${depth * 24}px` }}
        >
          {/* 展開/收起按鈕 */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleGroup(node.mcode)}
              className="p-0.5 rounded hover:bg-accent transition-colors shrink-0"
            >
              {expandedGroups.has(node.mcode) ? '⬇️' : '➡️'}
            </button>
          ) : (
            <span className="inline-block w-5 shrink-0" />
          )}

          {/* 權限複選框 */}
          <button
            type="button"
            onClick={() => hasChildren ? toggleGroupPermissions(node) : togglePermission(node.mcode)}
            className={cn(
              'flex items-center justify-center w-5 h-5 rounded border-2 transition-all shrink-0',
              isSelected
                ? 'bg-primary border-primary text-white'
                : isPartial
                  ? 'bg-primary/30 border-primary'
                  : 'bg-white border-gray-300 hover:border-primary',
            )}
          >
            {isSelected && <span className="text-xs">✓</span>}
            {isPartial && !isSelected && <span className="text-xs text-primary">●</span>}
          </button>

          {/* 菜單圖標 + 名稱 */}
          <span className="text-sm flex-1 truncate">
            {node.ico && <span className="mr-1.5">{node.ico}</span>}
            <span className={cn(isSelected ? 'font-medium' : 'text-muted-foreground')}>
              {node.name}
            </span>
          </span>

          {/* 菜單路徑（權限鍵） */}
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {node.mcode}
          </span>

          {/* 子節點選中計數 */}
          {hasChildren && (
            <span className="text-xs text-muted-foreground shrink-0">
              {selectedChildren}/{childMcodes.length}
            </span>
          )}
        </div>

        {/* 子節點 */}
        {hasChildren && expandedGroups.has(node.mcode) && (
          <div>
            {node.children!.map((child) => renderPermissionNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const selectedSet = new Set(form.levels)
  const totalMenuNodes = countAll(menuTree)
  const selectedCount = selectedSet.size

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">角色管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理後台角色，權限與菜單樹聯動 — 角色選中的菜單即為可訪問的功能
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增角色
        </button>
      </div>

      {/* 三者關係說明卡片 */}
      <div className="mb-5 bg-blue-50 border border-blue-200 rounded-lg px-5 py-3.5 flex items-start gap-3">
        <span className="text-lg shrink-0">💡</span>
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-1">角色 / 用戶 / 菜單 三者關係</p>
          <p className="text-blue-600 text-xs leading-relaxed">
            <span className="font-medium">菜單管理</span>定義後台可用功能頁面 →
            <span className="font-medium">角色管理</span>選擇該角色可訪問的菜單（即權限）→
            <span className="font-medium">用戶管理</span>為用戶分配角色，用戶即可訪問對應菜單
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
      {loading && <LoadingState text="載入中..." />}

      {/* 空狀態 */}
      {!loading && roles.length === 0 && !error && (
        <>
          <EmptyState icon="🔐" text="尚未創建任何角色" />
          <div className="flex justify-center -mt-16 pb-8">
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
            >
              <span className="mr-1">➕</span>
              新增角色
            </button>
          </div>
        </>
      )}

      {/* 角色表格 */}
      {!loading && roles.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">角色名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">代碼</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">描述</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">權限數</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">用戶數</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">狀態</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{item.name}</span>
                        {/* 系統角色標識 */}
                        {item.name.includes('超級') && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-normal">
                            系統
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{item.rcode}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.description || '-'}</td>
                    {/* 權限數 */}
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'inline-block px-2 py-0.5 rounded text-xs font-medium',
                        (item.levelCount ?? 0) > 0
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-400',
                      )}>
                        {item.levelCount ?? 0}
                      </span>
                    </td>
                    {/* 用戶數 */}
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'inline-block px-2 py-0.5 rounded text-xs font-medium',
                        (item.userCount ?? 0) > 0
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-gray-100 text-gray-400',
                      )}>
                        {item.userCount ?? 0}
                      </span>
                    </td>
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
                          title="編輯角色及其菜單權限"
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 新增/編輯對話框 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            {/* 對話框頭部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-lg font-semibold">{editTarget ? '編輯角色' : '新增角色'}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editTarget ? '修改角色信息及菜單權限' : '創建新角色並分配菜單權限'}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                ❌
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    角色名稱 <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="請輸入角色名稱"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    角色代碼 <span className="text-muted-foreground text-xs">（系統自動生成）</span>
                  </label>
                  <input
                    type="text"
                    value={editTarget ? form.rcode : '創建後自動生成（如 R101）'}
                    disabled
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono bg-gray-50 text-muted-foreground cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">描述</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="角色用途描述"
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

              {/* 菜單權限樹 */}
              <div className="border rounded-md overflow-hidden">
                {/* 權限樹頭部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📋</span>
                    <span className="text-sm font-medium">菜單權限</span>
                    <span className="text-xs text-muted-foreground">
                      已選 {selectedCount} / {totalMenuNodes} 個菜單
                    </span>
                    {detailLoading && (
                      <span className="animate-spin inline-block text-sm text-muted-foreground">🔄</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllPermissions}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      全選
                    </button>
                    <button
                      type="button"
                      onClick={clearAllPermissions}
                      className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                    >
                      清空
                    </button>
                  </div>
                </div>

                {/* 權限樹內容 */}
                <div className="max-h-[400px] overflow-y-auto px-2 py-2">
                  {menuLoading ? (
                    <LoadingState text="載入菜單樹..." inline />
                  ) : menuTree.length === 0 ? (
                    <EmptyState icon="📋" text="尚未配置任何菜單" hint="請先到「菜單管理」創建菜單項" />
                  ) : (
                    <div className="space-y-0.5">
                      {menuTree.map((node) => renderPermissionNode(node, 0))}
                    </div>
                  )}
                </div>
              </div>

              {/* 權限統計條 */}
              {menuTree.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-secondary/20 rounded-md">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${totalMenuNodes > 0 ? (selectedCount / totalMenuNodes) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {totalMenuNodes > 0 ? Math.round((selectedCount / totalMenuNodes) * 100) : 0}%
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

            {/* 對話框底部 */}
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
