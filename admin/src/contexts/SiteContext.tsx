/**
 * 站點上下文 — 集中管理當前站點狀態
 *
 * 設計目的：
 * - 將站點選擇邏輯從 Layout.tsx 抽離，集中管理，便於未來遷移
 * - 切換站點時顯示過渡覆蓋層（避免白屏閃爍），再刷新頁面重新獲取數據
 *
 * 注意：
 * - 當前 24+ 頁面各自獨立從 localStorage（getCurrentSiteId）讀取站點 ID 並獲取數據，
 *   統一改為 Context 消費需要大規模遷移，故暫保留 reload 方案 + 過渡動畫。
 * - 未來可逐步將頁面遷移為消費 Context 的 currentSiteId，並用 useEffect 依賴觸發重新獲取，
 *   最終移除 reload。
 *
 * 用法：
 *   <SiteProvider> <Layout /> </SiteProvider>
 *   const { currentSiteId, currentSiteName, sites, setSites, updateCurrentSite, switchSite } = useSite()
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import {
  getCurrentSiteId,
  getCurrentSiteName,
  setCurrentSite,
  getCachedSites,
  type SiteInfo,
} from '../lib/api'

interface SiteContextValue {
  /** 當前站點 ID */
  currentSiteId: string
  /** 當前站點名稱（顯示用） */
  currentSiteName: string
  /** 用戶可訪問的站點列表（從緩存初始化，載入後更新） */
  sites: SiteInfo[]
  /** 設置站點列表（Layout 載入 /admin/sites 後調用） */
  setSites: (sites: SiteInfo[]) => void
  /** 更新當前站點（不刷新頁面，用於初始載入時修正默認站點） */
  updateCurrentSite: (siteId: string, siteName: string) => void
  /** 切換站點：更新狀態 + localStorage，顯示過渡動畫後刷新頁面 */
  switchSite: (site: SiteInfo) => void
  /** 是否正在切換中（用於過渡覆蓋層顯示） */
  isSwitching: boolean
}

const SiteContext = createContext<SiteContextValue | null>(null)

export function SiteProvider({ children }: { children: ReactNode }) {
  const [currentSiteId, setCurrentSiteIdState] = useState<string>(() => getCurrentSiteId())
  const [currentSiteName, setCurrentSiteNameState] = useState<string>(() => getCurrentSiteName())
  // 從緩存初始化，避免下拉列表初始空白
  const [sites, setSitesState] = useState<SiteInfo[]>(() => getCachedSites())
  const [isSwitching, setIsSwitching] = useState(false)

  /** 設置站點列表 */
  const setSites = useCallback((list: SiteInfo[]) => {
    setSitesState(list)
  }, [])

  /** 更新當前站點（不刷新頁面，用於初始載入修正默認站點） */
  const updateCurrentSite = useCallback((siteId: string, siteName: string) => {
    setCurrentSite(siteId, siteName)
    setCurrentSiteIdState(siteId)
    setCurrentSiteNameState(siteName)
  }, [])

  /**
   * 切換站點（用戶主動操作）：
   * 1. 更新 localStorage（api.ts 的 getCurrentSiteId 讀取此值）
   * 2. 更新 Context state（即時反映到 UI）
   * 3. 顯示過渡覆蓋層
   * 4. 短暫延遲後刷新頁面（讓所有頁面重新獲取新站點數據）
   *
   * 保留 reload 是因為 24+ 頁面各自獨立獲取數據，無法通過 Context 統一觸發。
   * 過渡動畫讓 reload 看起來是「有意為之」而非突兀的閃爍。
   */
  const switchSite = useCallback(
    (site: SiteInfo) => {
      if (site.siteId === getCurrentSiteId()) return
      // 更新持久化存儲 + Context state
      updateCurrentSite(site.siteId, site.name)
      // 顯示過渡覆蓋層
      setIsSwitching(true)
      // 400ms 後刷新，讓過渡動畫可見
      window.setTimeout(() => {
        window.location.reload()
      }, 400)
    },
    [updateCurrentSite],
  )

  return (
    <SiteContext.Provider
      value={{
        currentSiteId,
        currentSiteName,
        sites,
        setSites,
        updateCurrentSite,
        switchSite,
        isSwitching,
      }}
    >
      {children}
      {/* 站點切換過渡覆蓋層 — 全屏半透明，居中 spinner */}
      {isSwitching && (
        <div className="fixed inset-0 z-[300] bg-white/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3">
            <span className="text-4xl animate-spin">🔄</span>
            <p className="text-sm text-slate-600 font-medium">正在切換站點...</p>
            <p className="text-xs text-slate-400">{currentSiteName}</p>
          </div>
        </div>
      )}
    </SiteContext.Provider>
  )
}

/** 消費站點上下文的 Hook */
export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext)
  if (!ctx) {
    throw new Error('useSite 必須在 SiteProvider 內使用')
  }
  return ctx
}
