import {
  ID, DATE, PLACE, AIRFIELD, AIRFIELD_NAME, REGION, COUNTRY, TYPE, TIME, DAYLIGHT,
  DEATHS, INJURIES, TSB, TC_REGION, FR_TYPE, FR_REGION, FR_COUNTRY,
  CATEGORIES, EVENTS, AIRCRAFT, ORPHAN_EVENTS, labels, pageSize,
} from "./search.mjs";

const $ = id => document.getElementById(id);
const whole = new Intl.NumberFormat("en-CA");
const prettyDate = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" });
const query = $("query");
const dialog = $("details");
const inputs = ["year", "region", "kind", "event"];
let meta;
let latestYear = "";
let worker;
let generation = 0;
let page = 1;
let timer;
let lastCount = 0;
let linked = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, fn, className = "light-button") {
  const node = el("button", text, className);
  node.type = "button";
  node.addEventListener("click", fn);
  return node;
}

function hyperlink(text, target, className = "") {
  const node = el("a", text, className);
  node.href = target;
  node.target = "_blank";
  node.rel = "noopener";
  return node;
}

function date(value) {
  if (!value) return "Not recorded";
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? value : prettyDate.format(time);
}

function textPair(list, term, definition) {
  list.append(el("dt", term), el("dd", definition));
}

function detailPair(list, term, definition) {
  const group = el("div");
  textPair(group, term, definition ?? "Not recorded");
  list.append(group);
}

function reportPlace(row) {
  return row[PLACE] || row[AIRFIELD_NAME] || row[REGION] || "Location not recorded";
}

function option(select, value, label = value) {
  const node = el("option", label);
  node.value = value;
  select.append(node);
}

function state() {
  return Object.fromEntries([["q", query.value.trim()], ...inputs.map(id => [id, $(id).value])]);
}

function writeLocation(filters, record) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value || key === "year") params.set(key, value);
  }
  if (record) params.set("report", record);
  const target = new URL(location.href);
  target.hash = params.toString();
  return target;
}

function schedule({ resetPage = true } = {}) {
  if (!meta) return;
  if (resetPage) page = 1;
  const filters = state();
  history.replaceState(null, "", writeLocation(filters, linked));
  $("pagination").hidden = true;
  $("status").textContent = "Searching the archive…";
  $("results").setAttribute("aria-busy", "true");
  clearTimeout(timer);
  const id = ++generation;
  timer = setTimeout(() => worker.postMessage({ type: "search", filters, page, id, linked }), 90);
}

function configure(manifest) {
  meta = manifest;
  latestYear = meta.shards.find(part => /^\d{4}$/.test(part.year))?.year ?? "";
  for (const part of meta.shards) option($("year"), part.year, part.year === "undated" ? "Undated" : part.year);
  for (const key of ["region", "kind", "event"]) {
    const group = { region: "regions", kind: "kinds", event: "events" }[key];
    for (const value of meta[group]) option($(key), value);
  }
  for (const id of inputs) $(id).disabled = false;
  $("archive-count").textContent = `${whole.format(meta.total)} reports`;
  $("coverage").textContent = meta.latest ? `Latest recorded occurrence: ${date(meta.latest)}` : "Occurrence date unavailable";
  const details = $("source-status");
  textPair(details, "Occurrence table modified", meta.sourceUpdated ? date(meta.sourceUpdated) : "Date unavailable");
  textPair(details, "Snapshot built", date(meta.built));
  textPair(details, "Latest occurrence date", date(meta.latest));
  if (meta.sourceUpdated && Date.now() - new Date(meta.sourceUpdated) > 45 * 86400_000) {
    details.after(el("p", "This download may be stale. Compare it with the official query for recent records.", "hint"));
  }
  for (const chip of document.querySelectorAll("[data-discover]")) {
    if (chip.dataset.mode === "event" && !meta.events.includes(chip.dataset.discover)) chip.hidden = true;
  }
  readLocation(query.value);
}

