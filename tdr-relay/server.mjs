import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createAllegroRequest, validateInput, diagnose, safeErrorCode } from "./upstream.mjs";

export function createRelayServer({ token, allegroRequest = createAllegroRequest() } = {}) {
  if (typeof token !== "string" || token.length < 32 || /\s/.test(token)) throw new Error("RELAY_ACCESS_TOKEN must contain at least 32 non-space characters");
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  const authorized = request => timingSafeEqual(expected, createHash("sha256").update(request.headers.authorization || "").digest());
  return http.createServer({ requestTimeout: 120000, headersTimeout: 15000, maxHeaderSize: 16384 }, async (request, response) => {
    const send = (status, value) => {
      if (response.destroyed) return;
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && ["/", "/setup.js"].includes(request.url)) {
      const script = request.url === "/setup.js";
      response.writeHead(200, {
        "Content-Type": script ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
      });
      response.end(readFileSync(new URL(script ? "./setup.js" : "./setup.html", import.meta.url)));
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      send(200, { ok: true, version: "1.0.0", tlsVerification: "required", intermediateCertificate: "bundled", storesCredentials: false });
      return;
    }
    if (!authorized(request)) { request.resume(); send(401, { error: "Unauthorized" }); return; }
    const controller = new AbortController();
    request.on("aborted", () => controller.abort());
    response.on("close", () => { if (!response.writableFinished) controller.abort(); });
    if (request.method === "GET" && request.url === "/v1/diagnostics") {
      const result = await diagnose(allegroRequest, controller.signal);
      send(result.ok ? 200 : 502, result);
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/allegro") { request.resume(); send(404, { error: "Not found" }); return; }
    if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) {
      request.resume(); send(415, { error: "JSON required" }); return;
    }
    let input;
    try {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) { send(413, { error: "Request too large" }); request.destroy(); return; }
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      validateInput(input);
    } catch { send(400, { error: "Invalid relay request" }); return; }
    try { send(200, await allegroRequest(input, controller.signal)); }
    catch (error) { send(502, { error: "Allegro connection failed", code: safeErrorCode(error) }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 10000);
  const server = createRelayServer({ token: process.env.RELAY_ACCESS_TOKEN });
  server.listen(port, "0.0.0.0", () => console.log(`Allegro relay listening on port ${port}`));
  process.on("SIGTERM", () => { server.close(); server.closeIdleConnections(); });
}
