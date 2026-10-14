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
        case "udcBiz": payload = { ComUDCOutListOMM: { outUdcOmms: [{ value02: "THLCHT1", value03: "1", value05: "THLCH", value06: "1" }] } }; break;
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
test("invalid origin, JSON, multi-port and excessive requests never reach Allegro", async () => {
  const app = createTdrHandler({ allegroRequest: () => assert.fail("no network") });
  assert.equal((await app(request("/api/tdr", query, "https://other.example"))).status, 403);
  assert.equal((await app(request("/api/tdr/batch", { queries: [query, query] }))).status, 400);
  assert.equal((await app(new Request("https://test.netlify.app/api/tdr", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await app(request("/api/tdr", { padding: "x".repeat(66000) }))).status, 413);
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
