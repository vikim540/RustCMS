/**
 * API 客戶端 - JWT 認證 + 統一錯誤處理
 *
 * v1.6.5+ 改進：
 * - 所有錯誤（網絡層、401、業務碼非 0）透過 showGlobalError 推送到左下角全局通知
 * - 401 改用 CustomEvent('unauthorized') 通知 App.tsx，由 React Router navigate 跳轉（更平滑，不整頁刷新）
 * - isRedirectingToLogin 鎖 3 秒後自動解鎖，避免鎖死
 * - 403 權限錯誤沿用 Layout 的 permissionDeniedCallback（已在頂部顯示 toast，不重複彈框）
 */

import { showGlobalError } from '../components/GlobalErrorToast'

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'

/** 從 localStorage 獲取 token */
export function getToken(): string | null {
  return localStorage.getItem('cms_token')
}

/** 保存 token */
export function setToken(token: string): void {
  localStorage.setItem('cms_token', token)
}

/** 清除 token */
export function clearToken(): void {
  localStorage.removeItem('cms_token')
}

/** 用戶信息（登錄後緩存，用於側邊欄權限過濾） */
export interface UserInfo {
  id: number
  ucode: string
  username: string
  realname: string
  isSuper: boolean
  permissions: string[]
}

/** 保存用戶信息 */
export function setUserInfo(info: UserInfo): void {
  localStorage.setItem('cms_user', JSON.stringify(info))
}

/** 獲取用戶信息 */
export function getUserInfo(): UserInfo | null {
  const raw = localStorage.getItem('cms_user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserInfo
  } catch {
    return null
  }
}

/** 清除用戶信息 */
export function clearUserInfo(): void {
  localStorage.removeItem('cms_user')
}

/** 站點信息（多站點管理） */
export interface SiteInfo {
  siteId: string
  name: string
  binding: string
  databaseId: string
  databaseName: string
  domain: string
  region: string
  accessType: string
  status: string
  isPrimary: boolean
  sorting: number
}

const SITE_ID_KEY = 'cms_site_id'
const SITE_NAME_KEY = 'cms_site_name'
const SITES_KEY = 'cms_sites'

/** 獲取當前選中的站點 ID */
export function getCurrentSiteId(): string {
  return localStorage.getItem(SITE_ID_KEY) || 'endoscopy'
}

/** 獲取當前站點名稱 */
export function getCurrentSiteName(): string {
  return localStorage.getItem(SITE_NAME_KEY) || 'Endoscopy CMS'
}

/** 設置當前站點 */
export function setCurrentSite(siteId: string, siteName: string): void {
  localStorage.setItem(SITE_ID_KEY, siteId)
  localStorage.setItem(SITE_NAME_KEY, siteName)
}

/** 清除站點選擇 */
export function clearCurrentSite(): void {
  localStorage.removeItem(SITE_ID_KEY)
  localStorage.removeItem(SITE_NAME_KEY)
  localStorage.removeItem(SITES_KEY)
}

/** 緩存用戶可訪問的站點列表 */
export function setCachedSites(sites: SiteInfo[]): void {
  localStorage.setItem(SITES_KEY, JSON.stringify(sites))
}

/** 獲取緩存的站點列表 */
export function getCachedSites(): SiteInfo[] {
  const raw = localStorage.getItem(SITES_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as SiteInfo[]
  } catch {
    return []
  }
}

/** 統一 API 響應格式 */
export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data?: T
  meta?: { page: number; pagesize: number; total: number }
}

/** 全局重定向鎖 — 防止多個並發 401 同時觸發重定向導致無限刷新 */
let isRedirectingToLogin = false

/** 全局權限錯誤回調（由 Layout 設置，用於在頁面上顯示提示而非控制台報錯） */
let permissionDeniedCallback: ((msg: string) => void) | null = null

/** 設置全局權限錯誤回調 */
export function setPermissionDeniedCallback(cb: ((msg: string) => void) | null): void {
  permissionDeniedCallback = cb
}

/** 判斷當前是否在登錄頁（登錄頁的 401 由頁面自身處理，不重複彈全局通知） */
function isOnLoginPage(): boolean {
  return window.location.pathname.replace(/\/+$/, '') === '/login'
}

