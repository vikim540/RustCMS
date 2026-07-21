import { useState, useEffect, useCallback } from 'react'
import { api, getCurrentSiteId, type SiteInfo } from '../lib/api'
import { LoadingState, EmptyState } from '../components/StateDisplay'

/** 創建站點表單數據 */
interface CreateSiteForm {
  siteId: string
  name: string
  domain: string
  region: string
}

/** 創建狀態 */
type CreateStatus = 'idle' | 'creating' | 'success' | 'error'

export default function Sites() {
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [userIsSuper, setUserIsSuper] = useState(false)

  // 創建站點相關狀態
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState<CreateSiteForm>({
    siteId: '',
    name: '',
    domain: '',
    region: 'apac',
  })
  const [createStatus, setCreateStatus] = useState<CreateStatus>('idle')
  const [createMessage, setCreateMessage] = useState('')
  const [createError, setCreateError] = useState('')

  // 編輯站點相關狀態
  const [editingSite, setEditingSite] = useState<SiteInfo | null>(null)
  const [editForm, setEditForm] = useState({ name: '', domain: '', sorting: 0, status: '1' })
  const [editError, setEditError] = useState('')

  // 成功提示（固定顯示直到用戶關閉）
  const [successNotice, setSuccessNotice] = useState<string | null>(null)

  /** 載入站點列表 */
  const loadSites = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ sites: SiteInfo[] }>('/admin/sites')
      setSites(res.data?.sites ?? [])
    } catch {
      /* 靜默處理 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSites()
    // 檢查當前用戶是否為超管
    const userStr = localStorage.getItem('cms_user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        setUserIsSuper(!!user.isSuper)
      } catch {
        /* 解析失敗 */
      }
    }
  }, [loadSites])

  /** 處理創建站點 */
  async function handleCreateSite() {
    // 基本驗證
    if (!createForm.siteId.trim() || !createForm.name.trim()) {
      setCreateError('站點 ID 和名稱為必填項')
      return
    }
    if (!/^[a-z][a-z0-9-]*$/.test(createForm.siteId)) {
      setCreateError('站點 ID 只能包含小寫字母、數字和連字符，且以字母開頭')
      return
    }

    setCreateStatus('creating')
    setCreateError('')
    setCreateMessage('正在創建數據庫，請等待約 1 分鐘...')

    try {
      const res = await api.post('/admin/sites/create', {
        siteId: createForm.siteId.trim(),
        name: createForm.name.trim(),
        domain: createForm.domain.trim(),
        region: createForm.region,
      })

      setCreateStatus('success')
      setCreateMessage(res.msg || '站點創建成功')

      // 重新載入站點列表
      await loadSites()

      // 顯示固定成功提示（直到用戶關閉）
      setSuccessNotice(`✅ 站點「${createForm.name.trim()}」創建成功！數據庫已在 ${createForm.region.toUpperCase()} 地區創建，用戶現在可以切換到此站點。`)
    } catch (e) {
      setCreateStatus('error')
      setCreateError(e instanceof Error ? e.message : '創建站點失敗')
    }
  }

  /** 重置創建表單 */
  function resetCreateForm() {
    setCreateForm({ siteId: '', name: '', domain: '', region: 'apac' })
    setCreateStatus('idle')
    setCreateMessage('')
    setCreateError('')
  }

  /** 打開編輯站點 */
  function openEditSite(site: SiteInfo) {
    setEditingSite(site)
    setEditForm({
      name: site.name,
      domain: site.domain,
      sorting: site.sorting,
      status: site.status,
    })
    setEditError('')
  }

  /** 保存編輯站點 */
  async function handleSaveEdit() {
    if (!editingSite) return
    if (!editForm.name.trim()) {
      setEditError('站點名稱不能為空')
      return
    }

    try {
      await api.put(`/admin/sites/${editingSite.siteId}`, {
        name: editForm.name.trim(),
        domain: editForm.domain.trim(),
        sorting: editForm.sorting,
        status: editForm.status,
      })
      setEditingSite(null)
      await loadSites()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '更新失敗')
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span>🌐</span>
            <span>多站點管理</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理所有 CMS 站點，創建新站點將自動在亞太地區創建獨立的 D1 數據庫
          </p>
        </div>
        {userIsSuper && (
          <button
            onClick={() => {
              resetCreateForm()
              setShowCreateModal(true)
            }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <span>➕</span>
            <span>創建新站點</span>
          </button>
        )}
      </div>

      {/* 固定成功提示（直到用戶點擊關閉） */}
      {successNotice && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <span className="text-2xl">🎉</span>
          <div className="flex-1">
            <p className="font-medium text-green-800">{successNotice}</p>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-green-600 hover:text-green-800 text-sm font-medium"
          >
            關閉 ✕
          </button>
        </div>
      )}

      {/* 站點列表 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        {loading ? (
          <LoadingState text="載入中..." />
        ) : sites.length === 0 ? (
          <EmptyState icon="📭" text="暫無站點" />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-accent/30">
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">站點名稱</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">站點 ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">域名</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">數據庫</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">地區</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">訪問方式</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">狀態</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">當前</th>
                {userIsSuper && <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">操作</th>}
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.siteId} className="border-b hover:bg-accent/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {site.isPrimary && <span title="主站">⭐</span>}
                      <span className="font-medium">{site.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-accent px-1.5 py-0.5 rounded">{site.siteId}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{site.domain || '-'}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{site.databaseName || site.binding || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {site.region.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {site.accessType === 'binding' ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">靜態綁定</span>
                    ) : (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">REST API</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {site.status === '1' ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">啟用</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">禁用</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {site.siteId === getCurrentSiteId() ? (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">當前</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  {userIsSuper && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEditSite(site)}
                        className="text-sm text-primary hover:underline"
                      >
                        編輯
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 創建站點 Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span>🚀</span>
                <span>創建新站點</span>
              </h2>
              {createStatus !== 'creating' && (
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="p-6">
              {createStatus === 'creating' ? (
                /* 創建中：顯示等待狀態 */
                <div className="text-center py-8">
                  <div className="inline-block animate-spin text-4xl mb-4">⚙️</div>
                  <p className="text-lg font-medium mb-2">{createMessage}</p>
                  <p className="text-sm text-muted-foreground">
                    系統正在通過 Cloudflare REST API 創建 APAC 地區的 D1 數據庫並初始化表結構...
                  </p>
                  <div className="mt-4 w-full bg-accent rounded-full h-2 overflow-hidden">
                    <div className="bg-primary h-full animate-pulse" style={{ width: '70%' }}></div>
                  </div>
                </div>
              ) : createStatus === 'success' ? (
                /* 創建成功：顯示成功狀態 */
                <div className="text-center py-8">
                  <div className="text-5xl mb-4">✅</div>
                  <p className="text-lg font-medium text-green-600 mb-2">站點創建成功！</p>
                  <p className="text-sm text-muted-foreground">{createMessage}</p>
                  <button
                    onClick={() => {
                      setShowCreateModal(false)
                      resetCreateForm()
                    }}
                    className="mt-6 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    關閉
                  </button>
                </div>
              ) : (
                /* 創建表單 */
                <div className="space-y-4">
                  {createError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      {createError}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      站點 ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.siteId}
                      onChange={(e) => setCreateForm({ ...createForm, siteId: e.target.value })}
                      placeholder="如：opd-cms"
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      只能包含小寫字母、數字和連字符，將作為數據庫名稱後綴（{createForm.siteId || 'xxx'}-cms）
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      站點名稱 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.name}
                      onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="如：OPD CMS"
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">站點域名</label>
                    <input
                      type="text"
                      value={createForm.domain}
                      onChange={(e) => setCreateForm({ ...createForm, domain: e.target.value })}
                      placeholder="如：opd.cmermedical.com.hk"
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">數據庫地區</label>
                    <select
                      value={createForm.region}
                      onChange={(e) => setCreateForm({ ...createForm, region: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="apac">APAC - 亞太地區（推薦）</option>
                      <option value="wnam">WNAM - 北美西部</option>
                      <option value="enam">ENAM - 北美東部</option>
                      <option value="weur">WEUR - 西歐</option>
                      <option value="eeur">EEUR - 東歐</option>
                      <option value="oc">OC - 大洋洲</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      所有數據庫均創建在亞太地區以獲得最低延遲
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                    💡 創建過程約需 1 分鐘，系統將自動：
                    <br />
                    1. 創建 D1 數據庫（{createForm.siteId || 'xxx'}-cms）
                    <br />
                    2. 初始化數據表結構
                    <br />
                    3. 註冊到站點列表
                  </div>
                </div>
              )}

              {createStatus === 'idle' && (
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 px-4 py-2 border rounded-lg hover:bg-accent transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateSite}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    開始創建
                  </button>
                </div>
              )}

              {createStatus === 'error' && (
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setCreateStatus('idle')}
                    className="flex-1 px-4 py-2 border rounded-lg hover:bg-accent transition-colors"
                  >
                    返回修改
                  </button>
                  <button
                    onClick={handleCreateSite}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    重試
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 編輯站點 Modal */}
      {editingSite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">編輯站點</h2>
              <button
                onClick={() => setEditingSite(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {editError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1.5">站點名稱</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">站點域名</label>
                <input
                  type="text"
                  value={editForm.domain}
                  onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">排序</label>
                <input
                  type="number"
                  value={editForm.sorting}
                  onChange={(e) => setEditForm({ ...editForm, sorting: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">狀態</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="1">啟用</option>
                  <option value="0">禁用</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <button
                onClick={() => setEditingSite(null)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
