# Strange Skies Canada

An independent CoolCode.ca explorer for Transport Canada civil aviation occurrence reports.

- Search by CADORS number, date, airfield, location, event, aircraft or operator. The search checks English and French fields where the source supplies both.
- Filter by report type, year, province/territory/country, and occurrence or aircraft event. The initial view loads the latest year. Choose **All years** or a suggested search to explore the full history.
- Open a result for reported aircraft, categories, events, and casualty counts where supplied. Copy its number to look it up in Transport Canada's CADORS form, or copy an explorer deep link.

## What is in the archive

CADORS contains preliminary occurrence reports, which can be amended. The source category “Weather balloon, meteor, rocket, CIRVIS/UFO” combines several possible observations. Individual explanations belong in the source record where available. The bulk CSVs omit narratives, so the explorer links to the [official CADORS query](https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/CADORS-SCREAQ/q.aspx?lang=eng) for a report-number lookup and to the [official narrative search](https://wwwapps.tc.gc.ca/Saf-Sec-Sur/2/CADORS-SCREAQ/ws.aspx?lang=eng) for searches in narrative text.

The [Transport Canada Open Government dataset](https://open.canada.ca/data/en/dataset/a348c1d1-2392-4595-b5e2-c6a244a7e87f) lists these five source tables:

1. Occurrence Information
2. Occurrence Category
3. Occurrence Event Information
4. Aircraft Information
5. Aircraft Event Information

The builder joins exact CADORS numbers and associates aircraft events using the occurrence plus aircraft number. It retains unmatched aircraft events separately. The site shows the occurrence table's HTTP modification date, the latest event date in the snapshot and the build date as separate values. Publication can lag behind the actual events.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).

## Build and serve

Use Python 3.10 or later. The build uses the standard library and downloads the five official CSVs. Expect roughly 260 MB of downloads before compression.

```sh
python3 scripts/build.py
python3 -m http.server 8080 --directory dist
```

For an offline rebuild, put the official files in a directory under their names with the `CADORS_` prefix removed, and pass `--inputs /path/to/downloads`. HTTP source modification dates are unavailable in this mode. To place the build elsewhere, pass `--output /path/to/output`.

The GitHub Actions workflow builds and publishes the static `dist/` folder to GitHub Pages, with daily refreshes and a manual run option in **Actions**. An incomplete download or incompatible source schema fails the build before publication. Only the browser-ready output is deployed. A browser worker searches gzip files split by occurrence year, and retains a small cache of requested years. The site needs a current browser and no installation or runtime backend.
