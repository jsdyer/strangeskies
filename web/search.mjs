// These indices follow the compact row format emitted by scripts/build.py.
export const [ID, DATE, PLACE, AIRFIELD, AIRFIELD_NAME, REGION, COUNTRY, TYPE, TIME,
  DAYLIGHT, DEATHS, INJURIES, TSB, TC_REGION, FR_TYPE, FR_REGION, FR_COUNTRY,
  CATEGORIES, EVENTS, AIRCRAFT, ORPHAN_EVENTS] = Array.from({ length: 21 }, (_, index) => index);
export const pageSize = 24;

export function labels(row) {
  return [...row[CATEGORIES], ...row[EVENTS], ...row[ORPHAN_EVENTS], ...row[AIRCRAFT].flatMap(plane => plane[9])];
}

export function normalize(value) {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function terms(query) {
  return [...query.slice(0, 160).replace(/[“”]/g, '"').matchAll(/"([^"]*)"?|([^\s"]+)/gu)]
    .map(term => normalize(term[1] ?? term[2])).filter(Boolean);
}

function textOf(row) {
  return normalize([
    row[ID], row[DATE], row[PLACE], row[AIRFIELD], row[AIRFIELD_NAME], row[REGION],
    row[COUNTRY], row[TYPE], row[TSB], row[TC_REGION], row[FR_TYPE], row[FR_REGION],
    row[FR_COUNTRY], ...labels(row).flat(), ...row[AIRCRAFT].flatMap(plane => plane.slice(0, 9)),
  ].join(" "));
}

export function matcher(filters) {
  const parts = terms(filters.q);
  return row => {
    if (filters.region && row[REGION] !== filters.region) return false;
    if (filters.kind && row[TYPE] !== filters.kind) return false;
    if (filters.event && !labels(row).some(label => label[0] === filters.event)) return false;
    if (!parts.length) return true;
    const index = textOf(row);
    return parts.every(term => index.includes(term));
  };
}
