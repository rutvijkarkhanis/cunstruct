#!/usr/bin/env python3
"""Schedule reader: PDF or DXF drawing -> cunstruct.analysis.v1 JSON.

Reads schedule tables only (door/window schedules, area and finish
schedules, fixture count tables) from the drawing's own text: the PDF text
layer, local OCR when a page has none, or DXF text. Standalone; it does not
change drawing_ocr.py. See schedule_core.py for what becomes a quantity.

Usage:
  python3 scripts/drawing-ocr/schedule_reader.py drawing.pdf --out analysis.json [--observations obs.json] [--pages 1,2]
  python3 scripts/drawing-ocr/schedule_reader.py drawing.dxf --out analysis.json
"""
import argparse, hashlib, json, sys
from pathlib import Path

import schedule_core
import schedule_sources

EXTRACTOR = "schedule-reader 0.1 (text layer / OCR / DXF)"


def read(path, pages=None):
    path = Path(path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.suffix.lower() == ".dxf":
        src = schedule_sources.dxf_pages(path)
    else:
        src = schedule_sources.pdf_pages(path, pages)
    items, obs = schedule_core.read_document(src, path.name)
    obs["pages"] = [dict(page=p["page"], source=p["source"], words=len(p["words"])) for p in src]
    analysis = dict(schema_version="cunstruct.analysis.v1", source_drawing=dict(sha256=sha, filename=path.name, extractor=EXTRACTOR), items=items)
    return analysis, obs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("drawing"); ap.add_argument("--out", required=True); ap.add_argument("--observations")
    ap.add_argument("--pages", help="comma-separated page numbers (PDF only; default all)")
    a = ap.parse_args(argv)
    analysis, obs = read(a.drawing, [int(p) for p in a.pages.split(",")] if a.pages else None)
    Path(a.out).write_text(json.dumps(analysis, indent=1))
    if a.observations:
        Path(a.observations).write_text(json.dumps(obs, indent=1, default=str))
    n = len(analysis["items"]); m = sum(i["status"] == "MEASURED" for i in analysis["items"])
    print(f"{len(obs['tables'])} schedules; {n} items ({m} measured, {n - m} for review); "
          f"{len(obs['unscheduled'])} tags with no schedule row; {len(obs['excluded_columns'])} money columns excluded", file=sys.stderr)


if __name__ == "__main__":
    main()
