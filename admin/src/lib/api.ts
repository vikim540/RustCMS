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

/** 構建技術診斷報告（供一鍵複製用，非 UI 展示） */
function buildTechReport(params: {
  method: string
  url: string
  path: string
  status?: number
  statusText?: string
  reqHeaders: Record<string, string>
  reqBody?: unknown
  respBody?: unknown
  errorCode?: number
  backendDetail?: string
  networkError?: string
}): string {
  const { method, url, path, status, statusText, reqHeaders, reqBody, respBody, errorCode, backendDetail, networkError } = params

  // 脫敏：移除 Authorization token 值，僅保留前 10 字元
  const safeHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (k.toLowerCase() === 'authorization') {
      safeHeaders[k] = v.slice(0, 17) + '...(redacted)'
    } else {
      safeHeaders[k] = v
    }
  }

  // 請求體截斷（保留 2000 字元，足夠調試）
  let bodyStr = ''
  if (reqBody !== undefined) {
    try {
      bodyStr = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody, null, 2)
      if (bodyStr.length > 2000) bodyStr = bodyStr.slice(0, 2000) + '\n... (truncated)'
    } catch {
      bodyStr = '[unserializable]'
    }
  }

  // 響應體截斷
  let respStr = ''
  if (respBody !== undefined) {
    try {
      respStr = typeof respBody === 'string' ? respBody : JSON.stringify(respBody, null, 2)
      if (respStr.length > 2000) respStr = respStr.slice(0, 2000) + '\n... (truncated)'
    } catch {
      respStr = '[unserializable]'
    }
  }

  // 調用堆疊（定位到前端源碼調用位置）
  const stack = new Error().stack || ''
  // 過濾掉 buildTechReport/request 內部幀，保留真正調用者
  const stackLines = stack.split('\n')
    .filter((line) => !line.includes('buildTechReport') && !line.includes('at request '))
    .join('\n')

  const lines: string[] = [
    `=== 技術診斷報告 ===`,
    `時間: ${new Date().toISOString()}`,
    ``,
    `--- 請求 ---`,
    `Method: ${method}`,
    `URL: ${url}`,
    `Path: ${path}`,
    `Headers: ${JSON.stringify(safeHeaders, null, 2)}`,
  ]
  if (bodyStr) lines.push(`Body: ${bodyStr}`)

  if (status !== undefined) {
    lines.push('', `--- 響應 ---`, `Status: ${status} ${statusText || ''}`)
    if (errorCode !== undefined) lines.push(`錯誤碼 (code): ${errorCode}`)
    if (backendDetail) lines.push(`後端詳情: ${backendDetail}`)
    if (respStr) lines.push(`Body: ${respStr}`)
  }

  if (networkError) {
    lines.push('', `--- 網絡錯誤 ---`, networkError)
  }

  lines.push('', `--- 調用堆疊 (前端源碼定位) ---`)
  lines.push(stackLines)

  return lines.join('\n')
}

/** API 請求封裝 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const token = getToken()
  const method = options.method || 'GET'
  const fullUrl = `${API_BASE}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Site-Id': getCurrentSiteId(),
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // 網絡層錯誤防護：fetch 本身失敗（斷網、DNS 失敗、CORS 阻擋等）
  let res: Response
  try {
    res = await fetch(fullUrl, { ...options, headers })
  } catch (networkError) {
    const errMsg = networkError instanceof Error ? networkError.message : String(networkError)
    showGlobalError(
      '網絡連線錯誤',
      '無法連接到伺服器，請檢查網路連線後重試。',
      buildTechReport({ method, url: fullUrl, path, reqHeaders: headers, reqBody: options.body, networkError: `${networkError instanceof Error ? networkError.name : 'Error'}: ${errMsg}` }),
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
      window.dispatchEvent(new CustomEvent('unauthorized'))
      setTimeout(() => {
        isRedirectingToLogin = false
      }, 3000)
    }
    const errMsg = '登錄已過期,請重新登錄'
    if (!onLogin) {
      const respBody = await res.json().catch(() => null)
      showGlobalError('登錄已過期', errMsg, buildTechReport({ method, url: fullUrl, path, status: 401, statusText: 'Unauthorized', reqHeaders: headers, reqBody: options.body, respBody }))
    }
    throw new Error(errMsg)
  }

  // 403 = 權限拒絕 → 不登出，僅提示無權限
  if (res.status === 403) {
    const json = await res.json().catch(() => ({ msg: '無權限訪問此功能' })) as ApiResponse<T>
    const msg = json.msg || '無權限訪問此功能'
    if (permissionDeniedCallback) {
      permissionDeniedCallback(msg)
    }
    throw new Error(msg)
  }

  // 500 = 伺服器內部錯誤 → 嘗試解析後端返回的詳細錯誤信息
  if (res.status === 500) {
    const json = await res.json().catch(() => ({ msg: '伺服器內部錯誤' })) as ApiResponse<T> & { detail?: string }
    const msg = json.msg || '伺服器內部錯誤'
    showGlobalError('伺服器錯誤', msg, buildTechReport({
      method, url: fullUrl, path, status: 500, statusText: 'Internal Server Error',
      reqHeaders: headers, reqBody: options.body, respBody: json, errorCode: json.code, backendDetail: json.detail,
    }))
    throw new Error(msg)
  }

  // 其他非 200 狀態碼（404/429/502/503 等）
  if (!res.ok) {
    const json = await res.json().catch(() => ({ msg: `HTTP ${res.status} ${res.statusText}` })) as ApiResponse<T> & { detail?: string }
    const msg = json.msg || `HTTP ${res.status} ${res.statusText}`
    showGlobalError('請求失敗', msg, buildTechReport({
      method, url: fullUrl, path, status: res.status, statusText: res.statusText,
      reqHeaders: headers, reqBody: options.body, respBody: json, errorCode: json.code, backendDetail: json.detail,
    }))
    throw new Error(msg)
  }

  const json: ApiResponse<T> = await res.json()
  if (json.code !== 0) {
    const msg = json.msg || '請求失敗'
    showGlobalError(
      '請求失敗',
      msg,
      buildTechReport({ method, url: fullUrl, path, status: res.status, statusText: res.statusText, reqHeaders: headers, reqBody: options.body, respBody: json, errorCode: json.code }),
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
