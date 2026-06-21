const VERSION = "2.0.0";
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
    rf20: numeric(row.rds22),
    rf40: numeric(row.rds42)
  })).filter((row) => row.pod && (row.rf20 || row.rf40));
}

class AllegroTdrClient {
  constructor({ username, password }) {
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
    const landing = await fetch(`${ALLEGRO_BASE_URL}/oceans/nawlogon.do`, { redirect: "manual" });
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
    const response = await fetch(`${ALLEGRO_BASE_URL}${pathname}`, {
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
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw codedError(`Allegro 返回无法解析的数据 (${response.status})`, "INVALID_RESPONSE");
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
  const client = new AllegroTdrClient(payload);
  try {
    return jsonResponse(request, env, await client.query(payload.vvd, payload.pol));
  } catch (error) {
    const status = ["AUTH_REQUIRED", "INVALID_REQUEST"].includes(error?.code) ? 400
      : error?.code === "AUTH_FAILED" ? 401
        : error?.code === "TERMINAL_NOT_FOUND" ? 404
          : 502;
    return jsonResponse(request, env, publicError(error), status);
  }
}

async function batchQuery(request, env) {
  const payload = await parseRequest(request);
  const queries = Array.isArray(payload.queries) ? payload.queries.slice(0, 30) : [];
  if (!queries.length) return jsonResponse(request, env, { error: "没有可查询的 POL", code: "INVALID_REQUEST" }, 400);
  if (!payload.username || !payload.password) {
    return jsonResponse(request, env, { error: "Allegro 账号或密码未填写", code: "AUTH_REQUIRED" }, 400);
  }
  const client = new AllegroTdrClient(payload);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (let index = 0; index < queries.length; index += 1) {
        const query = queries[index] || {};
        let line;
        try {
          const result = await client.query(query.vvd, query.pol);
          line = { index, ok: true, result };
        } catch (error) {
          line = { index, ok: false, ...publicError(error) };
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        if (line.code === "AUTH_FAILED" || line.code === "AUTH_REQUIRED") break;
      }
      controller.close();
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (!allowedOrigin(request, env)) return jsonResponse(request, env, { error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" }, 403);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse(request, env, { ok: true, version: VERSION, mode: "cloud" });
    }
    if (request.method === "POST" && url.pathname === "/api/tdr") return singleQuery(request, env);
    if (request.method === "POST" && url.pathname === "/api/tdr/batch") return batchQuery(request, env);
    return jsonResponse(request, env, { error: "Not found", code: "NOT_FOUND" }, 404);
  }
};
