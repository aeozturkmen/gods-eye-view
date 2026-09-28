#!/usr/bin/env python3
"""
Refresh the official Turkish Straits transit statistics bundled with the app.

Source: T.C. Ulaştırma ve Altyapı Bakanlığı, Denizcilik İstatistikleri,
"Türk Boğazları Gemi Geçiş İstatistikleri" — quarterly .xls files with monthly
figures per strait (published about a month after each quarter ends).

Maintenance only (the app never runs this). Needs `xlrd` 2.x for the legacy
.xls format:

    python3 -m venv .tmp/xlsenv && .tmp/xlsenv/bin/pip install xlrd==2.0.1
    .tmp/xlsenv/bin/python scripts/update-strait-stats.py

Writes src/layers/straits/officialStats.json. Uses, per year, the newest
quarter file on the page, for the current year and the two before it.
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.request

import xlrd

PAGE = "https://denizcilikistatistikleri.uab.gov.tr/turk-bogazlari-gemi-gecis-istatistikleri"
OUT = pathlib.Path(__file__).resolve().parent.parent / "src/layers/straits/officialStats.json"
UA = {"User-Agent": "gods-eye-view strait stats refresh (maintenance script)"}
STRAITS = {"bosphorus": "İSTANBUL BOĞAZI", "dardanelles": "ÇANAKKALE BOĞAZI"}
TYPE_ROWS = {"naval": "(Naval)", "passenger": "(Passenger Ship)",
             "container": "(Container Ship)", "bulk": "(Bulk Carrier)",
             "generalCargo": "(General Cargo Ship)"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def newest_quarter_files(html, years):
    """{year: url} — highest quarter per year; a later upload wins a tie."""
    best = {}
    for url in re.findall(r'href="([^"]+/turk-bogazlari-gemi-gecis-istatistikleri/[^"]+\.xlsx?)"', html):
        m = re.search(r"/(\d{4})-(\d|i{1,3}|iv)-ceyrek", url, re.I)
        if not m or int(m.group(1)) not in years:
            continue
        q = m.group(2).lower()
        q = {"i": 1, "ii": 2, "iii": 3, "iv": 4}.get(q) or int(q)
        year = int(m.group(1))
        # Hashed names (e.g. 2025-4-ceyrek-6980….xls) are re-uploads: prefer them.
        rank = (q, 1 if re.search(r"ceyrek-[0-9a-f]{8,}", url) else 0)
        if year not in best or rank > best[year][0]:
            best[year] = (rank, url)
    return {y: u for y, (_, u) in best.items()}


def num(v):
    return int(round(v)) if isinstance(v, float) else None


def find_row(sheet, text, start=0):
    for r in range(start, sheet.nrows):
        if any(text in str(c.value).upper() for c in sheet.row(r)):
            return r
    return None


def parse_workbook(data, year):
    book = xlrd.open_workbook(file_contents=data)
    general = book.sheet_by_index(0)
    types = next((s for s in book.sheets() if "Tip" in s.name or "Type" in s.name), None)
    out = {}
    for key, title in STRAITS.items():
        head = find_row(general, title)
        if head is None:
            raise SystemExit(f"{year}: no '{title}' block in the general sheet")
        months = []
        # Twelve month rows follow the two header rows.
        for i in range(12):
            row = general.row(head + 3 + i)
            vessels = num(row[1].value)
            if vessels is None:
                continue  # month not published yet
            months.append({
                "month": f"{year}-{i + 1:02d}",
                "vessels": vessels,
                "grossTonnage": num(row[2].value),
                "withPilot": num(row[3].value),
                "loaOver200m": num(row[6].value),
                "tankers": sum(num(row[c].value) or 0 for c in (8, 9, 10)),
            })
        if types is not None:
            thead = find_row(types, title)
            for field, label in TYPE_ROWS.items():
                r = find_row(types, label.upper(), thead) if thead is not None else None
                if r is None:
                    continue
                for m in months:
                    m[field] = num(types.cell_value(r, int(m["month"][5:])))
        out[key] = months
    return out


def main():
    html = fetch(PAGE).decode("utf-8", "replace")
    this_year = datetime.date.today().year
    files = newest_quarter_files(html, {this_year, this_year - 1, this_year - 2})
    if not files:
        raise SystemExit("No quarterly files found on the statistics page")
    series = {k: [] for k in STRAITS}
    used = {}
    for year in sorted(files):
        parsed = parse_workbook(fetch(files[year]), year)
        for key in STRAITS:
            series[key].extend(parsed[key])
        used[str(year)] = files[year]
    latest = max(m["month"] for m in series["bosphorus"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "schemaVersion": 1,
        "source": "T.C. Ulaştırma ve Altyapı Bakanlığı · Denizcilik İstatistikleri",
        "sourceUrl": PAGE,
        "cadence": "Quarterly release of monthly totals (Resmi İstatistik Programı)",
        "retrievedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latestMonth": latest,
        "files": used,
        "straits": {
            "bosphorus": {"name": "İstanbul Boğazı", "months": series["bosphorus"]},
            "dardanelles": {"name": "Çanakkale Boğazı", "months": series["dardanelles"]},
        },
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} · latest month {latest} · "
          + ", ".join(f"{k}: {len(v)} months" for k, v in series.items()))


if __name__ == "__main__":
    sys.exit(main())
