const VERSION = "1.2.0";
const DEFAULT_ALLOWED_ORIGIN = "https://bobwzw2.github.io";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const DEFAULT_TDR_API_URL = "https://space-control-tdr.2119990716.workers.dev";

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

function binary(data, init = {}, request, env) {
  return new Response(data, {
    ...init,
    headers: {
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

function githubHeaders(env, accept = "application/vnd.github+json") {
  const token = cleanText(env.GITHUB_TOKEN);
  if (!token) throw new Error("GITHUB_TOKEN secret is not configured");
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "space-control-sync-worker"
  };
}

function githubContentUrl(owner, repo, branch, path) {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
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
  const url = githubContentUrl(owner, repo, branch, path);
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

function scheduleConfig(env) {
  return {
    owner: cleanText(env.SCHEDULE_GITHUB_OWNER) || "BOBWZW2",
    repo: cleanText(env.SCHEDULE_GITHUB_REPO) || "data-base",
    branch: cleanText(env.SCHEDULE_GITHUB_BRANCH) || "main",
    path: cleanText(env.SCHEDULE_PATH) || "schedule_latest.xlsx"
  };
}

async function readScheduleFile(env) {
  const { owner, repo, branch, path } = scheduleConfig(env);
  const response = await fetch(githubContentUrl(owner, repo, branch, path), {
    headers: githubHeaders(env, "application/vnd.github.raw"),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(await githubError(response));
  return response.arrayBuffer();
}

function mappingConfigs(env) {
  const canonical = {
    owner: cleanText(env.MAPPING_GITHUB_OWNER) || "BOBWZW2",
    repo: cleanText(env.MAPPING_GITHUB_REPO) || "data-base",
    branch: cleanText(env.MAPPING_GITHUB_BRANCH) || "main",
    path: cleanText(env.MAPPING_PATH) || "vessel_mapping_latest.csv"
  };
  const published = {
    owner: cleanText(env.GITHUB_OWNER) || "BOBWZW2",
    repo: cleanText(env.GITHUB_REPO) || "Space-Control",
    branch: cleanText(env.GITHUB_BRANCH) || "main",
    path: cleanText(env.PUBLISHED_MAPPING_PATH) || "data/vessel_mapping_latest.csv"
  };
  const key = (item) => `${item.owner}/${item.repo}/${item.branch}/${item.path}`;
  return [...new Map([canonical, published].map((item) => [key(item), item])).values()];
}

async function readGithubTextFile(env, config) {
  const response = await fetch(githubContentUrl(config.owner, config.repo, config.branch, config.path), {
    headers: githubHeaders(env),
    cache: "no-store"
  });
  if (response.status === 404) return { text: "", sha: "" };
  if (!response.ok) throw new Error(await githubError(response));
  const payload = await response.json();
  return {
    text: payload.content ? decodeBase64Utf8(payload.content) : "",
    sha: payload.sha || ""
  };
}

async function writeGithubTextFile(env, config, text, sha, message) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path).replace(/%2F/g, "/")}`;
  const body = {
    message,
    branch: config.branch,
    content: encodeBase64Utf8(text)
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

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function csvCell(value) {
  const text = String(value || "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeMappingEntries(entries) {
  const byCode = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const code = cleanText(entry?.code).toUpperCase();
    const name = cleanText(entry?.name).toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(code) || !name || name.length > 120) return;
    byCode.set(code, { code, name });
  });
  return [...byCode.values()];
}

function mergeVesselMappingCsv(text, entries) {
  const records = new Map();
  String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).slice(1).forEach((line) => {
    if (!line.trim()) return;
    const [code, name, active = "Y", updatedAt = "", source = ""] = parseCsvLine(line).map(cleanText);
    if (code && name) records.set(code.toUpperCase(), {
      code: code.toUpperCase(),
      name: name.toUpperCase(),
      active: active || "Y",
      updatedAt,
      source
    });
  });
  const today = new Date().toISOString().slice(0, 10);
  entries.forEach(({ code, name }) => records.set(code, {
    code,
    name,
    active: "Y",
    updatedAt: today,
    source: "Allegro VVD lookup"
  }));
  const lines = ["VESSEL_CODE,VESSEL_NAME,ACTIVE,UPDATED_AT,SOURCE"];
  [...records.values()].sort((a, b) => a.code.localeCompare(b.code)).forEach((record) => {
    lines.push([record.code, record.name, record.active, record.updatedAt, record.source].map(csvCell).join(","));
  });
  return `${lines.join("\n")}\n`;
}

async function updateVesselMappingFile(env, config, entries) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readGithubTextFile(env, config);
    const text = mergeVesselMappingCsv(current.text, entries);
    try {
      await writeGithubTextFile(env, config, text, current.sha, "Refresh Allegro vessel mapping");
      return `${config.owner}/${config.repo}:${config.path}`;
    } catch (error) {
      if (attempt === 0 && /409|sha/i.test(String(error.message || error))) continue;
      throw error;
    }
  }
  throw new Error(`Vessel mapping conflict: ${config.owner}/${config.repo}`);
}

async function refreshVesselMapping(request, env) {
  const payload = await request.json().catch(() => ({}));
  const vvds = [...new Set((Array.isArray(payload.vvds) ? payload.vvds : [])
    .map(cleanVvd)
    .filter((vvd) => /^[A-Z]+\d+[A-Z]+$/.test(vvd)))]
    .slice(0, 60);
  if (!vvds.length) throw new Error("vvds is required");
  const tdrBase = cleanText(env.TDR_API_URL) || DEFAULT_TDR_API_URL;
  const response = await fetch(`${tdrBase.replace(/\/+$/, "")}/api/vessels/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: cleanText(payload.username),
      password: String(payload.password || ""),
      vvds
    })
  });
  const resolved = await response.json().catch(() => ({}));
  if (!response.ok || resolved.ok === false) {
    const error = new Error(resolved.error || `TDR vessel lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const entries = normalizeMappingEntries(resolved.entries);
  if (!entries.length) {
    return { entries: [], failures: resolved.failures || [], updated: [] };
  }
  const updated = [];
  for (const config of mappingConfigs(env)) {
    updated.push(await updateVesselMappingFile(env, config, entries));
  }
  return { entries, failures: resolved.failures || [], updated };
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
  if (request.method === "GET" && url.pathname === "/api/schedule/latest") {
    const buffer = await readScheduleFile(env);
    return binary(buffer, {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Cache-Control": "no-store"
      }
    }, request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/vessel-mapping/latest") {
    const [config] = mappingConfigs(env);
    const { text } = await readGithubTextFile(env, config);
    return binary(text, {
      headers: {
        "Content-Type": CSV_CONTENT_TYPE,
        "Cache-Control": "no-store"
      }
    }, request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/vessel-mapping/refresh") {
    const result = await refreshVesselMapping(request, env);
    return json({ ok: true, ...result }, {}, request, env);
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
      return json({ ok: false, error: error.message || String(error) }, { status: error.status || 500 }, request, env);
    }
  }
};
