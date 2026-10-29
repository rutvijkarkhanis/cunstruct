#!/usr/bin/env python3
"""Instance counter: PDF or DXF drawing -> door/window counts for review.

Reads the drawing once with the schedule reader's sources, reads its
schedules (schedule_core), then counts tagged openings on floor plans
(instance_core). Writes:
  --out           cunstruct.analysis.v1: the schedule reader's items plus one
                  count item per door/window type (keyed by its mark, e.g.
                  "D1") and review flags.
                  Import it in BOQ Review -> Import JSON like any analysis.
  --observations-out  cunstruct.observation.v1: one `opening` per counted
                  instance and one `schedule_entry` per schedule row.
  --report        what was counted where, and why anything is pending.
No network, no model. Nothing is persisted by this tool.

Usage:
  python3 scripts/drawing-ocr/instance_counter.py drawing.pdf --out analysis.json \\
      [--observations-out observations.json] [--report report.json] [--pages 1,2]
"""
import argparse, hashlib, json, sys
from pathlib import Path

import instance_core
import schedule_core
import schedule_sources

EXTRACTOR = "instance-counter 0.1 + schedule-reader 0.1"


def analyse(src, name="drawing"):
    """Schedules, then counts, for already-read pages (schedule_sources
    pages). The one pipeline the CLI and the tests share.
    Returns (schedule items, count items, observations, report)."""
    sched_items, sched_obs = schedule_core.read_document(src, name)
    tables = [(t["page"], t["bbox"]) for t in sched_obs["tables"]]
    marks = sched_obs["schedule_marks"]
    for m, sizes in sched_obs.get("schedule_sizes", {}).items():
        if m in marks:
            marks[m]["sizes"] = sorted(sizes)
    families = instance_core.schedule_families(sched_obs.get("page_schedule_sizes", {}))
    counts, observations, report = instance_core.count_document(src, marks, tables, name, families=families)
    return sched_items, counts, observations, report


def read(path, pages=None):
    path = Path(path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    src = schedule_sources.dxf_pages(path) if path.suffix.lower() == ".dxf" else schedule_sources.pdf_pages(path, pages)
    sched_items, counts, observations, report = analyse(src, path.name)
    analysis = dict(schema_version="cunstruct.analysis.v1", source_drawing=dict(sha256=sha, filename=path.name, extractor=EXTRACTOR),
                    items=sched_items + counts)
    obs_doc = dict(schema_version="cunstruct.observation.v1", source_drawing=dict(sha256=sha, filename=path.name, extractor=EXTRACTOR),
                   observations=observations)
    return analysis, obs_doc, report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("drawing"); ap.add_argument("--out", required=True)
    ap.add_argument("--observations-out"); ap.add_argument("--report")
    ap.add_argument("--pages", help="comma-separated page numbers (PDF only; default all)")
    a = ap.parse_args(argv)
    analysis, obs_doc, report = read(a.drawing, [int(p) for p in a.pages.split(",")] if a.pages else None)
    Path(a.out).write_text(json.dumps(analysis, indent=1))
    if a.observations_out:
        Path(a.observations_out).write_text(json.dumps(obs_doc, indent=1))
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1, default=str))
    counts = [i for i in analysis["items"] if i["item"].endswith(" — count")]
    flags = [i for i in analysis["items"] if i["key"].startswith("FLAG:")]
    print(f"{len(counts)} door/window types counted ({sum(i['status'] == 'MEASURED' for i in counts)} resolved, "
          f"{sum(i['status'] != 'MEASURED' for i in counts)} for review); {len(flags)} symbol flags; "
          f"{sum(o['observation_type'] == 'opening' for o in obs_doc['observations'])} instance observations", file=sys.stderr)


if __name__ == "__main__":
    main()
