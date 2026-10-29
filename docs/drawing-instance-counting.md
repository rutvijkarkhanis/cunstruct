# Drawing instance-counting engine

**Principle:** a count is a claim about physical objects. It is made only when
the drawing's own evidence supports it, and every case where it doesn't is
returned as an explicit unresolved result, never as a number.

Code: `src/lib/counting/`. Contract: `cunstruct.counting.v1` (`contract.ts`).
First slice: doors, windows and ventilators on architectural floor plans.

## 1. Architecture assessment (main @ 1c47814, PR #230 open)

| Need | What already exists | Used how |
|---|---|---|
| PDF text + vectors, canonical space | `review/pdfGeometry.ts` (`extractPageGeometry`: text runs with direction, shapes incl. Bezier `path`) | Adapter `sheetFromPdfExtraction` |
| Coordinate convention | `review/evidenceCoords.ts` (top-left, y down, as displayed, scale 1) | The only space the engine reasons in |
| Text classification, floor from sheet title, opening-schedule rows | `review/drawingInventory.ts` | Floor identification; schedule-row tags excluded |
| Box overlap rule | `review/geometryFusion.ts` (`isGeometryMatch`) | Duplicate-detection merge |
| Geometry model | `review/drawingGeometry.ts` | Input shape type |
| OCR (raster/vector-text PDFs) | `scripts/drawing-ocr/drawing_ocr.py` (Python, Tesseract) | Not called; an OCR sheet can be fed in (`textSource: "ocr"`) after `toCanonicalSheet` |
| Schedules | PR #230 `scripts/drawing-ocr/schedule_*.py` (PDF text, OCR, DXF) → `cunstruct.analysis.v1` items keyed by tag | `scheduleFromAnalysis` reads that output |
| Import contract | `review/analysisSchemaV1.ts` (`parseAnalysisV1`; PENDING = null quantity; >1 candidates forces PENDING; `source_drawing.sha256`) | Output target, unchanged |
| Per-occurrence facts | `review/observationSchemaV1.ts` (`opening`, `schedule_entry`, no quantity field) | Output target, unchanged |
| Type ↔ instance, GREEN/AMBER/RED | `review/typeInstances.ts`, `review/instanceReconciliation.ts` (GREEN needs located count = expected AND a schedule entry) | Consumes the observations as before |
| Review → Apply | `review/reviewQueue.ts` (every import starts PENDING_REVIEW), `review/applyReview.ts` (only VERIFIED/EDITED apply; pending writes "pending", never 0) | Unchanged; the engine never writes a BOQ |

