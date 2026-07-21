/**
 * 標籤式多值輸入組件
 * 支持回車/逗號添加標籤、退格刪除、批量導入、協議剝離
 */
import { useState, useRef } from 'react'
import { cn } from '../lib/utils'

interface TagInputProps {
  values: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  /** 是否剝離 http:// https:// 前綴（用於 CORS 域名） */
  stripProtocol?: boolean
  disabled?: boolean
}

export function TagInput({ values, onChange, placeholder, stripProtocol, disabled }: TagInputProps) {
  const [input, setInput] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const processValue = (val: string): string => {
    let v = val.trim()
    if (stripProtocol) {
      v = v.replace(/^https?:\/\//, '')
    }
    return v
  }

  const addTag = (rawVal: string) => {
    const v = processValue(rawVal)
    if (v && !values.includes(v)) {
      onChange([...values, v])
    }
  }

  const removeTag = (index: number) => {
    onChange(values.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (input.trim()) {
        addTag(input)
        setInput('')
      }
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      removeTag(values.length - 1)
    }
  }

  const handleBulkAdd = () => {
    const lines = bulkText
      .split(/[,，\n]/)
      .map(processValue)
      .filter(Boolean)
    const newTags = [...new Set([...values, ...lines])]
    onChange(newTags)
    setBulkText('')
    setShowBulk(false)
  }

  return (
    <div className="w-full">
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 p-2 border rounded-md min-h-[38px] bg-white',
          disabled && 'opacity-50 pointer-events-none bg-muted',
        )}
      >
        {values.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full whitespace-nowrap"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="hover:text-destructive transition-colors leading-none"
            >
              ❌
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (input.trim()) {
              addTag(input)
              setInput('')
            }
          }}
          placeholder={values.length === 0 ? placeholder || '輸入後按 Enter 添加' : ''}
          className="flex-1 min-w-[120px] text-sm outline-none bg-transparent"
          disabled={disabled}
        />
      </div>
      {/* 批量導入 */}
      <button
        type="button"
        onClick={() => setShowBulk(!showBulk)}
        className="mt-1 text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        {showBulk ? '收起批量導入' : '📋 批量導入'}
      </button>
      {showBulk && (
        <div className="mt-1.5">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="每行一個或用逗號分隔，批量添加..."
            className="w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            rows={4}
          />
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => {
                setBulkText('')
                setShowBulk(false)
              }}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleBulkAdd}
              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              添加全部
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
