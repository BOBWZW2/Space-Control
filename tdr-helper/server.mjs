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
let selectedVvd = "";

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

function codedError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function ensureLogin(target) {
  if (/VOP_M3001\.do/i.test(target.url()) && await target.locator("#condVvdCd").count()) return;
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
  selectedVvd = vvd;
}

async function selectTerminal(target, pol) {
  await target.locator("#listcombobox100 button").click();
  const terminal = target.locator("p").filter({ hasText: new RegExp(`^${pol}T\\d+$`) }).first();
  try {
    await terminal.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    await target.keyboard.press("Escape").catch(() => undefined);
    throw codedError(`未找到 ${pol} 对应的 Terminal`, "TERMINAL_NOT_FOUND", { pol });
  }
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
        empty20: parse(cells[13]) + parse(cells[14]),
        empty40: parse(cells[15]) + parse(cells[16]) + parse(cells[17]),
        weight: parse(cells[18]) + parse(cells[19]) + parse(cells[20]) + parse(cells[21]) + parse(cells[22])
      };
    }).filter((row) => row.pod);
  }, { id, source });
}

async function specialCargoRows(target) {
  return target.evaluate(() => {
    const parse = (value) => {
      const result = Number(String(value || "").replaceAll(",", "").trim());
      return Number.isFinite(result) ? result : 0;
    };
    const candidates = Array.from(document.querySelectorAll('[id*="grid"][id$="-body"]'));
    const grid = candidates.find((node) => {
      const headerId = node.id.replace(/-body$/, "-head");
      const header = document.getElementById(headerId)?.innerText || "";
      return /Reefer Cargo/i.test(header);
    });
    if (!grid) return [];
    return Array.from(grid.querySelectorAll("table tbody tr")).map((tr) => {
      const cells = Array.from(tr.cells).map((cell) => (cell.innerText || "").trim());
      const offset = cells.findIndex((value, index) => index >= 3 && /^[A-Z]{5}$/.test(value));
      if (offset < 2) return null;
      const so = cells[offset - 2] || "";
      const co = cells[offset - 1] || "";
      const pod = (cells[offset] || "").toUpperCase();
      const values = cells.slice(offset + 1).map(parse);
      // Tank 4 + DG 4 + Reefer 4 + OOG 5. Some Allegro builds insert
      // one hidden selector column before Tank; use the last 9 columns as
      // a stable anchor: Reefer 4 columns immediately precede OOG 5.
      const reeferStart = Math.max(0, values.length - 9);
      return {
        so,
        co,
        pod,
        rf20: values[reeferStart] || 0,
        rf40: values[reeferStart + 1] || 0
      };
    }).filter((row) => row?.pod && (row.rf20 || row.rf40));
  });
}

async function ensureTdrVoyage(target, vvd) {
  const onTdr = /VOP_M3001\.do/i.test(target.url());
  if (!onTdr) {
    await target.goto(TDR_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    selectedVvd = "";
  }
  const currentVvd = await target.locator("#condVvdCd").inputValue().catch(() => "");
  const hasVessel = await target.locator("#vslName").inputValue().catch(() => "");
  if (selectedVvd !== vvd || currentVvd.trim().toUpperCase() !== vvd || !hasVessel) {
    await selectVoyage(target, vvd);
  }
}

async function fetchTdr(vvd, pol) {
  const target = await browserPage();
  await ensureLogin(target);
  await ensureTdrVoyage(target, vvd);
  await selectTerminal(target, pol);
  await target.getByText("Load Vol.", { exact: true }).click();
  await target.locator("#VOP_M3001_D3grid100").waitFor({ state: "attached", timeout: 30000 });
  await target.waitForTimeout(700);
  const [ocean, interport] = await Promise.all([
    gridRows(target, "VOP_M3001_D3grid100", "ocean"),
    gridRows(target, "VOP_M3001_D3grid101", "interport")
  ]);
  const specialCargo = target.getByText("Special Cargo", { exact: true });
  if (await specialCargo.count()) {
    await specialCargo.first().click();
    await target.waitForTimeout(500);
  }
  const special = await specialCargoRows(target);
  return {
    vvd,
    pol,
    rows: [...ocean, ...interport].map((row) => ({
      ...row,
      qty20: number(row.qty20),
      qty40: number(row.qty40),
      empty20: number(row.empty20),
      empty40: number(row.empty40),
      weight: Math.round(number(row.weight) * 10) / 10
    })),
    special: special.map((row) => ({
      ...row,
      rf20: number(row.rf20),
      rf40: number(row.rf40)
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
    json(res, 500, { error: error?.message || String(error), code: error?.code || "TDR_QUERY_FAILED" });
  }
});

server.listen(PORT, HOST, () => console.log(`Space Control TDR helper: http://${HOST}:${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await context?.close().catch(() => undefined);
    server.close(() => process.exit(0));
  });
}
