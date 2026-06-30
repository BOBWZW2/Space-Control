const SCHEDULE_URL = "https://raw.githubusercontent.com/BOBWZW2/data-base/main/schedule_latest.xlsx";
const MAPPING_URL = "./data/vessel_mapping_latest.csv";
const DEFAULT_LANES = ["CGX", "CGS", "HLX", "KCI", "CI3"];
const PORT_ALIASES = new Map([["CNNSA", "CNNAS"]]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SETTINGS_KEY = "space-control-schedule-web-settings";
const CACHE_KEY = "space-control-schedule-web-cache-v1";

const els = {
  laneList: document.querySelector("#laneList"),
  laneForm: document.querySelector("#laneForm"),
  laneInput: document.querySelector("#laneInput"),
  laneOptions: document.querySelector("#laneOptions"),
  vesselList: document.querySelector("#vesselList"),
  vesselForm: document.querySelector("#vesselForm"),
  vesselInput: document.querySelector("#vesselInput"),
  vesselOptions: document.querySelector("#vesselOptions"),
  refreshButton: document.querySelector("#refreshButton"),
  sourceDate: document.querySelector("#sourceDate"),
  sourceStatus: document.querySelector("#sourceStatus"),
  clockDate: document.querySelector("#clockDate"),
  clockTime: document.querySelector("#clockTime"),
  departedCount: document.querySelector("#departedCount"),
  todayCount: document.querySelector("#todayCount"),
  futureCount: document.querySelector("#futureCount"),
  focusCount: document.querySelector("#focusCount"),
  noticeBar: document.querySelector("#noticeBar"),
  noticeText: document.querySelector("#noticeText"),
  statusTabs: document.querySelectorAll(".status-tab"),
  statusView: document.querySelector("#statusView"),
  activeStatusTitle: document.querySelector("#activeStatusTitle"),
  activeStatusSubtitle: document.querySelector("#activeStatusSubtitle"),
  activeWList: document.querySelector("#activeWList"),
  activeEList: document.querySelector("#activeEList"),
};

const TAB_META = {
  departed: {
    title: "已离港",
    subtitle: "过去五天 ETD",
    className: "departed-column",
  },
  today: {
    title: "今日",
    subtitle: "今日 ETB",
    className: "today-column",
  },
  future: {
    title: "未来五天到港",
    subtitle: "接下来五天 ETB",
    className: "future-column",
  },
};

let dashboard = null;
let activeTab = "departed";
let vesselLookup = new Map();
let busy = false;

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePort(value) {
  const code = normalizeUpper(value);
  return PORT_ALIASES.get(code) || code;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function parseDateTime(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoLocal(value) {
  if (!value) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function displayDateTime(value) {
  if (!value) return "";
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function directionForVvd(vvd) {
  const clean = normalizeUpper(vvd).replace(/[^A-Z0-9]/g, "");
  return clean.endsWith("E") ? "E" : "W";
}

function xmlDecode(value) {
  return normalizeText(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)));
}

function parseAttributes(xml) {
  const attrs = {};
  for (const match of xml.matchAll(/([\w:]+)="([^"]*)"/g)) {
    attrs[match[1]] = xmlDecode(match[2]);
  }
  return attrs;
}

function extractTextNodes(xml) {
  const parts = [];
  for (const match of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    parts.push(xmlDecode(match[1]));
  }
  return parts.join("");
}

function extractValueNode(xml) {
  const match = xml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  return match ? xmlDecode(match[1]) : "";
}

function columnIndexFromRef(ref) {
  const match = normalizeText(ref).match(/^([A-Z]+)/i);
  if (!match) return null;
  let index = 0;
  for (const letter of match[1].toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index;
}

async function parseSharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("string");
  const strings = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(extractTextNodes(match[1]));
  }
  return strings;
}

function parseCellValue(attrs, body, sharedStrings) {
  if (attrs.t === "inlineStr") return extractTextNodes(body);
  if (attrs.t === "s") return sharedStrings[Number(extractValueNode(body))] || "";
  if (attrs.t === "str") return extractValueNode(body);
  return extractValueNode(body) || extractTextNodes(body);
}

async function parseScheduleWorkbook(buffer) {
  if (!window.JSZip) throw new Error("Excel parser library did not load");
  const zip = await window.JSZip.loadAsync(buffer);
  const sheet = zip.file("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("schedule workbook missing sheet1.xml");

  const sharedStrings = await parseSharedStrings(zip);
  const xml = await sheet.async("string");
  const rowMaps = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1];
    const cells = new Map();
    let fallbackColumn = 1;

    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const column = columnIndexFromRef(attrs.r) || fallbackColumn;
      fallbackColumn = column + 1;
      cells.set(column, parseCellValue(attrs, cellMatch[2], sharedStrings));
    }

    rowMaps.push(cells);
  }

  const headerMap = {};
  for (const [column, value] of rowMaps[0] || []) {
    headerMap[normalizeUpper(value)] = column;
  }

  const required = ["LANE", "VVD", "PORT", "ETA", "ETB", "ETD"];
  const missing = required.filter((name) => !headerMap[name]);
  if (missing.length) throw new Error(`schedule workbook missing columns: ${missing.join(", ")}`);

  const rows = [];
  for (let i = 1; i < rowMaps.length; i += 1) {
    const row = rowMaps[i];
    const lane = normalizeUpper(row.get(headerMap.LANE));
    const vvd = normalizeUpper(row.get(headerMap.VVD));
    const port = normalizePort(row.get(headerMap.PORT));
    if (!lane || !vvd || !port) continue;

    rows.push({
      rowNumber: i + 1,
      lane,
      vvd,
      port,
      eta: normalizeText(row.get(headerMap.ETA)),
      etb: normalizeText(row.get(headerMap.ETB)),
      etd: normalizeText(row.get(headerMap.ETD)),
    });
  }

  return rows;
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    records.push(row);
  }

  return records;
}

