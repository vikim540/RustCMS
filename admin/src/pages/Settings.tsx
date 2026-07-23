import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import { LoadingState, ErrorState } from '../components/StateDisplay'
import { cn } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { TagInput } from '../components/TagInput'

/** 配置項 */
interface Config {
  id: number
  name: string
  value: string
  type: string // "1" = 開關, "2" = 文字輸入
  sorting: number
  description: string
}

/** 配置分組定義（依 sorting 範圍劃分） */
interface ConfigGroup {
  min: number
  max: number
  title: string
  icon: string
  desc: string
}

const CONFIG_GROUPS: ConfigGroup[] = [
  { min: 20, max: 29, title: '留言表單', icon: '💬', desc: '留言與表單提交相關配置' },
  { min: 30, max: 39, title: '安全配置', icon: '🛡️', desc: 'API 安全、防護等設置' },
  { min: 40, max: 49, title: 'WebAPI', icon: '</>', desc: 'API 接口與跨域配置' },
  { min: 50, max: 59, title: '通知配置', icon: '🔔', desc: '郵件與 Webhook 通知開關' },
  { min: 60, max: 69, title: '搜索引擎驗證', icon: '🔍', desc: 'Google/Bing 搜索引擎站點驗證' },
  { min: 70, max: 79, title: 'S3 存儲配置', icon: '💾', desc: 'R2/S3 兼容存儲（默認鎖定，點擊解鎖後可修改）' },
  { min: 90, max: 99, title: '郵件服務', icon: '📧', desc: 'SMTP/MailChannels 發信配置' },
  { min: 210, max: 219, title: 'SEO 內鏈配置', icon: '🔗', desc: '文章關鍵詞自動替換為超連結' },
]

/** Tab 定義 */
const TABS = [
  { key: 'flags', label: '功能開關', icon: '🚩' },
  { key: 'basic', label: '基本配置', icon: '💬', groupMins: [20, 60, 210] },
  { key: 'security', label: '安全配置', icon: '🛡️', groupMins: [30] },
  { key: 'webapi', label: 'WebAPI', icon: '🔌', groupMins: [40] },
  { key: 'storage', label: '存儲配置', icon: '💾', groupMins: [70] },
  { key: 'notify', label: '通知配置', icon: '🔔', groupMins: [50, 90] },
] as const

/** Webhook 專屬配置項（通知 tab 中單獨一個 section 展示） */
const WEBHOOK_SECTION_CONFIGS = new Set([
  'webhook_url', 'webhook_message', 'webhook_form', 'webhook_comment', 'form_webhook_url',
])

/** 需要隱藏的配置項（手機版/水印/URL 相關，前後端分離架構不需要） */
const HIDDEN_CONFIGS = new Set([
  'open_wap', 'wap_domain', 'wap_site_dir',
  'watermark_open', 'watermark_text', 'watermark_text_font',
  'watermark_text_size', 'watermark_text_color', 'watermark_pic',
  'watermark_position',
  'url_rule_type', 'url_rule_content_path', 'url_index_404',
  'tpl_html_dir',
])

/** Webhook 相關配置項（webhook_enabled 關閉時隱藏） */
const WEBHOOK_CONFIGS = new Set([
  'webhook_url', 'webhook_message', 'webhook_form', 'webhook_comment',
])

/** 通知配置分組中的郵件相關配置項（mail_enabled 關閉時隱藏） */
const MAIL_IN_NOTIFY_CONFIGS = new Set([
  'message_send_mail', 'form_send_mail', 'comment_send_mail', 'message_send_to',
])

/** 多值配置項定義：使用 TagInput 標籤式輸入（回車添加、可刪除） */
const MULTI_VALUE_CONFIGS: Record<string, { stripProtocol?: boolean; placeholder?: string }> = {
  api_cors_origins: { stripProtocol: true, placeholder: '輸入域名後按 Enter，如 www.example.com' },
  ip_deny: { placeholder: '輸入 IP 或 IP 段後按 Enter，如 192.168.1.0/24' },
  ip_allow: { placeholder: '輸入 IP 或 IP 段後按 Enter，如 10.0.0.1' },
  message_send_to: { placeholder: '輸入郵箱後按 Enter，如 admin@example.com' },
}

/** 依 sorting 取得所屬分組 */
function getGroup(sorting: number): ConfigGroup | null {
  return (
    CONFIG_GROUPS.find((g) => sorting >= g.min && sorting <= g.max) ?? null
  )
}

