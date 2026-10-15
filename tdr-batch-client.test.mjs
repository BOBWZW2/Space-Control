import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./tdr-batch-client.js", import.meta.url), "utf8");
const run = vm.runInNewContext(source + "; fetchTdrBatchLines", { TextDecoder, Uint8Array });
const choices = ["THLCH", "MYPKG", "SGSIN"].map(port => ({ vvd: "TEST2639W", port }));
const credentials = { username: "test-user", password: "test-only-secret" };
const collect = async iterator => { const lines = []; for await (const line of iterator) lines.push(line); return lines; };

test("small batches preserve out-of-order indexes, split Unicode, and a final line without newline", async () => {
  let calls = 0;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.queries.map(q => q.pol), calls++ === 0 ? ["THLCH", "MYPKG"] : ["SGSIN"]);
    const result = body.queries.map((_, index) => ({ index, ok: true, result: { name: "测试船" } })).reverse();
    const bytes = new TextEncoder().encode(result.map(line => JSON.stringify(line)).join("\n"));
    return new Response(new ReadableStream({ start(controller) {
      for (let p = 0; p < bytes.length; p += 3) controller.enqueue(bytes.slice(p, p + 3)); controller.close();
    } }));
  }));
  assert.equal(calls, 2); assert.deepEqual(lines.map(x => x.index), [1, 0, 2]);
  assert.equal(lines[0].result.name, "测试船");
});

test("a broken stream preserves a completed port, marks the missing port, and continues the next batch", async () => {
  let calls = 0, read = false;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async () => {
    if (calls++ > 0) return new Response('{"index":0,"ok":true}\n');
    return new Response(new ReadableStream({ pull(controller) {
      if (!read) { read = true; controller.enqueue(new TextEncoder().encode('{"index":1,"ok":true}\n')); }
      else controller.error(new Error("network interrupted"));
    } }));
  }));
  assert.deepEqual(lines.map(x => [x.index, x.ok]), [[1, true], [0, false], [2, true]]);
});

test("authentication failures stop later batches and cancel the active stream", async () => {
  let calls = 0, cancelled = false;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"index":0,"ok":false,"code":"AUTH_FAILED","error":"登录失败"}\n'));
    }, cancel() { cancelled = true; } }));
  }));
  assert.equal(calls, 1); assert.equal(lines.length, 1);
  assert.equal(lines[0].code, "AUTH_FAILED"); assert.equal(cancelled, true);
});

test("HTTP errors and empty output explicitly mark each affected port", async () => {
  let calls = 0;
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async () => calls++ === 0
    ? new Response('{"error":"upstream timed out","code":"ALLEGRO_TIMEOUT"}', { status: 502 }) : new Response("")));
  assert.deepEqual(lines.map(x => x.index), [0, 1, 2]);
  assert.equal(lines[0].code, "ALLEGRO_TIMEOUT"); assert.equal(lines[1].code, "ALLEGRO_TIMEOUT");
  assert.equal(lines[2].ok, false);
});

test("old one-port servers fall back without duplicate results or repeated batch rejections", async () => {
  let calls = 0;
  const sizes = [];
  const lines = await collect(run("https://test.netlify.app", credentials, choices, async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body); sizes.push(body.queries.length);
    return body.queries.length > 1
      ? new Response('{"code":"BATCH_LIMIT"}', { status: 400 }) : new Response('{"index":0,"ok":true}\n');
  }));
  assert.equal(calls, 4); assert.deepEqual(sizes, [2, 1, 1, 1]);
  assert.deepEqual(lines.map(x => [x.index, x.ok]), [[0, true], [1, true], [2, true]]);
});

test("partial or duplicate output cannot silently omit or overwrite a port", async () => {
  for (const text of ['{"index":0,"ok":true}\n', '{"index":0,"ok":true}\n{"index":0,"ok":true}\n']) {
    const lines = await collect(run("https://test.netlify.app", credentials, choices.slice(0, 2), async () => new Response(text)));
    assert.deepEqual(lines.map(x => [x.index, x.ok]), [[0, true], [1, false]]);
  }
});