function readLocation(initialQuery = "") {
  const params = new URLSearchParams(location.hash.slice(1));
  query.value = (params.get("q") ?? initialQuery).slice(0, 160);
  linked = params.get("report")?.slice(0, 40) ?? null;
  for (const id of inputs) {
    const value = params.get(id) ?? (id === "year" ? latestYear : "");
    $(id).value = value;
    if ($(id).selectedIndex === -1) $(id).value = "";
  }
  schedule();
}

function clear() {
  for (const id of inputs) $(id).value = id === "year" ? latestYear : "";
  query.value = "";
  linked = null;
  schedule();
  query.focus();
}

function loadFailed() {
  $("status").textContent = "Snapshot unavailable";
  $("results").removeAttribute("aria-busy");
  const box = el("div", undefined, "empty");
  box.append(el("h3", "The archive did not load"), el("p", "Retry the snapshot or search Transport Canada directly."),
    button("Retry", () => location.reload()), el("p"));
  box.lastElementChild.append(hyperlink("Official CADORS query ↗", document.querySelector(".source-links a").href));
  $("results").replaceChildren(box);
}

function recordCard(row) {
  const article = el("article", undefined, "report");
  const header = el("h3");
  header.append(button(reportPlace(row), () => detail(row), "report-title"));
  const tags = [...new Set(labels(row).map(pair => pair[0] || pair[1]).filter(Boolean))];
  const display = [row[TYPE], row[AIRFIELD], ...tags.slice(0, 3)].filter(Boolean).join(" · ");
  article.append(el("p", `${row[ID]} · ${date(row[DATE])}`, "report-meta"), header,
    el("p", display || "Event details unavailable in the published tables"));
  return article;
}

function showResults({ count, results }) {
  lastCount = count;
  const list = $("results");
  list.removeAttribute("aria-busy");
  const scope = $("year").value === "undated" ? "undated records" : $("year").value || "all years";
  $("status").textContent = `${whole.format(count)} ${count === 1 ? "report" : "reports"} · ${scope}`;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  $("pagination").hidden = pages < 2;
  $("previous").disabled = page === 1;
  $("next").disabled = page >= pages;
  $("page-number").textContent = `Page ${whole.format(page)} of ${whole.format(pages)}`;
  list.replaceChildren(...results.map(recordCard));
  if (count) return;
  const box = el("div", undefined, "empty");
  box.append(el("h3", "No occurrences found"),
    el("p", "Try a different airfield name or a smaller phrase. Clear filters to broaden the search."),
    button("Clear filters", clear));
  if ($("year").value) box.append(" ", button("Search all years", () => {
    $("year").value = "";
    schedule();
  }));
  list.append(box);
}

async function copy(value, label, status, host) {
  try {
    await navigator.clipboard.writeText(value);
    status.textContent = label;
  } catch {
    const field = el("input");
    field.readOnly = true;
    field.value = value;
    field.setAttribute("aria-label", "Text to copy");
    host.append(field);
    field.select();
    status.textContent = "Copy the selected text.";
  }
}

function labelList(host, heading, pairs) {
  const names = [...new Set(pairs.map(pair => pair.filter(Boolean).join(" / ")).filter(Boolean))];
  if (!names.length) return;
  const list = el("ul", undefined, "detail-list");
  for (const name of names) list.append(el("li", name));
  host.append(el("h3", heading), list);
}

