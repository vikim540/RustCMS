import { useState } from 'react'

/**
 * FAQ Q&A 配對結構
 */
export interface FaqPair {
  id: string
  question: string
  answer: string
}

/**
 * 生成唯一 ID（用於 React key）
 */
function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

/**
 * HTML 轉義（防止 XSS，問題文字可能含特殊字符）
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成單個 FAQ 的 HTML（含 Google 微數據 microdata 屬性）
 *
 * 結構：
 * <details class="faq-item" itemprop="mainEntity" itemscope itemtype="https://schema.org/Question">
 *   <summary itemprop="name">問題</summary>
 *   <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
 *     <div itemprop="text">答案</div>
 *   </div>
 * </details>
 *
 * 問題：轉義 HTML（純文字展示）
 * 答案：不轉義（允許基本 HTML 標籤如 <strong>/<a>），後端 sanitizeHtml 會清理危險標籤
 *
 * 微數據參考：https://developers.google.com/search/docs/appearance/structured-data/faqpage
 */
function buildFaqItemHtml(pair: FaqPair): string {
  const q = escapeHtml(pair.question.trim())
  const a = pair.answer.trim()
  return `<details class="faq-item" itemprop="mainEntity" itemscope itemtype="https://schema.org/Question"><summary itemprop="name">${q}</summary><div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer"><div itemprop="text">${a}</div></div></details>`
}

/**
 * 生成整組 FAQ 的 HTML（含 FAQPage 微數據容器）
 *
 * 結構：
 * <div class="faq-group" itemscope itemtype="https://schema.org/FAQPage">
 *   <details class="faq-item" ...>...</details>
 *   <details class="faq-item" ...>...</details>
 * </div>
 *
 * 整組 FAQ 包裝在一個容器中，作為單一的 BlockEmbed 插入編輯器
 * 避免多個獨立 embed 之間產生空 <p><br/></p> 行
 */
export function buildFaqGroupHtml(pairs: FaqPair[]): string {
  const validPairs = pairs.filter((p) => p.question.trim() && p.answer.trim())
  if (validPairs.length === 0) return ''
  const itemsHtml = validPairs.map(buildFaqItemHtml).join('')
  return `<div class="faq-group" itemscope itemtype="https://schema.org/FAQPage">${itemsHtml}</div>`
}

/**
 * FAQ 插入面板 Modal（可複用組件）
 *
 * 用戶可添加多組問答配對，插入後在編輯器中生成
 * <div class="faq-group" itemscope itemtype="https://schema.org/FAQPage">
 *   <details class="faq-item" itemprop="mainEntity" itemscope itemtype="https://schema.org/Question">
 *     <summary itemprop="name">Q</summary>
 *     <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
 *       <div itemprop="text">A</div>
 *     </div>
 *   </details>
 * </div>
 *
 * 後端解析 class="faq-item" 生成 FAQPage JSON-LD（SEO 結構化數據）
 * 前端 Nuxt 直接讀取 HTML 中的 microdata 屬性（雙重 SEO 覆蓋）
 *
 * 用法：
 * ```tsx
 * <FaqPickerModal
 *   open={faqPickerOpen}
 *   onClose={() => setFaqPickerOpen(false)}
 *   onInsert={(html) => {
 *     quillRef.current?.clipboard.dangerouslyPasteHTML(range.index, html, 'user')
 *   }}
 * />
 * ```
 */
export default function FaqPickerModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  /** 插入完成後的回調，返回 HTML 字符串（整組 <div class="faq-group"> 塊） */
  onInsert: (html: string) => void
}) {
  const [pairs, setPairs] = useState<FaqPair[]>([
    { id: genId(), question: '', answer: '' },
  ])

  /** 新增一組問答 */
  const addPair = () => {
    setPairs((prev) => [...prev, { id: genId(), question: '', answer: '' }])
  }

  /** 移除指定問答 */
  const removePair = (id: string) => {
    setPairs((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev))
  }

  /** 更新問題 */
  const updateQuestion = (id: string, value: string) => {
    setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, question: value } : p)))
  }

  /** 更新答案 */
  const updateAnswer = (id: string, value: string) => {
    setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, answer: value } : p)))
  }

  /** 確認插入 */
  const handleConfirm = () => {
    const html = buildFaqGroupHtml(pairs)
    if (!html) return
    onInsert(html)

    // 重置狀態
    setPairs([{ id: genId(), question: '', answer: '' }])
    onClose()
  }

  if (!open) return null

  const validPairs = pairs.filter((p) => p.question.trim() && p.answer.trim())

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
          <div>
            <h2 className="text-lg font-semibold">❓ 插入 FAQ 問答</h2>
            <p className="text-xs text-gray-500 mt-1">
              生成 <code className="bg-gray-100 px-1 rounded">&lt;details&gt;</code> 標籤，含 Google 微數據（microdata）+ JSON-LD 雙重結構化數據（SEO）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {/* 內容區 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {pairs.map((pair, index) => (
            <div key={pair.id} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
              {/* 問答標題 + 刪除按鈕 */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  問答 #{index + 1}
                </span>
                {pairs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePair(pair.id)}
                    className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded"
                  >
                    🗑️ 刪除
                  </button>
                )}
              </div>

              {/* 問題 */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  問題 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pair.question}
                  onChange={(e) => updateQuestion(pair.id, e.target.value)}
                  placeholder="例如：這項服務適合什麼人群？"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* 答案 */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  答案 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={pair.answer}
                  onChange={(e) => updateAnswer(pair.id, e.target.value)}
                  placeholder="輸入答案內容（支援純文字，也可輸入基本 HTML 標籤如 <strong>、<a> 等）"
                  rows={3}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                />
              </div>

              {/* 預覽 */}
              {pair.question.trim() && pair.answer.trim() && (
                <div className="border border-blue-100 bg-blue-50 rounded p-3">
                  <p className="text-xs text-blue-600 mb-2">📋 預覽</p>
                  <details className="faq-item border border-gray-200 rounded p-2 bg-white">
                    <summary className="cursor-pointer font-medium text-sm text-gray-800">
                      {pair.question}
                    </summary>
                    <div className="mt-2 text-sm text-gray-600 leading-relaxed">
                      {pair.answer}
                    </div>
                  </details>
                </div>
              )}
            </div>
          ))}

          {/* 新增問答按鈕 */}
          <button
            type="button"
            onClick={addPair}
            className="w-full border-2 border-dashed border-gray-300 rounded-lg py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            ➕ 新增一組問答
          </button>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <span className="text-xs text-gray-500">
            {validPairs.length > 0
              ? `✅ ${validPairs.length} 組有效問答將作為一組插入`
              : '請填寫問題和答案'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={validPairs.length === 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              插入 FAQ
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
