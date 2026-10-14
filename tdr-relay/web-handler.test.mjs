import test from "node:test";
import assert from "node:assert/strict";
import { createWebRelayHandler } from "./web-handler.mjs";
import handler, { config } from "./netlify/functions/allegro.mjs";

const token = "test-only-access-token-0123456789abcdef";
const input = { method: "GET", pathname: "/oceans/nawlogon.do" };
function request(path, body, accessToken = token) {
  return new Request("https://test-relay.netlify.app" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
test("serverless health is configuration-only and never contacts Allegro", async () => {
  const app = createWebRelayHandler({ getToken: () => token, allegroRequest: () => assert.fail("network must not run") });
  const response = await app(request("/health"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).accessTokenConfigured, true);
});
test("missing token fails closed without exposing credentials", async () => {
  const app = createWebRelayHandler({ getToken: () => "", allegroRequest: () => assert.fail("network must not run") });
  assert.equal((await app(request("/health"))).status, 503);
  assert.equal((await app(request("/v1/allegro", input))).status, 503);
});
test("serverless unauthorized requests never contact Allegro", async () => {
  const app = createWebRelayHandler({ getToken: () => token, allegroRequest: () => assert.fail("network must not run") });
  assert.equal((await app(request("/v1/diagnostics", undefined, "wrong"))).status, 401);
});
test("serverless diagnostic sends no Allegro credentials and returns verified connectivity", async () => {
  let sent;
  const app = createWebRelayHandler({ getToken: () => token, allegroRequest: async value => {
    sent = value; return { status: 200, body: "<html>login</html>" };
  } });
  const response = await app(request("/v1/diagnostics"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tlsVerified, true);
  assert.deepEqual(sent, input);
});
test("serverless relay preserves cookie boundaries and Unicode response data", async () => {
  const expected = { status: 200, body: '{"name":"测试船"}', headers: [["set-cookie", "s=a; Secure"], ["set-cookie", "r=b; Secure"]] };
  const app = createWebRelayHandler({ getToken: () => token, allegroRequest: async value => {
    assert.deepEqual(value, input); return expected;
  } });
  const response = await app(request("/v1/allegro", input));
  assert.deepEqual(await response.json(), expected);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("serverless invalid paths, destination injection and query parameters are rejected", async () => {
  const app = createWebRelayHandler({ getToken: () => token, allegroRequest: () => assert.fail("network must not run") });
  assert.equal((await app(request("/v1/allegro", { ...input, pathname: "https://other.example" }))).status, 400);
  assert.equal((await app(request("/v1/allegro?password=secret", input))).status, 400);
  assert.equal((await app(request("/v1/other"))).status, 404);
});
test("serverless error response excludes upstream error text", async () => {
  const secret = "test-only-private-value";
  const app = createWebRelayHandler({ getToken: () => token, allegroRequest: async () => { throw Object.assign(new Error(secret), { code: "ECONNRESET" }); } });
  const response = await app(request("/v1/allegro", input));
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(body.includes("ECONNRESET"));
  assert.ok(!body.includes(secret));
});
test("serverless response cap rejects oversized output instead of truncating TDR", async () => {
  const app = createWebRelayHandler({ getToken: () => token, maxResponseBytes: 200,
    allegroRequest: async () => ({ status: 200, headers: [], body: "x".repeat(250) }) });
  const response = await app(request("/v1/allegro", input));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "RESPONSE_TOO_LARGE");
});
test("Netlify entry point loads its bundled CA and uses only the explicit API paths", async t => {
  const previous = process.env.RELAY_ACCESS_TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.RELAY_ACCESS_TOKEN; else process.env.RELAY_ACCESS_TOKEN = previous; });
  process.env.RELAY_ACCESS_TOKEN = token;
  assert.deepEqual(config.path, ["/health", "/v1/allegro", "/v1/diagnostics"]);
  assert.equal((await handler(request("/health"))).status, 200);
});
