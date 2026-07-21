import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import ImageCompressDialog from '../components/ImageCompressDialog'
import UploadProgressOverlay from '../components/UploadProgressOverlay'
import { TagInput } from '../components/TagInput'
import { LoadingState } from '../components/StateDisplay'
import { useImageUpload } from '../hooks/useImageUpload'

/** Quill 全局聲明（cdnjs Cloudflare CDN 託管） */
declare global {
  interface Window {
    Quill?: {
      new (container: HTMLElement | string, options?: Record<string, unknown>): QuillInstance
    }
  }
}

/** Quill CDN 常量（cdnjs - Cloudflare CDN） */
const QUILL_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/quill/2.0.2/quill.min.js'
const QUILL_CSS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/quill/2.0.2/quill.snow.min.css'

interface QuillInstance {
  root: HTMLElement
  getText: () => string
  getContents: () => unknown
  setContents: (delta: unknown) => void
  getSelection: () => { index: number } | null
  getLength: () => number
  insertEmbed: (index: number, type: string, value: string) => void
  on: (event: string, callback: () => void) => void
  clipboard: { dangerouslyPasteHTML: (html: string) => void }
}

/** Quill 本地載入狀態 */
let quillLoaded = false
let quillLoading: Promise<void> | null = null

/** 載入 Quill 編輯器（cdnjs CDN，防重複載入 + 輪詢兜底） */
function loadQuill(): Promise<void> {
  // 已載入完成，直接返回
  if (window.Quill) { quillLoaded = true; return Promise.resolve() }
  // 正在載入中，返回同一個 Promise（避免重複創建 script）
  if (quillLoading) return quillLoading

  quillLoading = new Promise<void>((resolve, reject) => {
    // 載入 CSS（僅一次）
    if (!document.querySelector(`link[href="${QUILL_CSS_URL}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = QUILL_CSS_URL
      document.head.appendChild(link)
    }

    // 載入 JS（僅一次）
    let script = document.getElementById('quill-script') as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = 'quill-script'
      script.src = QUILL_JS_URL
      script.async = true
      document.head.appendChild(script)
    }

    // 事件監聽
    script.addEventListener('load', () => { quillLoaded = true; quillLoading = null; resolve() })
    script.addEventListener('error', () => { quillLoading = null; reject(new Error('Quill 腳本載入失敗')) })

    // 輪詢兜底：每 100ms 檢查 window.Quill 是否已就緒（解決事件遺漏問題）
    let attempts = 0
    const maxAttempts = 50 // 5 秒超時
    const poll = setInterval(() => {
      attempts++
      if (window.Quill) {
        clearInterval(poll)
        quillLoaded = true
        quillLoading = null
        resolve()
      } else if (attempts >= maxAttempts) {
        clearInterval(poll)
        quillLoading = null
        reject(new Error('Quill 載入超時（5秒）'))
      }
    }, 100)
  })

  return quillLoading
}

/** 內容狀態: '1'=已發布, '0'=草稿 */
type ContentStatus = '1' | '0'

/** 內容數據結構 */
interface Content {
  id: number
  title: string
  titlecolor: string
  scode: string
  content: string
  date: string
  status: string
  istop: string
  isrecommend: string
  isheadline: string
  visits: number
  keywords: string
  description: string
  sorting: number
  author: string
  source: string
  tags: string
  ico: string
  filename: string
  outlink: string
  subtitle: string
}

/** 欄目（分類）樹節點 */
interface Category {
  id: number
  name: string
  scode: string
  pcode: string
  status: string
  children?: Category[]
}

/** 內容詳情響應 */
interface ContentDetail {
  content: Content
}

/** 擴展欄位定義 */
interface ExtField {
  id: number
  name: string
  field: string
  type: string // 1=單行文本 ... 10=多圖
  mcode: string // 所屬模型代碼
  value: string // 選項選項預設值（單選/多選/下拉的選項列表）
  scode: string // 適用欄目（逗號分隔，空=全展示）
  required: string // "1"=必填, "0"=可選
  sorting: number
  status: string
}

/** 擴展欄位類型標籤 */
const EXT_TYPE_LABELS: Record<string, string> = {
  '1': '單行文本',
  '2': '多行文本',
  '3': '單選',
  '4': '多選',
  '5': '單圖',
  '6': '附件',
  '7': '日期',
  '8': '編輯器',
  '9': '下拉',
  '10': '多圖',
}

/** 表單數據 */
interface FormData {
  title: string
  titlecolor: string
  scode: string
  content: string
  keywords: string
  description: string
  status: ContentStatus
  istop: boolean
  isrecommend: boolean
  isheadline: boolean
  tags: string
  author: string
  source: string
  ico: string
  filename: string
  outlink: string
  subtitle: string
  date: string
}

/** 空表單初始值 */
const EMPTY_FORM: FormData = {
  title: '',
  titlecolor: '',
  scode: '',
  content: '',
  keywords: '',
  description: '',
  status: '1',
  istop: false,
  isrecommend: false,
  isheadline: false,
  tags: '',
  author: '',
  source: '',
  ico: '',
  filename: '',
  outlink: '',
  subtitle: '',
  date: '',
}

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

/** 存存儲配置（僅 picker 所需字段） */
interface StorageConfig {
  s3_public_url: string
  s3_endpoint: string
  s3_bucket: string
}

/** 圖片擴展名白名單 */
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

/**
 * 媒體庫選擇器 Modal
 * - 可在任何圖片上傳區域打開
 * - 從 GET /admin/media 載入文件，GET /admin/storage/config 載入存儲配置
 * - 僅顯示圖片類型文件，支持搜索過濾
 */
function MediaPickerModal({
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
    const { s3_public_url, s3_endpoint, s3_bucket } = storageConfig
    return s3_public_url
      ? `${s3_public_url.replace(/\/$/, '')}/${key}`
      : `${s3_endpoint}/${s3_bucket}/${key}`
  }

  /** 過濾：僅圖片 + 搜索關鍵字 */
  const imageFiles = files.filter((f) => {
    const ext = f.key.split('.').pop()?.toLowerCase() || ''
    if (!IMAGE_EXTS.includes(ext)) return false
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
          ) : imageFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <span className="text-4xl mb-2">🖼️</span>
              <p>暫無圖片</p>
              {onUpload && <p className="text-xs mt-1">點擊上方「上傳圖片」按鈕添加</p>}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {imageFiles.map((file) => {
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

/** 將欄目樹渲染為帶縮進的 select 選項 */
function renderCategoryOptions(
  categories: Category[],
  depth = 0,
): React.ReactNode[] {
  const options: React.ReactNode[] = []
  for (const cat of categories) {
    const prefix = depth > 0 ? '└' + '─'.repeat(depth - 1) + ' ' : ''
    options.push(
      <option key={cat.scode} value={cat.scode}>
        {prefix}
        {cat.name}
      </option>,
    )
    if (cat.children && cat.children.length > 0) {
      options.push(...renderCategoryOptions(cat.children, depth + 1))
    }
  }
  return options
}

/** 擴展字段輸入元件：根據欄位類型渲染對應的輸入控件 */
function ExtFieldInput({
  field,
  value,
  onChange,
  uploadFile,
}: {
  field: ExtField
  value: string
  onChange: (val: string) => void
  uploadFile: (file: File) => Promise<string | null>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('') // 外鏈 URL 輸入框值
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false) // 媒體庫選擇器開關

  // 解析選項值（單選/多選/下拉）
  const options = field.value
    ? field.value.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  // 處理單文件上傳（單圖/附件）
  const handleSingleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadFile(file)
      if (url) onChange(url)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 處理多圖上傳
  const handleMultiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    try {
      const urls: string[] = []
      for (const file of files) {
        const url = await uploadFile(file)
        if (url) urls.push(url)
      }
      if (urls.length > 0) {
        const existing = value ? value.split(',').filter(Boolean) : []
        onChange([...existing, ...urls].join(','))
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 多選：切換某個選項
  const toggleMultiOption = (opt: string) => {
    const selected = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt]
    onChange(next.join(','))
  }

  // 多圖：移除指定圖片
  const removeImage = (idx: number) => {
    const images = value ? value.split(',').filter(Boolean) : []
    images.splice(idx, 1)
    onChange(images.join(','))
  }

  const inputClass =
    'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring'

  switch (field.type) {
    case '1': // 單行文本
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder={`請輸入${field.name}`}
        />
      )
    case '2': // 多行文本
    case '8': // 編輯器（簡化為 textarea）
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === '8' ? 8 : 4}
          className={`${inputClass} resize-y`}
          placeholder={`請輸入${field.name}`}
        />
      )
    case '3': // 單選
      return (
        <div className="flex flex-wrap gap-4 pt-1">
          {options.length === 0 && (
            <span className="text-sm text-muted-foreground">未設置選項</span>
          )}
          {options.map((opt) => (
            <label key={opt} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`ext-${field.field}`}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="w-4 h-4"
              />
              <span className="text-sm">{opt}</span>
            </label>
          ))}
        </div>
      )
    case '4': // 多選
      return (
        <div className="flex flex-wrap gap-4 pt-1">
          {options.length === 0 && (
            <span className="text-sm text-muted-foreground">未設置選項</span>
          )}
          {options.map((opt) => {
            const selected = value
              ? value.split(',').map((s) => s.trim()).filter(Boolean)
              : []
            return (
              <label key={opt} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggleMultiOption(opt)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm">{opt}</span>
              </label>
            )
          })}
        </div>
      )
    case '5': // 單圖
      return (
        <div className="space-y-2">
          {value && (
            <div className="relative inline-block">
              <img
                src={value}
                alt={field.name}
                className="w-32 h-32 object-cover rounded border"
              />
              <button
                type="button"
                onClick={() => onChange('')}
                className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full transition-transform hover:scale-110"
                title="移除"
              >
                <span className="text-xs leading-none">❌</span>
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleSingleUpload}
          />
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="輸入圖片外鏈 URL"
              className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => {
                if (urlInput.trim()) {
                  onChange(urlInput.trim())
                  setUrlInput('')
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
            >
              <span className="text-base">🔗</span>
              <span>確認</span>
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <span className="inline-block animate-spin">🔄</span>
              ) : (
                <span className="text-base">🖼️</span>
              )}
              <span>{uploading ? '上傳中...' : value ? '更換圖片' : '上傳圖片'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMediaPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
            >
              <span className="text-base">🖼️</span>
              <span>媒體庫</span>
            </button>
          </div>
          <MediaPickerModal
            open={mediaPickerOpen}
            onClose={() => setMediaPickerOpen(false)}
            onSelect={(url) => onChange(url)}
            onUpload={async (files) => {
              const urls: (string | null)[] = []
              for (const f of files) {
                urls.push(await uploadFile(f))
              }
              return urls
            }}
          />
        </div>
      )
    case '6': // 附件
      return (
        <div className="space-y-2">
          {value && (
            <div className="flex items-center gap-2">
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline truncate max-w-xs"
              >
                {value.split('/').pop() || '查看附件'}
              </a>
              <button
                type="button"
                onClick={() => onChange('')}
                className="p-0.5 text-red-600 hover:bg-red-50 rounded"
                title="移除"
              >
                <span className="text-sm leading-none">❌</span>
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" className="hidden" onChange={handleSingleUpload} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <span className="inline-block animate-spin">🔄</span>
            ) : (
              <span className="text-base">📤</span>
            )}
            <span>{uploading ? '上傳中...' : '上傳附件'}</span>
          </button>
        </div>
      )
    case '7': // 日期
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )
    case '9': // 下拉
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} bg-white`}
        >
          <option value="">請選擇</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )
    case '10': // 多圖
      return (
        <div className="space-y-2">
          {value && (
            <div className="flex flex-wrap gap-2">
              {value
                .split(',')
                .filter(Boolean)
                .map((url, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={url}
                      alt={`${field.name}-${idx}`}
                      className="w-24 h-24 object-cover rounded border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full transition-transform hover:scale-110"
                      title="移除"
                    >
                      <span className="text-xs leading-none">❌</span>
                    </button>
                  </div>
                ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleMultiUpload}
          />
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="輸入圖片外鏈 URL"
              className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => {
                if (urlInput.trim()) {
                  const existing = value ? value.split(',').filter(Boolean) : []
                  onChange([...existing, urlInput.trim()].join(','))
                  setUrlInput('')
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
            >
              <span className="text-base">➕</span>
              <span>添加</span>
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <span className="inline-block animate-spin">🔄</span>
              ) : (
                <span className="text-base">🖼️</span>
              )}
              <span>{uploading ? '上傳中...' : '上傳圖片'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMediaPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
            >
              <span className="text-base">🖼️</span>
              <span>媒體庫</span>
            </button>
          </div>
          <MediaPickerModal
            open={mediaPickerOpen}
            onClose={() => setMediaPickerOpen(false)}
            onSelect={(url) => {
              const existing = value ? value.split(',').filter(Boolean) : []
              onChange([...existing, url].join(','))
            }}
            onUpload={async (files) => {
              const urls: (string | null)[] = []
              for (const f of files) {
                urls.push(await uploadFile(f))
              }
              const valid = urls.filter((u): u is string => !!u)
              if (valid.length > 0) {
                const existing = value ? value.split(',').filter(Boolean) : []
                onChange([...existing, ...valid].join(','))
              }
              return urls
            }}
          />
        </div>
      )
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder={`請輸入${field.name}`}
        />
      )
  }
}

export default function ContentEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mcode = searchParams.get('mcode') || ''
  const isEdit = !!id

  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editorReady, setEditorReady] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic')
  const [icoUploading, setIcoUploading] = useState(false)
  const [icoUrlInput, setIcoUrlInput] = useState('') // 縮略圖外鏈 URL 輸入框值
  const [icoMediaPickerOpen, setIcoMediaPickerOpen] = useState(false) // 縮略圖媒體庫選擇器
  const [quillImagePicker, setQuillImagePicker] = useState(false) // Quill 編輯器媒體庫選擇器
  const [allTags, setAllTags] = useState<string[]>([]) // 歷史標籤列表（供快速補充）

  // 自定義擴展欄位
  const [extFields, setExtFields] = useState<ExtField[]>([])
  const [extValues, setExtValues] = useState<Record<string, string>>({})
  const [extLoading, setExtLoading] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const quillRef = useRef<QuillInstance | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const icoFileRef = useRef<HTMLInputElement>(null)

  // ─── 上傳 hook（autoCompress=false：圖片通過 ImageCompressDialog 壓縮） ───
  // 統一所有上傳位置：縮略圖、Quill 編輯器圖片、擴展字段圖片
  const { uploading: imgUploading, progress: imgProgress, error: imgUploadError, uploadSingle, clearError: clearImgError } = useImageUpload({
    autoCompress: false,
  })

  // ─── 圖片壓縮對話框狀態 ───
  // 當用戶選擇圖片時，彈出 ImageCompressDialog 讓用戶控制壓縮質量
  // 回調函數在壓縮確認後被調用，傳入壓縮後的文件
  // 支持批量：粘貼富文本帶多圖時一次壓縮多張
  const [pendingImageUpload, setPendingImageUpload] = useState<{
    files: File[]
    callback: (urls: (string | null)[]) => void
  } | null>(null)

  /** 載入欄目樹 (支持按 mcode 過濾，使用 /all 端點無需 M202 權限) */
  const fetchCategories = useCallback(async () => {
    try {
      const url = mcode ? `/admin/sorts/all?mcode=${encodeURIComponent(mcode)}` : '/admin/sorts/all'
      const res = await api.get<Category[]>(url)
      const cats = res.data ?? []
      setCategories(cats)
      // 新建模式下, 如果有 mcode 參數且未選擇欄目, 自動預選第一個欄目
      if (!isEdit && !form.scode && cats.length > 0) {
        setForm((prev) => ({ ...prev, scode: cats[0].scode }))
      }
    } catch {
      /* 忽略欄目載入錯誤 */
    }
  }, [mcode, isEdit, form.scode])

  /** 載入內容詳情（編輯模式） */
  const fetchContent = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      // 使用 admin 端點載入內容（不經過 Workers Cache，確保讀到最新數據）
      const res = await api.get<ContentDetail>(`/admin/contents/${id}`)
      const content = res.data?.content
      if (content) {
        // 將 'YYYY-MM-DD HH:MM:SS' 轉為 datetime-local 所需的 'YYYY-MM-DDTHH:MM'
        const rawDate = content.date ?? ''
        const localDate = rawDate ? rawDate.replace(' ', 'T').slice(0, 16) : ''
        setForm({
          title: content.title ?? '',
          titlecolor: content.titlecolor ?? '',
          scode: content.scode ?? '',
          content: content.content ?? '',
          keywords: content.keywords ?? '',
          description: content.description ?? '',
          status: content.status === '1' ? '1' : '0',
          istop: content.istop === '1',
          isrecommend: content.isrecommend === '1',
          isheadline: content.isheadline === '1',
          tags: content.tags ?? '',
          author: content.author ?? '',
          source: content.source ?? '',
          ico: content.ico ?? '',
          filename: content.filename ?? '',
          outlink: content.outlink ?? '',
          subtitle: content.subtitle ?? '',
          date: localDate,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入內容失敗')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  // 載入歷史標籤列表（供標籤輸入器快速補充）
  useEffect(() => {
    api.get<string[]>('/admin/contents/all-tags').then((res) => {
      setAllTags(res.data ?? [])
    }).catch(() => {
      // 獲取失敗不影響編輯功能
    })
  }, [])

  useEffect(() => {
    if (isEdit) {
      fetchContent()
    }
  }, [isEdit, fetchContent])

  /** 載入欄目對應的擴展欄位，編輯模式下同時載入現有擴展值 */
  const fetchExtFields = useCallback(
    async (scode: string, contentId?: string) => {
      if (!scode) {
        setExtFields([])
        setExtValues({})
        return
      }
      setExtLoading(true)
      try {
        const res = await api.get<ExtField[]>(
          `/admin/contents/extfields?scode=${encodeURIComponent(scode)}`,
        )
        const fields = res.data ?? []
        setExtFields(fields)
        // 初始化空值
        const initial: Record<string, string> = {}
        for (const f of fields) {
          initial[f.field] = ''
        }
        // 編輯模式：載入現有擴展值，僅合併當前欄位存在的值
        if (contentId) {
          try {
            const vRes = await api.get<Record<string, string>>(
              `/admin/contents/${contentId}/ext`,
            )
            if (vRes.data) {
              for (const f of fields) {
                const v = vRes.data[f.field]
                if (v !== undefined && v !== null) {
                  initial[f.field] = v
                }
              }
            }
          } catch {
            /* 忽略擴展值載入錯誤 */
          }
        }
        setExtValues(initial)
      } catch {
        setExtFields([])
        setExtValues({})
      } finally {
        setExtLoading(false)
      }
    },
    [],
  )

  // 當欄目變化時，載入對應擴展欄位（編輯模式下附帶現有值）
  useEffect(() => {
    if (form.scode) {
      fetchExtFields(form.scode, isEdit && id ? id : undefined)
    } else {
      setExtFields([])
      setExtValues({})
    }
  }, [form.scode, fetchExtFields, isEdit, id])

  /** 更新擴展字段值 */
  const updateExtValue = (field: string, value: string) => {
    setExtValues((prev) => ({ ...prev, [field]: value }))
  }

  /**
   * 圖片上傳到 R2（統一使用 ImageCompressDialog 讓用戶控制壓縮質量）
   *
   * 流程：
   *   1. 用戶選擇圖片文件
   *   2. 彈出 ImageCompressDialog（質量滑桿+尺寸控制+前後對比）
   *   3. 用戶確認壓縮設置後，hook 上傳壓縮後的文件
   *   4. 返回上傳後的 URL
   *
   * 非圖片文件（SVG等）直接上傳，不彈出對話框。
   *
   * 使用位置：縮略圖、Quill 編輯器圖片、擴展字段圖片、媒體庫選擇器上傳
   */
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    clearImgError()
    // SVG 和非圖片文件直接上傳，不壓縮
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      return await uploadSingle(file)
    }
    // 圖片文件：彈出壓縮對話框，等待用戶確認
    return new Promise<string | null>((resolve) => {
      setPendingImageUpload({
        files: [file],
        callback: (urls) => resolve(urls[0] ?? null),
      })
    })
  }, [uploadSingle, clearImgError])

  /**
   * 批量圖片上傳（用於粘貼富文本帶多圖場景）
   * 一次彈出 ImageCompressDialog 壓縮所有圖片，然後逐張上傳
   */
  const uploadImages = useCallback(async (files: File[]): Promise<(string | null)[]> => {
    // 分離需要壓縮的圖片和可直接上傳的文件
    const compressible: File[] = []
    const direct: { index: number; file: File }[] = []
    files.forEach((file, index) => {
      if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
        direct.push({ index, file })
      } else {
        compressible.push(file)
      }
    })

    // 直接上傳的非圖片文件
    const results: (string | null)[] = new Array(files.length).fill(null)
    for (const { index, file } of direct) {
      clearImgError()
      results[index] = await uploadSingle(file)
    }

    // 需要壓縮的圖片文件
    if (compressible.length > 0) {
      const compressedUrls = await new Promise<(string | null)[]>((resolve) => {
        setPendingImageUpload({
          files: compressible,
          callback: resolve,
        })
      })
      let compressedIdx = 0
      files.forEach((file, index) => {
        if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
          results[index] = compressedUrls[compressedIdx] ?? null
          compressedIdx++
        }
      })
    }

    return results
  }, [uploadSingle, clearImgError])

  /** ImageCompressDialog 確認回調 — 批量上傳壓縮後的文件 */
  const handleImageCompressConfirm = useCallback(async (compressedFiles: File[]) => {
    if (!pendingImageUpload) return
    const { callback } = pendingImageUpload
    setPendingImageUpload(null)

    if (compressedFiles.length === 0) {
      callback([])
      return
    }

    clearImgError()
    // 逐張上傳壓縮後的文件，返回所有 URL（保持順序）
    const urls: (string | null)[] = []
    for (const file of compressedFiles) {
      const url = await uploadSingle(file)
      urls.push(url)
    }
    callback(urls)
  }, [pendingImageUpload, uploadSingle, clearImgError])

  /** ImageCompressDialog 取消回調 */
  const handleImageCompressCancel = useCallback(() => {
    if (pendingImageUpload) {
      pendingImageUpload.callback([])
      setPendingImageUpload(null)
    }
  }, [pendingImageUpload])

  /** 縮略圖（ico）上傳處理 */
  const handleIcoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIcoUploading(true)
    try {
      const url = await uploadImage(file)
      if (url) updateField('ico', url)
    } finally {
      setIcoUploading(false)
      if (icoFileRef.current) icoFileRef.current.value = ''
    }
  }

  /** 初始化 Quill 編輯器（依賴 loading，確保編輯器 DOM 已渲染） */
  useEffect(() => {
    // 載入中時編輯器 div 不在 DOM 中，跳過初始化
    if (loading) return

    let cancelled = false
    let pasteHandler: ((e: ClipboardEvent) => void) | null = null

    const initEditor = async () => {
      try {
        await loadQuill()
        if (cancelled || !window.Quill || !editorRef.current) return

        // 如果已有實例，先清理
        if (quillRef.current) {
          editorRef.current.innerHTML = ''
        }

        // 創建編輯器容器
        const editorContainer = document.createElement('div')
        editorRef.current.appendChild(editorContainer)

        const quill = new window.Quill(editorContainer, {
          theme: 'snow',
          readOnly: false,
          placeholder: '在此輸入內容...',
          modules: {
            toolbar: {
              container: [
                [{ header: [1, 2, 3, 4, 5, 6, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ color: [] }, { background: [] }],
                [{ align: [] }],
                ['blockquote', 'code-block'],
                [{ list: 'ordered' }, { list: 'bullet' }],
                ['link', 'image'],
                ['clean'],
              ],
              handlers: {
                image: function () {
                  // 直接打開增強版媒體庫選擇器（含上傳+外鏈+媒體庫三合一）
                  setQuillImagePicker(true)
                },
              },
            },
            clipboard: {
              matchVisual: false,
            },
          },
        })

        quillRef.current = quill

        // 設置已有內容
        if (form.content) {
          quill.clipboard.dangerouslyPasteHTML(form.content)
        }

        // 監聯內容變化
        quill.on('text-change', () => {
          if (quillRef.current) {
            const html = quillRef.current.root.innerHTML
            setForm((prev) => ({ ...prev, content: html }))
          }
        })

        // ─── 粘貼事件：攔截剪貼板圖片 + 粘貼 HTML 中的 base64 圖片 ───
        // 場景1：用戶截圖粘貼 → 提取 File → 壓縮上傳 → 插入編輯器
        // 場景2：從本地文章/Word/網頁複製帶圖富文本 → Quill 插入 HTML → 掃描 base64 圖片 → 轉存媒體庫
        const handlePaste = async (e: ClipboardEvent) => {
          const clipboardData = e.clipboardData
          if (!clipboardData) return
          const items = clipboardData.items
          if (!items || items.length === 0) return

          // 提取所有圖片文件（排除文本/HTML 類型）
          const imageFiles: File[] = []
          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (file) {
                // 給文件一個合理的名字
                if (!file.name || file.name === 'image.png') {
                  const ext = file.type.split('/')[1] || 'png'
                  const newName = `paste_${Date.now()}_${i}.${ext}`
                  imageFiles.push(new File([file], newName, { type: file.type }))
                } else {
                  imageFiles.push(file)
                }
              }
            }
          }

          // 場景1：剪貼板有圖片文件（截圖）→ 阻止默認，走批量壓縮上傳
          if (imageFiles.length > 0) {
            e.preventDefault()
            e.stopPropagation()

            const range = quill.getSelection()
            const insertIndex = range ? range.index : (quill.getLength() || 0) - 1

            const urls = await uploadImages(imageFiles)
            const validUrls = urls.filter((u): u is string => !!u)

            validUrls.forEach((url, i) => {
              quill.insertEmbed(insertIndex + i, 'image', url)
            })
            return
          }

          // 場景2：富文本粘貼（無 File items，有 text/html）→ 讓 Quill 處理後掃描 base64 圖片
          const hasHtml = Array.from(items).some(
            (item) => item.kind === 'string' && item.type === 'text/html'
          )
          if (!hasHtml) return

          // 不阻止默認行為，讓 Quill 插入 HTML
          // 延遲掃描，等 Quill 完成 DOM 插入
          setTimeout(async () => {
            if (!quillRef.current) return
            const root = quillRef.current.root
            const base64Images = root.querySelectorAll<HTMLImageElement>(
              'img[src^="data:image/"]'
            )
            if (base64Images.length === 0) return

            // 將每個 base64 圖片轉為 File 對象
            const files: File[] = []
            const imgElements: HTMLImageElement[] = []
            for (let i = 0; i < base64Images.length; i++) {
              const img = base64Images[i]
              try {
                const resp = await fetch(img.src)
                const blob = await resp.blob()
                const ext = blob.type.split('/')[1] || 'png'
                const file = new File([blob], `paste_html_${Date.now()}_${i}.${ext}`, {
                  type: blob.type,
                })
                files.push(file)
                imgElements.push(img)
              } catch {
                // 單個轉換失敗跳過，不影響其他
              }
            }

            if (files.length === 0) return

            // 批量壓縮上傳
            const urls = await uploadImages(files)
            imgElements.forEach((img, i) => {
              if (urls[i]) {
                img.src = urls[i]!
              }
            })
          }, 50)
        }

        quill.root.addEventListener('paste', handlePaste)
        pasteHandler = handlePaste

        if (!cancelled) {
          setEditorReady(true)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '編輯器初始化失敗')
      }
    }

    // 延遲初始化，確保 DOM 就緒
    const timer = setTimeout(initEditor, 100)

    return () => {
      cancelled = true
      clearTimeout(timer)
      // 移除粘貼事件監聽
      if (quillRef.current && pasteHandler) {
        quillRef.current.root.removeEventListener('paste', pasteHandler)
      }
      if (editorRef.current) {
        editorRef.current.innerHTML = ''
      }
      quillRef.current = null
      setEditorReady(false)
    }
  }, [loading])

  /** 表單欄位更新 */
  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** 提交表單 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('請輸入標題')
      return
    }
    if (!form.scode) {
      setError('請選擇欄目')
      return
    }
    // 從編輯器獲取最新內容
    let content = form.content
    if (quillRef.current) {
      content = quillRef.current.root.innerHTML
    }

    setSaving(true)
    setError('')
    try {
      // 將 datetime-local 的 'YYYY-MM-DDTHH:MM' 轉回 'YYYY-MM-DD HH:MM:SS'
      const submitDate = form.date ? form.date.replace('T', ' ') + ':00' : ''
      const payload = {
        title: form.title.trim(),
        titlecolor: form.titlecolor,
        scode: form.scode,
        content,
        keywords: form.keywords,
        description: form.description,
        status: form.status,
        istop: form.istop ? '1' : '0',
        isrecommend: form.isrecommend ? '1' : '0',
        isheadline: form.isheadline ? '1' : '0',
        tags: form.tags,
        author: form.author,
        source: form.source,
        ico: form.ico,
        filename: form.filename,
        outlink: form.outlink,
        subtitle: form.subtitle,
        date: submitDate,
        ext_fields: extValues,
      }
      if (isEdit) {
        await api.put(`/admin/contents/${id}`, payload)
      } else {
        await api.post('/admin/contents', payload)
      }
      navigate('/contents')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState text="載入中..." />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* 頁首 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/contents')}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="text-base">⬅️</span>
          <span>返回</span>
        </button>
        <h1 className="text-2xl font-bold">{isEdit ? '編輯內容' : '新建內容'}</h1>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* 表單 */}
      <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-lg border p-6">
        {/* Tab 切換 */}
        <div className="flex gap-1 border-b">
          <button
            type="button"
            onClick={() => setActiveTab('basic')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'basic'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            基本內容
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('advanced')}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'advanced'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            高級內容
          </button>
        </div>

        {/* 基本內容 Tab（用 CSS display 切換，避免編輯器 DOM 被卸載導致內容丟失） */}
        <div style={{ display: activeTab === 'basic' ? 'block' : 'none' }}>
          <>
            {/* 標題 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                標題 <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="請輸入內容標題"
                  required
                />
                {/* 標題顏色選擇器 */}
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xs text-muted-foreground">標題字色</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={form.titlecolor || '#333333'}
                      onChange={(e) => updateField('titlecolor', e.target.value)}
                      className="w-10 h-10 rounded-md border cursor-pointer p-0.5 bg-transparent"
                      title="標題顏色"
                    />
                    {form.titlecolor && (
                      <button
                        type="button"
                        onClick={() => updateField('titlecolor', '')}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        title="清除顏色"
                      >
                        ❌
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 欄目 + 狀態 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  欄目 <span className="text-destructive">*</span>
                </label>
                <select
                  value={form.scode}
                  onChange={(e) => updateField('scode', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                  required
                >
                  <option value="">請選擇欄目</option>
                  {renderCategoryOptions(categories)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">狀態</label>
                <select
                  value={form.status}
                  onChange={(e) => updateField('status', e.target.value as ContentStatus)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-white"
                >
                  <option value="1">已發布</option>
                  <option value="0">草稿</option>
                </select>
              </div>
            </div>

            {/* Slug + 發佈時間 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Slug (URL別名)</label>
                <input
                  type="text"
                  value={form.filename}
                  onChange={(e) => updateField('filename', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="URL別名，留空則用ID"
                  pattern="[a-zA-Z0-9\-_/]+"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">發佈時間</label>
                <input
                  type="datetime-local"
                  value={form.date}
                  onChange={(e) => updateField('date', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground">設置未來時間可實現定時發布</p>
              </div>
            </div>

            {/* 內容 - Quill 編輯器 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                內容 {!editorReady && <span className="text-xs text-muted-foreground">（編輯器載入中...）</span>}
              </label>
              <div ref={editorRef} className="border rounded-md overflow-hidden" />
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" />
            </div>

            {/* 標籤（TagInput 組件 + 歷史標籤快速補充） */}
            <div>
              <label className="block text-sm font-medium mb-1.5">標籤</label>
              <TagInput
                values={form.tags ? form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : []}
                onChange={(tags) => updateField('tags', tags.join(','))}
                placeholder="輸入標籤後按 Enter 添加"
              />
              {allTags.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">📋 歷史標籤（點擊添加）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags
                      .filter((t) => {
                        const current = form.tags ? form.tags.split(/[,，]/).map((s) => s.trim()) : []
                        return !current.includes(t)
                      })
                      .slice(0, 30)
                      .map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            const current = form.tags ? form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []
                            if (!current.includes(tag)) {
                              updateField('tags', [...current, tag].join(','))
                            }
                          }}
                          className="px-2 py-0.5 text-xs border border-border text-muted-foreground rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* 作者、來源 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">作者</label>
                <input
                  type="text"
                  value={form.author}
                  onChange={(e) => updateField('author', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="請輸入作者"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">來源</label>
                <input
                  type="text"
                  value={form.source}
                  onChange={(e) => updateField('source', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="請輸入來源"
                />
              </div>
            </div>

            {/* 縮略圖 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">縮略圖</label>
              <div className="space-y-2">
                {form.ico && (
                  <div className="relative inline-block">
                    <img
                      src={form.ico}
                      alt="縮略圖"
                      className="w-32 h-32 object-cover rounded border"
                    />
                    <button
                      type="button"
                      onClick={() => updateField('ico', '')}
                      className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full transition-transform hover:scale-110"
                      title="移除"
                    >
                      <span className="text-xs leading-none">❌</span>
                    </button>
                  </div>
                )}
                <input
                  ref={icoFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleIcoUpload}
                />
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    value={icoUrlInput}
                    onChange={(e) => setIcoUrlInput(e.target.value)}
                    placeholder="輸入圖片外鏈 URL"
                    className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (icoUrlInput.trim()) {
                        updateField('ico', icoUrlInput.trim())
                        setIcoUrlInput('')
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
                  >
                    <span className="text-base">🔗</span>
                    <span>確認</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => icoFileRef.current?.click()}
                    disabled={icoUploading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {icoUploading ? (
                      <span className="inline-block animate-spin">🔄</span>
                    ) : (
                      <span className="text-base">🖼️</span>
                    )}
                    <span>{icoUploading ? '上傳中...' : form.ico ? '更換縮略圖' : '上傳縮略圖'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIcoMediaPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
                  >
                    <span className="text-base">🖼️</span>
                    <span>媒體庫</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 選項 */}
            <div className="flex flex-wrap gap-6">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.istop}
                  onChange={(e) => updateField('istop', e.target.checked)}
                  className="w-4 h-4 rounded border-input"
                />
                <span className="text-sm">置頂</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isrecommend}
                  onChange={(e) => updateField('isrecommend', e.target.checked)}
                  className="w-4 h-4 rounded border-input"
                />
                <span className="text-sm">推薦</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isheadline}
                  onChange={(e) => updateField('isheadline', e.target.checked)}
                  className="w-4 h-4 rounded border-input"
                />
                <span className="text-sm">頭條</span>
              </label>
            </div>

            {/* 自定義字段（擴展欄位） */}
            <div className="pt-2 border-t">
              <h3 className="text-sm font-semibold mb-3 pt-3">自定義字段</h3>
              {extLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <span className="inline-block animate-spin">🔄</span>
                  載入自定義字段中...
                </div>
              ) : extFields.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {form.scode ? '此欄目沒有自定義字段' : '請先選擇欄目'}
                </p>
              ) : (
                <div className="space-y-4">
                  {extFields.map((field) => (
                    <div key={field.id}>
                      <label className="block text-sm font-medium mb-1.5">
                        {field.name}
                        {field.required === '1' && <span className="text-destructive"> *</span>}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({EXT_TYPE_LABELS[field.type] ?? '自定義'})
                        </span>
                      </label>
                      <ExtFieldInput
                        field={field}
                        value={extValues[field.field] ?? ''}
                        onChange={(val) => updateExtValue(field.field, val)}
                        uploadFile={uploadImage}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        </div>

        {/* 高級內容 Tab */}
        <div style={{ display: activeTab === 'advanced' ? 'block' : 'none' }}>
          <>
            {/* 副標題 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">副標題</label>
              <input
                type="text"
                value={form.subtitle}
                onChange={(e) => updateField('subtitle', e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="請輸入副標題"
              />
            </div>

            {/* 外鏈 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">外鏈</label>
              <input
                type="text"
                value={form.outlink}
                onChange={(e) => updateField('outlink', e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="跳轉外鏈接，設置後內容變為外鏈類型"
              />
            </div>

            {/* 關鍵字 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">關鍵字</label>
              <input
                type="text"
                value={form.keywords}
                onChange={(e) => updateField('keywords', e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="多個關鍵字以逗號分隔"
              />
            </div>

            {/* 描述 */}
            <div>
              <label className="block text-sm font-medium mb-1.5">描述</label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder="SEO 描述..."
              />
            </div>
          </>
        </div>

        {/* 操作按鈕 */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <button
            type="submit"
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity text-sm disabled:opacity-50',
            )}
          >
            <span className="text-base">💾</span>
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/contents')}
            className="px-5 py-2 border rounded-md hover:bg-accent transition-colors text-sm"
          >
            取消
          </button>
        </div>
      </form>

      {/* 媒體庫選擇器 - 縮略圖 */}
      <MediaPickerModal
        open={icoMediaPickerOpen}
        onClose={() => setIcoMediaPickerOpen(false)}
        onSelect={(url) => updateField('ico', url)}
        onUpload={uploadImages}
      />

      {/* 媒體庫選擇器 - Quill 編輯器圖片插入 */}
      <MediaPickerModal
        open={quillImagePicker}
        onClose={() => setQuillImagePicker(false)}
        onUpload={uploadImages}
        onSelect={(url) => {
          if (quillRef.current) {
            const range = quillRef.current.getSelection()
            const index = range ? range.index : 0
            quillRef.current.insertEmbed(index, 'image', url)
          }
        }}
      />

      {/* ─── 圖片壓縮對話框（所有圖片上傳統一使用，支持批量） ─── */}
      {pendingImageUpload && (
        <ImageCompressDialog
          files={pendingImageUpload.files}
          onConfirm={handleImageCompressConfirm}
          onCancel={handleImageCompressCancel}
        />
      )}

      {/* ─── 上傳進度 + 錯誤（屏幕居中覆蓋層，統一組件） ─── */}
      <UploadProgressOverlay
        uploading={imgUploading}
        progress={imgProgress}
        error={imgUploadError}
        onClearError={clearImgError}
      />
    </div>
  )
}
