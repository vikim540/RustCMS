/**
 * React Error Boundary — 捕獲子組件渲染錯誤
 *
 * 設計目的：
 * - 捕獲子組件樹渲染期間的同步錯誤（如 undefined 屬性訪問、組件拋出異常）
 * - 捕獲到的錯誤通過 `showGlobalError` 推送到 GlobalErrorToast，非開發者也能看到
 * - 不阻止整個應用渲染：捕獲後顯示局部的 fallback UI，而非白屏崩潰
 *
 * 注意：
 * - React Error Boundary 無法捕獲事件處理器中的錯誤、異步錯誤、setTimeout 回調錯誤
 *   （這些應在各自的 try/catch 中調用 showGlobalError）
 * - 此組件主要保護渲染層，確保單個組件崩潰不會拖垮整個後台
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { showGlobalError } from './GlobalErrorToast'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 自定義 fallback 渲染函數（可選），默認顯示通用錯誤提示 */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  /**
   * 靜態 getDerivedStateFromError：在渲染階段調用，更新 state 以觸發 fallback 渲染。
   * 不在此處進行副作用（如 showGlobalError），副作用放在 componentDidCatch 中。
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  /**
   * componentDidCatch：在提交階段調用，可安全執行副作用。
   * 將錯誤推送到 GlobalErrorToast，讓非開發者用戶也能看到。
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const detail = [
      `錯誤訊息: ${error.message}`,
      `組件堆棧:`,
      errorInfo.componentStack || '(無組件堆棧)',
      `原始堆棧:`,
      error.stack || '(無原始堆棧)',
    ].join('\n')

    showGlobalError(
      '頁面渲染錯誤',
      '頁面某個區塊渲染時發生錯誤，已自動隔離。可嘗試重新整理或聯繫管理員。',
      detail,
    )
  }

  /** 重置錯誤狀態，讓子組件重新渲染（用於「重試」按鈕） */
  reset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // 自定義 fallback
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      // 默認 fallback UI
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center">
          <span className="text-6xl mb-4">💥</span>
          <h2 className="text-xl font-bold text-slate-700 mb-2">頁面渲染出錯</h2>
          <p className="text-sm text-slate-500 mb-1 max-w-md">
            此區塊渲染時發生錯誤，已自動隔離避免影響其他功能。
          </p>
          <p className="text-xs text-slate-400 mb-4">
            錯誤詳情已顯示在左下角通知中，可嘗試重試或重新整理頁面。
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
            >
              🔄 重試
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
            >
              🔄 重新整理頁面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
