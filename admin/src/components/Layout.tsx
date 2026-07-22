import { useState, useEffect, useMemo, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { api, clearToken, getUserInfo, clearUserInfo, setPermissionDeniedCallback, setUserInfo, getCurrentSiteId, setCachedSites, clearCurrentSite, type UserInfo, type SiteInfo } from '../lib/api'
import { cn } from '../lib/utils'
import { FeatureFlagProvider } from '../hooks/useFeatureFlags'
import { SiteProvider, useSite } from '../contexts/SiteContext'

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
  /** 顯式權限 mcode（用於動態注入項目，如表單子項使用 M204） */
  permissionMcode?: string
}

/** 活躍表單（用於側邊欄動態注入） */
interface ActiveForm {
  id: number
  form_name: string
  fcode: string
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
  '自定義表單': 'M204',
  '表單管理': 'M210',
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
  '多站點管理': 'M508',
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
      { to: '/forms', label: '表單管理', icon: '📝' },
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
      { to: '/forms/submissions', label: '自定義表單', icon: '📝' },
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
      { to: '/sites', label: '多站點管理', icon: '🌐' },
      // 以下兩項無對應菜單 mcode，默認僅超級管理員可見
      { to: '/database', label: '資料庫管理', icon: '🖥️' },
      { to: '/storage', label: '存儲設置', icon: '💾' },
    ],
  },
]

export default function Layout() {
  // SiteProvider 包裹內層組件，提供站點上下文 + 切換過渡覆蓋層
  return (
    <SiteProvider>
      <LayoutInner />
    </SiteProvider>
  )
}

