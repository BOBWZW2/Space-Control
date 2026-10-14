import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import worker from "./worker.js";

const credentials = { username: "test-user", password: "test-only-</script>-秘密" };
const origin = "https://ops.culines.com";
const query = { vvd: "XPAG2639W", pol: "THLCH" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function fixture(pathname, body, options = {}) {
  if (pathname === "/oceans/general.signon") {
    return { signon: { signOnResult: options.authFailed ? "failed" : "success" } };
  }
  switch (body.header.operation) {
    case "udcMdm": return { ComUDCOutListOMM: { outUdcOmms: [{
      value01: "XPAG", value02: "2639", value03: "W", value04: "HLX", value06: "TEST VESSEL"
    }] } };
    case "udcBiz": return { ComUDCOutListOMM: { outUdcOmms: ["THLCH", "MYPKG"].map(port => ({
      value02: port + "T1", value03: "1", value05: port, value06: "1"
    })) } };
    case "searchTdrSysCode": return { ComUDCOutOMM: { value01: "test-system" } };
    case "searchTdrLodingListM3001": return { TdrLoadingGroupOMM: {
      oceanLoadingList: [{ slotOwnPtrId: "CUL", contOprPtrId: "CUL", pod: "INNSA",
        fds22: 2, fds25: 1, fds42: 1, fds45: 1, fdsl5: 1, eds22: 1, eds42: 2,
        wt22: 1.1, wt25: 2.2, wt42: 3.3, wt45: 4.4, wtl5: 5.5 }],
      interportLoadingList: [], specialLoadingList: []
    } };
    default: throw new Error("Unexpected fixture operation " + body.header.operation);
  }
}

function mockBrowser(options = {}) {
  const state = { acquired: 0, closed: [], posts: [], commands: [], sessions: [] };
  let entered;
  state.serviceStarted = new Promise(resolve => { entered = resolve; });
  class Socket extends EventTarget {
    accept() {}
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      state.commands.push(method);
      queueMicrotask(async () => {
        let result = {};
        if (method === "Page.navigate") result = options.navigationError ? { errorText: options.navigationError } : { frameId: "page" };
        if (method === "Runtime.evaluate") {
          try {
            const value = await vm.runInNewContext(params.expression, {
              location: { origin: options.pageOrigin || origin },
              fetch: async (url, init) => {
                assert.equal(new URL(url).origin, origin);
                assert.equal(init.redirect, "error");
                assert.equal(init.credentials, "include");
                assert.equal(init.headers.Cookie, undefined);
                const pathname = new URL(url).pathname;
                const body = JSON.parse(init.body);
                state.posts.push({ pathname, body });
                if (options.serviceGate && pathname === "/serviceEndpoint/json") {
                  entered();
                  await options.serviceGate;
                }
                if (options.invalidJson) return new Response(credentials.password, { status: 502 });
                return json(fixture(pathname, body, options));
              }
            });
            result = { result: { value } };
          } catch {
            result = { exceptionDetails: { text: "Uncaught" } };
          }
        }
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result }) }));
        if (method === "Page.navigate" && !options.navigationError) {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ method: "Page.loadEventFired" }) }));
        }
      });
    }
    close() { this.dispatchEvent(new Event("close")); }
  }
  const binding = {
    async acquire(settings) {
      state.acquired += 1;
      state.sessions.push(settings);
      if (options.acquireGate) await options.acquireGate;
      if (options.quotaExceeded) throw new Error("Browser time limit exceeded for today");
      return { sessionId: "session-" + state.acquired };
    },
    devtools: { async newTarget(id, url) { assert.equal(url, "about:blank"); return { id: "page" }; } },
    async connectSession(id, settings) {
      assert.equal(settings.targetId, "page");
      return { webSocket: { async fetch(url, init) {
        assert.equal(init.headers.Upgrade, "websocket");
        return { webSocket: new Socket() };
      } } };
    },
    async closeSession(id) { state.closed.push(id); }
  };
  return { binding, state };
}

