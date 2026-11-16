#!/usr/bin/env python3
"""Join licensed CADORS CSVs into a static archive with yearly data shards."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
import gzip
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
from time import sleep
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATASET = "https://open.canada.ca/data/en/dataset/a348c1d1-2392-4595-b5e2-c6a244a7e87f"
CANADA_OGL = "https://open.canada.ca/en/open-government-licence-canada"
BASE = "https://opendatatc.tc.canada.ca/CADORS_"
QUERY = "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/CADORS-SCREAQ/q.aspx?lang=eng"
NARRATIVES = "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/CADORS-SCREAQ/ws.aspx?lang=eng"

OCCURRENCE = (
    "cadorsnumber", "occurrencedate", "occurrencelocation", "aerodromeid",
    "aerodromelocation", "subdivision_enm", "country_enm",
    "occurrencetypedescriptione", "occurrencetime", "dayornight", "fatalities",
    "Injuries", "tsboccurrencenumber", "tc_region_enm",
    "occurrencetypedescriptionf", "subdivision_fnm", "country_fnm",
)
AIRCRAFT = (
    "cadorsnumber", "aircraftnumber", "aircraftregistration", "foreignaircraftregistration",
    "flightnumber", "aircraft_make_name_nm", "aircraft_model_name_nm",
    "operator", "Categorydescriptione", "phasenamee", "damagedescriptione",
    "Country_Enm",
)
SCHEMA = {
    "Occurrence_Information": OCCURRENCE,
    "Occurrence_Category": ("cadorsnumber", "occurrence_category_etxt", "occurrence_category_ftxt"),
    "Occurrence_Event_Information": ("cadorsnumber", "event_name_enm", "event_name_fnm"),
    "Aircraft_Information": AIRCRAFT,
    "Aircraft_Event_Information": ("cadorsnumber", "aircraftnumber", "event_name_enm", "event_name_fnm"),
}
MINIMUM = {
    "Occurrence_Information": 100_000,
    "Occurrence_Category": 100_000,
    "Occurrence_Event_Information": 50_000,
    "Aircraft_Information": 100_000,
    "Aircraft_Event_Information": 100_000,
}


def clean(value):
    return " ".join((value or "").split())


def source_url(name):
    return BASE + name + ".csv"


def download(name, directory):
    path = directory / (name + ".csv")
    for attempt in range(3):
        try:
            request = Request(source_url(name), headers={"User-Agent": "CoolCode Strange Skies Canada/1.0"})
            with urlopen(request, timeout=100) as response, path.open("wb") as output:
                if response.headers.get_content_type() == "text/html":
                    raise ValueError("Received HTML instead of the CSV")
                shutil.copyfileobj(response, output)
                expected = response.headers.get("Content-Length")
                if expected and int(expected) != output.tell():
                    raise ValueError(f"Incomplete download: {output.tell():,} of {int(expected):,} bytes")
                stamp = response.headers.get("Last-Modified")
                return path, parsedate_to_datetime(stamp).isoformat() if stamp else None
        except (OSError, ValueError) as error:
            if attempt == 2:
                raise ValueError(f"{name} download failed after three attempts: {error}") from error
            print(f"Retrying {name}: {error}", file=sys.stderr)
            sleep(2 ** (attempt + 1))


def imported_rows(path, fields):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not set(fields).issubset(reader.fieldnames):
            raise ValueError(f"{path.name}: expected CADORS columns were not found")
        for item in reader:
            if None in item or any(item[key] is None for key in fields):
                raise ValueError(f"{path.name}: malformed CSV at line {reader.line_num}")
            values = tuple(clean(item[key]) for key in fields)
            if not values[0]:
                raise ValueError(f"{path.name}: missing CADORS number at line {reader.line_num}")
            yield values


def year_of(value):
    try:
        return str(date.fromisoformat(value).year)
    except ValueError:
        return "undated"


def casualty(value):
    if not value:
        return None
    try:
        number = float(value)
        return int(number) if number >= 0 and number.is_integer() else None
    except ValueError:
        return None


def append_if_new(values, item):
    if any(item) and item not in values:
        values.append(item)


def aircraft_key(value):
    return value.partition(".")[0] if value else ""


def create_table(conn, name, path, check_full_size):
    fields = SCHEMA[name]
    conn.execute(f"CREATE TABLE {name} ({','.join(field + ' TEXT' for field in fields)})")
    params = ",".join("?" for _ in fields)
    cursor = conn.executemany(f"INSERT INTO {name} VALUES ({params})", imported_rows(path, fields))
    count = cursor.rowcount
    if count < (MINIMUM[name] if check_full_size else 1):
        raise ValueError(f"{name} appears incomplete: {count:,} rows")
    conn.execute(f"CREATE INDEX {name}_id ON {name}(cadorsnumber)")
    return count


def gather(conn):
    # Stream each indexed child table in ID order. The main occurrence loop then
    # needs only one group from each child at a time, even on low-memory runners.
    from itertools import groupby

    child_groups = []
    for name in tuple(SCHEMA)[1:]:
        groups = groupby(conn.execute(f"SELECT * FROM {name} ORDER BY cadorsnumber"), key=lambda item: item[0])
        child_groups.append(iter((key, list(values)) for key, values in groups))
    child = [next(groups, ("", [])) for groups in child_groups]

    by_year = {}
    kinds = set()
    regions = set()
    event_labels = set()
    seen_ids = set()
    for raw in conn.execute("SELECT * FROM Occurrence_Information ORDER BY cadorsnumber"):
        cid, when, place, aerodrome, airname, region, country, kind, hour, light, killed, injured, tsb, tc, kind_fr, region_fr, country_fr = raw
        if cid in seen_ids:
            raise ValueError(f"Duplicate occurrence identifier: {cid}")
        seen_ids.add(cid)
        related = []
        for index, groups in enumerate(child_groups):
            while child[index][0] and child[index][0] < cid:
                child[index] = next(groups, ("", []))
            related.append(child[index][1] if child[index][0] == cid else [])
        categories = []
        for _, en, fr in related[0]:
            append_if_new(categories, [en, fr])
        events = []
        for _, en, fr in related[1]:
            append_if_new(events, [en, fr])
        aircraft_events = {}
        for _, key, en, fr in related[3]:
            item = [en, fr]
            append_if_new(aircraft_events.setdefault(aircraft_key(key), []), item)
        planes = []
        attached = set()
        for key, registration, foreign, flight, make, model, operator, category, phase, damage, registry in (row[1:] for row in related[2]):
            key = aircraft_key(key)
            append_if_new(planes, [
                registration or foreign, flight, make, model, operator, category,
                phase, damage, registry, aircraft_events.get(key, []),
            ])
            attached.add(key)
        unidentified_aircraft_events = []
        for key, labels in aircraft_events.items():
            if key not in attached:
                for label in labels:
                    append_if_new(unidentified_aircraft_events, label)
        all_labels = categories + events + unidentified_aircraft_events + [
            label for plane in planes for label in plane[9]]
        event_labels.update(entry[0] for entry in all_labels if entry[0])
        kinds.add(kind)
        if region or country:
            regions.add(region or country)
        y = year_of(when)
        by_year.setdefault(y, []).append([
            cid, when, place, aerodrome, airname, region or country, country, kind, hour,
            light, casualty(killed), casualty(injured), tsb, tc, kind_fr, region_fr, country_fr,
            categories, events, planes, unidentified_aircraft_events,
        ])
    return by_year, sorted(kinds - {""}), sorted(regions), sorted(event_labels)


def build(output, inputs):
    output = output.resolve()
    if output in ROOT.parents or output == ROOT or output.is_relative_to(ROOT / "web"):
        raise ValueError("Use a dedicated output directory outside the application source")
    if output.exists() and (not output.is_dir() or (
        any(output.iterdir()) and not (output / "data" / "manifest.json").is_file()
    )):
        raise ValueError("Use an empty output directory or a previous Strange Skies build")
    if inputs and inputs.resolve().is_relative_to(output):
        raise ValueError("Keep input files outside the output directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="strange-skies-", dir=output.parent) as temporary:
        tmp = Path(temporary)
        work = tmp / "working"
        work.mkdir()
        if inputs:
            files = [(inputs / (name + ".csv"), None) for name in SCHEMA]
        else:
            with ThreadPoolExecutor(max_workers=5) as executor:
                jobs = [executor.submit(download, name, work) for name in SCHEMA]
                files = [job.result() for job in jobs]
        source = []
        with sqlite3.connect(work / "merge.sqlite") as conn:
            conn.execute("PRAGMA journal_mode = OFF")
            for name, (path, updated) in zip(SCHEMA, files):
                count = create_table(conn, name, path, check_full_size=inputs is None)
                source.append({"name": name.replace("_", " "), "url": source_url(name), "rows": count, "updated": updated})
                print(f"{name}: {count:,} source rows", flush=True)
            by_year, kinds, regions, event_labels = gather(conn)
        if not by_year:
            raise ValueError("CADORS export contained no occurrences")
        staging = tmp / "site"
        shutil.copytree(ROOT / "web", staging)
        data = staging / "data"
        data.mkdir()
        shards = []
        latest = ""
        for year, rows in sorted(by_year.items(), key=lambda pair: pair[0] if pair[0].isdigit() else "0000", reverse=True):
            name = f"records-{year}.json.gz"
            rows.sort(key=lambda row: (row[1], row[0]), reverse=True)
            if year != "undated":
                latest = max(latest, rows[0][1])
            payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()
            (data / name).write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
            shards.append({"year": year, "file": name, "count": len(rows), "bytes": (data / name).stat().st_size})
        manifest = {
            "version": 1, "total": sum(part["count"] for part in shards), "shards": shards,
            "regions": regions, "kinds": kinds, "events": event_labels, "latest": latest,
            "built": datetime.now(timezone.utc).isoformat(), "sourceUpdated": source[0]["updated"],
            "source": DATASET, "licence": CANADA_OGL, "query": QUERY,
            "narrativeSearch": NARRATIVES, "tables": source,
        }
        (data / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        staging.replace(output)
    print(f"{manifest['total']:,} occurrences · {len(shards)} date shards · {sum(x['bytes'] for x in shards) / 2**20:.1f} MiB compressed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, help="Directory of five official CSVs, using names without the CADORS_ prefix")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    try:
        build(args.output, args.inputs)
    except (OSError, ValueError, sqlite3.Error, csv.Error) as error:
        parser.exit(1, f"Build failed: {error}\n")


if __name__ == "__main__":
    main()
