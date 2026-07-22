/**
 * 認證服務 - 登錄/登出/個人信息/權限校驗
 * 雙 MD5 密碼驗證 + JWT HS256 簽發
 * 權限系統: 超級管理員 (ucode="10001") 跳過所有檢查, 普通用戶按 ay_role_level 中的 level 鍵校驗
 */
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { verifyPassword } from '../utils/password';
import { signJwt, genUuid, type JwtClaims } from '../utils/jwt';
import { okData, ok, err, notFound } from '../utils/response';
import { nowStr } from '../utils/datetime';
import { getConfig } from './config';
import { getUserSites } from './site';

/** 超級管理員 ucode */
const SUPER_ADMIN_UCODE = '10001';

/**
 * 加載用戶權限列表
 * 根據 rcodes (逗號分隔的角色代碼) 查詢 ay_role_level, 收集所有不重複的 level 權限鍵
 * 超級管理員返回空數組 (調用方應通過 isSuper 判斷跳過)
 *
 * 優化：使用單次 IN 查詢替代逐個角色查詢，減少數據庫往返
 */
export async function loadUserPermissions(db: D1Database, rcodes: string): Promise<string[]> {
  if (!rcodes) return [];
  const rcodeList = rcodes.split(',').map((r) => r.trim()).filter(Boolean);
  if (rcodeList.length === 0) return [];

  const placeholders = rcodeList.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT DISTINCT level FROM ay_role_level WHERE rcode IN (${placeholders}) AND level IS NOT NULL AND level != ''`)
    .bind(...rcodeList)
    .all<{ level: string }>();

  return result.results.map((r) => r.level).filter(Boolean);
}

/**
 * 從數據庫重新加載用戶權限（確保角色權限變更後即時生效）
 * 用於 admin 中間件和 handleProfile，避免使用 JWT 中的過時權限
 *
 * @param db D1 數據庫
 * @param userId 用戶 ID
 * @returns 最新權限列表，用戶不存在或已禁用時返回 null
 */
export async function reloadUserPermissions(db: D1Database, userId: number): Promise<string[] | null> {
  const user = await db
    .prepare('SELECT rcodes FROM ay_user WHERE id = ? AND status = ?')
    .bind(userId, '1')
    .first<{ rcodes: string }>();
  if (!user) return null;
  return loadUserPermissions(db, user.rcodes || '');
}

/**
 * Cloudflare Turnstile 人機驗證
 * 文檔：https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * @param secretKey Turnstile 密鑰（從 D1 配置讀取）
 * @param token 前端 Turnstile widget 返回的 token
 * @param remoteip 用戶 IP（可選，用於增強驗證）
 * @returns 驗證成功返回 true，失敗返回 false
 */
async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteip?: string,
): Promise<boolean> {
  // secret key 未配置時放行（避免配置丟失導致所有用戶被鎖死）
  if (!secretKey) return true;
  if (!token) return false;

  const params = new URLSearchParams();
  params.append('secret', secretKey);
  params.append('response', token);
  if (remoteip) params.append('remoteip', remoteip);

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = (await resp.json()) as { success: boolean };
    return data.success === true;
  } catch {
    // 網絡異常時放行（避免 Cloudflare API 故障導致無法登錄）
    return true;
  }
}

/** 管理員登錄 */
export async function handleLogin(
  db: D1Database,
  kv: KVNamespace,
  jwtSecret: string,
  body: { username?: string; password?: string; turnstileToken?: string },
  loginIp: string = '',
  turnstileSecret: string = '',
): Promise<Response> {
  const username = body.username;
  const passwordInput = body.password;
  if (!username || !passwordInput) {
    return err('缺少用戶名或密碼參數', 1001);
  }

  // Cloudflare Turnstile 人機驗證（開關開啟時驗證）
  // secret key 從 Secrets Store 讀取（v1.7.0 遷移，0010 遷移已清空 D1 中的值）
  const turnstileEnabled = await getConfig(db, kv, 'turnstile_enabled', '0');
  if (turnstileEnabled === '1') {
    const token = body.turnstileToken || '';
    const verified = await verifyTurnstile(turnstileSecret, token, loginIp || undefined);
    if (!verified) {
      return err('人機驗證失敗，請重試', 2007);
    }
  }

  // 查詢用戶 (含 ucode, realname, rcodes 用於權限)
  const stmt = db
    .prepare('SELECT * FROM ay_user WHERE username = ? AND status = ? LIMIT 1')
    .bind(username, '1');
  const user = await stmt.first<{
    id: number;
    ucode: string;
    username: string;
    password: string;
    realname: string | null;
    rcodes: string | null;
    status: string;
  }>();

  if (!user) {
    return err('用戶名或密碼錯誤', 2001);
  }

  // 驗證密碼 (雙 MD5 + 常量時間比較)
  if (!verifyPassword(passwordInput, user.password)) {
    return err('用戶名或密碼錯誤', 2001);
  }

  // 判斷是否超級管理員
  const isSuper = user.ucode === SUPER_ADMIN_UCODE;

  // 加載權限 (超級管理員不需要加載, 享有所有權限)
  const permissions = isSuper ? [] : await loadUserPermissions(db, user.rcodes || '');

  // 簽發 JWT (7天過期)
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7 * 24 * 3600;
  const claims: JwtClaims = {
    sub: String(user.id),
    username: user.username,
    ucode: user.ucode,
    realname: user.realname || '',
    rcodes: user.rcodes || '',
    isSuper,
    permissions,
    iat: now,
    exp,
    jti: genUuid(),
  };
  const token = await signJwt(claims, jwtSecret);

  // 更新登錄信息（含登錄 IP）
  await db
    .prepare('UPDATE ay_user SET login_count = login_count + 1, last_login_ip = ?, lastlogintime = ? WHERE id = ?')
    .bind(loginIp, nowStr(), user.id)
    .run();

  // 獲取用戶可訪問的站點列表
  const sites = await getUserSites(db, user.id, isSuper);

  return okData(
    {
      token,
      user: {
        id: user.id,
        ucode: user.ucode,
        username: user.username,
        realname: user.realname,
        rcodes: user.rcodes,
        isSuper,
        permissions,
      },
      sites,
      expires: exp,
    },
    '登錄成功',
  );
}

/** 獲取當前用戶信息 (含權限信息) — 權限從數據庫重新加載，確保角色變更後即時生效 */
export async function handleProfile(db: D1Database, claims: JwtClaims): Promise<Response> {
  const stmt = db
    .prepare(
      'SELECT id, ucode, username, realname, rcodes, acodes, status, login_count, lastlogintime FROM ay_user WHERE id = ?',
    )
    .bind(Number(claims.sub));
  const user = await stmt.first();
  if (!user) return notFound('用戶不存在');

  // 重新從數據庫加載權限（而非使用 JWT 中的快照），確保角色權限變更後即時生效
  const permissions = claims.isSuper ? [] : await loadUserPermissions(db, (user as { rcodes: string }).rcodes || '');

  // 獲取用戶可訪問的站點列表（確保站點分配變更後即時生效）
  const sites = await getUserSites(db, Number(claims.sub), claims.isSuper);

  return okData(
    {
      ...user,
      isSuper: claims.isSuper,
      permissions,
      sites,
    },
    '成功',
  );
}

/** 登出 (將 token jti 加入 KV 黑名單) */
export async function handleLogout(
  blacklist: KVNamespace,
  claims: JwtClaims,
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = claims.exp - now;
  if (ttl > 0) {
    await blacklist.put(`token:black:${claims.jti}`, '1', { expirationTtl: ttl });
  }
  return ok('登出成功');
}

/** 檢查 token 是否在黑名單中 */
export async function isTokenBlacklisted(
  blacklist: KVNamespace,
  jti: string,
): Promise<boolean> {
  const val = await blacklist.get(`token:black:${jti}`);
  return val !== null;
}

/**
 * 權限校驗輔助函數
 * 超級管理員 (isSuper=true) 跳過所有檢查
 * 普通用戶檢查 permissions 數組中是否包含 `${resource}:${action}` 鍵
 */
export function hasPermission(claims: JwtClaims, resource: string, action: string): boolean {
  if (claims.isSuper) return true;
  const key = `${resource}:${action}`;
  return claims.permissions.includes(key);
}

/**
 * 檢查用戶是否有指定菜單的訪問權限
 * 超級管理員跳過所有檢查
 * 普通用戶檢查 permissions 數組中是否包含該 mcode
 *
 * 與 hasPermission 不同, 此函數基於菜單 mcode (如 "M504") 校驗,
 * 適用於基於菜單的 API 路由權限攔截
 */
export function hasMenuPermission(claims: JwtClaims, mcode: string): boolean {
  if (claims.isSuper) return true;
  return claims.permissions.includes(mcode);
}