function mockDirect(t, options = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    if (!init.body) return new Response("login page");
    const body = JSON.parse(init.body);
    const failHere = options.tls && (options.failAt !== "service" || pathname === "/serviceEndpoint/json");
    if (failHere) return new Response("Invalid SSL certificate", { status: 526 });
    if (options.nonJsonStatus) return new Response("upstream unavailable", { status: options.nonJsonStatus });
    return json(fixture(pathname, body, options));
  });
  return calls;
}

function request(pathname, payload, requestOrigin = "https://bobwzw2.github.io") {
  return new Request("https://worker.example" + pathname, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ ...credentials, ...payload })
  });
}

function assertCargo(result) {
  assert.equal(result.pol, "THLCH");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].qty20, 3);
  assert.equal(result.rows[0].qty40, 3);
  assert.equal(result.rows[0].empty20, 1);
  assert.equal(result.rows[0].empty40, 2);
  assert.equal(result.rows[0].weight, 16.5);
}

const relayEnv = { ALLEGRO_RELAY_URL: "https://test-relay.onrender.com", ALLEGRO_RELAY_TOKEN: "test-only-relay-token-0123456789abcdef" };

test("configured relay preserves login cookies and TDR results without contacting direct origin or browser", async t => {
  const { binding, state } = mockBrowser();
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, relayEnv.ALLEGRO_RELAY_URL + "/v1/allegro");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer " + relayEnv.ALLEGRO_RELAY_TOKEN);
    const input = JSON.parse(init.body);
    sent.push(input);
    if (input.method === "GET") return json({ status: 200, body: "<html>login</html>", headers: [
      ["set-cookie", "session=session-a; Secure; HttpOnly"], ["set-cookie", "route=route-b; Secure"]
    ] });
    assert.match(input.headers.cookie, /session=session-a/);
    assert.match(input.headers.cookie, /route=route-b/);
    return json({ status: 200, headers: [["content-type", "application/json"]],
      body: JSON.stringify(fixture(input.pathname, JSON.parse(input.body))) });
  });
  const response = await worker.fetch(request("/api/tdr", query), { ...relayEnv, BROWSER: binding });
  assertCargo(await response.json());
  assert.equal(sent.filter(input => input.pathname === "/oceans/general.signon").length, 1);
  assert.equal(state.acquired, 0);
});

test("relay batch retains the existing streaming format and one login per request", async t => {
  let logins = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body);
    if (input.method === "GET") return json({ status: 200, headers: [], body: "login" });
    if (input.pathname === "/oceans/general.signon") logins++;
    return json({ status: 200, headers: [], body: JSON.stringify(fixture(input.pathname, JSON.parse(input.body))) });
  });
  const response = await worker.fetch(request("/api/tdr/batch", { queries: [query, { ...query, pol: "MYPKG" }] }), relayEnv);
  const lines = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(line => [line.ok, line.result.pol]), [[true, "THLCH"], [true, "MYPKG"]]);
  assert.equal(logins, 1);
});

test("invalid relay configuration fails before credentials leave the Worker", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("network must not be contacted"));
  for (const env of [
    { ...relayEnv, ALLEGRO_RELAY_URL: "http://test-relay.onrender.com" },
    { ...relayEnv, ALLEGRO_RELAY_URL: "https://other.example" },
    { ...relayEnv, ALLEGRO_RELAY_URL: relayEnv.ALLEGRO_RELAY_URL + "/redirect" },
    { ...relayEnv, ALLEGRO_RELAY_TOKEN: "" }
  ]) {
    const response = await worker.fetch(request("/api/tdr", query), env);
    assert.equal((await response.json()).code, "RELAY_CONFIGURATION_ERROR");
  }
});

test("relay upstream errors do not trigger a direct retry or leak credentials", async t => {
  const { binding, state } = mockBrowser();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++; assert.equal(url, relayEnv.ALLEGRO_RELAY_URL + "/v1/allegro");
    return json({ error: credentials.password, code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }, 502);
  });
  const response = await worker.fetch(request("/api/tdr", query), { ...relayEnv, BROWSER: binding });
  const body = await response.text();
  assert.ok(body.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE"));
  assert.ok(!body.includes(credentials.password));
  assert.equal(calls, 1);
  assert.equal(state.acquired, 0);
});

