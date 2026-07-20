import { useState, useEffect, useMemo } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { api, clearToken, getUserInfo, clearUserInfo } from '../lib/api'
import { cn } from '../lib/utils'
import { FeatureFlagProvider } from '../hooks/useFeatureFlags'

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

/**
 * 側邊欄標籤 → 菜單 mcode 顯式映射
 * 與 ay_menu 表完全對齊，確保權限選擇器（Roles.tsx）與側邊欄分組一致。
 * 未列出的標籤默認隱藏（安全優先），僅超級管理員可見。
 */
const LABEL_MCODE_MAP: Record<string, string> = {
  // 內容管理 (M200 子菜單)
  '欄目管理': 'M202',
  '單頁管理': 'M203',
  '留言管理': 'M204',
  '擴展字段': 'M206',
  '內容模型': 'M207',
  '回收站': 'M208',
  // 多媒體 (M300 子菜單)
  '媒體庫': 'M301',
  // SEO設置 (M400 子菜單)
  '友情連結': 'M401',
  '幻燈片': 'M402',
  '標籤管理': 'M403',
  // M404 自定義標籤已移除（headless CMS 無模板引擎，功能與 config API 重疊）
  // 系統設置 (M500 子菜單)
  '站點信息': 'M501',
  '公司信息': 'M502',
  '系統配置': 'M503',
  '系統用戶': 'M504',
  '角色管理': 'M505',
  '菜單管理': 'M506',
  '系統日誌': 'M507',
  // 「資料庫管理」「存儲設置」無對應菜單 → 不在映射中，默認僅超管可見
}

/** 內容模型列表的統一權限鍵（ay_menu M201 = 文章列表） */
const CONTENT_LIST_PERMISSION = 'M201'

/**
 * 側邊欄分組配置（與 ay_menu 菜單樹結構完全對齊，參考 PbootCMS/Go 版分組邏輯）
 * 分組順序：全局配置 → 基礎內容 → 文章內容 → 擴展內容 → 多媒體 → 系統管理
 * 「文章內容」僅放文案相關（動態模型列表 + 回收站），技術性菜單在「全局配置」
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: '全局配置',
    icon: '🌐',
    items: [
      { to: '/settings', label: '系統配置', icon: '🎛️' },
      { to: '/models', label: '內容模型', icon: '📦' },
      { to: '/extfields', label: '擴展字段', icon: '🧩' },
    ],
  },
  {
    title: '基礎內容',
    icon: '📋',
    items: [
      { to: '/site', label: '站點信息', icon: '🌐' },
      { to: '/company', label: '公司信息', icon: '🏢' },
      { to: '/categories', label: '欄目管理', icon: '🗂️' },
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
      { to: '/messages', label: '留言管理', icon: '💬' },
      { to: '/links', label: '友情連結', icon: '🔗' },
      { to: '/tags', label: '標籤管理', icon: '🏷️' },
    ],
  },
  {
    title: '多媒體',
    icon: '🖼️',
    items: [
      { to: '/media', label: '媒體庫', icon: '🖼️' },
      { to: '/slides', label: '幻燈片', icon: '🖼️' },
    ],
  },
  {
    title: '系統管理',
    icon: '🛡️',
    items: [
      { to: '/users', label: '系統用戶', icon: '👥' },
      { to: '/roles', label: '角色管理', icon: '🔐' },
      { to: '/menus', label: '菜單管理', icon: '📋' },
      { to: '/logs', label: '系統日誌', icon: '📜' },
      // 以下兩項無對應菜單 mcode，默認僅超級管理員可見
      { to: '/database', label: '資料庫管理', icon: '🖥️' },
      { to: '/storage', label: '存儲設置', icon: '💾' },
    ],
  },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  // 預設所有分組收起，僅「文章內容」展開（文案日常工作區域）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(NAV_GROUPS.filter((g) => g.title !== '文章內容').map((g) => g.title)),
  )
  // 模型列表（掛載時載入一次）
  const [models, setModels] = useState<Model[]>([])
  // 當前用戶信息（用於側邊欄權限過濾）
  const [userInfo, setUserInfo] = useState(() => getUserInfo())

  // 載入模型列表
  useEffect(() => {
    api
      .get<Model[]>('/admin/models/all')
      .then((res) => setModels(res.data ?? []))
      .catch(() => {
        /* 載入失敗時靜默處理，側邊欄僅顯示回收站 */
      })
  }, [])

  // 構建導航分組（將動態模型注入「文章內容」分組前端，欄目管理保持首位）
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
    // 內容模型列表項目：統一使用 M201 (文章列表) 權限控制
    // item.mcode 是模型編碼（如 M1、M2），非菜單編碼，不能直接用於權限校驗
    if (item.mcode) return userInfo.permissions.includes(CONTENT_LIST_PERMISSION)
    // 其他項目：通過顯式映射表查找權限鍵
    const mcode = LABEL_MCODE_MAP[item.label]
    // 未映射的項目默認隱藏（安全優先）
    // 如「資料庫管理」「存儲設置」等僅超級管理員可用的功能
    if (!mcode) return false
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
  }, [navGroups, userInfo])

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
    <FeatureFlagProvider>
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
    </FeatureFlagProvider>
  )
}
