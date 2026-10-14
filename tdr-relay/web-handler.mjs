import { createHash, timingSafeEqual } from "node:crypto";
import { validateInput, diagnose, safeErrorCode } from "./upstream.mjs";

export function createWebRelayHandler({ getToken, allegroRequest, maxResponseBytes = 5 * 1024 * 1024 }) {
  const send = (status, payload) => new Response(JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
  } });
  return async function handler(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const token = getToken();
      const configured = typeof token === "string" && token.length >= 32 && !/\s/.test(token);
      return send(configured ? 200 : 503, { ok: configured, version: "1.1.0", tlsVerification: "required",
        intermediateCertificate: "bundled", storesCredentials: false, accessTokenConfigured: configured });
    }
    const token = getToken();
    if (typeof token !== "string" || token.length < 32 || /\s/.test(token)) return send(503, { error: "Relay not configured" });
    const digest = value => createHash("sha256").update(value).digest();
    if (!timingSafeEqual(digest("Bearer " + token), digest(request.headers.get("authorization") || ""))) {
      return send(401, { error: "Unauthorized" });
    }
    if (url.search) return send(400, { error: "Query parameters not allowed" });
    if (request.method === "GET" && url.pathname === "/v1/diagnostics") {
      const result = await diagnose(allegroRequest, request.signal);
      return send(result.ok ? 200 : 502, result);
    }
    if (request.method !== "POST" || url.pathname !== "/v1/allegro") return send(404, { error: "Not found" });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) return send(415, { error: "JSON required" });
    let input;
    try {
      const reader = request.body?.getReader();
      if (!reader) return send(400, { error: "JSON required" });
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 256 * 1024) { await reader.cancel(); return send(413, { error: "Request too large" }); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      validateInput(input);
    } catch { return send(400, { error: "Invalid relay request" }); }
    try {
      const result = await allegroRequest(input, request.signal);
      const response = send(200, result);
      // Stay below Netlify's 6 MB buffered response limit, including the JSON
      // envelope and escaping. Never silently return partial TDR data.
      if (Buffer.byteLength(await response.clone().text()) > maxResponseBytes) {
        return send(502, { error: "Allegro response too large", code: "RESPONSE_TOO_LARGE" });
      }
      return response;
    } catch (error) { return send(502, { error: "Allegro connection failed", code: safeErrorCode(error) }); }
  };
}
