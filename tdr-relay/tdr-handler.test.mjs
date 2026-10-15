import test from "node:test";
import assert from "node:assert/strict";
import { createTdrHandler } from "./tdr-handler.mjs";
import { validateInput } from "./upstream.mjs";

const credentials = { username: "test-user", password: "test-only-private-password" };
const query = { vvd: "XPAG2639W", pol: "THLCH" };
function request(path, payload, origin = "https://bobwzw2.github.io") {
  return new Request("https://test.netlify.app" + path, { method: payload === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify({ ...credentials, ...payload }) }) });
}
function nativeFixture(sent) {
  return async input => {
    validateInput(input);
    sent.push(input);
    const headers = [["content-type", "application/json"]];
    if (input.method === "GET") return { status: 200, headers: [...headers,
      ["set-cookie", "session=first; Secure"], ["set-cookie", "route=second; Secure"]], body: "<html>login</html>" };
    assert.match(input.headers.cookie, /session=first/);
    assert.match(input.headers.cookie, /route=second/);
    let payload;
    if (input.pathname === "/oceans/general.signon") payload = { signon: { signOnResult: "success" } };
    else {
      const operation = JSON.parse(input.body).header.operation;
      switch (operation) {
        case "udcMdm": payload = { ComUDCOutListOMM: { outUdcOmms: [{ value01: "XPAG", value02: "2639", value03: "W", value04: "HLX" }] } }; break;
        case "udcBiz": payload = { ComUDCOutListOMM: { outUdcOmms: ["THLCH", "MYPKG"].map((port, i) => ({ value02: port + "T1", value03: String(i + 1), value05: port, value06: String(i + 1) })) } }; break;
        case "searchTdrSysCode": payload = { ComUDCOutOMM: { value01: "TDR" } }; break;
        case "searchTdrLodingListM3001": payload = { TdrLoadingGroupOMM: { oceanLoadingList: [{ pod: "INNSA", slotOwnPtrId: "CUL", contOprPtrId: "CUL", fds22: 2, fds42: 3, wt22: 11.5 }] } }; break;
        default: assert.fail("Unexpected service operation");
      }
    }
    return { status: 200, headers, body: JSON.stringify(payload) };
  };
}
test("Netlify native API keeps original cargo mapping, cookie boundaries and NDJSON contract", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("must use native HTTPS, not runtime fetch"));
  const sent = [];
  const app = createTdrHandler({ allegroRequest: nativeFixture(sent) });
  const response = await app(request("/api/tdr/batch", { queries: [query] }));
  assert.equal(response.headers.get("access-control-allow-origin"), "https://bobwzw2.github.io");
  const line = JSON.parse((await response.text()).trim());
  assert.equal(line.index, 0); assert.equal(line.ok, true);
  assert.equal(line.result.rows[0].qty20, 2); assert.equal(line.result.rows[0].qty40, 3);
  assert.equal(line.result.rows[0].weight, 11.5);
  assert.equal(sent.filter(x => x.pathname === "/oceans/general.signon").length, 1);
});
test("Netlify health is configuration-only and preflights accept the original page", async () => {
  const app = createTdrHandler({ allegroRequest: () => assert.fail("no network") });
  assert.equal((await (await app(request("/api/health"))).json()).nativeTlsTransportAvailable, true);
  const r = await app(new Request("https://test.netlify.app/api/tdr/batch", { method: "OPTIONS", headers: { Origin: "https://bobwzw2.github.io" } }));
  assert.equal(r.status, 204);
});
test("invalid origin, JSON, oversized batches and excessive requests never reach Allegro", async () => {
  const app = createTdrHandler({ allegroRequest: () => assert.fail("no network") });
  assert.equal((await app(request("/api/tdr", query, "https://other.example"))).status, 403);
  assert.equal((await app(request("/api/tdr/batch", { queries: [query, query, query] }))).status, 400);
  assert.equal((await app(new Request("https://test.netlify.app/api/tdr", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await app(request("/api/tdr", { padding: "x".repeat(66000) }))).status, 413);
});

test("two ports share one login and voyage lookup, stream the fast port first, and retain correct indexes", async () => {
  const sent = [];
  const fixture = nativeFixture(sent);
  let releaseFirst;
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  let active = 0, peak = 0;
  const app = createTdrHandler({ allegroRequest: async (input, signal) => {
    const body = input.body ? JSON.parse(input.body) : {};
    if (body.header?.operation === "searchTdrLodingListM3001") {
      active++; peak = Math.max(peak, active);
      if (body.TdrCondOMM.condPortCd === "THLCH") await firstPending;
      active--;
    }
    return fixture(input, signal);
  } });
  const response = await app(request("/api/tdr/batch", { queries: [query, { ...query, pol: "MYPKG" }] }));
  const reader = response.body.getReader();
  const decode = value => JSON.parse(new TextDecoder().decode(value).trim());
  const first = decode((await reader.read()).value);
  assert.equal(first.index, 1); assert.equal(first.result.pol, "MYPKG");
  releaseFirst();
  const second = decode((await reader.read()).value);
  assert.equal(second.index, 0); assert.equal(second.result.pol, "THLCH");
  assert.equal((await reader.read()).done, true);
  assert.equal(peak, 2);
  assert.equal(sent.filter(x => x.pathname === "/oceans/general.signon").length, 1);
  for (const operation of ["udcMdm", "udcBiz"]) assert.equal(sent.filter(x => x.body && JSON.parse(x.body).header?.operation === operation).length, 1);
  assert.equal(sent.length, 8);
});

test("concurrent ports cannot cause duplicate failed login attempts", async () => {
  let logins = 0, services = 0;
  const app = createTdrHandler({ allegroRequest: async input => {
    if (input.method === "GET") return { status: 200, headers: [], body: "login" };
    if (input.pathname === "/oceans/general.signon") logins++;
    else services++;
    return { status: 200, headers: [], body: JSON.stringify({ signon: { signOnResult: "failed" } }) };
  } });
  const response = await app(request("/api/tdr/batch", { queries: [query, { ...query, pol: "MYPKG" }] }));
  const lines = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.ok(lines.every(line => line.code === "AUTH_FAILED"));
  assert.equal(logins, 1); assert.equal(services, 0);
});

test("a slow parallel port times out without discarding the already streamed port", async () => {
  const fixture = nativeFixture([]);
  const app = createTdrHandler({ deadlineMs: 30, allegroRequest: (input, signal) => {
    const body = input.body ? JSON.parse(input.body) : {};
    if (body.header?.operation === "searchTdrLodingListM3001" && body.TdrCondOMM.condPortCd === "MYPKG") {
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "REQUEST_CANCELLED" })), { once: true }));
    }
    return fixture(input, signal);
  } });
  const response = await app(request("/api/tdr/batch", { queries: [query, { ...query, pol: "MYPKG" }] }));
  const [body] = await Promise.all([response.text(), new Promise(resolve => setTimeout(resolve, 50))]);
  const lines = body.trim().split("\n").map(JSON.parse);
  assert.equal(lines[0].index, 0); assert.equal(lines[0].ok, true);
  assert.equal(lines[1].index, 1); assert.equal(lines[1].code, "ALLEGRO_TIMEOUT");
});

