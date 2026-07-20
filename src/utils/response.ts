/**
 * 統一 API 響應格式
 * 所有接口必須返回 { code, msg, data, meta } 結構
 */

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
  meta?: Meta;
}

export interface Meta {
  page: number;
  pagesize: number;
  total: number;
}

/** 創建分頁元數據 */
export function createMeta(page: number, pagesize: number, total: number): Meta {
  return { page, pagesize, total };
}

/** 成功響應 (無數據) */
export function ok(msg: string): Response {
  return Response.json({ code: 0, msg } satisfies ApiResponse);
}

/** 成功響應 (帶數據) */
export function okData<T>(data: T, msg = '成功'): Response {
  return Response.json({ code: 0, msg, data } satisfies ApiResponse<T>);
}

/** 成功響應 (帶分頁) */
export function okList<T>(data: T, meta: Meta, msg = '成功'): Response {
  return Response.json({ code: 0, msg, data, meta } satisfies ApiResponse<T>);
}

/** 失敗響應 */
export function err(msg: string, code = 1): Response {
  const status = code >= 2000 ? 401 : 400;
  return Response.json({ code, msg } satisfies ApiResponse, { status });
}

/** 權限拒絕響應 (HTTP 403) — 不觸發前端登出，僅提示無權限 */
export function forbidden(msg: string, code = 2005): Response {
  return Response.json({ code, msg } satisfies ApiResponse, { status: 403 });
}

/** 404 響應 */
export function notFound(msg: string): Response {
  return Response.json({ code: 1004, msg } satisfies ApiResponse, { status: 404 });
}
