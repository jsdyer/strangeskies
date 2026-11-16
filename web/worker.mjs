import { ID, matcher, pageSize } from "./search.mjs";

let manifest;
let active = 0;
const cache = new Map();
const memoryYears = 6;
const directory = new URL("./data/", import.meta.url);

async function fetchFile(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Data request returned HTTP ${response.status}.`);
  return response;
}

async function fetchRows(part) {
  const response = await fetchFile(new URL(part.file, directory));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const blob = new Blob([bytes]);
  const plain = bytes[0] === 31 && bytes[1] === 139
    ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : await blob.text();
  const rows = JSON.parse(plain);
  if (!Array.isArray(rows) || rows.length !== part.count) throw new Error(`Incomplete archive for ${part.year}.`);
  return rows;
}

function rowsOf(part) {
  const pending = cache.get(part.year) ?? fetchRows(part);
  cache.delete(part.year);
  cache.set(part.year, pending);
  if (cache.size > memoryYears) cache.delete(cache.keys().next().value);
  return pending.catch(error => {
    if (cache.get(part.year) === pending) cache.delete(part.year);
    throw error;
  });
}

async function init() {
  manifest = await (await fetchFile(new URL("manifest.json", directory))).json();
  if (manifest.version !== 1 || !manifest.total || !Array.isArray(manifest.shards)) {
    throw new Error("Invalid archive manifest.");
  }
  self.postMessage({ type: "metadata", manifest });
}

async function search({ id, filters, page, linked }) {
  if (!manifest) return;
  active = id;
  const parts = filters.year ? manifest.shards.filter(part => part.year === filters.year) : manifest.shards;
  const run = matcher(filters);
  let count = 0;
  let selected;
  const results = [];
  const start = (page - 1) * pageSize;
  for (let index = 0; index < parts.length; index += 3) {
    const chunk = await Promise.all(parts.slice(index, index + 3).map(rowsOf));
    if (id !== active) return;
    for (const rows of chunk) {
      for (const row of rows) {
        if (linked && row[ID] === linked) selected = row;
        if (!run(row)) continue;
        if (count >= start && results.length < pageSize) results.push(row);
        count += 1;
      }
    }
    self.postMessage({ type: "progress", id, loaded: Math.min(index + 3, parts.length), total: parts.length });
  }
  self.postMessage({ type: "found", id, count, results, linked: selected });
}

self.onmessage = ({ data }) => {
  if (data.type === "search") search(data).catch(error => {
    if (data.id === active) self.postMessage({ type: "error", id: data.id, message: error.message });
  });
};
init().catch(error => self.postMessage({ type: "error", message: error.message }));
