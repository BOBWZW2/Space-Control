const VERSION = "2.4.2";
const ALLEGRO_BASE_URL = "https://ops.culines.com";
const DEFAULT_ALLOWED_ORIGIN = "https://bobwzw2.github.io";

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function rounded(value) {
  return Math.round(numeric(value) * 10) / 10;
}

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

function rowsFromList(list, source) {
  return (list || []).map((row) => ({
    source,
    so: normalized(row.slotOwnPtrId),
    co: normalized(row.contOprPtrId),
    pod: normalized(row.pod),
    qty20: numeric(row.fds22) + numeric(row.fds25),
    qty40: numeric(row.fds42) + numeric(row.fds45) + numeric(row.fdsl5),
    empty20: numeric(row.eds22) + numeric(row.eds25),
    empty40: numeric(row.eds42) + numeric(row.eds45) + numeric(row.edsl5),
    weight: rounded(numeric(row.wt22) + numeric(row.wt25) + numeric(row.wt42) + numeric(row.wt45) + numeric(row.wtl5))
  })).filter((row) => row.pod);
}

function specialRows(list) {
  return (list || []).map((row) => ({
    so: normalized(row.slotOwnPtrId),
    co: normalized(row.contOprPtrId),
    pod: normalized(row.pod),
    tk20: numeric(row.tds22),
    tk40: numeric(row.tds42),
    dg20: numeric(row.dds22),
    dg40: numeric(row.dds42),
    rf20: numeric(row.rds22),
    rf40: numeric(row.rds42)
  })).filter((row) => row.pod && (row.tk20 || row.tk40 || row.dg20 || row.dg40 || row.rf20 || row.rf40));
}

class AllegroTdrClient {
  constructor({ username, password }, transport = fetch) {
    this.transport = transport;
    this.username = String(username || "");
    this.password = String(password || "");
    this.cookies = new Map();
    this.authenticated = false;
    this.voyageCache = new Map();
    this.portCache = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  absorbCookies(response) {
    const getSetCookie = response.headers.getSetCookie;
    const values = typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const line of values) {
      const match = String(line).match(/(?:^|,\s*)([^=;,\s]+)=([^;,]*)/);
      if (match) this.cookies.set(match[1], match[2]);
    }
  }

  async login() {
    if (this.authenticated) return;
    if (!this.username || !this.password) {
      throw codedError("Allegro 账号或密码未填写", "AUTH_REQUIRED");
    }
    const landing = await this.transport(`${ALLEGRO_BASE_URL}/oceans/nawlogon.do`, { redirect: "manual" });
    this.absorbCookies(landing);
    await landing.text();
    const payload = await this.post("/oceans/general.signon", {
      header: {},
      signon: { usrId: this.username, usrPwd: this.password }
    }, "/oceans/nawlogon.do");
    if (!/^success$/i.test(String(payload.signon?.signOnResult || ""))) {
      throw codedError("Allegro 登录失败，账号或密码不正确", "AUTH_FAILED");
    }
    this.authenticated = true;
  }

