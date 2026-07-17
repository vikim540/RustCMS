/**
 * FeatureGate — 功能開關門控組件
 *
 * 關閉時不渲染子組件，所有位置統一使用此組件控制功能可見性
 *
 * 用法：
 *   <FeatureGate flagKey="notify_mail_enabled">
 *     <MailSettingsSection />
 *   </FeatureGate>
 *
 *   // 帶 fallback
 *   <FeatureGate flagKey="semantic_search_enabled" fallback={<DisabledNotice />}>
 *     <SearchBox />
 *   </FeatureGate>
 */
import type { ReactNode } from 'react'
import { useFeatureFlag } from '../hooks/useFeatureFlags'

interface FeatureGateProps {
  /** 功能開關 key（對應後端 FLAG_REGISTRY） */
  flagKey: string
  /** 子組件（開啟時渲染） */
  children: ReactNode
  /** 關閉時的替代內容（可選，默認不渲染任何內容） */
  fallback?: ReactNode
}

export function FeatureGate({ flagKey, children, fallback = null }: FeatureGateProps) {
  const enabled = useFeatureFlag(flagKey)
  if (!enabled) return <>{fallback}</>
  return <>{children}</>
}