/** API 請求封裝 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Site-Id': getCurrentSiteId(),
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // 網絡層錯誤防護：fetch 本身失敗（斷網、DNS 失敗、CORS 阻擋等）
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch (networkError) {
    const errMsg = networkError instanceof Error ? networkError.message : String(networkError)
    showGlobalError(
      '網絡連線錯誤',
      '無法連接到伺服器，請檢查網路連線後重試。',
      `請求: ${options.method || 'GET'} ${path}\n錯誤: ${errMsg}`,
    )
    throw new Error(`網絡連線錯誤: ${errMsg}`)
  }

  // 401 = 未認證/token過期 → 清除登入狀態並通知 App.tsx 跳轉到 login
  if (res.status === 401) {
    clearToken()
    clearUserInfo()
    const onLogin = isOnLoginPage()
    // 觸發跳轉（僅一次，用鎖防抖）
    if (!onLogin && !isRedirectingToLogin) {
      isRedirectingToLogin = true
      // 使用 CustomEvent 通知 App.tsx 中的監聯器，通過 React Router navigate 跳轉
      // 比 window.location.href 更平滑，不會整頁刷新，保留路由狀態
      window.dispatchEvent(new CustomEvent('unauthorized'))
      // 3 秒後自動解鎖：navigate 不會刷新頁面，鎖需手動重置以支持後續會話
      setTimeout(() => {
        isRedirectingToLogin = false
      }, 3000)
    }
    const errMsg = '登錄已過期,請重新登錄'
    // 登錄頁的 401 由頁面自身顯示錯誤（如密碼錯誤），不重複彈全局通知
    if (!onLogin) {
      showGlobalError('登錄已過期', errMsg, `請求路徑: ${path}\nHTTP 401 Unauthorized`)
    }
    throw new Error(errMsg)
  }

  // 403 = 權限拒絕 → 不登出，僅提示無權限
  // 沿用 Layout 的 permissionDeniedCallback（已在頂部顯示 toast），不重複彈全局通知
  if (res.status === 403) {
    const json = await res.json().catch(() => ({ msg: '無權限訪問此功能' })) as ApiResponse<T>
    const msg = json.msg || '無權限訪問此功能'
    // 觸發全局回調（Layout 會顯示 toast 提示）
    if (permissionDeniedCallback) {
      permissionDeniedCallback(msg)
    }
    throw new Error(msg)
  }

  // 500 = 伺服器內部錯誤 → 嘗試解析後端返回的詳細錯誤信息
  if (res.status === 500) {
    const json = await res.json().catch(() => ({ msg: '伺服器內部錯誤' })) as ApiResponse<T> & { detail?: string }
    const msg = json.msg || '伺服器內部錯誤'
    const detailParts = [
      `請求: ${options.method || 'GET'} ${path}`,
      `HTTP 500 Internal Server Error`,
      `錯誤碼: ${json.code}`,
    ]
    if (json.detail) {
      detailParts.push(`後端詳情: ${json.detail}`)
    }
    showGlobalError('伺服器錯誤', msg, detailParts.join('\n'))
    throw new Error(msg)
  }

  // 其他非 200 狀態碼（404/429/502/503 等）
  if (!res.ok) {
    const json = await res.json().catch(() => ({ msg: `HTTP ${res.status} ${res.statusText}` })) as ApiResponse<T> & { detail?: string }
    const msg = json.msg || `HTTP ${res.status} ${res.statusText}`
    const detailParts = [
      `請求: ${options.method || 'GET'} ${path}`,
      `HTTP ${res.status} ${res.statusText}`,
    ]
    if (json.detail) {
      detailParts.push(`後端詳情: ${json.detail}`)
    }
    showGlobalError('請求失敗', msg, detailParts.join('\n'))
    throw new Error(msg)
  }

  const json: ApiResponse<T> = await res.json()
  if (json.code !== 0) {
    const msg = json.msg || '請求失敗'
    // 業務錯誤推送到全局通知，讓非開發者用戶也能看到（許多頁面的 catch 會靜默吞掉錯誤）
    showGlobalError(
      '請求失敗',
      msg,
      `請求: ${options.method || 'GET'} ${path}\n錯誤碼: ${json.code}`,
    )
    throw new Error(msg)
  }
  return json
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
