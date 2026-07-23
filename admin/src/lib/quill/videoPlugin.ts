/**
 * Quill 視頻插件
 *
 * 功能：覆蓋 Quill 內建 video blot，保留 iframe 完整屬性
 *
 * Quill 內建 video blot 僅保留 src 屬性，丟失 title/allow/referrerpolicy 等
 * 本插件擴展為接受 string（URL）或 object（含所有屬性）兩種值
 * clipboard matcher 將 <iframe> 轉為帶完整屬性的 video embed
 *
 * 依賴：Quill（需先載入 window.Quill）
 * 可移植性： blot 邏輯可參考移植到 TipTap/ProseMirror 等編輯器
 */

/** 視頻 embed 值（含完整 iframe 屬性） */
export interface VideoEmbedValue {
  src: string
  title?: string
  allow?: string
  referrerpolicy?: string
  width?: string
  height?: string
}

/**
 * 註冊自定義 video blot（覆蓋內建）
 * 必須在 Quill 實例創建後、內容載入前調用
 */
export function registerVideoPlugin(): void {
  const w = window as unknown as { Quill?: {
    import: (path: string) => unknown
    register: (blot: unknown, override?: boolean) => void
  } }
  if (!w.Quill) return

  const VideoBlot = w.Quill.import('formats/video') as unknown as {
    new (): { domNode: HTMLElement }
    blotName: string
    tagName: string
    className: string
  }

  class CustomVideoBlot extends VideoBlot {
    static blotName = 'video'

    static create(value: string | VideoEmbedValue): HTMLElement {
      const src = typeof value === 'string' ? value : value.src
      const node = document.createElement('iframe')
      node.setAttribute('class', 'ql-video')
      node.setAttribute('frameborder', '0')
      node.setAttribute('allowfullscreen', 'true')
      node.setAttribute('src', src)

      // 保留額外屬性（僅 object 值時）
      if (typeof value !== 'string') {
        if (value.title) node.setAttribute('title', value.title)
        if (value.allow) node.setAttribute('allow', value.allow)
        if (value.referrerpolicy) node.setAttribute('referrerpolicy', value.referrerpolicy)
        if (value.width) node.setAttribute('width', value.width)
        if (value.height) node.setAttribute('height', value.height)
      }
      return node
    }

    static value(node: HTMLElement): string | VideoEmbedValue {
      const src = node.getAttribute('src') || ''
      const title = node.getAttribute('title')
      const allow = node.getAttribute('allow')
      const referrerpolicy = node.getAttribute('referrerpolicy')
      const width = node.getAttribute('width')
      const height = node.getAttribute('height')

      // 有額外屬性時返回 object，否則返回 string（向後兼容）
      if (title || allow || referrerpolicy || width || height) {
        return { src, title, allow, referrerpolicy, width, height }
      }
      return src
    }
  }

  w.Quill.register(CustomVideoBlot, true)
}

/**
 * 視頻 iframe clipboard matcher 處理函數
 * 將 <iframe> 元素轉為帶完整屬性的 video embed
 *
 * @param el 剪貼簿 DOM 元素
 * @returns Delta ops 數組，或 null 表示不匹配
 */
export function matchVideoIframe(el: HTMLElement): unknown[] | null {
  if (el.tagName !== 'IFRAME') return null

  const src = el.getAttribute('src') || ''
  if (!src) return null

  return [
    { insert: { video: {
      src,
      title: el.getAttribute('title') || undefined,
      allow: el.getAttribute('allow') || undefined,
      referrerpolicy: el.getAttribute('referrerpolicy') || undefined,
      width: el.getAttribute('width') || undefined,
      height: el.getAttribute('height') || undefined,
    } } },
    { insert: '\n' },
  ]
}
