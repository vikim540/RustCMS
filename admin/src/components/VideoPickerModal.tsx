import { useState, useMemo } from 'react'

/**
 * YouTube URL 轉換為 embed URL
 *
 * 支持的輸入格式：
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 * - https://www.youtube-nocookie.com/embed/VIDEO_ID
 *
 * 同時提取原 URL 中的 t / start 參數轉為 start 參數
 */
function parseYouTubeUrl(url: string): { videoId: string; startTime?: number } | null {
  const regex = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/i
  const match = url.match(regex)
  if (!match) return null
  const videoId = match[1]

  // 提取時間戳 t=30 或 start=30
  let startTime: number | undefined
  const tMatch = url.match(/[?&](?:t|start)=(\d+)/)
  if (tMatch) startTime = parseInt(tMatch[1], 10)

  return { videoId, startTime }
}

/** YouTube iframe 參數配置 */
interface YouTubeParams {
  autoplay: boolean
  mute: boolean
  loop: boolean
  controls: boolean
  rel: boolean
  startTime: string
  endTime: string
  modestbranding: boolean
  playsinline: boolean
}

/** 預設參數 */
const DEFAULT_PARAMS: YouTubeParams = {
  autoplay: false,
  mute: false,
  loop: false,
  controls: true,
  rel: false,
  startTime: '',
  endTime: '',
  modestbranding: false,
  playsinline: true,
}

/**
 * 視頻插入面板 Modal（可複用組件）
 *
 * Tab 1: YouTube 嵌入 — 自動 URL 轉換 + iframe 參數配置
 * Tab 2: 視頻連結 — 直接視頻文件 URL（mp4/webm 等），生成 <video> 標籤
 *
 * 用法：
 * ```tsx
 * <VideoPickerModal
 *   open={videoPickerOpen}
 *   onClose={() => setVideoPickerOpen(false)}
 *   onInsert={(html) => {
 *     // 將 HTML 插入到編輯器中
 *     quillRef.current?.clipboard.dangerouslyPasteHTML(range.index, html)
 *   }}
 * />
 * ```
 */