test("native sessions are created per invocation and closed exactly once after streaming", async () => {
  const sessions = [];
  const app = createTdrHandler({ allegroRequestFactory: () => {
    const session = nativeFixture([]);
    session.closeCount = 0;
    session.close = () => session.closeCount++;
    sessions.push(session);
    return session;
  } });
  await Promise.all([1, 2].map(async () => {
    const response = await app(request("/api/tdr/batch", { queries: [query] }));
    assert.equal(JSON.parse((await response.text()).trim()).ok, true);
  }));
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0], sessions[1]);
  assert.deepEqual(sessions.map(session => session.closeCount), [1, 1]);
});
test("native errors do not leak account details or trigger an insecure fallback", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no fallback"));
  const app = createTdrHandler({ allegroRequest: async () => { throw Object.assign(new Error(credentials.password), { code: "ECONNRESET" }); } });
  const r = await app(request("/api/tdr", query));
  const text = await r.text(); assert.equal(r.status, 502);
  assert.match(text, /ECONNRESET/); assert.ok(!text.includes(credentials.password));
});
test("a request-wide deadline aborts native HTTPS and returns a typed failure before provider timeout", async () => {
  let aborted = false;
  const app = createTdrHandler({ deadlineMs: 10, allegroRequest: (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("cancelled"), { code: "REQUEST_CANCELLED" })); }, { once: true });
  }) });
  const response = await app(request("/api/tdr/batch", { queries: [query] }));
  const [body] = await Promise.all([response.text(), new Promise(resolve => setTimeout(resolve, 30))]);
  assert.equal(JSON.parse(body).code, "ALLEGRO_TIMEOUT"); assert.equal(aborted, true);
});
test("cancelling a streamed response closes the active native connection", async () => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let aborted = false;
  const app = createTdrHandler({ allegroRequest: (_input, signal) => { started(); return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("cancelled"), { code: "REQUEST_CANCELLED" })); }, { once: true });
  }); } });
  const response = await app(request("/api/tdr/batch", { queries: [query] }));
  await entered; await response.body.cancel(); assert.equal(aborted, true);
});
