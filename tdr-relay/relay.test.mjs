import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRelayServer } from "./server.mjs";
import { createAllegroRequest, diagnose, supplementedCa, validateInput } from "./upstream.mjs";

const token = "test-only-access-token-0123456789abcdef";
const input = { method: "GET", pathname: "/oceans/nawlogon.do" };
let dir, root, intermediate, key, cert, wrongCert, expiredCert;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "allegro-relay-test-"));
  const openssl = args => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "root.key", "-out", "root.pem", "-subj", "/CN=TEST-ONLY Root", "-days", "2", "-addext", "basicConstraints=critical,CA:TRUE"]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "intermediate.key", "-out", "intermediate.csr", "-subj", "/CN=TEST-ONLY Intermediate"]);
  writeFileSync(join(dir, "intermediate.ext"), "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n");
  openssl(["x509", "-req", "-in", "intermediate.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-out", "intermediate.pem", "-days", "2", "-extfile", "intermediate.ext"]);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=ops.culines.com"]);
  for (const [filename, hostname, days] of [["server.pem", "ops.culines.com", "1"], ["wrong.pem", "other.example", "1"], ["expired.pem", "ops.culines.com", "0"]]) {
    writeFileSync(join(dir, "server.ext"), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${hostname}\n`);
    openssl(["x509", "-req", "-in", "server.csr", "-CA", "intermediate.pem", "-CAkey", "intermediate.key", "-CAcreateserial", "-out", filename, "-days", days, "-extfile", "server.ext"]);
  }
  const read = name => readFileSync(join(dir, name));
  [root, intermediate, key, cert, wrongCert, expiredCert] = ["root.pem", "intermediate.pem", "server.key", "server.pem", "wrong.pem", "expired.pem"].map(read);
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function localTls(t, serverCert = cert, handler = (_req, res) => res.end("<html>Allegro login</html>")) {
  // Deliberately serves ONLY the leaf certificate, reproducing a missing chain.
  const server = https.createServer({ key, cert: serverCert }, handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.close(); server.closeAllConnections(); });
  return options => https.request({ ...options, port: server.address().port,
    lookup(_hostname, opts, callback) {
      if (opts.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
      else callback(null, "127.0.0.1", 4);
    }
  });
}

async function tlsRequester(t, options = {}) {
  const create = await localTls(t, options.cert, options.handler);
  return createAllegroRequest({ ca: options.ca || [root, intermediate], timeoutMs: options.timeoutMs || 1000, keepAlive: options.keepAlive || false,
    request(opts, callback) { return create(opts).on("response", callback); } });
}

test("bundled GeoTrust intermediate is signed by an existing trusted Node root", () => {
  assert.ok(supplementedCa().at(-1).includes("BEGIN CERTIFICATE"));
});
test("real TLS fails with a missing intermediate and succeeds when supplemented", async t => {
  const missing = await tlsRequester(t, { ca: [root] });
  await assert.rejects(missing(input), error => /UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error.code));
  const complete = await tlsRequester(t);
  assert.equal((await complete(input)).body, "<html>Allegro login</html>");
});
test("supplemented chain still rejects a certificate for another hostname", async t => {
  const request = await tlsRequester(t, { cert: wrongCert, keepAlive: true });
  t.after(() => request.close());
  await assert.rejects(request(input), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
});
test("supplemented chain still rejects expired server certificates", async t => {
  const request = await tlsRequester(t, { cert: expiredCert, keepAlive: true });
  t.after(() => request.close());
  await assert.rejects(request(input), { code: "CERT_HAS_EXPIRED" });
});

test("request-scoped keepalive reuses a verified TLS connection and closes the pool", async t => {
  const sockets = new Set();
  const create = await localTls(t, cert, (req, res) => { sockets.add(req.socket); res.end("login"); });
  const make = () => createAllegroRequest({ ca: [root, intermediate], keepAlive: true,
    request(opts, callback) { return create(opts).on("response", callback); } });
  const session = make();
  t.after(() => session.close());
  for (let i = 0; i < 6; i++) assert.equal((await session(input)).status, 200);
  assert.equal(sockets.size, 1);
  session.close();
  await assert.rejects(session(input), { code: "REQUEST_CANCELLED" });
  const next = make();
  t.after(() => next.close());
  await next(input);
  assert.equal(sockets.size, 2);
});
test("upstream redirects are returned without forwarding credentials", async t => {
  let calls = 0;
  const request = await tlsRequester(t, { handler(_req, res) { calls++; res.writeHead(302, { Location: "https://other.example" }); res.end(); } });
  assert.equal((await request(input)).status, 302);
  assert.equal(calls, 1);
});
test("upstream has a total deadline", async t => {
  const request = await tlsRequester(t, { timeoutMs: 30, handler() {} });
  await assert.rejects(request(input), { code: "UPSTREAM_TIMEOUT" });
});
test("only fixed Allegro paths, methods and safe headers are accepted", () => {
  for (const value of [
    { ...input, pathname: "https://other.example" }, { ...input, pathname: "/admin" },
    { ...input, method: "POST" }, { ...input, headers: { Host: "other.example" } },
    { ...input, headers: { Cookie: "value\r\ninjected: header" } },
    { ...input, headers: { Referer: "https://other.example/" } },
    { ...input, body: "password" }
  ]) assert.throws(() => validateInput(value));
});
test("diagnostic only checks a login page without sending credentials", async () => {
  let sent;
  const result = await diagnose(async value => { sent = value; return { status: 200, body: "<html>Login</html>" }; });
  assert.equal(result.ok, true);
  assert.equal(result.tlsVerified, true);
  assert.deepEqual(sent, input);
});

async function localRelay(t, upstream) {
  const server = createRelayServer({ token, allegroRequest: upstream });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, body, accessToken = token) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
test("health never contacts Allegro and unauthorized calls do not reach it", async t => {
  let calls = 0;
  const get = await localRelay(t, async () => { calls++; throw new Error("should not run"); });
  assert.equal((await get("/health")).status, 200);
  const setup = await get("/");
  assert.equal(setup.status, 200);
  assert.ok(setup.headers.get("content-security-policy").includes("connect-src 'self'"));
  assert.ok(!(await setup.text()).includes(token));
  assert.equal((await get("/v1/diagnostics", undefined, "wrong")).status, 401);
  assert.equal((await get("/v1/allegro", input, "wrong")).status, 401);
  assert.equal(calls, 0);
});
test("authenticated relay preserves separate session cookies without storing them", async t => {
  const expected = { status: 200, headers: [["set-cookie", "session=a; Secure"], ["set-cookie", "route=b; Secure"]], body: "{}" };
  const get = await localRelay(t, async () => expected);
  assert.deepEqual(await (await get("/v1/allegro", input)).json(), expected);
});
test("invalid destinations are rejected before an upstream request", async t => {
  let calls = 0;
  const get = await localRelay(t, async () => { calls++; });
  assert.equal((await get("/v1/allegro", { ...input, pathname: "/admin" })).status, 400);
  assert.equal(calls, 0);
});
test("connection errors expose only a known code, never credentials or raw errors", async t => {
  const secret = "do-not-return-a-secret";
  const get = await localRelay(t, async () => { throw Object.assign(new Error(secret), { code: secret }); });
  const response = await get("/v1/allegro", input);
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(!body.includes(secret));
  assert.ok(body.includes("UPSTREAM_CONNECTION_FAILED"));
});