export default function Settings() {
  const [configs, setConfigs] = useState<Config[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [savingSection, setSavingSection] = useState<number | null>(null)
  const [successMsg, setSuccessMsg] = useState('')
  const [testMailLoading, setTestMailLoading] = useState(false)
  const [testWebhookLoading, setTestWebhookLoading] = useState(false)
  const { flags, isEnabled, toggle: toggleFlag, refresh: refreshFlags } = useFeatureFlags()
  const [flagUpdating, setFlagUpdating] = useState<string | null>(null)

  // S3 存儲鎖定狀態（默認鎖定防誤觸）
  const [s3Unlocked, setS3Unlocked] = useState(false)
  // S3 存儲折疊狀態（默認折疊，很少改動）
  const [s3Collapsed, setS3Collapsed] = useState(true)
  // 搜索引擎推送折疊狀態（默認折疊，很少改動）
  const [seoCollapsed, setSeoCollapsed] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('flags')

  /** 拉取全部配置 */
  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Config[]>('/admin/configs')
      const data = Array.isArray(res.data) ? res.data : []
      data.sort((a, b) => a.sorting - b.sorting)
      setConfigs(data)
      setChanges({})
    } catch (err) {
      setError(err instanceof Error ? err.message : '加載失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  /** 切換功能開關 */
  const handleToggleFlag = async (flagKey: string, currentEnabled: boolean) => {
    setFlagUpdating(flagKey)
    setError('')
    setSuccessMsg('')
    try {
      await toggleFlag(flagKey, !currentEnabled)
      setSuccessMsg(!currentEnabled ? '功能已開啟' : '功能已關閉，相關配置已隱藏')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '開關切換失敗')
    } finally {
      setFlagUpdating(null)
    }
  }

  const mailEnabled = isEnabled('mail_enabled')
  const webhookEnabled = isEnabled('webhook_enabled')

  /** 取得某配置的當前顯示值（優先取本地變更） */
  const currentValue = (config: Config): string => {
    return config.name in changes ? changes[config.name] : config.value
  }

  /** 更新本地變更 */
  const updateValue = (name: string, value: string) => {
    setChanges((prev) => {
      const next = { ...prev }
      const original = configs.find((c) => c.name === name)?.value ?? ''
      if (value === original) {
        delete next[name]
      } else {
        next[name] = value
      }
      return next
    })
    setSuccessMsg('')
  }

  /** 切換開關配置 */
  const toggleSwitch = (config: Config) => {
    const current = currentValue(config)
    updateValue(config.name, current === '1' ? '0' : '1')
  }

  /** 取得分組內已修改的配置數量 */
  const getSectionChangedCount = (items: Config[]): number => {
    return items.filter((c) => c.name in changes).length
  }

  /** 分區塊保存（僅發送該分組的變更項） */
  const handleSaveSection = async (group: ConfigGroup, items: Config[]) => {
    const sectionNames = new Set(items.map((c) => c.name))
    const sectionChanges = Object.entries(changes).filter(([name]) => sectionNames.has(name))
    if (sectionChanges.length === 0) return

    setSavingSection(group.min)
    setError('')
    setSuccessMsg('')
    try {
      await api.put('/admin/configs', {
        configs: sectionChanges.map(([name, value]) => ({ name, value })),
      })
      // 更新本地 configs（無需重新拉取全部）
      setConfigs((prev) =>
        prev.map((c) =>
          sectionNames.has(c.name) && c.name in changes
            ? { ...c, value: changes[c.name] }
            : c,
        ),
      )
      // 清除該分組的變更記錄
      setChanges((prev) => {
        const next = { ...prev }
        sectionNames.forEach((name) => delete next[name])
        return next
      })
      setSuccessMsg(`「${group.title}」配置已保存`)
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSavingSection(null)
    }
  }

  /** 測試郵件發送 */
  const handleTestMail = async () => {
    const email = window.prompt('請輸入收件郵箱地址', '')
    if (!email) return
    setTestMailLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      await api.post('/admin/notify/test-mail', { to: email })
      setSuccessMsg(`測試郵件已發送至 ${email}`)
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '測試郵件發送失敗')
    } finally {
      setTestMailLoading(false)
    }
  }

  /** 測試 Webhook 推送 */
  const handleTestWebhook = async () => {
    setTestWebhookLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      await api.post('/admin/notify/test-webhook', { category: 'message' })
      setSuccessMsg('Webhook 測試推送已發送')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook 測試發送失敗')
    } finally {
      setTestWebhookLoading(false)
    }
  }

  /** 依分組切割配置 */
  const groupedConfigs = useMemo(() => {
    const groups: { group: ConfigGroup; items: Config[] }[] = []
    const others: Config[] = []

    for (const config of configs) {
      if (HIDDEN_CONFIGS.has(config.name)) continue
      // sorting 10-19 是站點信息，由單獨頁面管理
      if (config.sorting >= 10 && config.sorting <= 19) continue

      if (!mailEnabled) {
        if (config.sorting >= 90 && config.sorting <= 99) continue
        if (MAIL_IN_NOTIFY_CONFIGS.has(config.name)) continue
      }
      if (!webhookEnabled) {
        if (WEBHOOK_CONFIGS.has(config.name)) continue
      }

      const group = getGroup(config.sorting)
      if (group) {
        let bucket = groups.find((g) => g.group.min === group.min)
        if (!bucket) {
          bucket = { group, items: [] }
          groups.push(bucket)
        }
        bucket.items.push(config)
      } else {
        others.push(config)
      }
    }

    const visibleGroups = groups
      .filter((g) => g.items.length > 0)
      .sort((a, b) => a.group.min - b.group.min)
    return { groups: visibleGroups, others }
  }, [configs, mailEnabled, webhookEnabled])

  /** 渲染單個配置行 */
  const renderConfigRow = (config: Config, disabled = false) => {
    const isSwitch = config.type === '1'
    const val = currentValue(config)
    const isOn = val === '1'
    const hasChange = config.name in changes
    const multiValueOpts = MULTI_VALUE_CONFIGS[config.name]

    // 多值配置：全寬度佈局，標籤在上方，TagInput 在下方
    if (multiValueOpts) {
      const tags = val ? val.split(/[,，]/).map((v) => v.trim()).filter(Boolean) : []
      return (
        <div
          key={config.id}
          className={cn(
            'py-3 border-b last:border-b-0',
            hasChange && 'bg-amber-50/50 -mx-4 px-4',
            disabled && 'opacity-50 pointer-events-none',
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">{config.description || config.name}</span>
            {hasChange && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-800">
                已修改
              </span>
            )}
            {tags.length > 0 && (
              <span className="text-xs text-muted-foreground">({tags.length} 項)</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono block mb-2">{config.name}</span>
          <TagInput
            values={tags}
            onChange={(newTags) => updateValue(config.name, newTags.join(','))}
            placeholder={multiValueOpts.placeholder}
            stripProtocol={multiValueOpts.stripProtocol}
            disabled={disabled}
          />
        </div>
      )
    }

    return (
      <div
        key={config.id}
        className={cn(
          'flex items-center justify-between gap-4 py-3 border-b last:border-b-0',
          hasChange && 'bg-amber-50/50 -mx-4 px-4',
          disabled && 'opacity-50 pointer-events-none',
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{config.description || config.name}</span>
            {hasChange && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-800">
                已修改
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono">{config.name}</span>
        </div>
        <div className="shrink-0">
          {isSwitch ? (
            <button
              type="button"
              onClick={() => toggleSwitch(config)}
              disabled={disabled}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                isOn ? 'bg-primary' : 'bg-muted',
                disabled && 'cursor-not-allowed',
              )}
              aria-label={isOn ? '關閉' : '開啟'}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  isOn ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          ) : (
            <input
              type="text"
              value={val}
              onChange={(e) => updateValue(config.name, e.target.value)}
              disabled={disabled}
              className="w-64 px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:cursor-not-allowed"
              placeholder="請輸入配置值"
            />
          )}
        </div>
      </div>
    )
  }

  /** 渲染分組卡片（含獨立保存按鈕，S3/SEO 支持折疊與鎖定） */
  const renderSectionCard = (group: ConfigGroup, items: Config[], isOther = false) => {
    const changedCount = getSectionChangedCount(items)
    const isSaving = savingSection === group.min
    const displayGroup = isOther
      ? { ...group, title: '其他配置', icon: '⚙️', desc: '未歸類的配置項' }
      : group

    const isS3Group = displayGroup.min === 70
    const isSeoGroup = displayGroup.min === 60
    const isCollapsible = isS3Group || isSeoGroup
    const isCollapsed = isS3Group ? s3Collapsed : isSeoGroup ? seoCollapsed : false
    const isLocked = isS3Group && !s3Unlocked

    return (
      <div key={displayGroup.min} className="bg-white rounded-lg border overflow-hidden">
        {/* 卡片頭部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-gradient-to-r from-secondary/40 to-secondary/10">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {/* 折疊/展開按鈕（S3 和 SEO 分組） */}
            {isCollapsible && (
              <button
                onClick={() => isS3Group ? setS3Collapsed(!s3Collapsed) : setSeoCollapsed(!seoCollapsed)}
                className="text-sm hover:text-primary transition-colors shrink-0"
                aria-label={isCollapsed ? '展開' : '收起'}
              >
                {isCollapsed ? '➡️' : '⬇️'}
              </button>
            )}
            <span className="text-lg shrink-0">{displayGroup.icon}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{displayGroup.title}</h2>
                <span className="text-xs text-muted-foreground">({items.length} 項)</span>
                {isLocked && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-600">
                    🔒 已鎖定
                  </span>
                )}
                {changedCount > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-800">
                    {changedCount} 項待保存
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{displayGroup.desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* S3 解鎖/鎖定按鈕（敏感信息防誤觸） */}
            {isS3Group && (
              <button
                onClick={() => setS3Unlocked(!s3Unlocked)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all',
                  s3Unlocked
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-blue-600 text-white hover:bg-blue-700',
                )}
              >
                <span className="text-sm">{s3Unlocked ? '🔒' : '🔓'}</span>
                {s3Unlocked ? '鎖定' : '解鎖修改'}
              </button>
            )}
            {/* 獨立保存按鈕（S3 鎖定時隱藏） */}
            {(!isS3Group || s3Unlocked) && (
              <button
                onClick={() => handleSaveSection(displayGroup, items)}
                disabled={isSaving || changedCount === 0}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-md transition-all',
                  changedCount > 0
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed',
                )}
              >
                {isSaving ? (
                  <span className="animate-spin inline-block text-sm">🔄</span>
                ) : (
                  <span className="text-sm">💾</span>
                )}
                {isSaving ? '保存中...' : changedCount > 0 ? `保存 (${changedCount})` : '保存'}
              </button>
            )}
          </div>
        </div>
        {/* 配置項（折疊時隱藏） */}
        {!isCollapsed && (
          <>
            <div className="px-4">
              {items.map((config) => renderConfigRow(config, isLocked))}
            </div>
            {/* S3 鎖定提示 */}
            {isLocked && (
              <div className="px-4 py-2.5 bg-gray-50 text-center text-xs text-muted-foreground border-t">
                🔒 敏感信息已鎖定防誤觸，點擊「解鎖修改」按鈕進行編輯
              </div>
            )}
            {/* 通知配置分組：測試按鈕 */}
            {displayGroup.min === 50 && (mailEnabled || webhookEnabled) && (
              <div className="px-4 py-3 border-t flex flex-wrap items-center gap-2 bg-secondary/10">
                <span className="text-xs text-muted-foreground mr-1">通知測試：</span>
                {mailEnabled && (
                  <button
                    type="button"
                    onClick={handleTestMail}
                    disabled={testMailLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {testMailLoading ? (
                      <span className="animate-spin inline-block text-sm">🔄</span>
                    ) : (
                      <span className="text-sm">📤</span>
                    )}
                    測試郵件
                  </button>
                )}
                {webhookEnabled && (
                  <button
                    type="button"
                    onClick={handleTestWebhook}
                    disabled={testWebhookLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {testWebhookLoading ? (
                      <span className="animate-spin inline-block text-sm">🔄</span>
                    ) : (
                      <span className="text-sm">🪝</span>
                    )}
                    測試 Webhook
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const totalChanged = Object.keys(changes).length

  /** 取得當前 tab 應顯示的分組 */
  const visibleGroups = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab)
    if (!tab || !('groupMins' in tab)) return { groups: [] as { group: ConfigGroup; items: Config[] }[], others: [] as Config[] }
    const mins = tab.groupMins as readonly number[]
    const matched = groupedConfigs.groups.filter((g) => mins.includes(g.group.min))
    // "其他配置"只在"基本配置"tab 顯示，不在每個 tab 重複出現
    const others = activeTab === 'basic' ? groupedConfigs.others : []
    return { groups: matched, others }
  }, [activeTab, groupedConfigs])

  /** 通知 tab 中將 webhook 配置分離 */
  const splitNotifyGroups = useMemo(() => {
    if (activeTab !== 'notify') return null
    const result: { title: string; icon: string; desc: string; items: Config[]; isWebhook: boolean }[] = []
    for (const { group, items } of visibleGroups.groups) {
      const webhookItems = items.filter((c) => WEBHOOK_SECTION_CONFIGS.has(c.name))
      const normalItems = items.filter((c) => !WEBHOOK_SECTION_CONFIGS.has(c.name))
      if (normalItems.length > 0) {
        result.push({ title: group.title, icon: group.icon, desc: group.desc, items: normalItems, isWebhook: false })
      }
      if (webhookItems.length > 0) {
        result.push({ title: 'Webhook 推送', icon: '🪝', desc: 'Webhook 通知地址與開關（表單提交推送至客服群）', items: webhookItems, isWebhook: true })
      }
    }
    return result
  }, [activeTab, visibleGroups])

  if (loading) return (
    <div className="p-6">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
        <span className="text-xl">⚙️</span> 系統設置
      </h1>
      <LoadingState text="加載中..." />
    </div>
  )

  return (
    <div className="p-6 pb-8">
      {/* 頁頭 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            系統設置
          </h1>
          <p className="text-sm text-muted-foreground mt-1">管理網站各項系統配置參數，每個區塊可獨立保存</p>
        </div>
        {totalChanged > 0 && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-amber-700 bg-amber-100 px-3 py-1.5 rounded-md">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-300 text-amber-900 text-xs font-bold">
                {totalChanged}
              </span>
              項待保存
            </span>
            <button
              onClick={() => { setChanges({}); setSuccessMsg('') }}
              className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
            >
              全部放棄
            </button>
          </div>
        )}
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-md text-sm">
          <span className="shrink-0">⚠️</span>{error}
        </div>
      )}

      {/* 成功提示 */}
      {successMsg && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-md text-sm">
          <span className="shrink-0">✅</span>{successMsg}
        </div>
      )}

      {/* Tab 導航 */}
      <div className="flex items-center gap-1 mb-6 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 內容 */}
      {activeTab === 'flags' && (
        <>
          {/* 功能開關區域 */}
          {flags.length > 0 && (
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-indigo-100 bg-white/50">
                <span>🚩</span>
                <h2 className="font-semibold text-indigo-900">功能開關</h2>
                <span className="text-xs text-indigo-600">（後台直接管理，一鍵開關相關功能）</span>
              </div>
              <div className="px-5 py-4 space-y-3">
                {flags.map((flag) => {
                  const isUpdating = flagUpdating === flag.key
                  return (
                    <div key={flag.key} className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0 border-indigo-100">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{flag.icon} {flag.label}</span>
                          {!flag.enabled && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">已關閉</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{flag.description}</span>
                      </div>
                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleFlag(flag.key, flag.enabled)}
                          disabled={isUpdating}
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                            flag.enabled ? 'bg-primary' : 'bg-muted',
                            isUpdating && 'opacity-50 cursor-not-allowed',
                          )}
                          aria-label={flag.enabled ? '關閉' : '開啟'}
                        >
                          {isUpdating ? (
                            <span className="animate-spin inline-block text-sm absolute left-3.5">🔄</span>
                          ) : (
                            <span className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                              flag.enabled ? 'translate-x-6' : 'translate-x-1',
                            )} />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab !== 'flags' && activeTab !== 'notify' && (
        <div className="space-y-5">
          {visibleGroups.groups.map(({ group, items }) => renderSectionCard(group, items))}
          {visibleGroups.others.length > 0 && renderSectionCard(
            { min: -1, max: -1, title: '其他配置', icon: '⚙️', desc: '未歸類的配置項' },
            visibleGroups.others,
            true,
          )}
        </div>
      )}

      {/* 通知 tab：webhook 單獨一個 section */}
      {activeTab === 'notify' && splitNotifyGroups && (
        <div className="space-y-5">
          {splitNotifyGroups.map((section) => {
            const group: ConfigGroup = {
              min: section.isWebhook ? 55 : 50,
              max: section.isWebhook ? 55 : 59,
              title: section.title,
              icon: section.icon,
              desc: section.desc,
            }
            return renderSectionCard(group, section.items)
          })}
        </div>
      )}
    </div>
  )
}
