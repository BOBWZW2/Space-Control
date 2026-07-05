const VERSION = "1.0.0";
const DEFAULT_ALLOWED_ORIGIN = "https://bobwzw2.github.io";

function json(data, init = {}, request, env) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
      ...(init.headers || {})
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = String(env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN);
  const allowed = new Set([
    configured,
    DEFAULT_ALLOWED_ORIGIN,
    "http://127.0.0.1:4318",
    "http://localhost:4318"
  ]);
  return {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : configured,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function emptyCache() {
  return { version: 1, updatedAt: "", records: {} };
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanVvd(value) {
  return cleanText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizeCache(cache) {
  const raw = cache && typeof cache === "object" ? cache : {};
  return {
    version: Number(raw.version) || 1,
    updatedAt: cleanText(raw.updatedAt),
    records: raw.records && typeof raw.records === "object" ? raw.records : {}
  };
}

function repoConfig(env) {
  return {
    owner: cleanText(env.GITHUB_OWNER) || "BOBWZW2",
    repo: cleanText(env.GITHUB_REPO) || "Space-Control",
    branch: cleanText(env.GITHUB_BRANCH) || "main",
    path: cleanText(env.CACHE_PATH) || "data/space-control-cache.json"
  };
}

function githubHeaders(env) {
  const token = cleanText(env.GITHUB_TOKEN);
  if (!token) throw new Error("GITHUB_TOKEN secret is not configured");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "space-control-sync-worker"
  };
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64Utf8(text) {
  const binary = atob(String(text || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubError(response) {
  try {
    const payload = await response.json();
    return payload.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function readCacheFile(env) {
  const { owner, repo, branch, path } = repoConfig(env);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: githubHeaders(env),
    cache: "no-store"
  });
  if (response.status === 404) return { cache: emptyCache(), sha: "" };
  if (!response.ok) throw new Error(await githubError(response));
  const payload = await response.json();
  const content = payload.content ? decodeBase64Utf8(payload.content) : "{}";
  return {
    cache: normalizeCache(JSON.parse(content || "{}")),
    sha: payload.sha || ""
  };
}

async function writeCacheFile(env, cache, sha, message) {
  const { owner, repo, branch, path } = repoConfig(env);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const body = {
    message,
    branch,
    content: encodeBase64Utf8(`${JSON.stringify(cache, null, 2)}\n`)
  };
  if (sha) body.sha = sha;
  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await githubError(response));
  return response.json();
}

async function updateCache(env, mutate) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readCacheFile(env);
    const cache = normalizeCache(current.cache);
    mutate(cache);
    cache.updatedAt = new Date().toISOString();
    const result = await writeCacheFile(env, cache, current.sha, "Save space control cache via sync proxy")
      .catch((error) => {
        if (attempt === 0 && /409|sha/i.test(String(error.message || error))) return null;
        throw error;
      });
    if (result) return { cache, result };
  }
  throw new Error("GitHub cache conflict");
}

function validateRecord(record) {
  if (!record || typeof record !== "object") throw new Error("record is required");
  const vvd = cleanVvd(record.vvd);
  if (!vvd) throw new Error("record.vvd is required");
  if (vvd.length > 32) throw new Error("record.vvd is too long");
  const jsonText = JSON.stringify(record);
  if (jsonText.length > 250000) throw new Error("record is too large");
  return { ...record, vvd };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, version: VERSION }, {}, request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/cache") {
    const { cache } = await readCacheFile(env);
    return json({ ok: true, cache }, {}, request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/cache/record") {
    const payload = await request.json().catch(() => ({}));
    const record = validateRecord(payload.record);
    const { cache } = await updateCache(env, (draft) => {
      draft.records[record.vvd] = record;
    });
    return json({ ok: true, cache }, {}, request, env);
  }
  return json({ ok: false, error: "Not found" }, { status: 404 }, request, env);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: error.message || String(error) }, { status: 500 }, request, env);
    }
  }
};
