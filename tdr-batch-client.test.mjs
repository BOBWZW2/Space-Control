import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./tdr-batch-client.js", import.meta.url), "utf8");
const run = vm.runInNewContext(source + "; fetchTdrBatchLines", { TextDecoder, Uint8Array });
const choices = [{ vvd: "TEST2639W", port: "THLCH" }, { vvd: "TEST2639W", port: "MYPKG" }];
const credentials = { username: "test-user", password: "test-only-secret" };
const collect = async iterator => { const lines = []; for await (const line of iterator) lines.push(line); return lines; };
test("port orchestration preserves indexes and decodes split Unicode and final lines without a newline", async () => {
  let calls = 0;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.queries.length, 1); assert.equal(body.queries[0].pol, choices[calls].port); calls++;
    const bytes = new TextEncoder().encode(JSON.stringify({ index: 0, ok: true, result: { name: "测试船" } }));
    return new Response(new ReadableStream({ start(controller) {
      for (let p = 0; p < bytes.length; p += 3) controller.enqueue(bytes.slice(p, p + 3)); controller.close();
    } }));
  }));
  assert.equal(calls, 2); assert.deepEqual(lines.map(x => x.index), [0, 1]);
  assert.equal(lines[1].result.name, "测试船");
});
test("a failed port does not discard an earlier completed port or stop later independent work", async () => {
  let calls = 0;
  const lines = await collect(run("https://test.netlify.app", credentials, [...choices, choices[0]], async () => {
    if (calls++ === 1) throw new Error("network interrupted");
    return new Response('{"index":0,"ok":true}\n');
  }));
  assert.deepEqual(lines.map(x => [x.index, x.ok]), [[0, true], [1, false], [2, true]]);
});
test("authentication failures stop further login attempts", async () => {
  let calls = 0;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async () => {
    calls++; return new Response('{"index":0,"ok":false,"code":"AUTH_FAILED","error":"登录失败"}\n');
  }));
  assert.equal(calls, 1); assert.equal(lines[0].code, "AUTH_FAILED");
});
test("HTTP errors and empty output yield explicit port failures", async () => {
  let calls = 0;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async () => calls++ === 0
    ? new Response('{"error":"upstream timed out","code":"ALLEGRO_TIMEOUT"}', { status: 502 }) : new Response("")));
  assert.equal(lines[0].code, "ALLEGRO_TIMEOUT"); assert.equal(lines[1].ok, false);
});
