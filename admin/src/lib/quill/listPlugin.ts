/**
 * Quill 有序列表樣式插件
 *
 * 功能：有序列表懸掛縮進，序號在外、標題和描述左對齊
 *
 * v1.9.7 新增：顯式註冊 softBreak 鍵盤綁定確保 Shift+Enter 在有序列表內插入軟換行
 * 實現「標題+縮進內容」排版、懸掛縮進 CSS 確保續行與首行文字對齊
 *
 * 依賴：Quill（需先載入 window.Quill）
 * 可移植性： CSS 可直接用於任何編輯器輸出的有序列表
 */

/** 有序列表懸掛縮進 CSS */
export const listPluginCSS = `
  /* 有序列表懸掛縮進：序號在外，標題和描述左對齊嚴絲合縫 */
  .ql-editor ol { padding-left: 2.5em; list-style-position: outside; }
  .ql-editor ol li { padding-left: 0.5em; }
  .ql-editor ol li::marker { font-weight: bold; }
`

/**
 * 註冊 softBreak 鍵盤綁定（Shift+Enter 在有序列表內插入軟換行）
 * 確保「標題+縮進內容」排版可用
 */
export function registerListPlugin(): void {
  const w = window as unknown as { Quill?: {
    import: (path: string) => unknown
  } }
  if (!w.Quill) return

  // 獲取鍵盤模組並註冊 softBreak
  const keyboard = w.Quill.import('modules/keyboard') as unknown as {
    DEFAULTS: Record<string, unknown>
  }
  if (keyboard?.DEFAULTS) {
    keyboard.DEFAULTS.softBreak = {
      key: 'Enter',
      shiftKey: true,
      handler(this: unknown, range: { index: number; length: number }): void {
        const quill = (this as unknown as { quill: {
          insertText: (index: number, text: string, source?: string) => void
        } }).quill
        quill.insertText(range.index, '\n', 'user')
      },
    }
  }
}