What did **not** exist: any symbol detection (the OCR extractor says "Not
attempted: counting symbols"), tag-to-symbol association, cross-view
reconciliation, or a per-instance count with its own uncertainty.

**PR #230 is not a merge dependency.** It emits ordinary analysis.v1 items;
`scheduleFromAnalysis` takes any such payload. The engine was developed and
tested against that item shape (see `integration.test.ts`), so it works the
day #230 merges, and with any other schedule producer before then.

## 2. Contract and data flow

```
PDF page ──pdfGeometry.extractPageGeometry──► sheetFromPdfExtraction ─┐
DXF / OCR sheet ──────────────────────────► toCanonicalSheet (mm|px→pt, y-up→down)
LOCATION observations / CAD blocks ──────► symbols[] (optional) ──────┤
schedule (PR #230 analysis.v1, or any) ──► scheduleFromAnalysis ──────┤
drawing register ────────────────────────► expectedSheets[] ──────────┘
                                                                        ▼
                                                    countInstances()  (pure)
                                                                        ▼
        CountingResult: sheets · instances · references · counts · markTotals · unresolved · provenance
                                                                        ▼
                                                    toCountingPayloads()
                         ┌──────────────────────────────┴───────────────────────────┐
           cunstruct.analysis.v1 items (per mark × floor)       cunstruct.observation.v1
           → parseAnalysisV1 → review queue → explicit Apply    → typeInstances / reconcileInstances
```

Each candidate instance carries: category, proposed type (mark or null),
sheet/page/region, **observed** evidence (symbol boxes with method, tag text
and boxes, each with the id of the exact input element) kept apart from the
**interpretation** (tag association with distance/margin/competitors,
schedule association, duplicate group, cross-view reference ids),
recognition methods, `confidence: null` (nothing here is calibrated), status
(`confirmed | pending_review | ambiguous | conflicting | rejected`) and every
reason it is not confirmed. The result carries an input digest and every
threshold, so a stored result can be reproduced.

**Confirmed** = a symbol was detected, exactly one printed tag is clearly its
nearest (and it is the tag's clearly nearest symbol), the tag reads cleanly
from a PDF/CAD text layer, its mark has one consistent schedule entry of the
same category, and the sheet is a plan of an identified floor.

A **count** (mark × floor) has a quantity only when every candidate behind it
is confirmed and nothing else on its sheet could change it (an untagged
symbol of that category, an ambiguous or unreadable tag, a typical-floor
title, a schedule-count disagreement). Otherwise `quantity: null` with reasons.

## 3. Rules enforced (and where they are tested)

| Rule | Mechanism | Test |
|---|---|---|
| Never invent an instance or quantity | tag-only and untagged candidates are pending; a count needs all candidates confirmed | `engine.test.ts` base plan, missing tags |
| Never silently resolve conflicts | contradicting tags, schedule entries, sheets or totals → `conflicting`, both values kept as candidates | schedule ↔ plan, repeated sheets, `integration.test.ts` |
| One object in several views is counted once | only plan sheets count; elevation/section/detail tags become references | cross-view tests |
| A schedule entry is not an installed instance | entry with no plan occurrence → `schedule_entry_without_instance`, no item, never 0 | schedule tests |
| A detected symbol is not necessarily a distinct object | overlapping detections merged; same plan twice counted once; double door = one | duplicate tests |
| A schedule total does not prove the drawing count | compared only with a complete set; agreement changes nothing; disagreement blocks both | schedule tests |
| Uncertainty survives the import contract | PENDING + null quantity + candidates; parseAnalysisV1 and Apply keep it pending | `integration.test.ts` |
| No BOQ writes | the engine is pure; output only enters through import → review → Apply | — |

## 4. Test status — what the tests do and do not show

- **Synthetic unit and integration tests** (`src/lib/counting/*.test.ts`, 89
  tests): hand-built geometry and text. They show the rules behave as
  specified, including through the real pdf.js extraction of a hand-written
  PDF (`pdfPipeline.test.ts`). **They are not evidence of accuracy on real
  drawings.**
- **Exploratory real-drawing observations:** none. No authorised real
  drawing is in the repository or this environment.
- **Independently verified accuracy:** none. No independent reference count
  exists; no accuracy figure is claimed.

## 5. Limitations of this slice

- **Windows and ventilators are not detected geometrically.** They come from
  tags (always pending on their own) and from supplied symbol detections. A
  window detector (wall-gap + parallel sash lines) is the next detector.
- **Sliding, folding and revolving doors** have no swing and are not detected.
- **Door detection needs arc + leaf.** Arcs alone are reported, not counted;
  without a sheet scale, leaf width is not checked.
- **Mixed sheets** (plan plus details on one sheet) confirm nothing until the
  regions are separated via `excludedRegions`; there is no automatic
  viewport detection.
- **Typical floors are never multiplied.** The number of floors a typical plan
  stands for is a reviewer input the contract does not yet carry.
- **Tag association is proximity with a margin.** Leader lines (a tag joined to
  its door by a line) are not followed, so a tag placed far from its door is
  tag-only.
- **Schedule quantity scope is assumed building-wide** for the total check.
- **Not wired into the UI.** The engine and its payloads are library code; no
  screen calls `countInstances` yet. The review UI does not yet list
  `result.unresolved` beyond what the item notes carry.
- **Key collisions:** if the same BOQ also receives PR #230's schedule items
  keyed `D1`, Apply's existing scope rules decide matching (per-floor items
  carry a location); this has not been exercised with both imported together.

## 6. Next engineering step

Wire `countInstances` into the existing deterministic drawing path (the same
place `DrawingCoveragePanel` runs `drawingInventory` on the loaded PDF), so a
reviewer can see candidates and unresolved cases on the drawing and copy the
payload into Import JSON — then run it, exploratorily, on an authorised real
plan set.