async function loadVesselMapping() {
  const response = await fetch(`${MAPPING_URL}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return new Map();
  const rows = parseCsv(await response.text());
  if (rows.length < 2) return new Map();

  const headers = rows[0].map((value) => normalizeUpper(value).replace(/\s+/g, "_"));
  const codeIndex = headers.findIndex((name) => ["VESSEL_CODE", "CODE", "VSL_CODE"].includes(name));
  const nameIndex = headers.findIndex((name) => ["VESSEL_NAME", "NAME", "VSL_NAME"].includes(name));
  const activeIndex = headers.findIndex((name) => ["ACTIVE", "STATUS"].includes(name));
  const mapping = new Map();

  for (const row of rows.slice(1)) {
    const active = activeIndex >= 0 ? normalizeUpper(row[activeIndex]) : "";
    if (["N", "NO", "FALSE", "0", "INACTIVE"].includes(active)) continue;
    const code = normalizeUpper(row[codeIndex]);
    const name = normalizeUpper(row[nameIndex]);
    if (code && name) mapping.set(code, name);
  }

  return mapping;
}

function vesselForVvd(vvd, mapping) {
  const clean = normalizeUpper(vvd).replace(/[^A-Z0-9]/g, "");
  const codes = [...mapping.keys()].sort((a, b) => b.length - a.length);
  const mappedCode = codes.find((code) => clean.startsWith(code));
  if (mappedCode) return { vesselCode: mappedCode, vesselName: mapping.get(mappedCode) };
  const fallback = clean.match(/^([A-Z]+)\d/);
  const vesselCode = fallback ? fallback[1] : clean;
  return { vesselCode, vesselName: "" };
}

function defaultSettings() {
  return {
    lanes: DEFAULT_LANES.map((code) => ({ code, enabled: true })),
    vesselFocus: [],
  };
}

function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!raw) return defaultSettings();
    const lanes = Array.isArray(raw.lanes) && raw.lanes.length ? raw.lanes : defaultSettings().lanes;
    const vesselFocus = Array.isArray(raw.vesselFocus) ? raw.vesselFocus : [];
    return {
      lanes: lanes.map((lane) => ({
        code: normalizeUpper(typeof lane === "string" ? lane : lane.code).replace(/\s+/g, ""),
        enabled: typeof lane === "object" && "enabled" in lane ? Boolean(lane.enabled) : true,
      })).filter((lane) => lane.code),
      vesselFocus: [...new Set(vesselFocus.map(normalizeUpper).filter(Boolean))],
    };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function fetchScheduleRows(force = false) {
  const url = `${SCHEDULE_URL}?refresh=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub schedule request failed: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 1024) throw new Error("downloaded schedule file is unexpectedly small");
  const rows = await parseScheduleWorkbook(buffer);
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    rows,
  }));
  return { rows, fetchedAt: new Date().toISOString(), fromCache: false };
}

