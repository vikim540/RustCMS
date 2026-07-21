/**
 * 統一狀態展示組件
 *
 * 解決問題：各頁面載入中、空狀態、錯誤狀態佈局零散不一致
 * 統一為三個可復用組件：LoadingState / EmptyState / ErrorState
 *
 * 用法：
 *   <LoadingState text="載入中..." />           // 頁面級載入
 *   <LoadingState text="載入中..." inline />    // 表格行內載入（colSpan 用 td 包裹）
 *   <EmptyState icon="📭" text="暫無數據" />
 *   <ErrorState message="載入失敗" onRetry={fetchData} />
 */

interface LoadingStateProps {
  /** 顯示文字，默認「載入中...」 */
  text?: string
  /** 是否行內模式（用於表格 td 內，減少 padding） */
  inline?: boolean
  /** 自定義 emoji，默認 🔄 */
  emoji?: string
}

/** 載入中狀態：旋轉 emoji + 文字 */
export function LoadingState({ text = '載入中...', inline = false, emoji = '🔄' }: LoadingStateProps) {
  return (
    <div
      className={`flex items-center justify-center ${inline ? 'py-8' : 'py-20'} text-muted-foreground`}
    >
      <span className="inline-block animate-spin mr-2">{emoji}</span>
      {text}
    </div>
  )
}

interface EmptyStateProps {
  /** 顯示文字 */
  text: string
  /** 自定義 emoji 圖標 */
  icon?: string
  /** 輔助說明文字 */
  hint?: string
  /** 是否行內模式（用於表格 td 內） */
  inline?: boolean
}

/** 空狀態：圖標 + 主文字 + 輔助說明 */
export function EmptyState({ text, icon = '📭', hint, inline = false }: EmptyStateProps) {
  if (inline) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground">
        <span className="text-2xl mr-1">{icon}</span>
        <p className="mt-1">{text}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <span className="text-4xl mb-2">{icon}</span>
      <p>{text}</p>
      {hint && <p className="text-sm mt-1 text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

interface ErrorStateProps {
  /** 錯誤信息 */
  message: string
  /** 重試回調（可選），提供則顯示「重試」按鈕 */
  onRetry?: () => void
  /** 是否行內模式（用於表格 td 內） */
  inline?: boolean
}

/** 錯誤狀態：⚠️ 圖標 + 錯誤信息 + 可選重試按鈕 */
export function ErrorState({ message, onRetry, inline = false }: ErrorStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${inline ? 'py-8' : 'py-20'} text-muted-foreground`}
    >
      <span className="text-4xl mb-2">⚠️</span>
      <p className="text-destructive">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-4 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
        >
          🔄 重試
        </button>
      )}
    </div>
  )
}