function LayoutInner() {
  const navigate = useNavigate()
  const location = useLocation()
  // 站點上下文（取代本地 useState，集中管理站點狀態 + 切換過渡動畫）
  const { sites, setSites, currentSiteName, currentSiteId, updateCurrentSite, switchSite } = useSite()
  // 預設所有分組收起，僅「文章內容」展開（文案日常工作區域）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(NAV_GROUPS.filter((g) => g.title !== '文章內容').map((g) => g.title)),
  )
  // 模型列表（掛載時載入一次）
  const [models, setModels] = useState<Model[]>([])
  // 活躍表單列表（掛載時載入，用於側邊欄擴展內容動態注入）
  const [activeForms, setActiveForms] = useState<ActiveForm[]>([])
  // 當前用戶信息（用於側邊欄權限過濾）
  const [userInfo, setUserInfoState] = useState(() => getUserInfo())
  // 個人信息是否已從後端刷新完成（未刷新前非超管顯示骨架屏，避免權限閃現）
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false)
  const siteDropdownRef = useRef<HTMLDivElement>(null)

  // ─── 權限拒絕 toast 提示 ────────────────────────────────
  const [permToast, setPermToast] = useState<string | null>(null)
  useEffect(() => {
    setPermissionDeniedCallback((msg: string) => {
      setPermToast(msg)
      // 3 秒後自動消失
      setTimeout(() => setPermToast(null), 3000)
    })
    return () => setPermissionDeniedCallback(null)
  }, [])

  // 載入模型列表
  useEffect(() => {
    api
      .get<Model[]>('/admin/models/all')
      .then((res) => setModels(res.data ?? []))
      .catch(() => {
        /* 載入失敗時靜默處理，側邊欄僅顯示回收站 */
      })
  }, [])

  // 載入活躍表單列表（用於側邊欄擴展內容動態注入）
  useEffect(() => {
    api
      .get<ActiveForm[]>('/admin/forms/active')
      .then((res) => setActiveForms(res.data ?? []))
      .catch(() => {
        /* 載入失敗時靜默處理，側邊欄不顯示表單子項 */
      })
  }, [])

  // 載入用戶可訪問的站點列表
  useEffect(() => {
    api
      .get<{ sites: SiteInfo[] }>('/admin/sites')
      .then((res) => {
        const siteList = res.data?.sites ?? []
        setSites(siteList)
        setCachedSites(siteList)
        // 如果當前選中的站點不在列表中，切換到第一個可用站點
        const currentId = getCurrentSiteId()
        const found = siteList.find((s) => s.siteId === currentId)
        if (!found && siteList.length > 0) {
          updateCurrentSite(siteList[0].siteId, siteList[0].name)
        } else if (found) {
          updateCurrentSite(found.siteId, found.name)
        }
      })
      .catch(() => {
        /* 使用緩存的站點列表 */
      })
  }, [])

  // 點擊外部關閉站點下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setSiteDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  /** 切換站點：由 SiteContext 處理（更新狀態 + 過渡動畫 + 刷新頁面） */
  function handleSiteSwitch(site: SiteInfo) {
    setSiteDropdownOpen(false)
    switchSite(site)
  }

  // ─── 掛載時拉取最新用戶信息（刷新權限，解決角色權限變更後 JWT 過時的問題）───
  // 刷新完成後設置 profileLoaded=true，讓骨架屏消失；失敗也標記已載入（降級使用緩存）
  useEffect(() => {
    api
      .get<{
        id: number
        ucode: string
        username: string
        realname: string
        isSuper: boolean
        permissions: string[]
      }>('/auth/profile')
      .then((res) => {
        if (!res.data) {
          setProfileLoaded(true)
          return
        }
        const freshInfo: UserInfo = {
          id: res.data.id,
          ucode: res.data.ucode,
          username: res.data.username,
          realname: res.data.realname || '',
          isSuper: res.data.isSuper,
          permissions: res.data.permissions || [],
        }
        const oldInfo = getUserInfo()
        // 比較權限是否有變化
        const oldPerms = JSON.stringify(oldInfo?.permissions ?? [])
        const newPerms = JSON.stringify(freshInfo.permissions)
        if (oldPerms !== newPerms) {
          // 權限有變化 → 更新 localStorage + 狀態
          setUserInfo(freshInfo)
          setUserInfoState(freshInfo)
        }
        setProfileLoaded(true)
      })
      .catch(() => {
        // 靜默處理，使用 localStorage 中的緩存
        // 即使刷新失敗也標記為已載入，讓骨架屏消失（降級使用緩存權限）
        setProfileLoaded(true)
      })
  }, [])

  // 構建導航分組（將動態模型注入「文章內容」、活躍表單注入「擴展內容」）
  const navGroups = useMemo<NavGroup[]>(() => {
    const contentModelItems: NavItem[] = models
      .filter((m) => m.type === '2' && m.status === '1')
      .map((m) => ({
        to: `/contents?mcode=${encodeURIComponent(m.mcode)}`,
        label: `${m.name}列表`,
        icon: '📰',
        mcode: m.mcode,
      }))
    const formItems: NavItem[] = activeForms.map((f) => ({
      to: `/forms/submissions?form_key=${f.id}`,
      label: f.form_name,
      icon: '📝',
      permissionMcode: 'M204',
    }))
    return NAV_GROUPS.map((group) => {
      if (group.title === '文章內容') {
        return { ...group, items: [...contentModelItems, ...group.items] }
      }
      if (group.title === '擴展內容') {
        // 在「自定義表單」之後插入活躍表單子項
        const idx = group.items.findIndex((i) => i.to === '/forms/submissions')
        if (idx === -1) return group
        const before = group.items.slice(0, idx + 1)
        const after = group.items.slice(idx + 1)
        return { ...group, items: [...before, ...formItems, ...after] }
      }
      return group
    })
  }, [models, activeForms])

  /** 檢查用戶是否有該導航項目的訪問權限 */
  const hasNavPermission = (item: NavItem): boolean => {
    // 用戶信息未載入時隱藏所有非超管項目（避免權限閃現：舊權限先顯示後被過濾）
    if (!userInfo) return false
    // 超級管理員看到所有菜單
    if (userInfo.isSuper) return true
    // 動態注入項目（如表單子項）：使用顯式 permissionMcode
    if (item.permissionMcode) return userInfo.permissions.includes(item.permissionMcode)
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

  /** 判斷表單子項目是否當前活躍（基於 form_key query 參數比對） */
  const isFormItemActive = (itemTo: string): boolean => {
    if (location.pathname !== '/forms/submissions') return false
    const itemParams = new URLSearchParams(itemTo.split('?')[1] || '')
    const itemFormKey = itemParams.get('form_key') || ''
    const currentParams = new URLSearchParams(location.search)
    return (currentParams.get('form_key') || '') === itemFormKey
  }

  /** 判斷靜態「自定義表單」項是否活躍（僅在無 form_key 參數時活躍） */
  const isFormStaticActive = (): boolean => {
    if (location.pathname !== '/forms/submissions') return false
    return !new URLSearchParams(location.search).get('form_key')
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
    clearCurrentSite()
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
        <div className="h-14 flex items-center px-6 border-b relative" ref={siteDropdownRef}>
          {/* 站點選擇器：顯示當前站點名稱，點擊展開下拉選單 */}
          <button
            onClick={() => setSiteDropdownOpen(!siteDropdownOpen)}
            className="flex items-center gap-2 font-bold text-lg hover:text-primary transition-colors truncate"
            title={sites.length > 1 ? '切換站點' : currentSiteName}
          >
            <span className="truncate">{currentSiteName}</span>
            {sites.length > 1 && (
              <span className={cn('text-xs transition-transform', siteDropdownOpen && 'rotate-180')}>
                ▼
              </span>
            )}
          </button>
          {/* 站點下拉選單 */}
          {siteDropdownOpen && sites.length > 1 && (
            <div className="absolute top-full left-0 mt-px w-56 bg-white border border-t-0 shadow-lg z-50 max-h-80 overflow-y-auto">
              {sites.map((site) => (
                <button
                  key={site.siteId}
                  onClick={() => handleSiteSwitch(site)}
                  className={cn(
                    'w-full flex items-center gap-2 px-6 py-2.5 text-sm text-left transition-colors',
                    site.siteId === currentSiteId
                      ? 'bg-secondary text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <span>{site.isPrimary ? '⭐' : '🌐'}</span>
                  <span className="truncate">{site.name}</span>
                  {site.siteId === currentSiteId && <span className="ml-auto text-xs">✓</span>}
                </button>
              ))}
            </div>
          )}
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

          {/* 分組導航 — 非超管在個人信息刷新前顯示骨架屏，避免權限閃現 */}
          {!profileLoaded && !userInfo?.isSuper ? (
            <div className="px-6 py-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-4 h-4 bg-slate-200 rounded shrink-0"></div>
                  <div className="flex-1 h-4 bg-slate-200 rounded"></div>
                </div>
              ))}
              <p className="text-xs text-slate-300 pt-2">載入選單中...</p>
            </div>
          ) : (
            <>
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
                      const isFormSubItem = item.to.startsWith('/forms/submissions?')
                      const isFormStatic = item.to === '/forms/submissions'
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          className={({ isActive }) => {
                            // 帶 mcode 的內容項目使用自定義 active 判斷（基於 query 參數）
                            // 表單子項目同樣使用自定義判斷
                            const active = isContentItem
                              ? isContentItemActive(item.mcode!)
                              : isFormSubItem
                                ? isFormItemActive(item.to)
                                : isFormStatic
                                  ? isFormStaticActive()
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
            </>
          )}
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

      {/* 主內容區 — key 綁定權限變化，確保 RequirePermission 在權限更新後重新渲染 */}
      <main className="flex-1 overflow-auto">
        <Outlet key={JSON.stringify(userInfo?.permissions ?? [])} />
      </main>

      {/* ─── 權限拒絕 toast ─── */}
      {permToast && (
        <div className="fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
          <span className="text-lg shrink-0">🚫</span>
          <div>
            <p className="font-semibold text-sm">{permToast}</p>
            <p className="text-xs text-red-500 mt-0.5">当前角色无此功能的访问权限</p>
          </div>
          <button
            onClick={() => setPermToast(null)}
            className="ml-2 text-red-400 hover:text-red-600 text-lg leading-none shrink-0"
            aria-label="關閉"
          >
            ❌
          </button>
        </div>
      )}
    </div>
    </FeatureFlagProvider>
  )
}