  async post(pathname, body, referer = "/oceans/VOP_M3001.do") {
    const response = await this.transport(`${ALLEGRO_BASE_URL}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: ALLEGRO_BASE_URL,
        Referer: `${ALLEGRO_BASE_URL}${referer}`,
        Cookie: this.cookieHeader()
      },
      body: JSON.stringify(body),
      redirect: "manual"
    });
    this.absorbCookies(response);
    const text = await response.text();
    if (response.status === 526) {
      const error = codedError(`Allegro 接口 ${pathname} 证书校验失败 (526)`, "ALLEGRO_TLS_ERROR");
      error.status = 526;
      throw error;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw codedError(`Allegro 接口 ${pathname} 返回无法解析的数据 (${response.status})`, "INVALID_RESPONSE");
    }
    if (!response.ok || payload.header?.errorMessageProcessed || String(payload.header?.returnCode || "0") !== "0") {
      throw codedError(payload.header?.messageCode || `Allegro 请求失败 (${response.status})`, "ALLEGRO_REQUEST_FAILED");
    }
    return payload;
  }

  async service(operation, application, service, datasetName, dataset) {
    return this.post("/serviceEndpoint/json", {
      header: { programNr: "VOP_M3001", application, service, operation },
      [datasetName]: dataset
    });
  }

  async voyage(vvd) {
    const key = normalized(vvd);
    if (this.voyageCache.has(key)) return this.voyageCache.get(key);
    const task = this.service("udcMdm", "CntrBCM", "SvcBCM5001", "ComUDCInOMM", {
      delYn: "N",
      bizType: "mdmValid",
      bizKey: "mdmVVD",
      biz01: key
    }).then((payload) => {
      const row = payload.ComUDCOutListOMM?.outUdcOmms?.[0];
      if (!row) throw codedError(`未找到航次 ${key}`, "VVD_NOT_FOUND");
      return {
        vessel: row.value01,
        voyage: row.value02,
        direction: row.value03,
        lane: row.value04,
        vesselName: row.value06
      };
    });
    this.voyageCache.set(key, task);
    return task;
  }

  async ports(voyage) {
    const key = `${voyage.vessel}${voyage.voyage}${voyage.direction}`;
    if (this.portCache.has(key)) return this.portCache.get(key);
    const task = this.service("udcBiz", "CntrBCM", "SvcBCM3001", "ComUDCInOMM", {
      delYn: "N",
      bizType: "bizKeyCombo",
      bizKey: "BizSearchPol",
      bizModule: "VOP",
      obj01: voyage.vessel,
      obj02: voyage.voyage,
      obj03: voyage.direction,
      obj04: "Y"
    }).then((payload) => (payload.ComUDCOutListOMM?.outUdcOmms || []).map((row) => ({
      terminal: row.value02 || row.value01,
      portScheduleSequence: String(row.value03 || ""),
      terminalName: row.value04 || "",
      port: normalized(row.value05),
      callingPortSequence: String(row.value06 || "")
    })));
    this.portCache.set(key, task);
    return task;
  }

  async query(vvd, pol) {
    const startedAt = performance.now();
    await this.login();
    const voyage = await this.voyage(vvd);
    const ports = await this.ports(voyage);
    const selected = ports.find((item) => item.port === normalized(pol));
    if (!selected) throw codedError(`未找到 ${pol} 对应的 Terminal`, "TERMINAL_NOT_FOUND");
    const condition = {
      condVslCd: voyage.vessel,
      condVoyNr: voyage.voyage,
      condDirCd: voyage.direction,
      condFclCd: selected.terminal,
      condPortSchSeq: selected.portScheduleSequence,
      condPortCd: selected.port,
      condPortInldYn: "Y",
      condClgPortSeq: selected.callingPortSequence
    };
    const system = await this.service("searchTdrSysCode", "CntrVOP", "SvcVOP0401", "TdrCondOMM", condition);
    const systemCode = system.ComUDCOutOMM?.value01;
    if (!systemCode) throw codedError(`${pol} 未找到 TDR System Code`, "TDR_NOT_FOUND");
    const loading = await this.service("searchTdrLodingListM3001", "CntrVOP", "SvcVOP0401", "TdrCondOMM", {
      ...condition,
      hdrSysCd: systemCode
    });
    const group = loading.TdrLoadingGroupOMM || {};
    return {
      vvd: normalized(vvd),
      pol: selected.port,
      terminal: selected.terminal,
      rows: [
        ...rowsFromList(group.oceanLoadingList, "ocean"),
        ...rowsFromList(group.interportLoadingList, "interport")
      ],
      special: specialRows(group.specialLoadingList),
      fetchedAt: new Date().toISOString(),
      timing: { totalMs: Math.round(performance.now() - startedAt) }
    };
  }
}

// A new, short-lived browser session is created for each incoming TDR request.
// Chromium keeps normal certificate verification enabled and owns its cookies.
class CloudBrowserSession {
  constructor(binding) {
    this.binding = binding;
    this.socket = null;
    this.sessionId = null;
    this.commandId = 0;
    this.pending = new Map();
    this.closed = false;
  }

  async open() {
    try {
      const session = await this.binding.acquire({ keepAlive: 10000, recording: false });
      this.sessionId = session.sessionId;
      if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
      const target = await this.binding.devtools.newTarget(this.sessionId, "about:blank");
      if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
      const connection = await this.binding.connectSession(this.sessionId, { targetId: target.id });
      const response = await connection.webSocket.fetch("https://browser-binding.invalid", {
        headers: { Upgrade: "websocket" }
      });
      if (!response.webSocket) throw codedError("云端浏览器连接失败", "BROWSER_CONNECTION_FAILED");
      this.socket = response.webSocket;
      if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
      this.socket.accept();
      this.socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(codedError("云端浏览器通信失败", "BROWSER_PROTOCOL_ERROR"));
        else pending.resolve(message.result);
      });
      this.socket.addEventListener("close", () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(codedError("云端浏览器连接已关闭", "BROWSER_CONNECTION_CLOSED"));
        }
        this.pending.clear();
      });
      await this.command("Page.enable");
      const loaded = this.waitForLoad();
      try {
        const navigation = await this.command("Page.navigate", {
          url: `${ALLEGRO_BASE_URL}/oceans/nawlogon.do`
        });
        if (navigation.errorText) {
          throw codedError(`云端浏览器无法安全连接 Allegro (${navigation.errorText})`, "BROWSER_NAVIGATION_FAILED");
        }
        await loaded.promise;
      } finally {
        loaded.cancel();
      }
      const origin = await this.evaluate("location.origin");
      if (origin !== ALLEGRO_BASE_URL) {
        throw codedError("Allegro 登录页跳转到了其他网站，已停止查询", "BROWSER_ORIGIN_MISMATCH");
      }
    } catch (error) {
      await this.close();
      if (error?.code) throw error;
      throw codedError("云端浏览器未能启动，请检查 Browser Run 绑定及可用额度", "BROWSER_UNAVAILABLE");
    }
  }

  command(method, params = {}) {
    if (this.closed) return Promise.reject(codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED"));
    const id = ++this.commandId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(codedError("云端浏览器操作超时", "BROWSER_TIMEOUT"));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(codedError("云端浏览器连接失败", "BROWSER_CONNECTION_FAILED"));
      }
    });
  }

  waitForLoad() {
    let cleanup;
    let resolveWait;
    const promise = new Promise((resolve, reject) => {
      resolveWait = resolve;
      const onMessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.method === "Page.loadEventFired") { cleanup(); resolve(); }
      };
      const onClose = () => {
        cleanup();
        reject(codedError("云端浏览器连接已关闭", "BROWSER_CONNECTION_CLOSED"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(codedError("Allegro 登录页加载超时", "BROWSER_TIMEOUT"));
      }, 45000);
      cleanup = () => {
        clearTimeout(timer);
        this.socket?.removeEventListener("message", onMessage);
        this.socket?.removeEventListener("close", onClose);
      };
      this.socket.addEventListener("message", onMessage);
      this.socket.addEventListener("close", onClose);
    });
    // Navigation can fail before its load event; cancellation also clears the timer.
    promise.catch(() => undefined);
    return { promise, cancel: () => { cleanup(); resolveWait(); } };
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) throw codedError("云端浏览器请求 Allegro 失败", "BROWSER_REQUEST_FAILED");
    return result.result?.value;
  }

  async post(pathname, body, referer) {
    if (!["/oceans/general.signon", "/serviceEndpoint/json"].includes(pathname)) {
      throw codedError("不支持的 Allegro 接口", "INVALID_ALLEGRO_PATH");
    }
    const input = JSON.stringify({ origin: ALLEGRO_BASE_URL, pathname, body, referer });
    return this.evaluate(`(async (input) => {
      if (location.origin !== input.origin) throw new Error("Unexpected origin");
      const response = await fetch(input.origin + input.pathname, {
        method: "POST",
        credentials: "include",
        redirect: "error",
        referrer: input.origin + input.referer,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify(input.body)
      });
      return { status: response.status, ok: response.ok, text: await response.text() };
    })(${input})`);
  }

  async close() {
    this.closed = true;
    const sessionId = this.sessionId;
    this.sessionId = null;
    try { this.socket?.close(1000, "Complete"); } catch { /* Already closed. */ }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(codedError("云端浏览器连接已关闭", "BROWSER_CONNECTION_CLOSED"));
    }
    this.pending.clear();
    if (sessionId) {
      try { await this.binding.closeSession(sessionId); } catch { /* keepAlive bounds orphan sessions. */ }
    }
  }
}

class BrowserAllegroTdrClient extends AllegroTdrClient {
  constructor(credentials, binding) {
    super(credentials);
    this.browser = new CloudBrowserSession(binding);
    this.loginPromise = null;
  }

  async login() {
    if (!this.loginPromise) this.loginPromise = (async () => {
      if (!this.username || !this.password) throw codedError("Allegro 账号或密码未填写", "AUTH_REQUIRED");
      await this.browser.open();
      const payload = await this.post("/oceans/general.signon", {
        header: {}, signon: { usrId: this.username, usrPwd: this.password }
      }, "/oceans/nawlogon.do");
      if (!/^success$/i.test(String(payload.signon?.signOnResult || ""))) {
        throw codedError("Allegro 登录失败，账号或密码不正确", "AUTH_FAILED");
      }
      this.authenticated = true;
    })();
    return this.loginPromise;
  }

  async post(pathname, body, referer = "/oceans/VOP_M3001.do") {
    const response = await this.browser.post(pathname, body, referer);
    let payload;
    try { payload = JSON.parse(response.text); } catch {
      throw codedError(`Allegro 接口 ${pathname} 返回无法解析的数据 (${response.status})`, "INVALID_RESPONSE");
    }
    if (!response.ok || payload.header?.errorMessageProcessed || String(payload.header?.returnCode || "0") !== "0") {
      throw codedError(payload.header?.messageCode || `Allegro 请求失败 (${response.status})`, "ALLEGRO_REQUEST_FAILED");
    }
    return payload;
  }

  close() { return this.browser.close(); }
}

class ResilientTdrClient {
  constructor(credentials, env) {
    this.credentials = credentials;
    this.binding = env.BROWSER;
    this.relay = env.ALLEGRO_RELAY_URL ? new RelayTransport(env) : null;
    this.nativeTransport = typeof env.ALLEGRO_TRANSPORT === "function" ? env.ALLEGRO_TRANSPORT : null;
    this.active = new AllegroTdrClient(credentials, this.relay ? this.relay.fetch.bind(this.relay) : this.nativeTransport || fetch);
    this.browser = null;
    this.switchPromise = null;
    this.closed = false;
  }

  async call(method, ...args) {
    if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
    const client = this.active;
    try {
      return await client[method](...args);
    } catch (error) {
      if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
      if (this.relay || client === this.browser || error?.status !== 526 || !this.binding?.acquire) throw error;
      if (!this.switchPromise) this.switchPromise = (async () => {
        this.browser = new BrowserAllegroTdrClient(this.credentials, this.binding);
        await this.browser.login();
        this.active = this.browser;
        return this.browser;
      })();
      const browser = await this.switchPromise;
      return browser[method](...args);
    }
  }

  query(...args) { return this.call("query", ...args); }
  login(...args) { return this.call("login", ...args); }
  voyage(...args) { return this.call("voyage", ...args); }
  async close() { this.closed = true; this.relay?.close(); this.nativeTransport?.close?.(); await this.browser?.close(); }
}

class RelayTransport {
  constructor(env) {
    this.controllers = new Set();
    this.closed = false;
    let url;
    try { url = new URL(String(env.ALLEGRO_RELAY_URL)); } catch { /* validated below */ }
    if (!url || url.protocol !== "https:" || ![".onrender.com", ".netlify.app"].some(suffix => url.hostname.endsWith(suffix))
        || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash
        || !/^[^\s]{32,}$/.test(String(env.ALLEGRO_RELAY_TOKEN || ""))) {
      this.configurationError = codedError("云端代理配置不完整，请检查代理地址及访问密钥", "RELAY_CONFIGURATION_ERROR");
      return;
    }
    this.url = new URL("/v1/allegro", url).href;
    this.token = String(env.ALLEGRO_RELAY_TOKEN);
  }

  async fetch(url, init = {}) {
    if (this.configurationError) throw this.configurationError;
    if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
    const destination = new URL(url);
    if (destination.origin !== ALLEGRO_BASE_URL || destination.search || destination.hash
        || !["/oceans/nawlogon.do", "/oceans/general.signon", "/serviceEndpoint/json"].includes(destination.pathname)) {
      throw codedError("云端代理请求地址无效", "RELAY_DESTINATION_ERROR");
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    // Includes the free service's first wake-up. Subsequent requests do not
    // spend browser minutes, and the Node upstream has its own 20s deadline.
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(this.url, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ method: init.method || "GET", pathname: destination.pathname,
          headers: Object.fromEntries(new Headers(init.headers)), body: init.body || "" })
      });
      const text = await response.text();
      if (text.length > 12 * 1024 * 1024) throw codedError("云端代理返回的数据过大", "RELAY_RESPONSE_TOO_LARGE");
      let result;
      try { result = JSON.parse(text); } catch { throw codedError("云端代理尚未就绪，请稍后重试", "RELAY_UNAVAILABLE"); }
      if (!response.ok) {
        const code = /^[A-Z0-9_]{1,64}$/.test(result?.code || "") ? ` (${result.code})` : "";
        throw codedError(`云端代理连接 Allegro 失败${code}`, "RELAY_UPSTREAM_ERROR");
      }
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599
          || typeof result.body !== "string" || !Array.isArray(result.headers)
          || result.headers.some(pair => !Array.isArray(pair) || pair.length !== 2
            || !["content-type", "set-cookie"].includes(pair[0]) || typeof pair[1] !== "string")) {
        throw codedError("云端代理返回格式无效", "RELAY_INVALID_RESPONSE");
      }
      return new Response([204, 205, 304].includes(result.status) ? null : result.body,
        { status: result.status, headers: result.headers });
    } catch (error) {
      if (this.closed) throw codedError("TDR 查询已取消", "TDR_QUERY_CANCELLED");
      if (error?.code) throw error;
      throw codedError("云端代理连接中断或超时，请稍后重试", "RELAY_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = String(env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN);
  const allowed = new Set([
    configured,
    "https://bobwzw2.github.io",
    "http://127.0.0.1",
    "http://localhost"
  ]);
  if (!origin || allowed.has(origin) || origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:")) {
    return origin || configured;
  }
  return "";
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function jsonResponse(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(request, env), "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" }
  });
}

function publicError(error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    code: error?.code || "TDR_QUERY_FAILED"
  };
}

async function parseRequest(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    throw codedError("请求格式不正确", "INVALID_REQUEST");
  }
  return payload || {};
}

async function singleQuery(request, env) {
  const payload = await parseRequest(request);
  const client = new ResilientTdrClient(payload, env);
  try {
    return jsonResponse(request, env, await client.query(payload.vvd, payload.pol));
  } catch (error) {
    const status = ["AUTH_REQUIRED", "INVALID_REQUEST"].includes(error?.code) ? 400
      : error?.code === "AUTH_FAILED" ? 401
        : error?.code === "TERMINAL_NOT_FOUND" ? 404
          : 502;
    return jsonResponse(request, env, publicError(error), status);
  } finally {
    await client.close();
  }
}

async function batchQuery(request, env) {
  const payload = await parseRequest(request);
  const queries = Array.isArray(payload.queries) ? payload.queries.slice(0, 30) : [];
  if (!queries.length) return jsonResponse(request, env, { error: "没有可查询的 POL", code: "INVALID_REQUEST" }, 400);
  if (!payload.username || !payload.password) {
    return jsonResponse(request, env, { error: "Allegro 账号或密码未填写", code: "AUTH_REQUIRED" }, 400);
  }
  const client = new ResilientTdrClient(payload, env);
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let index = 0; index < queries.length && !cancelled; index += 1) {
          const query = queries[index] || {};
          let line;
          try {
            const result = await client.query(query.vvd, query.pol);
            line = { index, ok: true, result };
          } catch (error) {
            line = { index, ok: false, ...publicError(error) };
          }
          if (cancelled) break;
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          if (line.code === "AUTH_FAILED" || line.code === "AUTH_REQUIRED") break;
        }
      } finally {
        await client.close();
        if (!cancelled) controller.close();
      }
    },
    async cancel() {
      cancelled = true;
      await client.close();
    }
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/x-ndjson; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function vesselNameBatch(request, env) {
  const payload = await parseRequest(request);
  const vvds = [...new Set((Array.isArray(payload.vvds) ? payload.vvds : [])
    .map(normalized)
    .filter((vvd) => /^[A-Z]+\d+[A-Z]+$/.test(vvd)))]
    .slice(0, 60);
  if (!vvds.length) {
    return jsonResponse(request, env, { error: "没有可查询的 VVD", code: "INVALID_REQUEST" }, 400);
  }
  const client = new ResilientTdrClient(payload, env);
  try {
    await client.login();
    const checked = await mapWithConcurrency(vvds, 5, async (vvd) => {
      try {
        const voyage = await client.voyage(vvd);
        const code = normalized(voyage.vessel);
        const name = normalized(voyage.vesselName);
        if (!code || !name) throw codedError(`${vvd} 未返回船名`, "VESSEL_NAME_NOT_FOUND");
        return { ok: true, vvd, code, name };
      } catch (error) {
        return { ok: false, vvd, ...publicError(error) };
      }
    });
    const entriesByCode = new Map();
    checked.filter((item) => item.ok).forEach((item) => entriesByCode.set(item.code, {
      code: item.code,
      name: item.name,
      vvd: item.vvd
    }));
    return jsonResponse(request, env, {
      ok: true,
      entries: [...entriesByCode.values()],
      failures: checked.filter((item) => !item.ok)
    });
  } catch (error) {
    const status = error?.code === "AUTH_FAILED" ? 401 : error?.code === "AUTH_REQUIRED" ? 400 : 502;
    return jsonResponse(request, env, publicError(error), status);
  } finally {
    await client.close();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (!allowedOrigin(request, env)) return jsonResponse(request, env, { error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }, 403);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse(request, env, {
        ok: true, version: VERSION, mode: "cloud",
        browserFallbackAvailable: typeof env.BROWSER?.acquire === "function",
        nativeTlsTransportAvailable: typeof env.ALLEGRO_TRANSPORT === "function",
        relayConfigured: Boolean(env.ALLEGRO_RELAY_URL && env.ALLEGRO_RELAY_TOKEN)
      });
    }
    if (env.SYNC_BACKEND && (
      url.pathname === "/api/cache"
      || url.pathname === "/api/cache/record"
      || url.pathname === "/api/schedule/latest"
      || url.pathname.startsWith("/api/vessel-mapping/")
    )) {
      return env.SYNC_BACKEND.fetch(request);
    }
    if (request.method === "POST" && url.pathname === "/api/tdr") return singleQuery(request, env);
    if (request.method === "POST" && url.pathname === "/api/tdr/batch") return batchQuery(request, env);
    if (request.method === "POST" && url.pathname === "/api/vessels/batch") return vesselNameBatch(request, env);
    return jsonResponse(request, env, { error: "Not found", code: "NOT_FOUND" }, 404);
  }
};
