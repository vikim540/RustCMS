/**
 * Quill FAQ 群組插件
 *
 * 功能：在 Quill 編輯器中插入 FAQ 問答群組，生成帶 Google 微數據（microdata）的 HTML
 *
 * 生成的 HTML 結構（與 Nuxt 前端 CSS 完全匹配）：
 * <div class="faq" itemscope itemtype="https://schema.org/FAQPage">
 *   <details class="faq-item" itemprop="mainEntity" itemscope itemtype="https://schema.org/Question">
 *     <summary class="faq-question">
 *       <h3 class="faq-title" itemprop="name">問題文字</h3>
 *     </summary>
 *     <div class="faq-answer" itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
 *       <div itemprop="text">答案 HTML</div>
 *     </div>
 *   </details>
 * </div>
 *
 * 特性：
 * - 整組 FAQ 作為單一 BlockEmbed，避免多個 embed 之間產生空 <p><br/></p>
 * - 含 microdata 屬性，前端 Nuxt 可直接讀取做 SEO（無需 JS 解析）
 * - 後端 extractFaqJson() 另外生成 JSON-LD（雙重 SEO 覆蓋）
 * - clipboard matcher 向後兼容舊格式（獨立 <details class="faq-item">）
 *
 * 依賴：Quill（需先載入 window.Quill）
 * 可移植性： blot 邏輯可參考移植到 TipTap/ProseMirror 等編輯器
 */

/** FAQ 單項數據結構 */
export interface FaqItemData {
  question: string
  answer: string
}

/** FAQ 群組 embed 值 */
export interface FaqGroupValue {
  items: FaqItemData[]
}

/**
 * 註冊 FAQ 群組 BlockEmbed blot + clipboard matcher
 * 必須在 Quill 實例創建後、內容載入前調用
 */
export function registerFaqPlugin(): void {
  const w = window as unknown as { Quill?: {
    import: (path: string) => unknown
    register: (blot: unknown, override?: boolean) => void
  } }
  if (!w.Quill) return

  const BlockEmbed = w.Quill.import('blots/block/embed') as unknown as {
    new (): { domNode: HTMLElement }
    blotName: string
    tagName: string
    className: string
  }

  class FaqGroupBlock extends BlockEmbed {
    static blotName = 'faq-group-block'
    static tagName = 'DIV'
    static className = 'faq'

    static create(value: FaqGroupValue): HTMLElement {
      const node = document.createElement('div')
      node.setAttribute('class', 'faq')
      node.setAttribute('itemscope', '')
      node.setAttribute('itemtype', 'https://schema.org/FAQPage')

      const items = value?.items || []
      for (const item of items) {
        const details = document.createElement('details')
        details.setAttribute('class', 'faq-item')
        details.setAttribute('itemprop', 'mainEntity')
        details.setAttribute('itemscope', '')
        details.setAttribute('itemtype', 'https://schema.org/Question')

        // summary > h3.faq-title (itemprop="name")
        const summary = document.createElement('summary')
        summary.setAttribute('class', 'faq-question')

        const title = document.createElement('h3')
        title.setAttribute('class', 'faq-title')
        title.setAttribute('itemprop', 'name')
        title.textContent = item.question || ''

        summary.appendChild(title)

        // div.faq-answer (itemprop="acceptedAnswer") > div (itemprop="text")
        const answerWrap = document.createElement('div')
        answerWrap.setAttribute('class', 'faq-answer')
        answerWrap.setAttribute('itemprop', 'acceptedAnswer')
        answerWrap.setAttribute('itemscope', '')
        answerWrap.setAttribute('itemtype', 'https://schema.org/Answer')

        const answerText = document.createElement('div')
        answerText.setAttribute('itemprop', 'text')
        answerText.innerHTML = item.answer || ''

        answerWrap.appendChild(answerText)
        details.appendChild(summary)
        details.appendChild(answerWrap)
        node.appendChild(details)
      }
      return node
    }

    static value(node: HTMLElement): FaqGroupValue {
      const items: FaqItemData[] = []
      const detailsList = node.querySelectorAll('details.faq-item')
      detailsList.forEach((details) => {
        // 優先取 h3.faq-title，否則取 summary 的文字內容（向後兼容舊格式）
        const titleEl = details.querySelector('h3.faq-title')
        const summary = details.querySelector('summary')
        // 優先取 itemprop="text" 的內容，否則取 .faq-answer 內容（向後兼容）
        const answerText = details.querySelector('[itemprop="text"]')
        const answerDiv = answerText || details.querySelector('.faq-answer') || details.querySelector('div')
        items.push({
          question: titleEl ? titleEl.textContent || '' : (summary ? summary.textContent || '' : ''),
          answer: answerDiv ? answerDiv.innerHTML : '',
        })
      })
      return { items }
    }
  }

  w.Quill.register(FaqGroupBlock, true)
}

