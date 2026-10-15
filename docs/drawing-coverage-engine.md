# Drawing coverage engine

**Principle:** the model returning some observations is not the same as the
drawing having been inspected. Coverage is measured against what the drawing's
own text says is there.

## Data flow

```
PDF (Storage: project-drawings)
 ├─ AI path (unchanged): ai-analysis edge function → OpenAI → parseObservationsV1
 │     → pinObservations → analysis_observation rows (+ observationDiagnostics in the response)
 │
 └─ Deterministic path (new, browser, read-only):
       drawingTextLoader      signed URL → pdf.js → pdfGeometry.extractPageGeometry (text runs, canonical space)
       drawingInventory       text runs → candidates: space labels, room dimensions, lengths, areas, sheet titles;
                              page floor from the sheet title
       roomDimensionReconciliation   label ↔ dimension by page position (beneath the label, same direction);
                              mutual-nearest with a 1.5× margin, else ambiguous / no_dimension
       drawingCoverageReport  observations ↔ inventory spaces (page + label + location); gaps, duplicates,
                              rejections, floor and size conflicts; always "provisional"
       measuredQuantities     high-confidence sizes → floor areas via measurementValidator.computeCalculation;
                              everything else pending (null, never 0); toAnalysisPayload → cunstruct.analysis.v1
       DrawingCoveragePanel   shown under LOCATION observations; "Copy drafts as analysis JSON"
 │
 └─ Existing review workflow: analysis JSON import → review items → explicit Apply (applyFinding.ts) → BOQ
```

## Reused, not rebuilt

| Need | Existing component |
|---|---|
| PDF loading, worker | `pdfjs-dist` as in `PdfEvidenceViewer.tsx` |
| Text + coordinates | `pdfGeometry.extractPageGeometry` (now also records text direction) |
| Coordinate convention | `evidenceCoords.ts`: top-left, y-down, as displayed; `pageSize` when declared |
| File access | `drawingStorage.signedDrawingUrl`; RLS on the private bucket |
| Area arithmetic, units | `measurementValidator` (`computeCalculation`, LENGTH_TIMES_WIDTH, in/m/mm) |
| Item format, evidence, calculation data | `analysisSchemaV1` / `parseAnalysisV1`, `calculationAdvisory` |
| Human confirmation | existing review queue and Apply |

## Rules that keep it honest

- A space label comes only from a fixed vocabulary; unknown text is counted as unclassified, not guessed.
- A dimension pairs with a label only when it is printed beneath it, on the same page, in the same reading direction, and is clearly the nearest on both sides. Ties stay ambiguous. A size is never borrowed from another room with the same name, and never assigned twice.
- Observations without an evidence box match a space only when its label is unique on that page.
- A unit not printed on the drawing is never assumed for a quantity.
- Nothing here writes to the database or changes BOQ lines, rates, descriptions or quantities.

## Limits

- **Scanned or raster pages** have no text layer: coverage is "unavailable" for them (no OCR source yet). `DrawingTextPage` is the interface for adding one.
- **Split text:** labels split across several pdf.js text runs are not re-joined yet.
- **Plan convention:** reconciliation assumes the common "size printed beneath the name" layout. Other layouts produce `no_dimension`/`ambiguous`, never a wrong match.
