import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

/** 統計數據結構 */
interface Stats {
  contentTotal: number
  sortTotal: number
  visitsTotal: number
  todayNew: number
}

/** 當前激活的分頁 */
type TabKey = 'overview' | 'versions' | 'api' | 'system'

/** 版本更新條目 */
interface VersionEntry {
  version: string
  date: string
  changes: string
  icon: string
  /** 是否為最新版本 */
  latest?: boolean
}

/** API 接口條目 */
interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  desc: string
  auth: boolean
}

/** 分頁定義 */
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: '概覽', icon: '📊' },
  { key: 'versions', label: '版本更新', icon: '🚀' },
  { key: 'api', label: 'API 開發手冊', icon: '📡' },
  { key: 'system', label: '系統信息', icon: '⚙️' },
]

/** 版本更新歷史（硬編碼） */
const VERSIONS: VersionEntry[] = [
  {
    version: 'v0.6.0',
    date: '2026-07-17',
    icon: '🎨',
    latest: true,
    changes: '系統設置分區塊獨立保存（無需整頁刷新）；角色權限改為菜單樹驅動（與菜單管理聯動）；用戶管理增加權限預覽（所選角色合併權限）；菜單管理顯示 mcode 權限鍵並修正 scode→mcode 字段；三頁面增加三者關係說明卡片',
  },
  {
    version: 'v0.5.0',
    date: '2026-07-17',
    icon: '🏗️',
    changes: '功能開關標準化架構：FLAG_REGISTRY 註冊表驅動；autoRouteProtection API 攔截中間件；FeatureFlagProvider + FeatureGate 組件化前端控制；後端關閉功能時 API 返回 404',
  },
  {
    version: 'v0.4.0',
    date: '2026-07-17',
    icon: '🚩',
    changes: 'Flagship 功能開關整合到系統設置頁面；混合模式（Flagship + D1 回退）支持本地切換；關閉郵件/Webhook 開關後自動隱藏後台對應配置區域',
  },
  {
    version: 'v0.3.0',
    date: '2026-07-17',
    icon: '🏗️',
    changes: '架構升級：Queues 定時發布、Vectorize 語義搜索（768維 bge-base-zh-v1.5）、Rate Limiting 速率限制（4組綁定）、KV API 響應緩存、Service Bindings 內部通信、Flagship 功能開關、Cron 每 15 分鐘掃描待發布文章',
  },
  {
    version: 'v0.2.1',
    date: '2026-07-17',
    icon: '🐛',
    changes: '移除 CF Email Service（需 Workers Paid），改用 MailChannels/Resend 免費方案；清理 D1 重複數據（43 條配置 + 1 個管理員 + 25 個菜單）；創建 Vectorize 索引 article-semantic-search',
  },
  {
    version: 'v0.2.0',
    date: '2026-07-17',
    icon: '✨',
    changes: '郵件服務改用 Cloudflare Email Service Workers API；修復 Webhook 異步通知生命週期；側邊欄模型子菜單去重',
  },
  {
    version: 'v0.1.2',
    date: '2026-07-17',
    icon: '✨',
    changes: '內容按模型分類管理；圖片上傳支持外鏈；API CORS 動態域名校驗；通知服務（Webhook + 郵件）',
  },
  {
    version: 'v0.1.1',
    date: '2026-07-16',
    icon: '🐛',
    changes: '修復 D1 遷移字段缺失問題；前端 Pages 部署優化',
  },
  {
    version: 'v0.1.0',
    date: '2026-07-16',
    icon: '🎉',
    changes: '項目初始版本，基於 PbootCMS 3.2.12 數據庫結構的 TypeScript + Hono CMS',
  },
]

