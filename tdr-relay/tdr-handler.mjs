import worker from "../tdr-worker/worker.js";
import { safeErrorCode } from "./upstream.mjs";

// Reuse the original data mapping and NDJSON API. Only the HTTPS transport
// changes: Node supplies the verified intermediate already used by the relay.
export function createTdrHandler({ allegroRequest, allegroRequestFactory, deadlineMs = 45000 }) {
  return async function handler(request) {
    const upstream = allegroRequestFactory ? allegroRequestFactory() : allegroRequest;
    const url = new URL(request.url);
    const controller = new AbortController();
    const callerSignal = request.signal;
    let expired = false;
    const abort = () => controller.abort();
    callerSignal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { expired = true; controller.abort(); }, deadlineMs);
    timer.unref?.();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      callerSignal.removeEventListener("abort", abort);
      controller.abort();
      if (allegroRequestFactory) upstream.close?.();
    };
    const env = { ALLOWED_ORIGIN: url.origin, TDR_QUERY_CONCURRENCY: 2 };
    const fail = (message, code, status) => new Response(JSON.stringify({ error: message, code }), {
      status, headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store",
        ...(request.headers.get("origin") === "https://bobwzw2.github.io" || request.headers.get("origin") === url.origin
          ? { "Access-Control-Allow-Origin": request.headers.get("origin"), Vary: "Origin" } : {}) }
    });
    const transport = async (destination, init = {}) => {
      const target = new URL(destination);
      if (target.origin !== "https://ops.culines.com" || target.search || target.hash) {
        throw Object.assign(new Error("Allegro 请求地址无效"), { code: "INVALID_REQUEST" });
      }
      try {
        const result = await upstream({ method: init.method || "GET", pathname: target.pathname,
          headers: Object.fromEntries(new Headers(init.headers)), body: init.body || "" }, controller.signal);
        return new Response([204, 205, 304].includes(result.status) ? null : result.body,
          { status: result.status, headers: result.headers });
      } catch (error) {
        throw Object.assign(new Error(expired ? "Allegro 查询超时，请重试这个口岸" : `云端连接 Allegro 失败 (${safeErrorCode(error)})`),
          { code: expired ? "ALLEGRO_TIMEOUT" : "ALLEGRO_CONNECTION_ERROR" });
      }
    };
    transport.close = close;
    env.ALLEGRO_TRANSPORT = transport;
    try {
      if (request.method === "POST") {
        const text = await request.text();
        if (Buffer.byteLength(text) > 64 * 1024) { close(); return fail("请求数据过大", "INVALID_REQUEST", 413); }
        let payload;
        try { payload = JSON.parse(text); } catch { close(); return fail("请求格式不正确", "INVALID_REQUEST", 400); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          close(); return fail("请求格式不正确", "INVALID_REQUEST", 400);
        }
        // Two ports share login and voyage lookups, with bounded parallel reads.
        // Keep each small batch below the provider's 60 second execution limit.
        if (url.pathname === "/api/tdr/batch" && (!Array.isArray(payload.queries) || payload.queries.length < 1 || payload.queries.length > 2)) {
          close(); return fail("每次请求最多查询两个口岸", "BATCH_LIMIT", 400);
        }
        request = new Request(request.url, { method: request.method, headers: request.headers, body: text, signal: request.signal });
      }
      if (request.signal.aborted) controller.abort();
      const response = await worker.fetch(request, env);
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) close();
      else {
        const reader = response.body.getReader();
        return new Response(new ReadableStream({
          async pull(output) {
            try {
              const { done, value } = await reader.read();
              if (done) { close(); output.close(); } else output.enqueue(value);
            } catch (error) { close(); output.error(error); }
          },
          async cancel(reason) { close(); await reader.cancel(reason); }
        }), { status: response.status, headers: response.headers });
      }
      return response;
    } catch {
      close(); return fail("TDR 请求未完成，请重试", "TDR_QUERY_FAILED", 502);
    }
  };
}
