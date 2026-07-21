/**
 * 圖片壓縮對話框組件
 *
 * 用戶上傳圖片時彈出，提供：
 *   - 質量滑塊實時控制壓縮質量（0.1 - 1.0）
 *   - 最大寬度/高度尺寸控制
 *   - WebP / 保留原格式 切換
 *   - 原圖 vs 壓縮後預覽對比
 *   - 文件大小對比 + 節省比例
 *
 * 前端壓縮完成後才允許上傳到 S3，避免上傳原圖浪費帶寬。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { compressImage, formatFileSize, type CompressFormat, type CompressResult } from '../lib/imageCompress'
import { cn } from '../lib/utils'

interface ImageCompressDialogProps {
  /** 待壓縮的圖片文件列表 */
  files: File[]
  /** 用戶確認壓縮設置後回調，傳入壓縮後的 File 數組 */
  onConfirm: (compressedFiles: File[]) => void
  /** 用戶取消回調 */
  onCancel: () => void
}

/** 單個文件的壓縮預覽狀態 */
interface FilePreview {
  /** 原始文件 */
  original: File
  /** 原始預覽 URL */
  originalUrl: string
  /** 壓縮結果（null 表示正在壓縮中） */
  result: CompressResult | null
  /** 壓縮中標記 */
  compressing: boolean
  /** 壓縮進度 0-100 */
  compressProgress: number
}

/** 質量等級預設 */
const QUALITY_PRESETS = [
  { value: 0.5, label: '高壓縮', desc: '最小體積' },
  { value: 0.7, label: '均衡', desc: '推薦' },
  { value: 0.82, label: '高質量', desc: '視覺無損' },
  { value: 0.95, label: '極高質量', desc: '接近原圖' },
]

