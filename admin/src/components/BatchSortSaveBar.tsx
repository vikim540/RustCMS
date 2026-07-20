/**
 * 批量排序保存欄組件
 *
 * 統一用於欄目管理、擴展字段、幻燈片等列表頁底部，
 * 當有 dirty 排序修改時顯示「保存排序」按鈕。
 *
 * 配合 useBatchSorting hook 使用。
 */
import { cn } from '../lib/utils'

interface BatchSortSaveBarProps {
  /** dirty 項目數量 */
  dirtyCount: number
  /** 是否正在保存中 */
  isSaving: boolean
  /** 保存回調 */
  onSave: () => void
  /** 清除 dirty 回調（可選） */
  onClear?: () => void
  /** 額外 class（可選） */
  className?: string
}

export function BatchSortSaveBar({
  dirtyCount,
  isSaving,
  onSave,
  onClear,
  className,
}: BatchSortSaveBarProps) {
  if (dirtyCount === 0) return null

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-md',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <span className="text-base">📝</span>
        <span>
          有 <strong className="font-semibold">{dirtyCount}</strong> 項排序修改待保存
        </span>
      </div>
      <div className="flex items-center gap-2">
        {onClear && (
          <button
            onClick={onClear}
            disabled={isSaving}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            放棄修改
          </button>
        )}
        <button
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <span className="animate-spin inline-block">⏳</span>
              保存中...
            </>
          ) : (
            <>
              <span>💾</span>
              保存排序（{dirtyCount} 項）
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * 排序輸入框 — 帶 dirty 樣式
 *
 * 當值被修改但尚未保存時，顯示 amber 邊框 + 背景提示。
 */
interface SortInputProps {
  value: number
  dirtyValue?: number
  isDirty: boolean
  onChange: (newSorting: number) => void
  disabled?: boolean
}

export function SortInput({ value, dirtyValue, isDirty, onChange, disabled }: SortInputProps) {
  const displayValue = isDirty ? (dirtyValue ?? value) : value

  return (
    <input
      type="number"
      min={1}
      value={displayValue}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10)
        if (!isNaN(v) && v >= 0) onChange(v)
      }}
      disabled={disabled}
      className={cn(
        'w-16 px-2 py-1 text-sm text-center border rounded-md transition-colors',
        isDirty
          ? 'border-amber-400 bg-amber-50 text-amber-900 font-medium'
          : 'border-gray-200 bg-white text-foreground hover:border-gray-300',
        'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed',
      )}
    />
  )
}