function readCachedRows() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cache && Array.isArray(cache.rows)) return { ...cache, fromCache: true };
  } catch {
    // Ignore broken cache.
  }
  return null;
}

function enrichRows(rows, mapping) {
  return rows.map((row) => ({
    ...row,
    ...vesselForVvd(row.vvd, mapping),
    direction: directionForVvd(row.vvd),
    etaDate: parseDateTime(row.eta),
    etbDate: parseDateTime(row.etb),
    etdDate: parseDateTime(row.etd),
  }));
}

function rowMatchesFocus(row, settings) {
  const enabledLanes = new Set(settings.lanes.filter((lane) => lane.enabled).map((lane) => lane.code));
  if (enabledLanes.has(row.lane)) return true;
  if (!settings.vesselFocus.length) return false;
  const searchable = `${row.vesselCode || ""} ${row.vesselName || ""} ${row.vvd || ""}`.toUpperCase();
  return settings.vesselFocus.some((term) => searchable.includes(term));
}

function makeItem(row, group, eventDate, eventField) {
  return {
    id: `${group}:${row.lane}:${row.vvd}:${row.port}:${toIsoLocal(eventDate) || ""}`,
    direction: row.direction,
    lane: row.lane,
    vvd: row.vvd,
    port: row.port,
    template: `${row.lane} - ${row.vvd} - ${row.port}`,
    vesselCode: row.vesselCode,
    vesselName: row.vesselName,
    etbTime: toIsoLocal(row.etbDate),
    etdTime: toIsoLocal(row.etdDate),
    etbLabel: displayDateTime(row.etbDate),
    etdLabel: displayDateTime(row.etdDate),
    eventField,
    eventTime: toIsoLocal(eventDate),
  };
}

function duplicateCallKey(item) {
  const vessel = item.vesselCode || item.vvd.replace(/\d.*$/, "");
  return [
    vessel,
    item.port,
    item.etbTime || item.eventTime || "",
    item.etdTime || item.eventTime || "",
  ].join("|");
}

function shouldReplaceDuplicate(existing, candidate) {
  return existing.direction === "E" && candidate.direction === "W";
}

function dedupeCalls(items) {
  const byCall = new Map();
  for (const item of items) {
    const key = duplicateCallKey(item);
    const existing = byCall.get(key);
    if (!existing || shouldReplaceDuplicate(existing, item)) {
      byCall.set(key, item);
    }
  }
  return [...byCall.values()];
}

function splitByDirection(groups) {
  const directions = {
    W: { departed: [], today: [], future: [] },
    E: { departed: [], today: [], future: [] },
  };
  for (const key of ["departed", "today", "future"]) {
    for (const item of groups[key]) {
      directions[item.direction === "E" ? "E" : "W"][key].push(item);
    }
  }
  return directions;
}

function buildGroups(rows, settings, now = new Date()) {
  const focusedRows = rows.filter((row) => rowMatchesFocus(row, settings));
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const futureEnd = addDays(todayStart, 6);
  const departedStart = new Date(now.getTime() - 5 * MS_PER_DAY);
  const departed = [];
  const today = [];
  const future = [];

  for (const row of focusedRows) {
    if (row.etdDate && row.etdDate >= departedStart && row.etdDate <= now) {
      departed.push(makeItem(row, "departed", row.etdDate, "ETD"));
    }
    if (row.etbDate && row.etbDate >= todayStart && row.etbDate < tomorrowStart) {
      today.push(makeItem(row, "today", row.etbDate, "ETB"));
    }
    if (row.etbDate && row.etbDate >= tomorrowStart && row.etbDate < futureEnd) {
      future.push(makeItem(row, "future", row.etbDate, "ETB"));
    }
  }

  const deduped = {
    departed: dedupeCalls(departed),
    today: dedupeCalls(today),
    future: dedupeCalls(future),
  };
  const directions = splitByDirection(deduped);

  deduped.departed.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
  deduped.today.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  deduped.future.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  for (const direction of Object.values(directions)) {
    direction.departed.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
    direction.today.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
    direction.future.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  }

  return {
    departed: deduped.departed,
    today: deduped.today,
    future: deduped.future,
    directions,
    focusedRows,
  };
}