export default function VideoPickerModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  /** 插入完成後的回調，返回 HTML 字符串（iframe 或 video 標籤） */
  onInsert: (html: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'youtube' | 'direct'>('youtube')

  // YouTube tab 狀態
  const [ytUrl, setYtUrl] = useState('')
  const [params, setParams] = useState<YouTubeParams>({ ...DEFAULT_PARAMS })

  // Direct video tab 狀態
  const [videoUrl, setVideoUrl] = useState('')
  const [videoPoster, setVideoPoster] = useState('')

  // 解析 YouTube URL
  const parsedYouTube = useMemo(() => {
    if (!ytUrl.trim()) return null
    return parseYouTubeUrl(ytUrl.trim())
  }, [ytUrl])

  // 如果 URL 帶有時間戳，自動填充 startTime
  const handleUrlChange = (url: string) => {
    setYtUrl(url)
    const parsed = parseYouTubeUrl(url)
    if (parsed?.startTime && !params.startTime) {
      setParams((p) => ({ ...p, startTime: String(parsed.startTime) }))
    }
  }

  /** 生成 YouTube embed URL */
  const buildEmbedUrl = (): string | null => {
    if (!parsedYouTube) return null
    const { videoId } = parsedYouTube
    const queryParts: string[] = []

    if (params.autoplay) {
      queryParts.push('autoplay=1')
      // autoplay 必須搭配 mute=1（瀏覽器限制）
      if (!params.mute) queryParts.push('mute=1')
    }
    if (params.mute) queryParts.push('mute=1')
    if (params.loop) {
      queryParts.push('loop=1')
      queryParts.push(`playlist=${videoId}`) // loop 必須搭配 playlist=videoId
    }
    if (!params.controls) queryParts.push('controls=0')
    if (params.rel) queryParts.push('rel=1')
    if (params.startTime) queryParts.push(`start=${params.startTime}`)
    if (params.endTime) queryParts.push(`end=${params.endTime}`)
    if (params.playsinline) queryParts.push('playsinline=1')

    const base = params.modestbranding
      ? 'https://www.youtube-nocookie.com/embed'
      : 'https://www.youtube.com/embed'

    return queryParts.length > 0
      ? `${base}/${videoId}?${queryParts.join('&')}`
      : `${base}/${videoId}`
  }

  /** 生成 YouTube iframe HTML */
  const buildYouTubeHtml = (): string => {
    const embedUrl = buildEmbedUrl()
    if (!embedUrl) return ''
    const allowAttrs = [
      'accelerometer',
      params.autoplay ? 'autoplay' : '',
      'clipboard-write',
      'encrypted-media',
      'gyroscope',
      'picture-in-picture',
      'web-share',
    ].filter(Boolean).join('; ')
    return `<iframe width="560" height="315" src="${embedUrl}" title="YouTube video player" frameborder="0" allow="${allowAttrs}" allowfullscreen></iframe>`
  }

  /** 生成直接視頻 HTML */
  const buildDirectVideoHtml = (): string => {
    if (!videoUrl.trim()) return ''
    const posterAttr = videoPoster.trim() ? ` poster="${videoPoster.trim()}"` : ''
    return `<video controls width="100%"${posterAttr}><source src="${videoUrl.trim()}">您的瀏覽器不支援視頻播放。</video>`
  }

  /** 確認插入 */
  const handleConfirm = () => {
    let html = ''
    if (activeTab === 'youtube') {
      html = buildYouTubeHtml()
    } else {
      html = buildDirectVideoHtml()
    }
    if (html) {
      onInsert(html)
      // 重置狀態
      setYtUrl('')
      setParams({ ...DEFAULT_PARAMS })
      setVideoUrl('')
      setVideoPoster('')
      onClose()
    }
  }

  if (!open) return null

  const embedUrl = buildEmbedUrl()
  const canInsert = activeTab === 'youtube' ? !!embedUrl : !!videoUrl.trim()

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頭部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">🎥 插入視頻</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
            title="關閉"
          >
            <span className="text-base">❌</span>
          </button>
        </div>

        {/* Tab 導航 */}
        <div className="flex border-b">
          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'youtube'
                ? 'border-b-2 border-primary text-primary bg-primary/5'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
            }`}
          >
            📺 YouTube 嵌入
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('direct')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'direct'
                ? 'border-b-2 border-primary text-primary bg-primary/5'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
            }`}
          >
            🔗 視頻連結
          </button>
        </div>

        {/* 內容區 */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'youtube' ? (
            <div className="space-y-4">
              {/* URL 輸入 */}
              <div>
                <label className="block text-sm font-medium mb-1.5">YouTube 連結</label>
                <input
                  type="text"
                  value={ytUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="貼上 YouTube 連結（支援 watch?v=、youtu.be/、embed/ 格式）"
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
                {ytUrl.trim() && !parsedYouTube && (
                  <p className="text-xs text-red-500 mt-1">⚠️ 無法識別此 YouTube 連結，請檢查格式</p>
                )}
                {parsedYouTube && (
                  <p className="text-xs text-green-600 mt-1">
                    ✅ 已識別影片 ID：{parsedYouTube.videoId}
                    {parsedYouTube.startTime ? `，起始時間：${parsedYouTube.startTime}s` : ''}
                  </p>
                )}
              </div>

              {/* 參數配置 */}
              <div className="space-y-3 bg-gray-50 rounded-md p-4">
                <p className="text-xs font-medium text-muted-foreground">播放參數</p>

                {/* 開關按鈕組 */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={params.autoplay}
                      onChange={(e) => setParams((p) => ({ ...p, autoplay: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">▶️ 自動播放</span>
                    {params.autoplay && !params.mute && (
                      <span className="text-[10px] text-amber-600">(將自動靜音)</span>
                    )}
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={params.mute}
                      onChange={(e) => setParams((p) => ({ ...p, mute: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">🔇 靜音播放</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={params.loop}
                      onChange={(e) => setParams((p) => ({ ...p, loop: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">🔁 循環播放</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={params.controls}
                      onChange={(e) => setParams((p) => ({ ...p, controls: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">🎛️ 顯示控制條</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={params.rel}
                      onChange={(e) => setParams((p) => ({ ...p, rel: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">📺 顯示相關影片</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={params.modestbranding}
                      onChange={(e) => setParams((p) => ({ ...p, modestbranding: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">🔒 隱私增強模式</span>
                  </label>
                </div>

                {/* 時間參數 */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                  <div>
                    <label className="block text-xs font-medium mb-1">起始時間（秒）</label>
                    <input
                      type="number"
                      min="0"
                      value={params.startTime}
                      onChange={(e) => setParams((p) => ({ ...p, startTime: e.target.value }))}
                      placeholder="如 30"
                      className="w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">結束時間（秒）</label>
                    <input
                      type="number"
                      min="0"
                      value={params.endTime}
                      onChange={(e) => setParams((p) => ({ ...p, endTime: e.target.value }))}
                      placeholder="如 120"
                      className="w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* 預覽 */}
              {embedUrl && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">預覽</label>
                  <div className="rounded-md overflow-hidden border bg-gray-50">
                    <div className="aspect-video">
                      <iframe
                        src={embedUrl}
                        title="預覽"
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 視頻 URL */}
              <div>
                <label className="block text-sm font-medium mb-1.5">視頻連結</label>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://example.com/video.mp4"
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  支援 MP4、WebM、Ogg 等格式。直接輸入視頻文件的完整 URL。
                </p>
              </div>

              {/* 封面圖（可選） */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  封面圖（可選）
                  <span className="ml-1 text-xs text-muted-foreground font-normal">影片載入前顯示的圖片</span>
                </label>
                <input
                  type="url"
                  value={videoPoster}
                  onChange={(e) => setVideoPoster(e.target.value)}
                  placeholder="https://example.com/poster.jpg"
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
              </div>

              {/* 預覽 */}
              {videoUrl.trim() && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">預覽</label>
                  <div className="rounded-md overflow-hidden border bg-gray-50">
                    <video
                      controls
                      poster={videoPoster.trim() || undefined}
                      className="w-full"
                    >
                      <source src={videoUrl.trim()} />
                      您的瀏覽器不支援視頻播放。
                    </video>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canInsert}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            插入視頻
          </button>
        </div>
      </div>
    </div>
  )
}