function detail(row) {
  $("detail-title").textContent = row[ID];
  const content = $("detail-body");
  const grid = el("dl", undefined, "detail-grid");
  detailPair(grid, "Occurrence", [row[TYPE], row[FR_TYPE]].filter(Boolean).filter((value, i, all) => all.indexOf(value) === i).join(" / ") || null);
  detailPair(grid, "Date and time", [date(row[DATE]), row[TIME], row[DAYLIGHT]].filter(Boolean).join(" · "));
  detailPair(grid, "Location", [reportPlace(row), row[REGION], row[COUNTRY]].filter(Boolean).filter((value, i, all) => all.indexOf(value) === i).join(" · "));
  detailPair(grid, "Aerodrome", row[AIRFIELD_NAME] || row[AIRFIELD] || null);
  detailPair(grid, "Transport Canada region", row[TC_REGION] || null);
  detailPair(grid, "Fatalities and injuries", `${row[DEATHS] ?? "Unknown"} / ${row[INJURIES] ?? "Unknown"}`);
  if (row[TSB]) detailPair(grid, "TSB occurrence number", row[TSB]);
  content.replaceChildren(grid);
  labelList(content, "Occurrence categories", row[CATEGORIES]);
  labelList(content, "Occurrence events", row[EVENTS]);
  labelList(content, "Other aircraft events", row[ORPHAN_EVENTS]);
  for (const aircraft of row[AIRCRAFT]) {
    const [registration, flight, make, model, operator, category, phase, damage, country, events] = aircraft;
    const aircraftGrid = el("dl", undefined, "detail-grid");
    detailPair(aircraftGrid, "Aircraft", [make, model, category].filter(Boolean).join(" · ") || null);
    detailPair(aircraftGrid, "Flight and registration", [flight, registration, country].filter(Boolean).join(" · ") || null);
    detailPair(aircraftGrid, "Operator", operator || null);
    detailPair(aircraftGrid, "Phase and damage", [phase, damage].filter(Boolean).join(" · ") || null);
    content.append(el("h3", "Aircraft record"), aircraftGrid);
    labelList(content, "Aircraft events", events);
  }
  const instruction = el("p", "For a narrative where published, copy the number and paste it into Transport Canada’s CADORS Number field.", "detail-note");
  const status = el("p", "", "detail-note");
  status.setAttribute("role", "status");
  const actions = el("div", undefined, "detail-actions");
  const recordYear = /^\d{4}-/.test(row[DATE]) ? row[DATE].slice(0, 4) : "undated";
  const link = writeLocation({ q: row[ID], year: recordYear }, row[ID]);
  actions.append(
    hyperlink("Official CADORS query ↗", meta.query, "primary"),
    button("Copy CADORS number", () => copy(row[ID], "CADORS number copied.", status, content)),
    button("Copy report link", () => copy(link.href, "Report link copied.", status, content)),
  );
  content.append(instruction, actions, status);
  if (!dialog.open) dialog.showModal();
}

$("search-form").addEventListener("submit", event => { event.preventDefault(); linked = null; schedule(); });
query.addEventListener("input", () => { linked = null; schedule(); });
for (const id of inputs) $(id).addEventListener("change", () => { linked = null; schedule(); });
$("reset").addEventListener("click", clear);
$("previous").addEventListener("click", () => {
  if (page > 1) { page -= 1; schedule({ resetPage: false }); $("results-heading").focus(); }
});
$("next").addEventListener("click", () => {
  if (page * pageSize < lastCount) { page += 1; schedule({ resetPage: false }); $("results-heading").focus(); }
});
for (const chip of document.querySelectorAll("[data-discover]")) {
  chip.addEventListener("click", () => {
    if (!meta) return;
    linked = null;
    for (const id of inputs) $(id).value = "";
    query.value = chip.dataset.mode === "event" ? "" : chip.dataset.discover;
    if (chip.dataset.mode === "event") $("event").value = chip.dataset.discover;
    schedule();
  });
}
window.addEventListener("hashchange", () => { if (meta) readLocation(); });

try {
  worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "metadata") configure(data.manifest);
    if (data.id !== undefined && data.id !== generation) return;
    if (data.type === "error") loadFailed();
    if (data.type === "progress" && data.total > 1) $("status").textContent = `Searching ${data.loaded} of ${data.total} year groups…`;
    if (data.type === "found") {
      showResults(data);
      if (linked) {
        if (data.linked) detail(data.linked);
        else $("status").textContent += " · The linked report was not found in this snapshot.";
        linked = null;
      }
    }
  });
  worker.addEventListener("error", loadFailed);
} catch {
  loadFailed();
}