function buildOptions(rows) {
  const lanes = [...new Set(rows.map((row) => row.lane).filter(Boolean))].sort();
  const vessels = new Map();
  for (const row of rows) {
    const value = row.vesselName || row.vesselCode;
    if (!value) continue;
    vessels.set(value, {
      value,
      label: row.vesselName && row.vesselCode ? `${row.vesselName} (${row.vesselCode})` : value,
      code: row.vesselCode || "",
      name: row.vesselName || "",
    });
  }
  return {
    lanes,
    vessels: [...vessels.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function buildDashboard(rows, fetchedAt, fromCache, settings) {
  const groups = buildGroups(rows, settings);
  return {
    generatedAt: new Date().toISOString(),
    source: { fetchedAt, fromCache },
    settings,
    options: buildOptions(rows),
    stats: {
      focusedRows: groups.focusedRows.length,
      departed: groups.departed.length,
      today: groups.today.length,
      future: groups.future.length,
    },
    groups: {
      departed: { items: groups.departed },
      today: { items: groups.today },
      future: { items: groups.future },
    },
    directions: {
      W: groups.directions.W,
      E: groups.directions.E,
    },
  };
}

function setBusy(nextBusy) {
  busy = nextBusy;
  document.body.classList.toggle("loading", busy);
  els.refreshButton.disabled = busy;
  els.refreshButton.textContent = busy ? "正在刷新..." : "手动刷新船期";
}

function updateClock() {
  const now = new Date();
  els.clockDate.textContent = dateFormatter.format(now);
  els.clockTime.textContent = timeFormatter.format(now);
}

function selectedLaneCodes(settings) {
  return new Set(settings.lanes.map((lane) => lane.code));
}

function selectedVessels(settings) {
  return new Set(settings.vesselFocus);
}

function renderLaneOptions(settings, options) {
  const selected = selectedLaneCodes(settings);
  els.laneOptions.innerHTML = (options.lanes || [])
    .filter((code) => !selected.has(code))
    .map((code) => `<option value="${escapeHtml(code)}"></option>`)
    .join("");
}

function renderVesselOptions(settings, options) {
  const selected = selectedVessels(settings);
  vesselLookup = new Map();
  const optionHtml = [];

  for (const item of options.vessels || []) {
    if (selected.has(item.value)) continue;
    const label = item.label || item.value;
    vesselLookup.set(normalizeUpper(label), item.value);
    vesselLookup.set(normalizeUpper(item.value), item.value);
    if (item.code) vesselLookup.set(normalizeUpper(item.code), item.value);
    if (item.name) vesselLookup.set(normalizeUpper(item.name), item.value);
    optionHtml.push(`<option value="${escapeHtml(label)}"></option>`);
  }

  els.vesselOptions.innerHTML = optionHtml.join("");
}

function renderSettings(settings, options) {
  els.laneList.innerHTML = settings.lanes.map((lane) => {
    const code = escapeHtml(lane.code);
    return `
      <div class="lane-toggle">
        <input type="checkbox" id="lane-${code}" data-lane="${code}" ${lane.enabled ? "checked" : ""}>
        <label for="lane-${code}">${code}</label>
        <button class="ghost-button" type="button" data-remove-lane="${code}" title="删除航线" aria-label="删除航线 ${code}">×</button>
      </div>
    `;
  }).join("");

  els.vesselList.classList.toggle("empty", settings.vesselFocus.length === 0);
  els.vesselList.innerHTML = settings.vesselFocus.map((value) => {
    const label = escapeHtml(value);
    return `
      <span class="chip">
        <span>${label}</span>
        <button class="ghost-button" type="button" data-remove-vessel="${label}" title="删除船名" aria-label="删除船名 ${label}">×</button>
      </span>
    `;
  }).join("");

  renderLaneOptions(settings, options);
  renderVesselOptions(settings, options);
}

function renderSource(source) {
  const date = source.fetchedAt ? new Date(source.fetchedAt) : null;
  els.sourceDate.textContent = date && !Number.isNaN(date.getTime())
    ? `${date.getMonth() + 1}/${date.getDate()} ${timeFormatter.format(date)}`
    : "--";
  els.sourceStatus.classList.toggle("error", source.fromCache);
  els.sourceStatus.textContent = source.fromCache ? "使用缓存" : "已读取";
}

function renderMetrics(stats) {
  els.departedCount.textContent = stats.departed;
  els.todayCount.textContent = stats.today;
  els.futureCount.textContent = stats.future;
  els.focusCount.textContent = stats.focusedRows;
  els.statusTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
}

function timeText(label, value) {
  return `${label} ${value || "--"}`;
}

function renderGroup(container, items) {
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">无</div>';
    return;
  }

  container.innerHTML = items.map((item) => {
    const vessel = item.vesselName || item.vesselCode || "";
    return `
      <article class="schedule-card">
        <div class="template">${escapeHtml(item.template)}</div>
        ${vessel ? `<div class="vessel-plain">${escapeHtml(vessel)}</div>` : ""}
        <div class="time-plain">
          <span>${escapeHtml(timeText("ETB", item.etbLabel))}</span>
          <span>${escapeHtml(timeText("ETD", item.etdLabel))}</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderActiveStatus() {
  const meta = TAB_META[activeTab];
  els.activeStatusTitle.textContent = meta.title;
  els.activeStatusSubtitle.textContent = meta.subtitle;
  els.statusView.className = `status-view ${meta.className}`;
  renderGroup(els.activeWList, dashboard.directions.W[activeTab]);
  renderGroup(els.activeEList, dashboard.directions.E[activeTab]);
  els.statusTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
}

function renderDashboard(nextDashboard) {
  dashboard = nextDashboard;
  renderSettings(dashboard.settings, dashboard.options);
  renderSource(dashboard.source);
  renderMetrics(dashboard.stats);
  renderActiveStatus();
}

async function loadDashboard({ force = false } = {}) {
  setBusy(true);
  els.noticeBar.hidden = true;
  try {
    const settings = readSettings();
    const mapping = await loadVesselMapping();
    const schedule = await fetchScheduleRows(force);
    const rows = enrichRows(schedule.rows, mapping);
    renderDashboard(buildDashboard(rows, schedule.fetchedAt, schedule.fromCache, settings));
  } catch (error) {
    const cache = readCachedRows();
    if (cache) {
      const settings = readSettings();
      const mapping = await loadVesselMapping();
      const rows = enrichRows(cache.rows, mapping);
      renderDashboard(buildDashboard(rows, cache.fetchedAt, true, settings));
      els.noticeBar.hidden = false;
      els.noticeText.textContent = `GitHub 读取失败，当前使用浏览器缓存：${error.message}`;
    } else {
      els.noticeBar.hidden = false;
      els.noticeText.textContent = error.message;
    }
  } finally {
    setBusy(false);
  }
}

function updateSettings(updater) {
  const settings = updater(readSettings());
  saveSettings(settings);
  if (dashboard) loadDashboard({ force: false });
}

els.laneList.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-lane]");
  if (!input || busy) return;
  const code = input.dataset.lane;
  updateSettings((settings) => ({
    ...settings,
    lanes: settings.lanes.map((lane) => lane.code === code ? { ...lane, enabled: input.checked } : lane),
  }));
});

els.laneList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-lane]");
  if (!button || busy) return;
  const code = button.dataset.removeLane;
  updateSettings((settings) => ({
    ...settings,
    lanes: settings.lanes.filter((lane) => lane.code !== code),
  }));
});

els.laneForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  const code = normalizeUpper(els.laneInput.value).replace(/\s+/g, "");
  if (!code) return;
  els.laneInput.value = "";
  updateSettings((settings) => ({
    ...settings,
    lanes: settings.lanes.some((lane) => lane.code === code)
      ? settings.lanes
      : [...settings.lanes, { code, enabled: true }],
  }));
});

els.vesselList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-vessel]");
  if (!button || busy) return;
  const value = button.dataset.removeVessel;
  updateSettings((settings) => ({
    ...settings,
    vesselFocus: settings.vesselFocus.filter((item) => item !== value),
  }));
});

els.vesselForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  const raw = normalizeUpper(els.vesselInput.value);
  const value = vesselLookup.get(raw) || raw;
  if (!value) return;
  els.vesselInput.value = "";
  updateSettings((settings) => ({
    ...settings,
    vesselFocus: settings.vesselFocus.includes(value)
      ? settings.vesselFocus
      : [...settings.vesselFocus, value],
  }));
});

els.statusTabs.forEach((button) => {
  button.addEventListener("click", () => {
    if (!dashboard || busy) return;
    activeTab = button.dataset.tab;
    renderMetrics(dashboard.stats);
    renderActiveStatus();
  });
});

els.refreshButton.addEventListener("click", () => {
  if (!busy) loadDashboard({ force: true });
});

updateClock();
setInterval(updateClock, 30 * 1000);
setInterval(() => loadDashboard({ force: false }), 30 * 60 * 1000);
await loadDashboard({ force: true });
