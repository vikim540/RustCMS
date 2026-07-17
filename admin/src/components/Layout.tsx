import { useState, useEffect, useMemo } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { api, clearToken, getUserInfo, clearUserInfo } from '../lib/api'
import { cn } from '../lib/utils'

/** 模型數據結構 */
interface Model {
  id: number
  name: string
  mcode: string
  type: string // "1"=單頁, "2"=列表
  urlname: string
  status: string // "1"=啟用, "0"=禁用
  issystem: string
}

/** 導航項目 */
interface NavItem {
  to: string
  label: string
  icon: string // emoji 圖標
  /** 內容模型項目的 mcode，用於帶 query 參數時的 active 判斷 */
  mcode?: string
}

/** 導航分組 */
interface NavGroup {
  title: string
  icon: string // emoji 圖標
  items: NavItem[]
}

/** 菜單樹節點（用於權限過濾） */
interface MenuNode {
  mcode: string
  name: string
  url: string | null
  children?: MenuNode[]
}

/** 側邊欄分組配置（與 Go CMS 結構對齊） */
const NAV_GROUPS: NavGroup[] = [
  {
    title: '全局配置',
    icon: '⚙️',
    items: [
      { to: '/settings', label: '配置參數', icon: '🎛️' },
      { to: '/models', label: '模型管理', icon: '📦' },
      { to: '/extfields', label: '模型欄位', icon: '🧩' },
    ],
  },
  {
    title: '基礎內容',
    icon: '🗄️',
    items: [
      { to: '/site', label: '站點信息', icon: '🌐' },
      { to: '/company', label: '公司信息', icon: '🏢' },
      { to: '/categories', label: '內容欄目', icon: '🗂️' },
    ],
  },
  {
    title: '文章內容',
    icon: '📄',
    items: [
      // 列表型模型子菜單在組件中動態注入（見 navGroups）
      { to: '/trash', label: '回收站', icon: '🗑️' },
    ],
  },
  {
    title: '擴展內容',
    icon: '📦',
    items: [
      { to: '/singles', label: '單頁管理', icon: '📄' },
      { to: '/links', label: '友情連結', icon: '🔗' },
      { to: '/slides', label: '幻燈片', icon: '🖼️' },
      { to: '/tags', label: '標籤管理', icon: '🏷️' },
      { to: '/labels', label: '自定義標籤', icon: '📑' },
      { to: '/messages', label: '留言管理', icon: '💬' },
      { to: '/media', label: '媒體庫', icon: '🖼️' },
    ],
  },
  {
    title: '系統管理',
    icon: '🛡️',
    items: [
      { to: '/users', label: '系統用戶', icon: '👥' },
      { to: '/roles', label: '角色管理', icon: '🔐' },
      { to: '/menus', label: '選單管理', icon: '📋' },
      { to: '/logs', label: '系統日誌', icon: '📜' },
      { to: '/database', label: '資料庫管理', icon: '🖥️' },
      { to: '/storage', label: '存儲設置', icon: '💾' },
    ],
  },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  // 預設所有分組展開
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // 模型列表（掛載時載入一次）
  const [models, setModels] = useState<Model[]>([])
  // 當前用戶信息（用於側邊欄權限過濾）
  const [userInfo, setUserInfo] = useState(() => getUserInfo())
  // 菜單名稱 → mcode 映射（從菜單樹構建）
  const [menuMcodeMap, setMenuMcodeMap] = useState<Map<string, string>>(new Map())

  // 載入模型列表
  useEffect(() => {
    api
      .get<Model[]>('/admin/models/all')
      .then((res) => setModels(res.data ?? []))
      .catch(() => {
        /* 載入失敗時靜默處理，側邊欄僅顯示回收站 */
      })
  }, [])

  // 載入菜單樹，構建名稱 → mcode 映射（用於側邊欄權限過濾）
  useEffect(() => {
    api
      .get<MenuNode[]>('/admin/menus')
      .then((res) => {
        const map = new Map<string, string>()
        const walk = (nodes: MenuNode[]) => {
          for (const node of nodes ?? []) {
            map.set(node.name, node.mcode)
            if (node.children?.length) walk(node.children)
          }
        }
        walk(res.data ?? [])
        setMenuMcodeMap(map)
      })
      .catch(() => {})
  }, [])

  // 構建導航分組（將動態模型注入「文章內容」分組前端，回收站保留末尾）
  const navGroups = useMemo<NavGroup[]>(() => {
    const contentModelItems: NavItem[] = models
      .filter((m) => m.type === '2' && m.status === '1')
      .map((m) => ({
        to: `/contents?mcode=${encodeURIComponent(m.mcode)}`,
        label: `${m.name}列表`,
        icon: '📰',
        mcode: m.mcode,
      }))
    return NAV_GROUPS.map((group) =>
      group.title === '文章內容'
        ? { ...group, items: [...contentModelItems, ...group.items] }
        : group,
    )
  }, [models])

  /** 檢查用戶是否有該導航項目的訪問權限 */
  const hasNavPermission = (item: NavItem): boolean => {
    // 用戶信息未載入時放行（避免空白側邊欄）
    if (!userInfo) return true
    // 超級管理員看到所有菜單
    if (userInfo.isSuper) return true
    // 內容模型項目有 mcode，直接檢查
    if (item.mcode) return userInfo.permissions.includes(item.mcode)
    // 其他項目：通過名稱查找對應的菜單 mcode
    const mcode = menuMcodeMap.get(item.label)
    // 找不到對應菜單時放行（如回收站等非菜單項目）
    if (!mcode) return true
    return userInfo.permissions.includes(mcode)
  }

  /** 按權限過濾後的導航分組（隱藏無權限項目和空分組） */
  const filteredNavGroups = useMemo(() => {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(hasNavPermission),
      }))
      .filter((group) => group.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navGroups, userInfo, menuMcodeMap])

  /** 判斷帶 mcode 的內容項目是否當前活躍（基於 query 參數比對） */
  const isContentItemActive = (itemMcode: string): boolean => {
    if (location.pathname !== '/contents') return false
    const params = new URLSearchParams(location.search)
    return (params.get('mcode') || '') === itemMcode
  }

  const handleLogout = async () => {
    try {
      await fetch(`${import.meta.env.VITE_API_BASE || '/api/v1'}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('cms_token')}` },
      })
    } catch {
      /* ignore */
    }
    clearToken()
    clearUserInfo()
    navigate('/login')
  }

  /** 切換分組展開/收起 */
  const toggleGroup = (title: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  return (
    <div className="flex h-screen">
      {/* 側邊欄 */}
      <aside className="w-56 bg-white border-r flex flex-col">
        <div className="h-14 flex items-center px-6 border-b">
          <span className="font-bold text-lg">CMS 管理後台</span>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {/* 儀表板（置頂，獨立項目） */}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-6 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-secondary text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )
            }
          >
            <span className="text-base">📊</span>
            儀表板
          </NavLink>

          {/* 分組導航 */}
          {filteredNavGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.title)
            return (
              <div key={group.title} className="mt-1">
                {/* 分組標題（可點擊展開/收起） */}
                <button
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center gap-2 px-6 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="text-xs shrink-0">{isCollapsed ? '➡️' : '⬇️'}</span>
                  <span className="text-sm shrink-0">{group.icon}</span>
                  <span>{group.title}</span>
                </button>

                {/* 子項目 */}
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const isContentItem = item.mcode !== undefined
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          className={({ isActive }) => {
                            // 帶 mcode 的內容項目使用自定義 active 判斷（基於 query 參數）
                            const active = isContentItem
                              ? isContentItemActive(item.mcode!)
                              : isActive
                            return cn(
                              'flex items-center gap-3 pl-10 pr-6 py-2 text-sm transition-colors',
                              active
                                ? 'bg-secondary text-foreground font-medium'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                            )
                          }}
                        >
                          <span className="text-base">{item.icon}</span>
                          {item.label}
                        </NavLink>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <div className="p-4 border-t">
          {/* 當前用戶信息 */}
          {userInfo && (
            <div className="flex items-center gap-2 mb-3 px-2 text-xs text-muted-foreground">
              <span className="text-sm">{userInfo.isSuper ? '👑' : '👤'}</span>
              <span className="truncate font-medium text-foreground">
                {userInfo.realname || userInfo.username}
              </span>
              {userInfo.isSuper && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                  超管
                </span>
              )}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
          >
            <span className="text-base">🚪</span>
            退出登錄
          </button>
        </div>
      </aside>

      {/* 主內容區 */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
