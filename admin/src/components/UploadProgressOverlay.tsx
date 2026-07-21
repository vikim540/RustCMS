/**
 * 上傳進度覆蓋層組件
 *
 * 屏幕居中顯示上傳進度（壓縮中/上傳中），含：
 *   - 階段指示（🗜️ 壓縮中 / 📤 上傳中）
 *   - 文件名 + 第 N/總數 個
 *   - 進度條 + 百分比
 *   - 錯誤提示（含失敗文件名和原因，可關閉）
 *
 * 設計原則：
 *   - 純展示組件，不包含上傳邏輯
 *   - 接收 useImageUpload hook 的 progress 和 error 狀態
 *   - 所有頁面統一使用，確保一致的用戶體驗
 */
import type { UploadProgress } from '../hooks/useImageUpload'

interface UploadProgressOverlayProps {
  /** 上傳中狀態 */
  uploading: boolean
  /** 進度信息（來自 useImageUpload hook） */
  progress: UploadProgress | null
  /** 錯誤信息（來自 useImageUpload hook） */
  error: string | null
  /** 清除錯誤回調 */
  onClearError: () => void
}

export default function UploadProgressOverlay({
  uploading,
  progress,
  error,
  onClearError,
}: UploadProgressOverlayProps) {
  // 無進度且無錯誤時不渲染
  if (!uploading && !error) return null

  const percent = progress
    ? progress.phase === 'compressing'
      ? (progress.compressProgress ?? 0)
      : (progress.uploadProgress ?? 0)
    : 0

  const phaseIcon = progress?.phase === 'compressing' ? '🗜️' : '📤'
  const phaseLabel = progress?.phase === 'compressing' ? '圖片壓縮中' : '上傳中'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
      {/* 半透明背景遮罩（僅上傳中時顯示） */}
      {uploading && (
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      )}

      {/* 居中卡片 */}
      <div className="relative z-10 pointer-events-auto">
        {/* 錯誤提示卡片 */}
        {error && (
          <div className="mb-3 px-5 py-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl shadow-2xl max-w-md">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">❌</span>
              <span className="font-bold text-sm">上傳失敗</span>
              <button
                onClick={onClearError}
                className="ml-auto text-red-400 hover:text-red-600 text-xs transition-colors"
              >
                ❌ 關閉
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-red-100/50 rounded-lg p-2 max-h-32 overflow-y-auto">
              {error}
            </pre>
          </div>
        )}

        {/* 進度卡片 */}
        {uploading && progress && (
          <div className="px-6 py-5 bg-white rounded-2xl shadow-2xl border border-slate-200 min-w-[360px] max-w-md">
            {/* 階段標題 */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl animate-pulse">{phaseIcon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-sm">{phaseLabel}</span>
                  <span className="text-xs text-slate-400">
                    第 {progress.current} / {progress.total} 個
                  </span>
                </div>
                <div className="text-xs text-slate-400 truncate mt-0.5" title={progress.fileName}>
                  {progress.fileName}
                </div>
              </div>
              <span className="text-2xl font-mono font-bold text-indigo-600">
                {Math.round(percent)}%
              </span>
            </div>

            {/* 進度條 */}
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* 底部提示 */}
            <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400">
              <span>
                {progress.phase === 'compressing'
                  ? '正在壓縮圖片，請稍候...'
                  : '正在上傳到雲端存儲...'}
              </span>
              <span className="animate-pulse">● ● ●</span>
            </div>
          </div>
        )}

        {/* 上傳中但無進度信息（初始化階段） */}
        {uploading && !progress && (
          <div className="px-6 py-5 bg-white rounded-2xl shadow-2xl border border-slate-200 min-w-[360px]">
            <div className="flex items-center gap-3">
              <span className="text-2xl animate-spin">🔄</span>
              <span className="font-bold text-slate-800 text-sm">準備上傳...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
