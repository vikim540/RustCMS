/**
 * 功能開關 Hook — 標準化組件化控制
 *
 * 用法：
 *   const { flags, isEnabled, toggle, refresh } = useFeatureFlags()
 *   if (isEnabled('mail_enabled')) { ... }
 *
 *   <FeatureGate flagKey="mail_enabled">
 *     <MailSettings />
 *   </FeatureGate>
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { api, getToken } from '../lib/api'

/** 功能開關狀態（與後端 flags.ts FLAG_REGISTRY 對應） */
export interface FlagState {
  key: string
  label: string
  description: string
  icon: string
  enabled: boolean
  managedBy: 'flagship' | 'database'
}

interface FlagContextValue {
  flags: FlagState[]
  isEnabled: (key: string) => boolean
  toggle: (key: string, enabled: boolean) => Promise<void>
  refreshing: boolean
  refresh: () => Promise<void>
}

const FlagContext = createContext<FlagContextValue | null>(null)

/** Provider 組件 — 包裹在 App 根部 */
export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FlagState[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    // 未登錄時不獲取功能開關（避免 /login 頁面 401 無限刷新）
    if (!getToken()) return
    setRefreshing(true)
    try {
      const res = await api.get<FlagState[]>('/admin/flags')
      setFlags(Array.isArray(res.data) ? res.data : [])
    } catch {
      // 靜默失敗
    } finally {
      setRefreshing(false)
    }
  }, [])

  const toggle = useCallback(async (key: string, enabled: boolean) => {
    await api.put('/admin/flags', { key, enabled })
    // 更新本地狀態（即時反映）
    setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled } : f)))
  }, [])

  const isEnabled = useCallback(
    (key: string) => flags.find((f) => f.key === key)?.enabled ?? true,
    [flags],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <FlagContext.Provider value={{ flags, isEnabled, toggle, refreshing, refresh }}>
      {children}
    </FlagContext.Provider>
  )
}

/** 主 Hook — 獲取功能開關上下文 */
export function useFeatureFlags(): FlagContextValue {
  const ctx = useContext(FlagContext)
  if (!ctx) {
    // 未被 Provider 包裹時返回默認值（全開啟）
    return {
      flags: [],
      isEnabled: () => true,
      toggle: async () => {},
      refreshing: false,
      refresh: async () => {},
    }
  }
  return ctx
}

/** 單個開關 Hook — 簡化用法 */
export function useFeatureFlag(key: string): boolean {
  const { isEnabled } = useFeatureFlags()
  return isEnabled(key)
}
