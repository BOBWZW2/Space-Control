import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HOST = "127.0.0.1";
const PORT = Number(process.env.TDR_HELPER_PORT || 4318);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_FILE = path.join(ROOT, "space-control-generator.html");
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = process.env.TDR_PROFILE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "SpaceControl", "tdr-browser-profile");
const LOGIN_URL = "https://ops.culines.com/oceans/nawlogon.do";
const TDR_URL = "https://ops.culines.com/oceans/VOP_M3001.do";
const ONLINE_ORIGIN = "https://bobwzw2.github.io";

let context;
let page;
let queue = Promise.resolve();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function allowRequestOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = origin === ONLINE_ORIGIN || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (!allowed) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Vary", "Origin");
  return true;
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 64 * 1024) throw new Error("Request too large");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function normalizeCode(value, max) {
  const clean = String(value || "").trim().toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{5,${max}}$`).test(clean)) throw new Error("Invalid vessel voyage or port code");
  return clean;
}

async function browserPage() {
  if (!context) {
    await fs.mkdir(PROFILE, { recursive: true });
    context = await chromium.launchPersistentContext(PROFILE, {
      executablePath: CHROME,
      headless: true,
      viewport: { width: 1440, height: 900 },
      args: ["--no-first-run", "--no-default-browser-check"]
    });
    page = context.pages()[0] || await context.newPage();
  }
  if (!page || page.isClosed()) page = await context.newPage();
  return page;
}

async function ensureLogin(target) {
  await target.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!/nawlogon\.do/i.test(target.url())) return;
  const username = process.env.ALLEGRO_USER;
  const password = process.env.ALLEGRO_PASSWORD;
  if (!username || !password) throw new Error("Allegro credentials are not configured");
  await target.getByRole("textbox", { name: "USER ID" }).fill(username);
  await target.getByRole("textbox", { name: "PASSWORD" }).fill(password);
  await Promise.all([
    target.waitForURL(/nawmain\.html/i, { timeout: 30000 }),
    target.getByRole("button", { name: "LOGIN" }).click({ force: true })
  ]);
}

async function selectVoyage(target, vvd) {
  await target.locator("#condVvdCd").fill(vvd);
  await target.locator("#logSearchVvd").click();
  const dialog = target.locator("iframe").last();
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  const frame = target.frameLocator("iframe").last();
  await frame.getByRole("textbox").fill(vvd);
  await frame.getByRole("button", { name: "Search" }).click();
  const result = frame.getByRole("radio").first();
  await result.waitFor({ state: "visible", timeout: 15000 });
  await result.check();
  await frame.getByRole("button", { name: "Select" }).click();
  await target.locator("#vslName").waitFor({ state: "visible" });
  await target.waitForFunction(() => document.querySelector("#vslName")?.value, null, { timeout: 15000 });
}

async function selectTerminal(target, pol) {
  await target.locator("#listcombobox100 button").click();
  const terminal = target.locator("p").filter({ hasText: new RegExp(`^${pol}T\\d+$`) }).first();
  await terminal.waitFor({ state: "visible", timeout: 15000 });
  await terminal.click();
  await target.locator("#btnR").click();
  await target.waitForFunction(() => document.querySelector("#hdrSysNm")?.value, null, { timeout: 30000 });
}

function number(text) {
  const value = Number(String(text || "").replaceAll(",", "").trim());
  return Number.isFinite(value) ? value : 0;
}

async function gridRows(target, id, source) {
  return target.evaluate(({ id, source }) => {
    const parse = (value) => {
      const result = Number(String(value || "").replaceAll(",", "").trim());
      return Number.isFinite(result) ? result : 0;
    };
    return Array.from(document.querySelectorAll(`#${id}-body table tbody tr`)).map((tr) => {
      const cells = Array.from(tr.cells).map((cell) => (cell.innerText || "").trim());
      return {
        source,
        so: cells[4] || "",
        co: cells[5] || "",
        pod: (cells[6] || "").toUpperCase(),
        qty20: parse(cells[8]) + parse(cells[9]),
        qty40: parse(cells[10]) + parse(cells[11]) + parse(cells[12]),
        weight: parse(cells[18]) + parse(cells[19]) + parse(cells[20]) + parse(cells[21]) + parse(cells[22])
      };
    }).filter((row) => row.pod);
  }, { id, source });
}

async function fetchTdr(vvd, pol) {
  const target = await browserPage();
  await ensureLogin(target);
  await target.goto(TDR_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await selectVoyage(target, vvd);
  await selectTerminal(target, pol);
  await target.getByText("Load Vol.", { exact: true }).click();
  await target.locator("#VOP_M3001_D3grid100").waitFor({ state: "attached", timeout: 30000 });
  await target.waitForFunction(() => {
    const ocean = document.querySelectorAll("#VOP_M3001_D3grid100-body table tbody tr").length;
    const interport = document.querySelectorAll("#VOP_M3001_D3grid101-body table tbody tr").length;
    return ocean + interport > 0;
  }, null, { timeout: 45000 });
  const [ocean, interport] = await Promise.all([
    gridRows(target, "VOP_M3001_D3grid100", "ocean"),
    gridRows(target, "VOP_M3001_D3grid101", "interport")
  ]);
  return {
    vvd,
    pol,
    rows: [...ocean, ...interport].map((row) => ({
      ...row,
      qty20: number(row.qty20),
      qty40: number(row.qty40),
      weight: Math.round(number(row.weight) * 10) / 10
    })),
    fetchedAt: new Date().toISOString()
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!allowRequestOrigin(req, res)) return json(res, 403, { error: "Origin not allowed" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      return res.end();
    }
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/api/tdr") {
      const input = await bodyJson(req);
      const vvd = normalizeCode(input.vvd, 12);
      const pol = normalizeCode(input.pol, 5);
      const task = queue.then(() => fetchTdr(vvd, pol));
      queue = task.catch(() => undefined);
      return json(res, 200, await task);
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/space-control-generator.html")) {
      const body = await fs.readFile(UI_FILE);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
      return res.end(body);
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 500, { error: error?.message || String(error) });
  }
});

server.listen(PORT, HOST, () => console.log(`Space Control TDR helper: http://${HOST}:${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await context?.close().catch(() => undefined);
    server.close(() => process.exit(0));
  });
}