export default function ImageCompressDialog({ files, onConfirm, onCancel }: ImageCompressDialogProps) {
  const [quality, setQuality] = useState(0.82)
  const [maxDimension, setMaxDimension] = useState(1920)
  const [format, setFormat] = useState<CompressFormat>('webp')
  const [previews, setPreviews] = useState<FilePreview[]>([])
  const [compressing, setCompressing] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewUrlsRef = useRef<string[]>([])
  /** previews 的同步鏡像，避免 runCompress 閉包中 previews 陳舊 */
  const previewsRef = useRef<FilePreview[]>([])

  /** hover 放大預覽狀態 */
  const [hoverPreview, setHoverPreview] = useState<{
    originalUrl: string
    compressedUrl: string
    originalSize: number
    compressedSize: number
  } | null>(null)

  /** 初始化原始預覽 */
  useEffect(() => {
    const initialPreviews: FilePreview[] = files.map((file) => {
      const url = URL.createObjectURL(file)
      previewUrlsRef.current.push(url)
      return { original: file, originalUrl: url, result: null, compressing: true, compressProgress: 0 }
    })
    previewsRef.current = initialPreviews
    setPreviews(initialPreviews)
  }, [files])

  /** 執行壓縮（防抖調用） */
  const runCompress = useCallback(async () => {
    setCompressing(true)
    // 標記所有為壓縮中
    setPreviews((prev) => {
      const next = prev.map((p) => ({ ...p, compressing: true, compressProgress: 0 }))
      previewsRef.current = next
      return next
    })

    const results: FilePreview[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        const result = await compressImage(files[i], {
          quality, maxDimension, format,
          onProgress: (p) => {
            setPreviews((prev) => {
              const next = [...prev]
              if (next[i]) next[i] = { ...next[i], compressProgress: p }
              previewsRef.current = next
              return next
            })
          },
        })
        // 釋放舊的預覽 URL（用 ref 避免閉包陳舊）
        const oldResultUrl = previewsRef.current[i]?.result?.previewUrl
        if (oldResultUrl) {
          URL.revokeObjectURL(oldResultUrl)
        }
        const newPreview: FilePreview = {
          original: files[i],
          originalUrl: previewsRef.current[i]?.originalUrl || previewUrlsRef.current[i] || '',
          result,
          compressing: false,
          compressProgress: 100,
        }
        results.push(newPreview)
        // 逐張更新，讓用戶看到進度
        setPreviews((prev) => {
          const next = [...prev]
          next[i] = newPreview
          previewsRef.current = next
          return next
        })
      } catch {
        const errorPreview: FilePreview = {
          original: files[i],
          originalUrl: previewsRef.current[i]?.originalUrl || previewUrlsRef.current[i] || '',
          result: null,
          compressing: false,
          compressProgress: 0,
        }
        results.push(errorPreview)
        setPreviews((prev) => {
          const next = [...prev]
          next[i] = errorPreview
          previewsRef.current = next
          return next
        })
      }
    }
    setCompressing(false)
  }, [files, quality, maxDimension, format])

  /** 設置變化或文件到達時防抖重新壓縮 */
  useEffect(() => {
    if (files.length === 0) return
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      runCompress()
    }, 350)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, quality, maxDimension, format])

  /** 組件卸載時釋放所有 ObjectURL */
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  /** 計算總計統計 */
  const stats = previews.reduce(
    (acc, p) => {
      acc.originalTotal += p.original.size
      if (p.result) {
        acc.compressedTotal += p.result.size
      }
      return acc
    },
    { originalTotal: 0, compressedTotal: 0 },
  )
  const totalSavings = stats.originalTotal > 0 ? 1 - stats.compressedTotal / stats.originalTotal : 0
  const allCompressed = previews.length > 0 && previews.every((p) => p.result && !p.compressing)

  /** 確認上傳 */
  const handleConfirm = () => {
    const compressedFiles = previews.map((p) => p.result?.file || p.original)
    onConfirm(compressedFiles)
  }

  /** 質量百分比顯示 */
  const qualityPercent = Math.round(quality * 100)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* 頭部 */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📷</span>
            <div>
              <h2 className="text-lg font-bold">圖片壓縮設置</h2>
              <p className="text-xs text-slate-300">
                共 {files.length} 張圖片 · 前端壓縮後上傳，節省帶寬
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white transition-colors text-2xl leading-none"
            aria-label="關閉"
          >
            ❌
          </button>
        </div>

        {/* 設置區 */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 space-y-4">
          {/* 質量滑塊 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-700">
                🎚️ 壓縮質量
              </label>
              <span className="text-sm font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                {qualityPercent}%
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.01}
              value={quality}
              onChange={(e) => setQuality(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between mt-1.5 gap-1">
              {QUALITY_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setQuality(preset.value)}
                  className={cn(
                    'flex-1 text-xs py-1 px-1 rounded transition-all border',
                    Math.abs(quality - preset.value) < 0.005
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300',
                  )}
                  title={preset.desc}
                >
                  <div className="font-semibold">{preset.label}</div>
                  <div className="text-[10px] opacity-70">{preset.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 最大邊長 + 格式 */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                最大邊長 (px)
              </label>
              <input
                type="number"
                min={100}
                max={8000}
                value={maxDimension}
                onChange={(e) => setMaxDimension(Math.max(100, parseInt(e.target.value) || 1920))}
                className="w-28 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <p className="text-[10px] text-slate-400 mt-1">按原始比例等比縮放</p>
            </div>
            {/* 尺寸預設 */}
            <div className="flex gap-1">
              {[
                { val: 1920, label: 'PC 1920' },
                { val: 1080, label: 'Mobile 1080' },
                { val: 800, label: '縮略 800' },
                { val: 400, label: '小圖 400' },
              ].map((preset) => (
                <button
                  key={preset.val}
                  onClick={() => setMaxDimension(preset.val)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs rounded-lg border transition-all',
                    maxDimension === preset.val
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                輸出格式
              </label>
              <div className="flex gap-1">
                <button
                  onClick={() => setFormat('webp')}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-lg border transition-all',
                    format === 'webp'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300',
                  )}
                >
                  WebP（推薦）
                </button>
                <button
                  onClick={() => setFormat('original')}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-lg border transition-all',
                    format === 'original'
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                  )}
                >
                  保留原格式
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 文件預覽列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {previews.map((preview, index) => {
            const result = preview.result
            const savings = result?.savings ?? 0
            const savingsPercent = Math.round(savings * 100)

            return (
              <div key={index} className="space-y-2">
                {/* 文件信息行 */}
                <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  {/* 壓縮後預覽 */}
                  <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-200 border border-slate-200">
                    {result?.previewUrl ? (
                      <img
                        src={result.previewUrl}
                        alt={preview.original.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <span className="animate-pulse text-lg">⏳</span>
                      </div>
                    )}
                    {preview.compressing && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                        <span className="text-white text-xs animate-pulse">壓縮中</span>
                        <div className="w-12 h-1 bg-white/30 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-400 transition-all duration-200"
                            style={{ width: `${preview.compressProgress}%` }}
                          />
                        </div>
                        <span className="text-white text-[10px] font-mono">{preview.compressProgress}%</span>
                      </div>
                    )}
                  </div>

                  {/* 文件信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-slate-800 truncate">
                        {preview.original.name}
                      </span>
                      {result && result.width > 0 && (
                        <span className="text-[10px] text-slate-400 flex-shrink-0">
                          {result.width}×{result.height}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">
                        原始: <span className="font-mono">{formatFileSize(preview.original.size)}</span>
                      </span>
                      <span className="text-slate-300">→</span>
                      {result ? (
                        <span className={cn('font-mono font-semibold', savings > 0 ? 'text-emerald-600' : 'text-slate-500')}>
                          {formatFileSize(result.size)}
                        </span>
                      ) : (
                        <span className="text-slate-300">計算中...</span>
                      )}
                      {result && savings > 0 && (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-semibold">
                          -{savingsPercent}%
                        </span>
                      )}
                      {result && savings <= 0 && (
                        <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded text-[10px]">
                          已是最佳
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 格式標籤 */}
                  {result && (
                    <span className="text-[10px] px-2 py-1 rounded bg-slate-100 text-slate-500 flex-shrink-0">
                      {result.type === 'image/webp' ? 'WebP' : result.type.split('/')[1]?.toUpperCase() || '?'}
                    </span>
                  )}
                </div>

                {/* ─── 前後圖片對比區域 ─── */}
                {result && !preview.compressing && (
                  <div
                    className="flex items-stretch gap-3 pb-2 cursor-zoom-in"
                    onMouseEnter={() => setHoverPreview({
                      originalUrl: preview.originalUrl,
                      compressedUrl: result.previewUrl,
                      originalSize: preview.original.size,
                      compressedSize: result.size,
                    })}
                    onMouseLeave={() => setHoverPreview(null)}
                  >
                    {/* 原始圖片 */}
                    <div className="flex-1 rounded-lg overflow-hidden border-2 border-slate-200 bg-slate-50 transition-shadow hover:shadow-md">
                      <div className="px-2 py-1 bg-slate-100 text-[10px] font-semibold text-slate-500 flex items-center justify-between">
                        <span>📷 原始圖片</span>
                        <span className="font-mono">{formatFileSize(preview.original.size)}</span>
                      </div>
                      <div className="flex items-center justify-center h-32 bg-checkered">
                        <img
                          src={preview.originalUrl}
                          alt="原始"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    </div>

                    {/* 箭頭 */}
                    <div className="flex items-center justify-center text-slate-300 text-xl">
                      →
                    </div>

                    {/* 壓縮後圖片 */}
                    <div className="flex-1 rounded-lg overflow-hidden border-2 border-emerald-300 bg-slate-50 transition-shadow hover:shadow-md">
                      <div className="px-2 py-1 bg-emerald-50 text-[10px] font-semibold text-emerald-600 flex items-center justify-between">
                        <span>✨ 壓縮後</span>
                        <span className="font-mono">{formatFileSize(result.size)}</span>
                      </div>
                      <div className="flex items-center justify-center h-32 bg-checkered">
                        <img
                          src={result.previewUrl}
                          alt="壓縮後"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 底部統計 + 操作 */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white">
          <div className="flex items-center justify-between">
            {/* 總計統計 */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">原始總計:</span>
                <span className="font-mono font-semibold text-slate-700">
                  {formatFileSize(stats.originalTotal)}
                </span>
              </div>
              <span className="text-slate-300">→</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">壓縮後:</span>
                <span className="font-mono font-semibold text-emerald-600">
                  {formatFileSize(stats.compressedTotal)}
                </span>
              </div>
              {totalSavings > 0 && (
                <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded text-xs font-bold">
                  總計節省 {Math.round(totalSavings * 100)}%
                </span>
              )}
            </div>

            {/* 操作按鈕 */}
            <div className="flex items-center gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={compressing || !allCompressed}
                className={cn(
                  'px-6 py-2 text-sm font-semibold rounded-lg transition-all',
                  compressing || !allCompressed
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg hover:scale-105 active:scale-95',
                )}
              >
                {compressing ? '⏳ 壓縮中...' : `📤 上傳 ${files.length} 張圖片`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── hover 放大預覽浮層 ─── */}
      {hoverPreview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-none"
          style={{ maxWidth: '100vw', maxHeight: '100vh' }}
        >
          <div className="flex items-stretch gap-3 p-4" style={{ maxWidth: '100vw', maxHeight: '100vh' }}>
            {/* 原始圖片放大 */}
            <div className="flex flex-col rounded-xl overflow-hidden border-2 border-slate-400 bg-slate-900 shadow-2xl" style={{ maxWidth: '48vw' }}>
              <div className="px-3 py-1.5 bg-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                <span>📷 原始圖片</span>
                <span className="font-mono">{formatFileSize(hoverPreview.originalSize)}</span>
              </div>
              <div className="flex items-center justify-center bg-checkered overflow-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
                <img
                  src={hoverPreview.originalUrl}
                  alt="原始放大"
                  className="object-contain"
                  style={{ maxWidth: '48vw', maxHeight: 'calc(100vh - 60px)' }}
                />
              </div>
            </div>

            {/* 箭頭 */}
            <div className="flex items-center justify-center text-white/50 text-3xl shrink-0">
              →
            </div>

            {/* 壓縮後圖片放大 */}
            <div className="flex flex-col rounded-xl overflow-hidden border-2 border-emerald-400 bg-slate-900 shadow-2xl" style={{ maxWidth: '48vw' }}>
              <div className="px-3 py-1.5 bg-emerald-900/50 text-xs font-semibold text-emerald-300 flex items-center justify-between shrink-0">
                <span>✨ 壓縮後</span>
                <span className="font-mono">{formatFileSize(hoverPreview.compressedSize)}</span>
              </div>
              <div className="flex items-center justify-center bg-checkered overflow-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
                <img
                  src={hoverPreview.compressedUrl}
                  alt="壓縮後放大"
                  className="object-contain"
                  style={{ maxWidth: '48vw', maxHeight: 'calc(100vh - 60px)' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