test("relay redirects and unexpected response headers fail without exposing secrets", async t => {
  t.mock.method(globalThis, "fetch", async () => json({ status: 200, body: credentials.password,
    headers: [["location", "https://other.example"]] }));
  const response = await worker.fetch(request("/api/tdr", query), relayEnv);
  const body = await response.text();
  assert.ok(body.includes("RELAY_INVALID_RESPONSE"));
  assert.ok(!body.includes(credentials.password));
});

test("cancelling a relay batch aborts its active request before submitting login credentials", async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(JSON.parse(init.body).method, "GET");
    entered();
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => {
      aborted = true;
      reject(new DOMException("Cancelled", "AbortError"));
    }, { once: true }));
  });
  const response = await worker.fetch(request("/api/tdr/batch", { queries: [query] }), relayEnv);
  await started;
  await response.body.cancel();
  assert.equal(aborted, true);
});

test("healthy direct queries do not allocate a cloud browser", async t => {
  mockDirect(t);
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal(response.status, 200);
  assertCargo(await response.json());
  assert.equal(state.acquired, 0);
});

test("526 retries in an isolated browser and closes the session", async t => {
  mockDirect(t, { tls: true });
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal(response.status, 200);
  assertCargo(await response.json());
  assert.equal(state.acquired, 1);
  assert.deepEqual(state.closed, ["session-1"]);
  assert.equal(state.sessions[0].recording, false);
  assert.equal(state.posts[0].body.signon.usrPwd, credentials.password);
  assert.ok(!state.commands.some(method => method.startsWith("Security.")));
});

test("one batch shares one browser login across ports", async t => {
  mockDirect(t, { tls: true });
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/tdr/batch", { queries: [query, { ...query, pol: "MYPKG" }] }), { BROWSER: binding });
  const raw = await response.text();
  const lines = raw.trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(line => [line.index, line.ok, line.result.pol]), [[0, true, "THLCH"], [1, true, "MYPKG"]]);
  assert.equal(state.posts.filter(post => post.pathname === "/oceans/general.signon").length, 1);
  assert.deepEqual(state.closed, ["session-1"]);
  assert.ok(!raw.includes(credentials.password));
});

test("parallel vessel lookups share a single fallback session", async t => {
  mockDirect(t, { tls: true, failAt: "service" });
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/vessels/batch", { vvds: ["XPAG2639W", "BIBK2638E", "XPBL2640W"] }), { BROWSER: binding });
  const value = await response.json();
  assert.equal(value.ok, true);
  assert.deepEqual(value.failures, []);
  assert.equal(value.entries[0].name, "TEST VESSEL");
  assert.equal(state.acquired, 1);
  assert.equal(state.posts.filter(post => post.pathname === "/oceans/general.signon").length, 1);
  assert.deepEqual(state.closed, ["session-1"]);
});

test("missing binding preserves a useful TLS error", async t => {
  mockDirect(t, { tls: true });
  const response = await worker.fetch(request("/api/tdr", query), {});
  const value = await response.json();
  assert.equal(response.status, 502);
  assert.equal(value.code, "ALLEGRO_TLS_ERROR");
  assert.match(value.error, /general.signon.*526/);
});

test("authentication rejection does not trigger fallback", async t => {
  mockDirect(t, { authFailed: true });
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "AUTH_FAILED");
  assert.equal(state.acquired, 0);
});

test("ordinary upstream errors do not allocate browser quota", async t => {
  mockDirect(t, { nonJsonStatus: 503 });
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "INVALID_RESPONSE");
  assert.equal(state.acquired, 0);
});

test("browser certificate errors fail closed and clean up", async t => {
  mockDirect(t, { tls: true });
  const { binding, state } = mockBrowser({ navigationError: "net::ERR_CERT_AUTHORITY_INVALID" });
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal((await response.json()).code, "BROWSER_NAVIGATION_FAILED");
  assert.equal(state.posts.length, 0);
  assert.deepEqual(state.closed, ["session-1"]);
});

