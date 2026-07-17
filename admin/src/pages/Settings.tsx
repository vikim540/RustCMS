import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

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
  { min: 60, max: 69, title: '搜索引擎推送', icon: '🔍', desc: '百度/神馬等搜索引擎收錄推送' },
  { min: 90, max: 99, title: '郵件服務', icon: '📧', desc: 'SMTP/MailChannels 發信配置' },
]

/** 需要隱藏的配置項（手機版/水印/URL 相關，前後端分離架構不需要） */
const HIDDEN_CONFIGS = new Set([
  'open_wap', 'wap_domain', 'wap_site_dir',
  'watermark_open', 'watermark_text', 'watermark_text_font',
  'watermark_text_size', 'watermark_text_color', 'watermark_pic',
  'watermark_position',
  'url_rule_type', 'url_rule_content_path', 'url_index_404',
  'tpl_html_dir',
])

/** Webhook 相關配置項（notify_webhook_enabled 關閉時隱藏） */
const WEBHOOK_CONFIGS = new Set([
  'webhook_url', 'webhook_message', 'webhook_form', 'webhook_comment',
])

/** 通知配置分組中的郵件相關配置項（notify_mail_enabled 關閉時隱藏） */
const MAIL_IN_NOTIFY_CONFIGS = new Set([
  'message_send_mail', 'form_send_mail', 'comment_send_mail', 'message_send_to',
])

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

  const mailEnabled = isEnabled('notify_mail_enabled')
  const webhookEnabled = isEnabled('notify_webhook_enabled')

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
      if ((config.sorting >= 10 && config.sorting <= 19) || (config.sorting >= 70 && config.sorting <= 79)) continue

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
  const renderConfigRow = (config: Config) => {
    const isSwitch = config.type === '1'
    const val = currentValue(config)
    const isOn = val === '1'
    const hasChange = config.name in changes

    return (
      <div
        key={config.id}
        className={cn(
          'flex items-center justify-between gap-4 py-3 border-b last:border-b-0',
          hasChange && 'bg-amber-50/50 -mx-4 px-4',
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
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                isOn ? 'bg-primary' : 'bg-muted',
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
              className="w-64 px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="請輸入配置值"
            />
          )}
        </div>
      </div>
    )
  }

  /** 渲染分組卡片（含獨立保存按鈕） */
  const renderSectionCard = (group: ConfigGroup, items: Config[], isOther = false) => {
    const changedCount = getSectionChangedCount(items)
    const isSaving = savingSection === group.min
    const displayGroup = isOther
      ? { ...group, title: '其他配置', icon: '⚙️', desc: '未歸類的配置項' }
      : group

    return (
      <div key={displayGroup.min} className="bg-white rounded-lg border overflow-hidden">
        {/* 卡片頭部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-gradient-to-r from-secondary/40 to-secondary/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg shrink-0">{displayGroup.icon}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{displayGroup.title}</h2>
                <span className="text-xs text-muted-foreground">({items.length} 項)</span>
                {changedCount > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-800">
                    {changedCount} 項待保存
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{displayGroup.desc}</p>
            </div>
          </div>
          {/* 獨立保存按鈕 */}
          <button
            onClick={() => handleSaveSection(displayGroup, items)}
            disabled={isSaving || changedCount === 0}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-md transition-all shrink-0',
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
        </div>
        {/* 配置項 */}
        <div className="px-4">
          {items.map(renderConfigRow)}
        </div>
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
      </div>
    )
  }

  const totalChanged = Object.keys(changes).length

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
              onClick={() => {
                setChanges({})
                setSuccessMsg('')
              }}
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
          <span className="shrink-0">⚠️</span>
          {error}
        </div>
      )}

      {/* 成功提示 */}
      {successMsg && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-md text-sm">
          <span className="shrink-0">✅</span>
          {successMsg}
        </div>
      )}

      {/* 功能開關區域 */}
      {!loading && flags.length > 0 && (
        <div className="mb-5 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-indigo-100 bg-white/50">
            <span>🚩</span>
            <h2 className="font-semibold text-indigo-900">功能開關</h2>
            <span className="text-xs text-indigo-600">
              （{flags[0]?.managedBy === 'flagship' ? 'Flagship 管理' : '本地管理'}）
            </span>
          </div>
          <div className="px-5 py-4 space-y-3">
            {flags.map((flag) => {
              const isFlagshipManaged = flag.managedBy === 'flagship'
              const isUpdating = flagUpdating === flag.key
              return (
                <div
                  key={flag.key}
                  className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0 border-indigo-100"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {flag.icon} {flag.label}
                      </span>
                      {!flag.enabled && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                          已關閉
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {flag.description}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {isFlagshipManaged ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">由 Flagship 管理</span>
                        <div
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full',
                            flag.enabled ? 'bg-primary' : 'bg-muted',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white shadow',
                              flag.enabled ? 'translate-x-6' : 'translate-x-1',
                            )}
                          />
                        </div>
                      </div>
                    ) : (
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
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                              flag.enabled ? 'translate-x-6' : 'translate-x-1',
                            )}
                          />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 加載中 */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <span className="animate-spin inline-block mr-2">🔄</span>
          加載中...
        </div>
      )}

      {/* 加載錯誤 */}
      {!loading && !configs.length && error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="text-2xl mb-3 text-destructive">⚠️</span>
          <p className="mb-3">{error}</p>
          <button
            onClick={fetchConfigs}
            className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors"
          >
            重新加載
          </button>
        </div>
      )}

      {/* 配置分組卡片（每個區塊獨立保存） */}
      {!loading && configs.length > 0 && (
        <div className="space-y-5">
          {groupedConfigs.groups.map(({ group, items }) =>
            renderSectionCard(group, items),
          )}
          {groupedConfigs.others.length > 0 &&
            renderSectionCard(
              { min: -1, max: -1, title: '其他配置', icon: '⚙️', desc: '未歸類的配置項' },
              groupedConfigs.others,
              true,
            )}
        </div>
      )}
    </div>
  )
}
