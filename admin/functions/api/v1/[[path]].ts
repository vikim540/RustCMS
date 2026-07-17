/**
 * Pages Function: 通過 Service Binding 代理所有 /api/* 請求到 Worker
 *
 * 使用 Service Bindings 實現 Pages ↔ Worker 零延遲內部通信
 * 不走公網，不消耗額外 subrequest 配額
 *
 * 配置: admin/wrangler.jsonc 中需添加 services 綁定:
 *   { "binding": "API", "service": "rust-cms" }
 */

interface Env {
  API: Fetcher; // Service binding to rust-cms Worker
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const targetUrl = new URL(url.pathname + url.search, 'https://rust-cms.internal');

  // 如果 Service Binding 未配置，回退到公網 fetch
  if (!context.env.API) {
    const fallbackUrl = `https://cms.vikim.eu.org${url.pathname}${url.search}`;
    const fallbackRequest = new Request(fallbackUrl, {
      method: context.request.method,
      headers: context.request.headers,
      body: context.request.body,
      redirect: 'manual',
    });
    const response = await fetch(fallbackRequest);
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    return newResponse;
  }

  // 通過 Service Binding 轉發請求 (零延遲，不走公網)
  const response = await context.env.API.fetch(targetUrl.toString(), {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });

  // 複製響應，添加 CORS 頭
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  return newResponse;
};
