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

  // 如果 Service Binding 未配置，返回錯誤（不暴露 Worker 公網域名）
  if (!context.env.API) {
    return new Response(
      JSON.stringify({
        code: 500,
        msg: 'Service Binding 未配置，請聯繫管理員',
        detail: `Pages Function env.API 為空。請檢查 admin/wrangler.jsonc 中 services 綁定是否配置正確（binding: "API", service: "rust-cms"）。\n請求: ${context.request.method} ${url.pathname}${url.search}`,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  try {
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
    // 前端實際發送 X-Site-Id 頭（多站點路由），需明確放行；保留 X-API-Key 以兼容舊客戶端
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id, X-API-Key');

    return newResponse;
  } catch (e) {
    // Service Binding 調用失敗（Worker 內部異常、網絡問題等）
    const errorMsg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({
        code: 500,
        msg: '後端服務調用失敗',
        detail: `Service Binding fetch 異常: ${errorMsg}\n請求: ${context.request.method} ${url.pathname}${url.search}\n時間: ${new Date().toISOString()}`,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
};
