#!/usr/bin/env python3
"""Quantity take-off: PDF or DXF drawing -> flooring quantities for review.

Reads the drawing's schedules with the schedule reader, then calculates
flooring per floor finish from the room/finish schedule (quantity_core).
Skirting types the schedule names are reported as not derivable (no room
perimeters are printed). Writes:
  --out     cunstruct.analysis.v1: one item per floor finish (and skirting
            type), for BOQ Review -> Import JSON. Calculated quantities are
            MEASURED with calculation_data the app recomputes; everything
            else is PENDING with its reasons.
  --report  every quantity record in full: inputs (observed or derived),
            evidence, included and excluded rooms, deductions, dependencies,
            status, reasons and the calculation version.
No network, no model. Nothing is written to the database by this tool.

Usage:
  python3 scripts/drawing-ocr/takeoff.py drawing.pdf --out analysis.json [--report report.json] [--pages 1,2]
"""
import argparse, hashlib, json, sys
from decimal import Decimal
from pathlib import Path

import quantity_core
import schedule_core
import schedule_sources

EXTRACTOR = f"{quantity_core.CALC_VERSION} + schedule-reader 0.1"


def take_off(path, pages=None):
    path = Path(path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    src = schedule_sources.dxf_pages(path) if path.suffix.lower() == ".dxf" else schedule_sources.pdf_pages(path, pages)
    _items, obs = schedule_core.read_document(src, path.name)
    floors, summary = quantity_core.floor_finish_takeoff(obs["tables"], path.name)
    records = floors + quantity_core.skirting_takeoff(obs["tables"])
    size = {p["page"]: p.get("size") for p in src}
    items = [quantity_core.to_analysis_item(r, path.name, size.get(next((e["page"] for m in r["inputs"] for e in m["evidence"]), None)))
             for r in records]
    analysis = dict(schema_version="cunstruct.analysis.v1", source_drawing=dict(sha256=sha, filename=path.name, extractor=EXTRACTOR), items=items)
    return analysis, dict(records=records, summary=summary)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("drawing"); ap.add_argument("--out", required=True); ap.add_argument("--report")
    ap.add_argument("--pages", help="comma-separated page numbers (PDF only; default all)")
    a = ap.parse_args(argv)
    analysis, report = take_off(a.drawing, [int(p) for p in a.pages.split(",")] if a.pages else None)
    Path(a.out).write_text(json.dumps(analysis, indent=1))
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1, default=lambda o: str(o) if isinstance(o, Decimal) else repr(o)))
    rs = report["records"]
    if not rs:
        print("no room/finish schedule found: nothing to take off (no quantity is estimated without one)", file=sys.stderr)
        return
    print(f"{len(rs)} quantities: {sum(r['status'] == 'calculated' for r in rs)} calculated, "
          f"{sum(r['status'] != 'calculated' for r in rs)} for review", file=sys.stderr)


if __name__ == "__main__":
    main()
