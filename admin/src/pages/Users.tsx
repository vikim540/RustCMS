import { useEffect, useState, useCallback } from 'react'
import { api, type SiteInfo } from '../lib/api'
import { LoadingState, EmptyState, ErrorState } from '../components/StateDisplay'
import { cn, formatDate } from '../lib/utils'

/** 系統用戶數據結構 */
interface User {
  id: number
  ucode: string
  username: string
  realname: string
  rcodes: string
  login_count: number
  last_login_ip: string
  lastlogintime: string
  status: string
}

/** 角色數據（含權限數量） */
interface Role {
  id: number
  name: string
  rcode: string
  description: string
  status: string
}

/** 角色詳情（含權限 levels） */
interface RoleDetail {
  role: Role
  levels: string[]
}

/** 菜單節點 */
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

/** 用戶表單 */
interface UserForm {
  username: string
  password: string
  realname: string
  rcodes: string[]
  status: string
}

/** 空表單初始值 */
const EMPTY_FORM: UserForm = {
  username: '',
  password: '',
  realname: '',
  rcodes: [],
  status: '1',
}

/** 超級管理員 ucode（不可刪除） */
const SUPER_ADMIN_UCODE = '10001'

/** 遞迴查找 mcode 對應的菜單名稱 */
function findMenuName(nodes: MenuNode[], mcode: string): string {
  for (const node of nodes) {
    if (node.mcode === mcode) return node.name
    if (node.children?.length) {
      const found = findMenuName(node.children, mcode)
      if (found) return found
    }
  }
  return ''
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

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [menuTree, setMenuTree] = useState<MenuNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // 對話框狀態
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  // 多站點：可用站點列表 + 當前編輯用戶已分配的站點
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [userSiteIds, setUserSiteIds] = useState<string[]>([])

  // 權限預覽狀態
  const [roleLevelsCache, setRoleLevelsCache] = useState<Record<string, string[]>>({})
  const [showPermissionPreview, setShowPermissionPreview] = useState(false)
  const [permissionLoading, setPermissionLoading] = useState(false)

  /** 載入用戶列表 */
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<User[]>('/admin/users')
      setUsers(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 載入角色列表 */
  const fetchRoles = useCallback(async () => {
    try {
      const res = await api.get<Role[]>('/admin/roles')
      setRoles(res.data ?? [])
    } catch {
      /* 忽略角色載入錯誤 */
    }
  }, [])

  /** 載入菜單樹（用於權限預覽顯示菜單名稱） */
  const fetchMenuTree = useCallback(async () => {
    try {
      const res = await api.get<MenuNode[]>('/admin/menus')
      setMenuTree(Array.isArray(res.data) ? res.data : [])
    } catch {
      /* 靜默處理 */
    }
  }, [])

  /** 載入站點列表（用於用戶站點分配） */
  const fetchSites = useCallback(async () => {
    try {
      const res = await api.get<{ sites: SiteInfo[] }>('/admin/sites')
      setSites(res.data?.sites ?? [])
    } catch {
      /* 忽略站點載入錯誤 */
    }
  }, [])

  useEffect(() => {
    fetchUsers()
    fetchRoles()
    fetchMenuTree()
    fetchSites()
  }, [fetchUsers, fetchRoles, fetchMenuTree, fetchSites])

  /** 取得角色名稱 */
  const getRoleNames = (rcodes: string): string => {
    if (!rcodes) return '-'
    const codeList = rcodes.split(',').map((s) => s.trim()).filter(Boolean)
    const names = codeList.map((code) => roles.find((r) => r.rcode === code)?.name ?? code)
    return names.join(', ') || '-'
  }

  /** 取得用戶的角色列表（對象數組） */
  const getUserRoles = (rcodes: string): Role[] => {
    if (!rcodes) return []
    const codeList = rcodes.split(',').map((s) => s.trim()).filter(Boolean)
    return codeList
      .map((code) => roles.find((r) => r.rcode === code))
      .filter((r): r is Role => !!r)
  }

  /** 載入所選角色的權限詳情（用於預覽） */
  const loadRolePermissions = async (rcodeList: string[]) => {
    setPermissionLoading(true)
    const newCache = { ...roleLevelsCache }
    for (const rcode of rcodeList) {
      if (newCache[rcode]) continue
      const role = roles.find((r) => r.rcode === rcode)
      if (!role) continue
      try {
        const res = await api.get<RoleDetail>(`/admin/roles/${role.id}`)
        if (res.data?.levels) {
          newCache[rcode] = res.data.levels
        }
      } catch {
        /* 忽略 */
      }
    }
    setRoleLevelsCache(newCache)
    setPermissionLoading(false)
  }

  /** 計算用戶的有效權限（合併所有角色的 levels） */
  const getEffectivePermissions = (rcodeList: string[]): Set<string> => {
    const perms = new Set<string>()
    for (const rcode of rcodeList) {
      const levels = roleLevelsCache[rcode]
      if (levels) {
        levels.forEach((l) => perms.add(l))
      }
    }
    return perms
  }

  /** 開啟新增對話框 */
  const openCreate = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setActionError('')
    setShowPermissionPreview(false)
    // 新建用戶時：默認選中所有站點
    setUserSiteIds(sites.map((s) => s.siteId))
    setModalOpen(true)
  }

  /** 開啟編輯對話框 */
  const openEdit = (item: User) => {
    setEditTarget(item)
    setForm({
      username: item.username ?? '',
      password: '',
      realname: item.realname ?? '',
      rcodes: item.rcodes ? item.rcodes.split(',').map((s) => s.trim()).filter(Boolean) : [],
      status: item.status ?? '1',
    })
    setActionError('')
    setShowPermissionPreview(false)
    setModalOpen(true)
    // 預載入權限
    const codeList = item.rcodes ? item.rcodes.split(',').map((s) => s.trim()).filter(Boolean) : []
    if (codeList.length > 0) {
      loadRolePermissions(codeList)
    }
    // 預載入用戶已分配的站點
    api
      .get<{ siteIds: string[] }>(`/admin/users/${item.id}/sites`)
      .then((res) => setUserSiteIds(res.data?.siteIds ?? []))
      .catch(() => setUserSiteIds([]))
  }

  /** 單選角色（同一時間只能分配一個角色） */
  const selectRole = (rcode: string) => {
    setForm((f) => ({
      ...f,
      // 再次點擊已選角色 → 取消選擇；否則替換為新選擇
      rcodes: f.rcodes[0] === rcode ? [] : [rcode],
    }))
    // 選中角色時預載入其權限
    if (form.rcodes[0] !== rcode) {
      loadRolePermissions([rcode])
    }
  }

  /** 提交表單 */
  const handleSubmit = async () => {
    if (!editTarget && !form.username.trim()) {
      setActionError('用戶名不能為空')
      return
    }
    if (!editTarget && !form.password.trim()) {
      setActionError('密碼不能為空')
      return
    }

    // 判斷是否為超級管理員（超管擁有所有站點訪問權限，無需分配站點）
    const isSuperAdmin = editTarget?.ucode === SUPER_ADMIN_UCODE

    // 非超級管理員：必須至少分配一個站點
    if (!isSuperAdmin && userSiteIds.length === 0) {
      setActionError('必須為用戶選擇至少一個可訪問的站點')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      let userId: number | undefined

      if (editTarget) {
        const payload: Record<string, unknown> = {
          realname: form.realname,
          rcodes: form.rcodes.join(','),
          status: form.status,
        }
        if (form.password.trim()) {
          payload.password = form.password
        }
        await api.put(`/admin/users/${editTarget.id}`, payload)
        userId = editTarget.id
      } else {
        const payload = {
          username: form.username.trim(),
          password: form.password,
          realname: form.realname,
          rcodes: form.rcodes.join(','),
          status: form.status,
        }
        const res = await api.post<{ id?: number; user?: { id?: number } }>('/admin/users', payload)
        // 嘗試從響應中獲取新用戶 ID（兼容兩種返回格式）
        userId = res.data?.id ?? res.data?.user?.id
      }

      // 保存站點分配（超級管理員跳過，自動擁有所有站點權限）
      if (userId && !isSuperAdmin) {
        try {
          await api.post(`/admin/users/${userId}/sites`, { siteIds: userSiteIds })
        } catch (siteErr) {
          // 站點分配失敗不阻塞用戶創建，但提示警告
          console.warn('站點分配保存失敗:', siteErr)
        }
      }

      setModalOpen(false)
      await fetchUsers()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 刪除用戶 */
  const handleDelete = async (item: User) => {
    if (item.ucode === SUPER_ADMIN_UCODE) return
    if (!window.confirm(`確定要刪除用戶「${item.username}」嗎?`)) return
    setActionLoading(item.id)
    try {
      await api.del(`/admin/users/${item.id}`)
      await fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除失敗')
    } finally {
      setActionLoading(null)
    }
  }

  // 計算當前表單選中角色的有效權限
  const effectivePerms = getEffectivePermissions(form.rcodes)
  const totalMenuCount = collectAllMcodes(menuTree).length

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">系統用戶</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理後台用戶帳號，為用戶分配角色以控制其可訪問的菜單功能
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
        >
          <span className="mr-1">➕</span>
          新增用戶
        </button>
      </div>

      {/* 三者關係說明卡片 */}
      <div className="mb-5 bg-green-50 border border-green-200 rounded-lg px-5 py-3.5 flex items-start gap-3">
        <span className="text-lg shrink-0">💡</span>
        <div className="text-sm text-green-800">
          <p className="font-medium mb-1">用戶如何獲得菜單訪問權限</p>
          <p className="text-green-600 text-xs leading-relaxed">
            為用戶分配角色 → 角色包含菜單權限（在角色管理中配置）→ 用戶即可訪問對應菜單。
            每個用戶僅能分配一個角色。
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
        <LoadingState text="載入中..." />
      )}

      {/* 空狀態 */}
      {!loading && users.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-50">👥</span>
          <p className="mb-3">尚未創建任何用戶</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm"
          >
            <span className="mr-1">➕</span>
            新增用戶
          </button>
        </div>
      )}

      {/* 用戶表格 */}
      {!loading && users.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">用戶名</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">真實姓名</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">角色</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">登錄次數</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">最後登錄IP</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">最後登錄時間</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">狀態</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => {
                  const isSuperAdmin = item.ucode === SUPER_ADMIN_UCODE
                  const userRoles = getUserRoles(item.rcodes)
                  return (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">{item.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{item.username}</span>
                          {isSuperAdmin && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                              <span className="text-[10px]">🛡️</span>
                              超管
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.realname || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {userRoles.length === 0 ? (
                            <span className="text-muted-foreground text-xs">-</span>
                          ) : (
                            userRoles.map((role) => (
                              <span
                                key={role.rcode}
                                className={cn(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  role.status === '1'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-gray-100 text-gray-500',
                                )}
                                title={role.description || role.rcode}
                              >
                                {role.name}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.login_count ?? 0}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.last_login_ip || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(item.lastlogintime)}
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
                            title="編輯用戶及角色分配"
                          >
                            <span className="text-sm">✏️</span>
                            編輯
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            disabled={actionLoading === item.id || isSuperAdmin}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors disabled:opacity-50',
                              isSuperAdmin
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-red-600 hover:bg-red-50',
                            )}
                            title={isSuperAdmin ? '超級管理員不可刪除' : '刪除'}
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            {/* 對話框頭部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-lg font-semibold">{editTarget ? '編輯用戶' : '新增用戶'}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editTarget ? '修改用戶信息並分配角色' : '創建新用戶並分配角色'}
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
              {/* 基本信息區 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    用戶名 {!editTarget && <span className="text-destructive">*</span>}
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="請輸入用戶名"
                    disabled={!!editTarget}
                    autoFocus
                  />
                  {editTarget && (
                    <p className="text-xs text-muted-foreground mt-1">用戶名創建後不可修改</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    密碼 {!editTarget && <span className="text-destructive">*</span>}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder={editTarget ? '留空表示不修改密碼' : '請輸入密碼'}
                  />
                  {editTarget && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <span>🔒</span>
                      填寫新密碼以重設
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">真實姓名</label>
                  <input
                    type="text"
                    value={form.realname}
                    onChange={(e) => setForm((f) => ({ ...f, realname: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="請輸入真實姓名"
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

              {/* 角色分配區 */}
              <div className="border rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🎭</span>
                    <span className="text-sm font-medium">角色分配</span>
                    <span className="text-xs text-muted-foreground">
                      {form.rcodes.length > 0 ? `已選：${roles.find((r) => r.rcode === form.rcodes[0])?.name ?? form.rcodes[0]}` : '請選擇一個角色'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPermissionPreview(!showPermissionPreview)
                      if (!showPermissionPreview && form.rcodes.length > 0) {
                        loadRolePermissions(form.rcodes)
                      }
                    }}
                    className="text-xs px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors flex items-center gap-1"
                  >
                    <span>{showPermissionPreview ? '👁️‍🗨️' : '👁️'}</span>
                    {showPermissionPreview ? '收起權限預覽' : '查看權限預覽'}
                  </button>
                </div>

                {/* 角色選擇列表 */}
                <div className="p-3 space-y-2">
                  {roles.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      <span className="text-2xl block mb-2 opacity-50">🎭</span>
                      尚未創建任何角色
                      <p className="text-xs mt-1">請先到「角色管理」創建角色</p>
                    </div>
                  ) : (
                    roles.map((role) => {
                      const isSelected = form.rcodes.includes(role.rcode)
                      const rolePerms = roleLevelsCache[role.rcode]
                      return (
                        <div
                          key={role.id}
                          className={cn(
                            'flex items-center gap-3 p-2.5 rounded-md border transition-all cursor-pointer',
                            isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-accent/30',
                          )}
                          onClick={() => selectRole(role.rcode)}
                        >
                          {/* 單選框（radio 樣式） */}
                          <div
                            className={cn(
                              'flex items-center justify-center w-5 h-5 rounded-full border-2 transition-all shrink-0',
                              isSelected
                                ? 'border-primary'
                                : 'border-gray-300',
                            )}
                          >
                            {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                          </div>

                          {/* 角色信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{role.name}</span>
                              <span className="text-xs text-muted-foreground font-mono">{role.rcode}</span>
                              {role.status === '0' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                                  已禁用
                                </span>
                              )}
                            </div>
                            {role.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {role.description}
                              </p>
                            )}
                          </div>

                          {/* 權限數量 */}
                          <div className="shrink-0 text-right">
                            {rolePerms ? (
                              <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                                <span>📋</span>
                                {rolePerms.length} 個菜單
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* 權限預覽 */}
                {showPermissionPreview && (
                  <div className="border-t bg-secondary/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">📊</span>
                      <span className="text-sm font-medium">有效權限預覽</span>
                      <span className="text-xs text-muted-foreground">
                        （共 {effectivePerms.size} / {totalMenuCount} 個菜單）
                      </span>
                      {permissionLoading && (
                        <span className="animate-spin inline-block text-sm text-muted-foreground">🔄</span>
                      )}
                    </div>
                    {form.rcodes.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">請先選擇至少一個角色</p>
                    ) : permissionLoading ? (
                      <p className="text-xs text-muted-foreground py-2">載入權限中...</p>
                    ) : effectivePerms.size === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">所選角色未配置任何菜單權限</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                        {Array.from(effectivePerms).map((mcode) => {
                          const menuName = findMenuName(menuTree, mcode)
                          return (
                            <span
                              key={mcode}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border rounded text-foreground"
                            >
                              {menuName || mcode}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 站點分配區（超級管理員跳過，自動擁有所有站點權限） */}
              {editTarget?.ucode !== SUPER_ADMIN_UCODE && (
                <div className="border rounded-md overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/30">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🌐</span>
                      <span className="text-sm font-medium">站點訪問權限</span>
                      <span className="text-xs text-muted-foreground">
                        已選 {userSiteIds.length} / {sites.length} 個站點
                        {userSiteIds.length === 0 && (
                          <span className="text-destructive ml-1">（必須至少選擇一個）</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setUserSiteIds(sites.map((s) => s.siteId))}
                        className="text-xs px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        全選
                      </button>
                      <span className="text-muted-foreground text-xs">|</span>
                      <button
                        type="button"
                        onClick={() => setUserSiteIds([])}
                        className="text-xs px-2.5 py-1 text-muted-foreground hover:bg-accent rounded transition-colors"
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  {/* 站點勾選列表 */}
                  <div className="p-3">
                    {sites.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        <span className="text-2xl block mb-2 opacity-50">🌐</span>
                        尚未配置任何站點
                        <p className="text-xs mt-1">請先到「多站點管理」創建站點</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {sites.map((site) => {
                          const isSelected = userSiteIds.includes(site.siteId)
                          return (
                            <label
                              key={site.siteId}
                              className={cn(
                                'flex items-center gap-2.5 p-2.5 rounded-md border transition-all cursor-pointer',
                                isSelected
                                  ? 'border-primary bg-primary/5'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-accent/30',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setUserSiteIds((prev) => [...prev, site.siteId])
                                  } else {
                                    setUserSiteIds((prev) => prev.filter((id) => id !== site.siteId))
                                  }
                                }}
                                className="w-4 h-4 accent-primary shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium truncate">{site.name}</span>
                                  {site.isPrimary && (
                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 shrink-0">
                                      ⭐ 主站
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {site.domain || site.siteId}
                                </p>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 超級管理員站點權限提示 */}
              {editTarget?.ucode === SUPER_ADMIN_UCODE && (
                <div className="border rounded-md px-4 py-3 bg-purple-50 border-purple-200 flex items-center gap-2">
                  <span className="text-sm">🛡️</span>
                  <span className="text-sm text-purple-700">
                    超級管理員自動擁有所有站點的訪問權限，無需單獨分配
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