/** API 接口列表 */
const API_ENDPOINTS: ApiEndpoint[] = [
  // 認證
  { method: 'POST', path: '/api/v1/auth/login', desc: '登錄 (5次/分/IP)', auth: false },
  { method: 'GET', path: '/api/v1/auth/profile', desc: '個人信息', auth: true },
  // 公開接口 (60次/分/IP)
  { method: 'GET', path: '/api/v1/site', desc: '站點信息', auth: false },
  { method: 'GET', path: '/api/v1/sorts', desc: '欄目樹', auth: false },
  { method: 'GET', path: '/api/v1/contents', desc: '內容列表 (?scode=&page=&pagesize=)', auth: false },
  { method: 'GET', path: '/api/v1/contents/:id', desc: '內容詳情', auth: false },
  { method: 'GET', path: '/api/v1/search', desc: '語義搜索 (?q=關鍵詞&topK=10&threshold=0.7)', auth: false },
  { method: 'POST', path: '/api/v1/messages', desc: '提交留言 (1次/10秒/IP)', auth: false },
  // 管理接口 (300次/分/用戶)
  { method: 'GET', path: '/api/v1/admin/contents', desc: '後台內容列表 (?mcode=&page=)', auth: true },
  { method: 'POST', path: '/api/v1/admin/contents', desc: '新建內容', auth: true },
  { method: 'PUT', path: '/api/v1/admin/contents/:id', desc: '更新內容', auth: true },
  { method: 'GET', path: '/api/v1/admin/models/all', desc: '所有模型', auth: true },
  { method: 'GET', path: '/api/v1/admin/sorts', desc: '欄目樹 (?mcode=)', auth: true },
  { method: 'GET', path: '/api/v1/admin/media', desc: '媒體列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/upload', desc: '文件上傳 (multipart/form-data)', auth: true },
  { method: 'GET', path: '/api/v1/admin/configs', desc: '系統配置', auth: true },
  { method: 'PUT', path: '/api/v1/admin/configs', desc: '更新配置', auth: true },
  { method: 'GET', path: '/api/v1/admin/flags', desc: '查詢功能開關狀態', auth: true },
  { method: 'PUT', path: '/api/v1/admin/flags', desc: '切換功能開關 (D1回退模式)', auth: true },
  { method: 'GET', path: '/api/v1/admin/scheduler/list', desc: '定時發布列表', auth: true },
  { method: 'POST', path: '/api/v1/admin/scheduler/schedule', desc: '設定文章發布時間', auth: true },
  { method: 'POST', path: '/api/v1/admin/vectorize/reindex', desc: '重建向量索引', auth: true },
  { method: 'POST', path: '/api/v1/admin/notify/test-mail', desc: '測試郵件發送', auth: true },
  { method: 'POST', path: '/api/v1/admin/notify/test-webhook', desc: '測試 Webhook 推送', auth: true },
]

/** 錯誤碼對照 */
const ERROR_CODES: { code: number; desc: string; color: string }[] = [
  { code: 0, desc: '成功', color: 'green' },
  { code: 1001, desc: '參數錯誤', color: 'yellow' },
  { code: 1004, desc: '未找到', color: 'yellow' },
  { code: 1005, desc: '操作失敗', color: 'orange' },
  { code: 2002, desc: '未授權', color: 'red' },
  { code: 2003, desc: 'Token 已過期', color: 'red' },
  { code: 2004, desc: 'Token 已登出', color: 'red' },
  { code: 4290, desc: '請求過於頻繁 (Rate Limited)', color: 'red' },
]

