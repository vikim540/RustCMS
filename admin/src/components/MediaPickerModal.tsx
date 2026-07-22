import { useEffect, useState, useRef } from 'react'
import { api } from '../lib/api'

/** 媒體庫文件信息 */
interface MediaFile {
  key: string
  size: number
  lastModified: string
  etag: string
  isUsed?: boolean
  isMarked?: boolean
}

/** 媒體庫列表結果 */
interface MediaListResult {
  files: MediaFile[]
  isTruncated: boolean
  nextCursor: string
}

/** 存儲配置（僅 picker 所需字段） */
interface StorageConfig {
  s3_public_url: string
  s3_endpoint: string
  s3_bucket: string
}

/** 圖片擴展名白名單 */
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

/**
 * 媒體庫選擇器 Modal（可複用組件）
 *
 * 三合一功能：① 媒體庫選擇 ② 文件上傳 ③ 外鏈 URL
 *
 * 用法：
 * ```tsx
 * <MediaPickerModal
 *   open={pickerOpen}
 *   onClose={() => setPickerOpen(false)}
 *   onSelect={(url) => setForm(f => ({ ...f, pic: url }))}
 *   onUpload={async (files) => { return await uploadFiles(files) }}
 * />
 * ```
 */
export default function MediaPickerModal({
  open,
  onClose,
  onSelect,
  onUpload,
}: {
  open: boolean
  onClose: () => void
  onSelect: (url: string) => void
  /** 上傳新圖片（含壓縮流程），返回上傳後的 URL 列表 */
  onUpload?: (files: File[]) => Promise<(string | null)[]>
}) {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  // 打開時並行載入媒體文件與存儲配置
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setFiles([])
    setSearch('')
    setUrlInput('')
    setShowUrlInput(false)
    Promise.all([
      api.get<MediaListResult>('/admin/media'),
      api.get<StorageConfig>('/admin/media/config'),
    ])
      .then(([mediaRes, configRes]) => {
        setFiles(mediaRes.data?.files ?? [])
        if (configRes.data) setStorageConfig(configRes.data)
      })
      .catch(() => {
        setFiles([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open])

  if (!open) return null

  /** 構造圖片公共 URL */
  const getImageUrl = (key: string): string => {
    if (!storageConfig) return ''
    if (storageConfig.s3_public_url) {
      return `${storageConfig.s3_public_url.replace(/\/$/, '')}/${key}`
    }
    return `${storageConfig.s3_endpoint.replace(/\/$/, '')}/${storageConfig.s3_bucket}/${key}`
  }

  /** 過濾僅顯示圖片類型文件 */
  const imageFiles = files.filter((f) => {
    const ext = f.key.split('.').pop()?.toLowerCase() || ''
    return IMAGE_EXTS.includes(ext)
  })

  /** 搜索過濾 */
  const filteredFiles = imageFiles.filter((f) => {
    if (search && !f.key.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  /** 刷新媒體列表 */
  const refreshMedia = async () => {
    try {
      const mediaRes = await api.get<MediaListResult>('/admin/media')
      setFiles(mediaRes.data?.files ?? [])
    } catch {
      // 刷新失敗不影響使用
    }
  }

  /** 處理文件上傳 */
  const handleFileUpload = async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0 || !onUpload) return
    setUploading(true)
    try {
      const fileArray = Array.from(selectedFiles)
      const urls = await onUpload(fileArray)
      const validUrls = urls.filter((u): u is string => !!u)
      // 上傳完成後刷新列表
      await refreshMedia()
      // 如果只有一張圖，直接選中插入
      if (validUrls.length === 1) {
        onSelect(validUrls[0])
        onClose()
      }
    } finally {
      setUploading(false)
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  /** 確認外鏈 URL 插入 */
  const handleUrlConfirm = () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    onSelect(trimmed)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頭部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">🖼️ 媒體庫選擇</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
            title="關閉"
          >
            <span className="text-base">❌</span>
          </button>
        </div>

        {/* 操作區：搜索 + 上傳 + 外鏈 */}
        <div className="px-6 py-3 border-b space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 搜索圖片..."
              className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {onUpload && (
              <>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {uploading ? '⏳ 上傳中...' : '⬆️ 上傳圖片'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowUrlInput(!showUrlInput)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-accent transition-colors whitespace-nowrap"
            >
              🔗 外鏈
            </button>
          </div>
          {/* 外鏈 URL 輸入區（可摺疊） */}
          {showUrlInput && (
            <div className="flex gap-2 pt-1">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="輸入圖片外鏈 URL（https://...）"
                className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleUrlConfirm()
                  }
                }}
              />
              <button
                type="button"
                onClick={handleUrlConfirm}
                disabled={!urlInput.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                插入
              </button>
            </div>
          )}
        </div>

        {/* 圖片網格 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <span className="inline-block animate-spin mr-2">🔄</span>
              載入中...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <span className="text-4xl mb-2">🖼️</span>
              <p>暫無圖片</p>
              {onUpload && <p className="text-xs mt-1">點擊上方「上傳圖片」按鈕添加</p>}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredFiles.map((file) => {
                const url = getImageUrl(file.key)
                const fileName = file.key.split('/').pop() || file.key
                return (
                  <button
                    key={file.key}
                    type="button"
                    onClick={() => {
                      if (url) {
                        onSelect(url)
                        onClose()
                      }
                    }}
                    className="bg-white rounded-lg border-2 border-gray-200 overflow-hidden hover:border-primary hover:shadow-md transition-all text-left group"
                    title={fileName}
                  >
                    <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                      {url ? (
                        <img
                          src={url}
                          alt={fileName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <span className="text-3xl">🖼️</span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{fileName}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
