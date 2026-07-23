/**
 * Quill FAQ 群組插件
 *
 * 功能：在 Quill 編輯器中插入 FAQ 問答群組，生成帶 Google 微數據（microdata）的 HTML
 *
 * 生成的 HTML 結構：
 * <div class="faq-group" itemscope itemtype="https://schema.org/FAQPage">
 *   <details class="faq-item" itemprop="mainEntity" itemscope itemtype="https://schema.org/Question">
 *     <summary itemprop="name">問題文字</summary>
 *     <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
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
    static className = 'faq-group'

    static create(value: FaqGroupValue): HTMLElement {
      const node = document.createElement('div')
      node.setAttribute('class', 'faq-group')
      node.setAttribute('itemscope', '')
      node.setAttribute('itemtype', 'https://schema.org/FAQPage')

      const items = value?.items || []
      for (const item of items) {
        const details = document.createElement('details')
        details.setAttribute('class', 'faq-item')
        details.setAttribute('itemprop', 'mainEntity')
        details.setAttribute('itemscope', '')
        details.setAttribute('itemtype', 'https://schema.org/Question')

        const summary = document.createElement('summary')
        summary.setAttribute('itemprop', 'name')
        summary.textContent = item.question || ''

        const answerWrap = document.createElement('div')
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
        const summary = details.querySelector('summary')
        const answerText = details.querySelector('[itemprop="text"]')
        const answerDiv = answerText || details.querySelector('div')
        items.push({
          question: summary ? summary.textContent || '' : '',
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
 * 處理 <div class="faq-group">（新格式）和獨立 <details class="faq-item">（舊格式向後兼容）
 *
 * @param el 剪貼簿 DOM 元素
 * @returns Delta ops 數組，或 null 表示不匹配
 */
export function matchFaqElement(el: HTMLElement): unknown[] | null {
  const w = window as unknown as { Quill?: { import: (path: string) => unknown } }
  if (!w.Quill) return null

  // FAQ 群組容器（新格式）— 整組作為單一 embed
  if (el.tagName === 'DIV' && el.classList.contains('faq-group')) {
    const items: FaqItemData[] = []
    el.querySelectorAll('details.faq-item').forEach((details) => {
      const summary = details.querySelector('summary')
      const answerText = details.querySelector('[itemprop="text"]')
      const answerDiv = answerText || details.querySelector('div')
      items.push({
        question: summary ? summary.textContent || '' : '',
        answer: answerDiv ? answerDiv.innerHTML : '',
      })
    })
    if (items.length > 0) {
      return [{ insert: { 'faq-group-block': { items } } }, { insert: '\n' }]
    }
  }

  // 獨立 FAQ 項目（舊格式向後兼容）— 包裝為單項群組
  if (el.tagName === 'DETAILS' && el.classList.contains('faq-item')) {
    const summary = el.querySelector('summary')
    const answerText = el.querySelector('[itemprop="text"]')
    const answerDiv = answerText || el.querySelector('div')
    return [
      { insert: { 'faq-group-block': {
        items: [{
          question: summary ? summary.textContent || '' : '',
          answer: answerDiv ? answerDiv.innerHTML : '',
        }],
      } } },
      { insert: '\n' },
    ]
  }

  return null
}

/** FAQ 群組 + 項目的編輯器內 CSS 樣式 */
export const faqPluginCSS = `
  /* FAQ 群組容器樣式（編輯器內） */
  .ql-editor .faq-group {
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
  .ql-editor details.faq-item > summary {
    cursor: pointer;
    font-weight: 600;
    color: #1f2937;
    list-style: none;
  }
  .ql-editor details.faq-item > summary::-webkit-details-marker { display: none; }
  .ql-editor details.faq-item > summary::before {
    content: "▶";
    display: inline-block;
    margin-right: 6px;
    font-size: 10px;
    transition: transform 0.2s;
  }
  .ql-editor details.faq-item[open] > summary::before { transform: rotate(90deg); }
  .ql-editor details.faq-item[open] > summary { margin-bottom: 8px; }
  .ql-editor details.faq-item > div {
    font-size: 14px;
    line-height: 1.6;
    color: #4b5563;
  }
`
