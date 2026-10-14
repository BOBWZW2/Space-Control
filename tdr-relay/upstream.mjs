import https from "node:https";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, brotliDecompressSync, inflateSync } from "node:zlib";

export const ORIGIN = "https://ops.culines.com";
export const HOST = "ops.culines.com";
export const LOGIN = "/oceans/nawlogon.do";
export const PATHS = new Set([LOGIN, "/oceans/general.signon", "/serviceEndpoint/json"]);
const MAX_RESPONSE = 8 * 1024 * 1024;

export function supplementedCa(pem = readFileSync(new URL("./certs/geotrust-cn-intermediate.pem", import.meta.url), "utf8")) {
  const intermediate = new X509Certificate(pem);
  const now = Date.now();
  if (!intermediate.ca || Date.parse(intermediate.validFrom) > now || Date.parse(intermediate.validTo) < now) {
    throw new Error("INVALID_INTERMEDIATE_CERTIFICATE");
  }
  // Require a signature from Node's existing trusted roots. Downloaded material
  // cannot introduce a new trust anchor, even if the CA download is compromised.
  const trustedIssuer = tls.rootCertificates.some(rootPem => {
    const root = new X509Certificate(rootPem);
    return intermediate.checkIssued(root) && intermediate.verify(root.publicKey);
  });
  if (!trustedIssuer) throw new Error("UNTRUSTED_INTERMEDIATE_CERTIFICATE");
  return [...tls.rootCertificates, pem];
}

export function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_REQUEST");
  const { method, pathname } = input;
  if (!PATHS.has(pathname) || (pathname === LOGIN ? method !== "GET" : method !== "POST")) {
    throw new Error("DESTINATION_NOT_ALLOWED");
  }
  if (method === "GET" && input.body != null && input.body !== "") throw new Error("INVALID_REQUEST");
  if (method === "POST" && typeof input.body !== "string") throw new Error("INVALID_REQUEST");
  if (Buffer.byteLength(input.body || "") > 128 * 1024) throw new Error("REQUEST_TOO_LARGE");
  const supplied = input.headers || {};
  if (typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("INVALID_REQUEST");
  const headers = { "Accept-Encoding": "identity", Accept: "application/json, text/html;q=0.9" };
  for (const [rawName, value] of Object.entries(supplied)) {
    const name = rawName.toLowerCase();
    if (!["content-type", "x-requested-with", "origin", "referer", "cookie"].includes(name)) {
      throw new Error("HEADER_NOT_ALLOWED");
    }
    if (typeof value !== "string" || /[\r\n\0]/.test(value) || value.length > 8192) throw new Error("INVALID_REQUEST");
    if (name === "origin" && value !== ORIGIN) throw new Error("INVALID_ORIGIN");
    if (name === "referer" && ![`${ORIGIN}${LOGIN}`, `${ORIGIN}/oceans/VOP_M3001.do`].includes(value)) {
      throw new Error("INVALID_REFERER");
    }
    headers[name] = value;
  }
  if (method === "POST") headers["Content-Length"] = String(Buffer.byteLength(input.body));
  return { method, pathname, body: input.body || "", headers };
}

export function createAllegroRequest({ ca = supplementedCa(), request = https.request, timeoutMs = 20000 } = {}) {
  return function allegroRequest(rawInput, signal) {
    const input = validateInput(rawInput);
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => req.destroy(Object.assign(new Error("REQUEST_CANCELLED"), { code: "REQUEST_CANCELLED" }));
      const req = request({
        hostname: HOST, servername: HOST, port: 443, path: input.pathname,
        method: input.method, headers: input.headers, agent: false,
        ca, rejectUnauthorized: true, minVersion: "TLSv1.2"
      }, response => {
        const chunks = [];
        let bytes = 0;
        response.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE) {
            req.destroy(Object.assign(new Error("RESPONSE_TOO_LARGE"), { code: "RESPONSE_TOO_LARGE" }));
          } else chunks.push(chunk);
        });
        response.on("error", error => finish(error));
        response.on("aborted", () => finish(Object.assign(new Error("UPSTREAM_ABORTED"), { code: "UPSTREAM_ABORTED" })));
        response.on("end", () => {
          try {
            let data = Buffer.concat(chunks);
            const encoding = response.headers["content-encoding"];
            if (encoding === "gzip") data = gunzipSync(data, { maxOutputLength: MAX_RESPONSE });
            else if (encoding === "br") data = brotliDecompressSync(data, { maxOutputLength: MAX_RESPONSE });
            else if (encoding === "deflate") data = inflateSync(data, { maxOutputLength: MAX_RESPONSE });
            else if (encoding && encoding !== "identity") throw new Error("UNSUPPORTED_ENCODING");
            const headers = [];
            if (response.headers["content-type"]) headers.push(["content-type", response.headers["content-type"]]);
            for (const cookie of response.headers["set-cookie"] || []) headers.push(["set-cookie", cookie]);
            // Do not follow redirects: credentials can only go to the fixed hostname.
            finish(null, { status: response.statusCode, headers, body: data.toString("utf8") });
          } catch (error) { finish(error); }
        });
      });
      req.on("error", error => finish(error));
      timer = setTimeout(() => req.destroy(Object.assign(new Error("UPSTREAM_TIMEOUT"), { code: "UPSTREAM_TIMEOUT" })), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else req.end(input.body || undefined);
    });
  };
}

export async function diagnose(allegroRequest, signal) {
  // Never sends a username, password, cookie, or login attempt.
  try {
    const response = await allegroRequest({ method: "GET", pathname: LOGIN }, signal);
    const loginPageAvailable = response.status === 200 && /<html[\s>]|<form[\s>]/i.test(response.body);
    return { ok: loginPageAvailable, tlsVerified: true, status: response.status,
      loginPageAvailable, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, tlsVerified: false, code: safeErrorCode(error), checkedAt: new Date().toISOString() };
  }
}

export function safeErrorCode(error) {
  const allowed = new Set(["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN", "CERT_REVOKED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND",
    "UPSTREAM_TIMEOUT", "RESPONSE_TOO_LARGE", "UPSTREAM_ABORTED", "REQUEST_CANCELLED"]);
  return allowed.has(error?.code) ? error.code : "UPSTREAM_CONNECTION_FAILED";
}