test("unexpected navigation origin receives no credentials", async t => {
  mockDirect(t, { tls: true });
  const { binding, state } = mockBrowser({ pageOrigin: "https://other.example" });
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal((await response.json()).code, "BROWSER_ORIGIN_MISMATCH");
  assert.equal(state.posts.length, 0);
  assert.deepEqual(state.closed, ["session-1"]);
});

test("invalid browser responses do not leak response text or credentials", async t => {
  mockDirect(t, { tls: true });
  const { binding, state } = mockBrowser({ invalidJson: true });
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  const raw = await response.text();
  assert.ok(!raw.includes(credentials.password));
  assert.equal(JSON.parse(raw).code, "INVALID_RESPONSE");
  assert.deepEqual(state.closed, ["session-1"]);
});

test("browser quota exhaustion returns an error without an insecure retry", async t => {
  const direct = mockDirect(t, { tls: true });
  const { binding, state } = mockBrowser({ quotaExceeded: true });
  const response = await worker.fetch(request("/api/tdr", query), { BROWSER: binding });
  assert.equal((await response.json()).code, "BROWSER_UNAVAILABLE");
  assert.equal(state.acquired, 1);
  assert.equal(direct.length, 2);
});

test("untrusted webpage origins cannot start browser sessions", async t => {
  const direct = mockDirect(t);
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(request("/api/tdr", query, "https://other.example"), { BROWSER: binding });
  assert.equal(response.status, 403);
  assert.equal(state.acquired, 0);
  assert.equal(direct.length, 0);
});

test("health reports configuration without a login or browser allocation", async t => {
  const direct = mockDirect(t);
  const { binding, state } = mockBrowser();
  const response = await worker.fetch(new Request("https://worker.example/api/health"), { BROWSER: binding });
  assert.deepEqual(await response.json(), { ok: true, version: "2.4.0", mode: "cloud", browserFallbackAvailable: true, relayConfigured: false });
  assert.equal(state.acquired, 0);
  assert.equal(direct.length, 0);
});

test("existing synchronization still delegates to its original backend", async () => {
  const response = await worker.fetch(new Request("https://worker.example/api/cache"), {
    SYNC_BACKEND: { fetch: async request => new Response(new URL(request.url).pathname) }
  });
  assert.equal(await response.text(), "/api/cache");
});

test("page load timeout rejects instead of accepting an unverified page", async t => {
  const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
  const instrumented = source + "\nexport { CloudBrowserSession };";
  const { CloudBrowserSession } = await import("data:text/javascript;base64," + Buffer.from(instrumented).toString("base64"));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new CloudBrowserSession({});
  session.socket = new EventTarget();
  const wait = session.waitForLoad();
  const rejected = assert.rejects(wait.promise, { code: "BROWSER_TIMEOUT" });
  t.mock.timers.tick(45001);
  await rejected;
  wait.cancel();
});

test("cancelling a batch closes an active cloud session", { timeout: 1500 }, async t => {
  mockDirect(t, { tls: true });
  let release;
  const serviceGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { binding, state } = mockBrowser({ serviceGate });
  const response = await worker.fetch(request("/api/tdr/batch", { queries: [query] }), { BROWSER: binding });
  await state.serviceStarted;
  await response.body.cancel();
  assert.deepEqual(state.closed, ["session-1"]);
  release();
});

test("cancellation while acquiring a browser sends no credentials", { timeout: 1500 }, async t => {
  const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
  const { CloudBrowserSession } = await import("data:text/javascript;base64," + Buffer.from(source + "\nexport { CloudBrowserSession };").toString("base64"));
  let release;
  const acquireGate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { binding, state } = mockBrowser({ acquireGate });
  const session = new CloudBrowserSession(binding);
  const opening = session.open();
  const rejected = assert.rejects(opening, { code: "TDR_QUERY_CANCELLED" });
  await session.close();
  release();
  await rejected;
  assert.deepEqual(state.closed, ["session-1"]);
  assert.equal(state.posts.length, 0);
  assert.equal(state.commands.length, 0);
});