/** HTTP 方法對應的樣式 */
function methodStyle(method: ApiEndpoint['method']): string {
  switch (method) {
    case 'GET':
      return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'POST':
      return 'bg-green-100 text-green-700 border-green-200'
    case 'PUT':
      return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'DELETE':
      return 'bg-red-100 text-red-700 border-red-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

/** 錯誤碼對應顏色樣式 */
function errorCodeStyle(color: string): string {
  switch (color) {
    case 'green':
      return 'bg-green-100 text-green-700'
    case 'yellow':
      return 'bg-yellow-100 text-yellow-700'
    case 'orange':
      return 'bg-orange-100 text-orange-700'
    case 'red':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [stats, setStats] = useState<Stats>({
    contentTotal: 0,
    sortTotal: 0,
    visitsTotal: 0,
    todayNew: 0,
  })

  useEffect(() => {
    api
      .get<Stats>('/admin/stats')
      .then((res) => {
        const d = res.data as Partial<Stats> | undefined
        setStats({
          contentTotal: d?.contentTotal ?? 0,
          sortTotal: d?.sortTotal ?? 0,
          visitsTotal: d?.visitsTotal ?? 0,
          todayNew: d?.todayNew ?? 0,
        })
      })
      .catch(() => {})
  }, [])

  /** 統計卡片配置 */
  const statCards = [
    {
      label: '內容總數',
      value: stats.contentTotal,
      icon: '📄',
      to: '/contents',
      gradient: 'from-blue-500 to-indigo-600',
    },
    {
      label: '欄目數量',
      value: stats.sortTotal,
      icon: '🗂️',
      to: '/categories',
      gradient: 'from-emerald-500 to-teal-600',
    },
    {
      label: '總訪問量',
      value: stats.visitsTotal,
      icon: '👁️',
      to: '/contents',
      gradient: 'from-purple-500 to-fuchsia-600',
    },
    {
      label: '今日新增',
      value: stats.todayNew,
      icon: '📈',
      to: '/contents',
      gradient: 'from-amber-500 to-orange-600',
    },
  ]

  /** 快速操作配置 */
  const quickActions = [
    { label: '新建內容', icon: '✏️', to: '/contents/new', desc: '創建新文章', color: 'hover:border-blue-400 hover:bg-blue-50' },
    { label: '新建欄目', icon: '📁', to: '/categories', desc: '管理內容欄目', color: 'hover:border-emerald-400 hover:bg-emerald-50' },
    { label: '媒體庫', icon: '🖼️', to: '/media', desc: '管理圖片文件', color: 'hover:border-purple-400 hover:bg-purple-50' },
    { label: '系統設置', icon: '⚙️', to: '/settings', desc: '配置系統參數', color: 'hover:border-amber-400 hover:bg-amber-50' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* 頁面頭部 - 漸層背景 */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🎛️</span>
          <div>
            <h1 className="text-2xl font-bold">儀表板</h1>
            <p className="text-sm text-slate-300 mt-1">
              RustCMS 管理後台 · 歡迎回來，在此管理您的網站內容
            </p>
          </div>
        </div>
      </div>

      {/* 分頁按鈕 */}
      <div className="flex flex-wrap gap-1 border-b border-border bg-white rounded-t-lg px-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 分頁內容 */}
      <div className="bg-white rounded-b-lg border border-t-0 border-border p-6">
        {/* ========== Tab 1: 概覽 ========== */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* 統計卡片 */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>📈</span>
                <span>數據統計</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((card) => (
                  <Link
                    key={card.label}
                    to={card.to}
                    className="group relative overflow-hidden rounded-xl border border-border bg-white p-5 transition-all hover:shadow-lg hover:-translate-y-0.5"
                  >
                    {/* 漸層頂部條 */}
                    <div
                      className={cn(
                        'absolute top-0 left-0 right-0 h-1 bg-gradient-to-r',
                        card.gradient,
                      )}
                    />
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-3xl">{card.icon}</span>
                      <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        查看詳情 →
                      </span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">
                      {card.value.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {card.label}
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            {/* 快速操作 */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>⚡</span>
                <span>快速操作</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    to={action.to}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border border-border bg-white p-4 transition-all',
                      action.color,
                    )}
                  >
                    <span className="text-3xl">{action.icon}</span>
                    <div>
                      <div className="font-medium text-foreground">
                        {action.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {action.desc}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ========== Tab 2: 版本更新 ========== */}
        {activeTab === 'versions' && (
          <div className="space-y-6">
            {/* 提示信息 */}
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              <span className="text-lg">📋</span>
              <span>最新版本更新將顯示在頂部</span>
            </div>

            {/* 版本時間線 */}
            <div className="relative">
              {/* 垂直線 */}
              <div className="absolute left-5 top-2 bottom-2 w-0.5 bg-gradient-to-b from-primary via-border to-transparent" />

              <ol className="space-y-6">
                {VERSIONS.map((v) => (
                  <li key={v.version} className="relative pl-14">
                    {/* 節點圓點 */}
                    <div
                      className={cn(
                        'absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-lg',
                        v.latest
                          ? 'border-primary shadow-md ring-4 ring-primary/10'
                          : 'border-border',
                      )}
                    >
                      {v.icon}
                    </div>

                    {/* 內容卡片 */}
                    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold',
                            v.latest
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground',
                          )}
                        >
                          {v.version}
                        </span>
                        {v.latest && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <span>🟢</span>
                            <span>最新</span>
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <span>📅</span>
                          <span>{v.date}</span>
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">
                        {v.changes}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* ========== Tab 3: API 開發手冊 ========== */}
        {activeTab === 'api' && (
          <div className="space-y-8">
            <div className="rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 p-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-indigo-900">
                <span>📚</span>
                <span>API 開發手冊</span>
              </h2>
              <p className="text-sm text-indigo-700 mt-1">
                本手冊面向前端開發者，提供完整的接口調用說明與示例代碼。
              </p>
            </div>

            {/* 1. 認證方式 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>🔑</span>
                <span>認證方式</span>
              </h3>
              <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                <p className="text-sm text-foreground leading-relaxed">
                  本系統使用 <strong className="font-semibold">JWT Bearer Token</strong>{' '}
                  進行身份認證。登錄接口返回 token 後，前端需將其存儲在{' '}
                  <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">
                    localStorage
                  </code>{' '}
                  中，並在後續請求的 Header 中攜帶。
                </p>
                <ul className="text-sm text-foreground space-y-1.5 list-disc list-inside">
                  <li>
                    登錄：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">POST /api/v1/auth/login</code>，請求體{' '}
                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{'{ username, password }'}</code>
                  </li>
                  <li>返回：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">{'{ token }'}</code></li>
                  <li>
                    存儲：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">localStorage.setItem('cms_token', token)</code>
                  </li>
                  <li>
                    請求頭：<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">Authorization: Bearer {'<token>'}</code>
                  </li>
                </ul>
              </div>
            </section>

            {/* 2. 基礎信息 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📡</span>
                <span>基礎信息</span>
              </h3>
              <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                <div className="text-sm text-foreground">
                  <strong className="font-semibold">Base URL：</strong>
                  通過 Pages Functions 同域代理，前綴為{' '}
                  <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">/api/v1</code>
                </div>
                <div className="text-sm text-foreground">
                  <strong className="font-semibold">統一響應格式：</strong>
                </div>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm">
                  <code>{`{
  "code": 0,
  "msg": "成功",
  "data": {},
  "meta": {
    "page": 1,
    "pagesize": 20,
    "total": 100
  }
}`}</code>
                </pre>
              </div>
            </section>

            {/* 3. 接口列表 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📋</span>
                <span>接口列表</span>
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-secondary-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">方法</th>
                      <th className="px-4 py-3 text-left font-semibold">路徑</th>
                      <th className="px-4 py-3 text-left font-semibold">說明</th>
                      <th className="px-4 py-3 text-center font-semibold">認證</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {API_ENDPOINTS.map((ep) => (
                      <tr key={`${ep.method}-${ep.path}`} className="hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              'inline-block px-2 py-0.5 rounded text-xs font-bold border',
                              methodStyle(ep.method),
                            )}
                          >
                            {ep.method}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="text-xs font-mono text-foreground">{ep.path}</code>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{ep.desc}</td>
                        <td className="px-4 py-2.5 text-center">
                          {ep.auth ? (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <span>🔒</span>
                              <span>需認證</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700">
                              <span>🌐</span>
                              <span>公開</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. 快速開始 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>🚀</span>
                <span>快速開始</span>
              </h3>
              <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm">
                <code>{`// 登錄獲取 token
const res = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'xxx' })
})
const { data } = await res.json()
localStorage.setItem('cms_token', data.token)

// 調用需認證接口
const resp = await fetch('/api/v1/admin/contents?page=1', {
  headers: { Authorization: \`Bearer \${localStorage.getItem('cms_token')}\` }
})
const result = await resp.json()
console.log(result.data) // 內容列表

// 語義搜索（公開接口，無需認證）
const search = await fetch('/api/v1/search?q=保養眼睛&topK=10&threshold=0.7')
const { data: articles } = await search.json()
console.log(articles) // 相似文章列表`}</code>
              </pre>
            </section>

            {/* 5. 錯誤碼 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>⚠️</span>
                <span>錯誤碼</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ERROR_CODES.map((err) => (
                  <div
                    key={err.code}
                    className="flex items-center gap-3 rounded-lg border border-border bg-white p-3"
                  >
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[3rem] px-2.5 py-1 rounded text-sm font-bold font-mono',
                        errorCodeStyle(err.color),
                      )}
                    >
                      {err.code}
                    </span>
                    <span className="text-sm text-foreground">{err.desc}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ========== Tab 4: 系統信息 ========== */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            {/* 項目信息 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📦</span>
                <span>項目信息</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">📦</span>
                  <div>
                    <div className="text-xs text-muted-foreground">項目名稱</div>
                    <div className="font-semibold text-foreground mt-0.5">RustCMS</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">🔧</span>
                  <div>
                    <div className="text-xs text-muted-foreground">技術棧</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      TypeScript + Hono + Cloudflare Workers
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">🗄️</span>
                  <div>
                    <div className="text-xs text-muted-foreground">數據庫</div>
                    <div className="font-semibold text-foreground mt-0.5">Cloudflare D1</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
                  <span className="text-2xl">💾</span>
                  <div>
                    <div className="text-xs text-muted-foreground">存儲</div>
                    <div className="font-semibold text-foreground mt-0.5">R2 (S3 兼容)</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-4 sm:col-span-2">
                  <span className="text-2xl">🌐</span>
                  <div>
                    <div className="text-xs text-muted-foreground">前端</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      React 18 + Vite + Tailwind CSS
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Cloudflare 資源 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>☁️</span>
                <span>Cloudflare 資源</span>
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap w-32">
                        <span className="inline-flex items-center gap-2">
                          <span>⚙️</span>
                          <span>Worker</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">rust-cms</code>
                        <span className="text-muted-foreground mx-2">·</span>
                        <a
                          href="https://cms.vikim.eu.org"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          <span>cms.vikim.eu.org</span>
                          <span>🔗</span>
                        </a>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🗄️</span>
                          <span>D1 數據庫</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">rust-cms-db</code>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📄</span>
                          <span>Pages</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">cms-admin</code>
                        <span className="text-muted-foreground mx-2">·</span>
                        <a
                          href="https://rbootcms.cmer.eu.org"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          <span>rbootcms.cmer.eu.org</span>
                          <span>🔗</span>
                        </a>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📦</span>
                          <span>KV 命名空間</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">CONFIG_CACHE</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">TOKEN_BLACKLIST</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">API_CACHE</code>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>📬</span>
                          <span>Queues</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">publish-queue</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground">publish-dlq</code>
                        <span className="text-muted-foreground mx-2 text-xs">定時發布</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🧠</span>
                          <span>Vectorize</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">article-semantic-search</code>
                        <span className="text-muted-foreground mx-2 text-xs">768維 cosine · bge-base-zh-v1.5</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🛡️</span>
                          <span>Rate Limiting</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">PUBLIC 60/min</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">ADMIN 300/min</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">LOGIN 5/min</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">FORM 1/10s</code>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🔗</span>
                          <span>Service Binding</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground">cms-admin → rust-cms</code>
                        <span className="text-muted-foreground mx-2 text-xs">零延遲內部通信</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>🚩</span>
                          <span>Flagship</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-foreground text-xs">notify_mail_enabled</code>
                        <span className="text-muted-foreground mx-1">·</span>
                        <code className="font-mono text-foreground text-xs">notify_webhook_enabled</code>
                        <span className="text-muted-foreground mx-2 text-xs">D1 回退模式</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 性能預算 */}
            <section>
              <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                <span>📊</span>
                <span>性能預算</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">📦</span>
                    <span className="font-medium text-foreground">Worker 體積限制</span>
                  </div>
                  <div className="text-2xl font-bold text-indigo-700">3 MB</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    壓縮後 gzip 約 1 MB
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">⚡</span>
                    <span className="font-medium text-foreground">單請求 CPU 時間</span>
                  </div>
                  <div className="text-2xl font-bold text-orange-700">
                    10ms <span className="text-sm font-normal text-muted-foreground">免費</span>
                    <span className="mx-2 text-muted-foreground">/</span>
                    50ms <span className="text-sm font-normal text-muted-foreground">付費</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    建議單請求 CPU ≤ 5ms
                  </p>
                </div>
              </div>
            </section>

            {/* 數據庫零改動提示 */}
            <section>
              <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
                <span className="text-xl">🚫</span>
                <div>
                  <div className="font-semibold text-red-900">硬約束：數據庫零改動</div>
                  <p className="text-sm text-red-700 mt-1">
                    禁止修改、刪除、重命名 PbootCMS 原版任何表結構或字段，表前綴{' '}
                    <code className="px-1 py-0.5 bg-red-100 rounded text-xs font-mono">ay_</code>{' '}
                    不變。僅允許冪等操作（CREATE INDEX IF NOT EXISTS、INSERT ... WHERE NOT EXISTS）。
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
