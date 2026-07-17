import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

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
}

const CONFIG_GROUPS: ConfigGroup[] = [
  { min: 20, max: 29, title: '留言表單', icon: '💬' },
  { min: 30, max: 39, title: '安全配置', icon: '🛡️' },
  { min: 40, max: 49, title: 'WebAPI', icon: '</>' },
  { min: 50, max: 59, title: '通知配置', icon: '🔔' },
  { min: 60, max: 69, title: '搜索引擎推送', icon: '🔍' },
  { min: 90, max: 99, title: '郵件服務', icon: '📧' },
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

/** 功能開關狀態 */
interface FlagState {
  key: string
  label: string
  enabled: boolean
  managedBy: 'flagship' | 'database'
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
  // 本地變更記錄: name -> newValue
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  // 通知測試按鈕 loading 狀態
  const [testMailLoading, setTestMailLoading] = useState(false)
  const [testWebhookLoading, setTestWebhookLoading] = useState(false)
  // 功能開關狀態 (Flagship / D1 回退)
  const [flags, setFlags] = useState<FlagState[]>([])
  const [flagUpdating, setFlagUpdating] = useState<string | null>(null)

  /** 拉取全部配置 */
  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<Config[]>('/admin/configs')
      const data = Array.isArray(res.data) ? res.data : []
      // 依 sorting 排序
      data.sort((a, b) => a.sorting - b.sorting)
      setConfigs(data)
      setChanges({})
    } catch (err) {
      setError(err instanceof Error ? err.message : '加載失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 拉取功能開關狀態 */
  const fetchFlags = useCallback(async () => {
    try {
      const res = await api.get<FlagState[]>('/admin/flags')
      const data = Array.isArray(res.data) ? res.data : []
      setFlags(data)
    } catch {
      // 靜默失敗，不影響主配置加載
    }
  }, [])

  useEffect(() => {
    fetchConfigs()
    fetchFlags()
  }, [fetchConfigs, fetchFlags])

  /** 切換功能開關 */
  const handleToggleFlag = async (flagKey: string, currentEnabled: boolean) => {
    setFlagUpdating(flagKey)
    setError('')
    setSuccessMsg('')
    try {
      await api.put('/admin/flags', { key: flagKey, enabled: !currentEnabled })
      await fetchFlags()
      setSuccessMsg(!currentEnabled ? '功能已開啟' : '功能已關閉，相關配置已隱藏')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '開關切換失敗')
    } finally {
      setFlagUpdating(null)
    }
  }

  /** 郵件通知是否啟用 */
  const mailEnabled = flags.find((f) => f.key === 'notify_mail_enabled')?.enabled ?? true
  /** Webhook 通知是否啟用 */
  const webhookEnabled = flags.find((f) => f.key === 'notify_webhook_enabled')?.enabled ?? true

  /** 取得某配置的當前顯示值（優先取本地變更） */
  const currentValue = (config: Config): string => {
    return config.name in changes ? changes[config.name] : config.value
  }

  /** 更新本地變更 */
  const updateValue = (name: string, value: string) => {
    setChanges((prev) => {
      const next = { ...prev }
      // 若與原始值相同則移除變更記錄
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

  /** 提交保存（僅發送變更項） */
  const handleSave = async () => {
    const changedEntries = Object.entries(changes)
    if (changedEntries.length === 0) return

    setSaving(true)
    setSuccessMsg('')
    setError('')
    try {
      await api.put('/admin/configs', {
        configs: changedEntries.map(([name, value]) => ({ name, value })),
      })
      // 保存成功後重新拉取以同步本地狀態
      await fetchConfigs()
      setSuccessMsg('配置已成功保存')
      // 3 秒後隱藏成功提示
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  /** 測試郵件發送（彈出輸入框收集收件郵箱） */
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

  /** 測試 Webhook 推送（以 message 分類觸發） */
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

  /** 放棄所有變更 */
  const handleReset = () => {
    setChanges({})
    setSuccessMsg('')
  }

  const changedCount = Object.keys(changes).length

  /** 依分組切割配置（過濾掉手機版/水印/URL 等不需要的配置項，並根據功能開關隱藏對應區域） */
  const groupedConfigs = useMemo(() => {
    const groups: { group: ConfigGroup; items: Config[] }[] = []
    const others: Config[] = []

    for (const config of configs) {
      // 隱藏不需要的配置項
      if (HIDDEN_CONFIGS.has(config.name)) continue
      // 隱藏 sorting 10-19 (手機版) 和 70-79 (水印) 範圍的所有配置
      if ((config.sorting >= 10 && config.sorting <= 19) || (config.sorting >= 70 && config.sorting <= 79)) continue

      // 🏁 功能開關控制：郵件關閉時隱藏郵件相關配置
      if (!mailEnabled) {
        // 隱藏整個郵件服務分組 (90-99)
        if (config.sorting >= 90 && config.sorting <= 99) continue
        // 隱藏通知配置中的郵件相關項
        if (MAIL_IN_NOTIFY_CONFIGS.has(config.name)) continue
      }

      // 🏁 功能開關控制：Webhook 關閉時隱藏 Webhook 相關配置
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

    // 依分組定義順序排列，過濾掉所有項目都被隱藏的空分組
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
        {/* 標籤 */}
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

        {/* 控件 */}
        <div className="shrink-0">
          {isSwitch ? (
            // 開關
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
            // 文字輸入
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

  return (
    <div className="p-6 pb-24">
      {/* 頁頭 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            系統設置
          </h1>
          <p className="text-sm text-muted-foreground mt-1">管理網站各項系統配置參數</p>
        </div>
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

      {/* 🏁 功能開關區域（Flagship / D1 回退） */}
      {!loading && flags.length > 0 && (
        <div className="mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 overflow-hidden">
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
                        {flag.key === 'notify_mail_enabled' ? '📧' : '🪝'} {flag.label}
                      </span>
                      {!flag.enabled && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                          已關閉
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {flag.key === 'notify_mail_enabled'
                        ? '關閉後隱藏所有郵件相關配置'
                        : '關閉後隱藏所有 Webhook 相關配置'}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {isFlagshipManaged ? (
                      // Flagship 管理: 唯讀開關 + 提示
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
                      // D1 管理: 可切換開關
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

      {/* 配置分組卡片 */}
      {!loading && configs.length > 0 && (
        <div className="space-y-6">
          {groupedConfigs.groups.map(({ group, items }) => (
            <div key={group.min} className="bg-white rounded-lg border overflow-hidden">
              {/* 分組標題 */}
              <div className="flex items-center gap-2.5 px-5 py-3.5 border-b bg-secondary/30">
                <span className="text-muted-foreground">{group.icon}</span>
                <h2 className="font-semibold">{group.title}</h2>
                <span className="text-xs text-muted-foreground">（{items.length} 項）</span>
              </div>
              {/* 配置項 */}
              <div className="px-4">
                {items.map(renderConfigRow)}
              </div>
              {/* 通知配置分組：測試按鈕（根據功能開關顯示） */}
              {group.min === 50 && (mailEnabled || webhookEnabled) && (
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
          ))}

          {/* 未分組配置 */}
          {groupedConfigs.others.length > 0 && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 py-3.5 border-b bg-secondary/30">
                <span className="text-muted-foreground">⚙️</span>
                <h2 className="font-semibold">其他配置</h2>
                <span className="text-xs text-muted-foreground">
                  （{groupedConfigs.others.length} 項）
                </span>
              </div>
              <div className="px-4">
                {groupedConfigs.others.map(renderConfigRow)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部固定操作列 */}
      {!loading && configs.length > 0 && (
        <div className="fixed bottom-0 left-56 right-0 bg-white border-t px-6 py-3 flex items-center justify-between z-30">
          <div className="text-sm text-muted-foreground">
            {changedCount > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-xs font-bold">
                  {changedCount}
                </span>
                項配置已修改，待保存
              </span>
            ) : (
              <span>無未保存的變更</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {changedCount > 0 && (
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent transition-colors disabled:opacity-50"
              >
                放棄變更
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || changedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? (
                <span className="animate-spin inline-block">🔄</span>
              ) : (
                <span>💾</span>
              )}
              {saving ? '保存中...' : `保存配置${changedCount > 0 ? ` (${changedCount})` : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