/**
 * FAQ clipboard matcher 處理函數
 * 處理 <div class="faq">（新格式）/ <div class="faq-group">（舊格式）和獨立 <details class="faq-item">（向後兼容）
 *
 * @param el 剪貼簿 DOM 元素
 * @returns Delta ops 數組，或 null 表示不匹配
 */
export function matchFaqElement(el: HTMLElement): unknown[] | null {
  const w = window as unknown as { Quill?: { import: (path: string) => unknown } }
  if (!w.Quill) return null

  /** 從 details.faq-item 提取問答數據（新舊格式通用） */
  const extractItems = (container: Element): FaqItemData[] => {
    const items: FaqItemData[] = []
    container.querySelectorAll('details.faq-item').forEach((details) => {
      // 問題：優先取 h3.faq-title，否則取 summary 文字（舊格式兼容）
      const titleEl = details.querySelector('h3.faq-title')
      const summary = details.querySelector('summary')
      // 答案：優先取 itemprop="text"，否則取 .faq-answer 或普通 div（舊格式兼容）
      const answerText = details.querySelector('[itemprop="text"]')
      const answerDiv = answerText || details.querySelector('.faq-answer') || details.querySelector('div')
      items.push({
        question: titleEl ? titleEl.textContent || '' : (summary ? summary.textContent || '' : ''),
        answer: answerDiv ? answerDiv.innerHTML : '',
      })
    })
    return items
  }

  // FAQ 群組容器（新格式 .faq + 舊格式 .faq-group）— 整組作為單一 embed
  if (el.tagName === 'DIV' && (el.classList.contains('faq') || el.classList.contains('faq-group'))) {
    const items = extractItems(el)
    if (items.length > 0) {
      return [{ insert: { 'faq-group-block': { items } } }, { insert: '\n' }]
    }
  }

  // 獨立 FAQ 項目（舊格式向後兼容）— 包裝為單項群組
  if (el.tagName === 'DETAILS' && el.classList.contains('faq-item')) {
    const items = extractItems(el)
    if (items.length > 0) {
      return [{ insert: { 'faq-group-block': { items } } }, { insert: '\n' }]
    }
  }

  return null
}

/** FAQ 群組 + 項目的編輯器內 CSS 樣式 */
export const faqPluginCSS = `
  /* FAQ 群組容器樣式（編輯器內，與 Nuxt 前端 .faq class 一致） */
  .ql-editor .faq {
    border: 2px dashed #d1d5db;
    border-radius: 10px;
    padding: 8px 12px;
    margin: 12px 0;
    background: #f9fafb;
  }
  .ql-editor details.faq-item {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 16px;
    margin: 8px 0;
    background: #ffffff;
  }
  .ql-editor details.faq-item > summary.faq-question {
    cursor: pointer;
    list-style: none;
  }
  .ql-editor details.faq-item > summary.faq-question::-webkit-details-marker { display: none; }
  .ql-editor details.faq-item > summary.faq-question::before {
    content: "▶";
    display: inline-block;
    margin-right: 6px;
    font-size: 10px;
    transition: transform 0.2s;
  }
  .ql-editor details.faq-item[open] > summary.faq-question::before { transform: rotate(90deg); }
  .ql-editor details.faq-item[open] > summary.faq-question { margin-bottom: 8px; }
  .ql-editor details.faq-item .faq-title {
    display: inline;
    font-weight: 600;
    font-size: 1em;
    color: #1f2937;
    margin: 0;
  }
  .ql-editor details.faq-item .faq-answer {
    font-size: 14px;
    line-height: 1.6;
    color: #4b5563;
  }
`
