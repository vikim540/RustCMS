import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import ImageCompressDialog from '../components/ImageCompressDialog'
import UploadProgressOverlay from '../components/UploadProgressOverlay'
import { useImageUpload } from '../hooks/useImageUpload'

/** S3 文件信息（含使用狀態與標記狀態） */
interface MediaFile {
  key: string
  size: number
  lastModified: string
  etag: string
  isUsed?: boolean
  isMarked?: boolean
}

/** 文件使用位置信息 */
interface UsageInfo {
  table: string
  id: number
  name: string
  field: string
}

/** 文件詳情 */
interface MediaDetail {
  name: string
  key: string
  size: number
  size_str?: string
  lastModified: string
  category: string
  ext: string
  mime?: string
  width?: number
  height?: number
  dimension?: string
  usages: UsageInfo[]
  usage_count: number
  isMarked: boolean
  isUsed?: boolean
}

/** 列表結果 */
interface ListResult {
  files: MediaFile[]
  isTruncated: boolean
  nextCursor: string
}

/** 過濾類型 */
type FilterType = 'all' | 'image' | 'document' | 'video' | 'unused' | 'marked'

/** 文件類型判斷 */
function getFileCategory(key: string): 'image' | 'document' | 'video' | 'other' {
  const ext = key.split('.').pop()?.toLowerCase() || ''
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'svg', 'ico'].includes(ext)) return 'image'
  if (['doc', 'docx', 'xls', 'xlsx', 'pdf', 'txt', 'csv'].includes(ext)) return 'document'
  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) return 'video'
  return 'other'
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 格式化日期 */
function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 生成文件的公共 URL */
function getFileUrl(key: string, publicUrl: string, endpoint: string, bucket: string): string {
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`
  }
  return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
}

/** 文件圖標 */
function FileIcon({ category }: { category: string }) {
  switch (category) {
    case 'image':
      return <span className="text-2xl text-blue-400">🖼️</span>
    case 'document':
      return <span className="text-2xl text-green-400">📄</span>
    case 'video':
      return <span className="text-2xl text-purple-400">🎥</span>
    default:
      return <span className="text-2xl text-gray-400">📄</span>
  }
}

/** 圖片預覽組件 — 載入後自動取得原始尺寸並顯示 */
function ImageWithDimensions({ src, alt, className, loading, onDimensions }: {
  src: string
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  onDimensions?: (w: number, h: number) => void
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  return (
    <div className="relative">
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        onLoad={(e) => {
          const img = e.target as HTMLImageElement
          const d = { w: img.naturalWidth, h: img.naturalHeight }
          setDims(d)
          onDimensions?.(d.w, d.h)
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      {dims && (
        <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-mono leading-tight">
          {dims.w}×{dims.h}
        </span>
      )}
    </div>
  )
}

/** 過濾標籤配置 */
const FILTER_TABS: { key: FilterType; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: '🔽' },
  { key: 'image', label: '圖片', icon: '🖼️' },
  { key: 'document', label: '文檔', icon: '📄' },
  { key: 'video', label: '視頻', icon: '🎥' },
  { key: 'unused', label: '未使用', icon: '⚠️' },
  { key: 'marked', label: '已標記', icon: '📑' },
]

export default function MediaLibrary() {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [copiedKey, setCopiedKey] = useState('')
  const [error, setError] = useState('')
  const [storageConfig, setStorageConfig] = useState<{ s3_endpoint: string; s3_bucket: string; s3_public_url: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── 新增狀態 ──────────────────────────────────────────
  const [filter, setFilter] = useState<FilterType>('all')
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [markingKey, setMarkingKey] = useState<string | null>(null)

  // ─── 圖片壓縮對話框狀態 ────────────────────────────────
  /** 待壓縮的圖片文件（非 null 時顯示壓縮對話框） */
  const [pendingImages, setPendingImages] = useState<File[] | null>(null)

  // ─── 詳情面板圖片尺寸 ────────────────────────────────
  const [detailImgDims, setDetailImgDims] = useState<{ w: number; h: number } | null>(null)

  // ─── 上傳 hook（統一壓縮+上傳+進度+錯誤處理） ──────────
  // autoCompress=false：圖片已通過 ImageCompressDialog 壓縮，非圖片無需壓縮
  const { uploading, progress, error: uploadError, uploadFiles, clearError } = useImageUpload({
    autoCompress: false,
  })

  /** 獲取存儲配置（用於生成文件 URL） */
  const fetchStorageConfig = useCallback(async () => {
    try {
      const res = await api.get<{ s3_endpoint: string; s3_bucket: string; s3_public_url: string }>('/admin/storage/config')
      if (res.data) setStorageConfig(res.data)
    } catch { /* 忽略 */ }
  }, [])

  /** 載入文件列表 */
  const fetchFiles = useCallback(async (resetCursor = false) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (!resetCursor && cursor) params.set('cursor', cursor)
      const res = await api.get<ListResult>(`/admin/media?${params.toString()}`)
      const data = res.data as ListResult
      if (data) {
        if (resetCursor) {
          setFiles(data.files)
        } else {
          setFiles((prev) => [...prev, ...data.files])
        }
        setCursor(data.nextCursor)
        setHasMore(data.isTruncated && !!data.nextCursor)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [cursor])

  useEffect(() => {
    fetchStorageConfig()
  }, [fetchStorageConfig])

  useEffect(() => {
    fetchFiles(true)
  }, [])

  /**
   * 上傳文件入口 — 圖片走壓縮對話框，非圖片直接上傳
   * 每個上傳動作的優化點：
   *   - 圖片：彈出壓縮對話框，用戶控制質量/尺寸/格式，前端壓縮後再上傳
   *   - 非圖片（文檔/視頻）：直接上傳，無需壓縮
   *   - 上傳過程顯示進度（壓縮中/上傳中，第 N/總數 張）
   *   - 完成後自動刷新列表
   *   - 上傳失敗顯示具體錯誤信息（文件名 + 錯誤原因）
   */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    // ⚠️ 必須先複製文件到數組，再清空 input！
    // 否則 input.value='' 會清空 FileList，導致 Array.from 得到空數組
    const allFiles = Array.from(fileList)
    if (fileInputRef.current) fileInputRef.current.value = ''

    // 分離圖片和非圖片
    const imageFiles = allFiles.filter((f) => f.type.startsWith('image/') && f.type !== 'image/svg+xml')
    const nonImageFiles = allFiles.filter((f) => !f.type.startsWith('image/') || f.type === 'image/svg+xml')

    // 非圖片文件直接上傳（使用 hook，autoCompress=false）
    if (nonImageFiles.length > 0) {
      setError('')
      clearError()
      const results = await uploadFiles(nonImageFiles)
      const successCount = results.filter((r) => r !== null).length
      if (successCount > 0) {
        await fetchFiles(true)
      }
    }

    // 圖片文件彈出壓縮對話框
    if (imageFiles.length > 0) {
      setPendingImages(imageFiles)
    }
  }

  /** 壓縮對話框確認後上傳壓縮後的圖片 */
  const handleCompressedConfirm = async (compressedFiles: File[]) => {
    setPendingImages(null)
    setError('')
    clearError()
    const results = await uploadFiles(compressedFiles)
    const successCount = results.filter((r) => r !== null).length
    if (successCount > 0) {
      await fetchFiles(true)
    }
  }

  /** 切換標記保護（POST /admin/media/mark） */
  const handleToggleMark = async (key: string) => {
    setMarkingKey(key)
    try {
      await api.post('/admin/media/mark', { key })
      // 更新列表中的本地狀態
      setFiles((prev) => prev.map((f) =>
        f.key === key ? { ...f, isMarked: !f.isMarked } : f
      ))
      // 若詳情面板開啟，同步更新
      if (detailKey === key && detail) {
        setDetail({ ...detail, isMarked: !detail.isMarked })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '標記操作失敗')
    } finally {
      setMarkingKey(null)
    }
  }

  /** 顯示文件詳情（GET /admin/media/detail?key=xxx） */
  const handleShowDetail = async (key: string) => {
    setDetailKey(key)
    setDetail(null)
    setDetailImgDims(null)
    setDetailLoading(true)
    try {
      const res = await api.get<MediaDetail>(`/admin/media/detail?key=${encodeURIComponent(key)}`)
      if (res.data) {
        setDetail(res.data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '獲取詳情失敗')
      setDetailKey(null)
    } finally {
      setDetailLoading(false)
    }
  }

  /** 關閉詳情面板 */
  const handleCloseDetail = () => {
    setDetailKey(null)
    setDetail(null)
  }

  /**
   * 安全刪除文件
   * - 未使用文件：普通確認
   * - 已使用文件：先取得引用數量，顯示強制刪除警告
   */
  const handleDelete = async (file: MediaFile, knownUsageCount?: number) => {
    const fileName = file.key.split('/').pop() || file.key

    if (file.isUsed) {
      // 已使用文件：取得引用數量後顯示警告
      let usageCount = knownUsageCount ?? 0
      if (knownUsageCount === undefined) {
        try {
          const res = await api.get<MediaDetail>(`/admin/media/detail?key=${encodeURIComponent(file.key)}`)
          if (res.data) {
            usageCount = res.data.usage_count || res.data.usages?.length || 0
          }
        } catch { /* 使用默認值 0 */ }
      }

      const confirmed = window.confirm(
        `此文件被 ${usageCount} 處引用，確定要強制刪除嗎？\n\n文件: ${fileName}`
      )
      if (!confirmed) return
    } else {
      if (!window.confirm(`確定刪除文件 "${fileName}" 嗎？`)) return
    }

    try {
      await api.del(`/admin/media/${encodeURIComponent(file.key)}`)
      setFiles((prev) => prev.filter((f) => f.key !== file.key))
      // 若詳情面板正顯示此文件，關閉它
      if (detailKey === file.key) {
        handleCloseDetail()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '刪除失敗')
    }
  }

  /** 批量清理未使用文件（POST /admin/media/clean） */
  const handleCleanUnused = async () => {
    const confirmed = window.confirm(
      '確定要清理所有未使用且未標記的文件嗎？\n\n已標記（鎖定）的文件將被保留。'
    )
    if (!confirmed) return

    setCleaning(true)
    setError('')
    try {
      const res = await api.post<{ msg?: string }>('/admin/media/clean', { force: false })
      await fetchFiles(true)
      if (res.msg) {
        window.alert(res.msg)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '清理失敗')
    } finally {
      setCleaning(false)
    }
  }

  /** 複製 URL */
  const handleCopyUrl = async (key: string) => {
    if (!storageConfig) return
    const url = getFileUrl(key, storageConfig.s3_public_url, storageConfig.s3_endpoint, storageConfig.s3_bucket)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 2000)
    } catch { /* 忽略 */ }
  }

  /** 過濾 + 搜索（客戶端過濾已載入的文件） */
  const filteredFiles = files.filter((f) => {
    // 搜索過濾
    if (search && !f.key.toLowerCase().includes(search.toLowerCase())) return false
    // 分類/狀態過濾
    const category = getFileCategory(f.key)
    switch (filter) {
      case 'all': return true
      case 'image': return category === 'image'
      case 'document': return category === 'document'
      case 'video': return category === 'video'
      case 'unused': return !f.isUsed && !f.isMarked
      case 'marked': return !!f.isMarked
      default: return true
    }
  })

  /** 統計計數 */
  const stats = {
    total: files.length,
    used: files.filter((f) => f.isUsed).length,
    unused: files.filter((f) => !f.isUsed && !f.isMarked).length,
    marked: files.filter((f) => f.isMarked).length,
  }

  return (
    <div className="p-6">
      {/* 頁首 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">媒體庫</h1>
          <p className="text-sm text-muted-foreground mt-1">管理 R2/S3 存儲中的文件</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchFiles(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 border border-gray-300 px-3 py-2 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <span className={`${loading ? 'animate-spin inline-block' : ''}`}>🔄</span>
            刷新
          </button>
          <button
            onClick={handleCleanUnused}
            disabled={cleaning}
            className="inline-flex items-center gap-1.5 bg-orange-500 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {cleaning ? <span className="animate-spin inline-block">🔄</span> : <span>🗑️</span>}
            清理未使用
          </button>
          <label className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            {uploading ? <span className="animate-spin inline-block">🔄</span> : <span>📤</span>}
            上傳文件
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* 錯誤提示（頁面級別錯誤，如載入失敗） */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm flex items-center gap-2">
          <span className="flex-shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 上傳進度 + 錯誤（屏幕居中覆蓋層，統一組件） */}
      <UploadProgressOverlay
        uploading={uploading}
        progress={progress}
        error={uploadError}
        onClearError={clearError}
      />

      {/* 統計欄 */}
      <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground">
        <span>總計 <b className="text-blue-600">{stats.total}</b> 個</span>
        <span>已使用 <b className="text-green-600">{stats.used}</b></span>
        <span>未使用 <b className="text-gray-500">{stats.unused}</b></span>
        <span>已標記 <b className="text-amber-600">{stats.marked}</b></span>
      </div>

      {/* 過濾標籤 */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {FILTER_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors ${
              filter === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <span className="text-sm">{Icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* 搜索框 */}
      <div className="mb-4 relative max-w-md">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文件名..."
          className="w-full pl-10 pr-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* 文件網格 */}
      {loading && files.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <span className="animate-spin inline-block mr-2">🔄</span>
          載入中...
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-3xl mb-3 opacity-30">🖼️</span>
          <p>暫無文件，點擊「上傳文件」按鈕上傳</p>
        </div>
      ) : (
        <>
          {/* 瀑布流佈局：寬度固定，高度自適應圖片原始比例，方便辨別 PC/Mobile 圖片 */}
          <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-3">
            {filteredFiles.map((file) => {
              const category = getFileCategory(file.key)
              const fileName = file.key.split('/').pop() || file.key
              const fileUrl = storageConfig
                ? getFileUrl(file.key, storageConfig.s3_public_url, storageConfig.s3_endpoint, storageConfig.s3_bucket)
                : ''
              const isImage = category === 'image'
              const isMarked = !!file.isMarked
              const isUsed = !!file.isUsed

              return (
                <div
                  key={file.key}
                  className={`break-inside-avoid mb-3 bg-white rounded-lg border-2 overflow-hidden group hover:shadow-lg transition-all cursor-pointer relative ${
                    isMarked ? 'border-amber-400' : isUsed ? 'border-green-300' : 'border-gray-200'
                  }`}
                  onClick={() => handleShowDetail(file.key)}
                >
                  {/* 預覽區 — 圖片按原始比例顯示，非圖片固定高度 */}
                  <div className={`bg-gray-50 flex items-center justify-center relative overflow-hidden ${isImage ? '' : 'h-32'}`}>
                    {isImage && fileUrl ? (
                      <ImageWithDimensions
                        src={fileUrl}
                        alt={fileName}
                        className="w-full h-auto object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <FileIcon category={category} />
                    )}

                    {/* 使用狀態徽章 */}
                    <span
                      className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded text-white font-medium ${
                        isMarked ? 'bg-amber-500' : isUsed ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    >
                      {isMarked ? '已標記' : isUsed ? '已使用' : '未使用'}
                    </span>

                    {/* 鎖定圖標覆蓋（已標記文件顯示） */}
                    {isMarked && (
                      <div className="absolute top-2 right-2 bg-amber-500 text-white rounded-full p-1">
                        <span className="text-xs">🔒</span>
                      </div>
                    )}

                    {/* 標記/鎖定切換按鈕 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleMark(file.key)
                      }}
                      disabled={markingKey === file.key}
                      title={isMarked ? '取消標記保護' : '標記保護'}
                      className={`absolute bottom-2 right-2 p-1.5 rounded-full transition-all disabled:opacity-50 ${
                        isMarked
                          ? 'bg-amber-500 text-white opacity-100'
                          : 'bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {markingKey === file.key ? (
                        <span className="animate-spin inline-block text-xs">🔄</span>
                      ) : isMarked ? (
                        <span className="text-xs">🔓</span>
                      ) : (
                        <span className="text-xs">📑</span>
                      )}
                    </button>
                  </div>

                  {/* 文件信息 */}
                  <div className="p-2">
                    <p className="text-xs font-medium truncate" title={fileName}>{fileName}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatSize(file.size)} · {formatDate(file.lastModified)}
                    </p>

                    {/* 操作按鈕 */}
                    <div className="flex items-center gap-1 mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCopyUrl(file.key)
                        }}
                        className="p-1.5 hover:bg-gray-100 rounded text-muted-foreground hover:text-foreground"
                        title="複製 URL"
                      >
                        {copiedKey === file.key ? (
                          <span className="text-sm text-green-500">✅</span>
                        ) : (
                          <span className="text-sm">📋</span>
                        )}
                      </button>
                      {isImage && fileUrl && (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 hover:bg-gray-100 rounded text-muted-foreground hover:text-foreground"
                          title="查看"
                        >
                          <span className="text-sm">🖼️</span>
                        </a>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(file)
                        }}
                        className="p-1.5 hover:bg-red-50 rounded text-muted-foreground hover:text-red-500 ml-auto"
                        title="刪除"
                      >
                        <span className="text-sm">🗑️</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 加載更多 */}
          {hasMore && !search && filter === 'all' && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => fetchFiles(false)}
                disabled={loading}
                className="px-6 py-2 border rounded-md text-sm hover:bg-accent disabled:opacity-50"
              >
                {loading ? <span className="animate-spin inline-block">🔄</span> : '加載更多'}
              </button>
            </div>
          )}
        </>
      )}

      {/* ─── 文件詳情 Modal ──────────────────────────────── */}
      {detailKey && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={handleCloseDetail}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal 頭部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="text-lg text-blue-500">📄</span>
                文件詳情
              </h2>
              <button
                onClick={handleCloseDetail}
                className="p-1 hover:bg-gray-100 rounded"
              >
                ❌
              </button>
            </div>

            {/* Modal 內容 */}
            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <span className="animate-spin inline-block mr-2">🔄</span>
                  載入中...
                </div>
              ) : detail ? (
                <div className="space-y-6">
                  {/* 文件預覽（圖片類型） */}
                  {detail.category === 'image' && storageConfig && (
                    <div className="flex justify-center">
                      <img
                        src={getFileUrl(detail.key, storageConfig.s3_public_url, storageConfig.s3_endpoint, storageConfig.s3_bucket)}
                        alt={detail.name}
                        className="max-w-full max-h-48 object-contain border rounded-lg"
                        onLoad={(e) => {
                          const img = e.target as HTMLImageElement
                          setDetailImgDims({ w: img.naturalWidth, h: img.naturalHeight })
                        }}
                      />
                    </div>
                  )}

                  {/* 文件基本信息 */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-3">基本信息</h3>
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b">
                          <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap w-20">文件名</td>
                          <td className="py-2 break-all">{detail.name}</td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 pr-4 text-muted-foreground">路徑</td>
                          <td className="py-2 break-all text-gray-500">{detail.key}</td>
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 pr-4 text-muted-foreground">大小</td>
                          <td className="py-2">{detail.size_str || formatSize(detail.size)}</td>
                        </tr>
                        {detail.mime && (
                          <tr className="border-b">
                            <td className="py-2 pr-4 text-muted-foreground">類型</td>
                            <td className="py-2">{detail.mime}</td>
                          </tr>
                        )}
                        {(detailImgDims || detail.dimension) && (
                          <tr className="border-b">
                            <td className="py-2 pr-4 text-muted-foreground">尺寸</td>
                            <td className="py-2 font-mono">
                              {detailImgDims ? `${detailImgDims.w} × ${detailImgDims.h} px` : detail.dimension}
                            </td>
                          </tr>
                        )}
                        <tr className="border-b">
                          <td className="py-2 pr-4 text-muted-foreground">修改時間</td>
                          <td className="py-2">{formatDate(detail.lastModified)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 text-muted-foreground">狀態</td>
                          <td className="py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${
                              detail.isMarked ? 'bg-amber-500' : (detail.isUsed ?? detail.usages.length > 0) ? 'bg-green-500' : 'bg-gray-400'
                            }`}>
                              {detail.isMarked ? (
                                <>
                                  <span className="text-xs">🔒</span>
                                  已標記保護
                                </>
                              ) : (detail.isUsed ?? detail.usages.length > 0) ? (
                                '已使用'
                              ) : (
                                '未使用'
                              )}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* 使用位置列表 */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
                      <span>⚠️</span>
                      使用位置
                      {detail.usages.length > 0 && (
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
                          {detail.usages.length} 處引用
                        </span>
                      )}
                    </h3>
                    {detail.usages.length > 0 ? (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">來源</th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">ID</th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">名稱</th>
                              <th className="px-3 py-2 text-left font-medium text-muted-foreground">欄位</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.usages.map((u, i) => (
                              <tr key={i} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">{u.table}</td>
                                <td className="px-3 py-2 text-xs">{u.id}</td>
                                <td className="px-3 py-2 break-all">{u.name || '-'}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{u.field}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground py-3 text-center bg-gray-50 rounded-lg">
                        未在數據庫中找到使用位置
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  無法獲取文件詳情
                </div>
              )}
            </div>

            {/* Modal 底部操作欄 */}
            {detail && (
              <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
                {/* 標記/鎖定切換 */}
                <button
                  onClick={() => handleToggleMark(detail.key)}
                  disabled={markingKey === detail.key}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
                    detail.isMarked
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                  }`}
                >
                  {markingKey === detail.key ? (
                    <span className="animate-spin inline-block">🔄</span>
                  ) : detail.isMarked ? (
                    <span>🔓</span>
                  ) : (
                    <span>🔒</span>
                  )}
                  {detail.isMarked ? '取消標記保護' : '標記保護'}
                </button>

                {/* 複製 URL + 刪除 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyUrl(detail.key)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-100"
                  >
                    {copiedKey === detail.key ? (
                      <span className="text-green-500">✅</span>
                    ) : (
                      <span>📋</span>
                    )}
                    複製 URL
                  </button>
                  <button
                    onClick={() => {
                      handleDelete(
                        {
                          key: detail.key,
                          size: detail.size,
                          lastModified: detail.lastModified,
                          etag: '',
                          isUsed: detail.isUsed ?? detail.usages.length > 0,
                          isMarked: detail.isMarked,
                        },
                        detail.usages.length,
                      )
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm bg-red-500 text-white hover:bg-red-600"
                  >
                    <span>🗑️</span>
                    刪除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 圖片壓縮對話框 ──────────────────────────────── */}
      {pendingImages && (
        <ImageCompressDialog
          files={pendingImages}
          onConfirm={handleCompressedConfirm}
          onCancel={() => setPendingImages(null)}
        />
      )}
    </div>
  )
}
