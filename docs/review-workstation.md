# BOQ Review Workstation — drawings & evidence

The workstation reviews a drawing analysis item-by-item and highlights each
item's AI evidence on the **actual** drawing.

## Flow

```
Documents → Upload PDF  (private bucket, RLS by project)
      ↓
BOQ → Review Analysis → Import JSON   (cunstruct.analysis.v1)
      ↓
Each item resolves its source drawing → signed URL → pdf.js renders the page
      ↓
Evidence bboxes overlaid on the page · V / E / F / P to review, auto-advance
```

Importing an analysis never changes the BOQ; reviewer corrections live in
`analysis_review_item.reviewer_json`, separate from the immutable `ai_json`.

## Coordinate convention (single source of truth)

Analysis `bbox = [x1, y1, x2, y2]` uses a **top-left origin** (x right, y down) in
a page coordinate space. That space is resolved in ONE place —
`evidenceCoords.resolvePageSpace()`:

1. `source.page_size` when the analysis declares it (authoritative), else
2. the PDF page's own scale-1 size (pdf.js viewport at scale 1).

If neither is available the overlay is not drawn (we never guess a page size).
To change the convention later (e.g. bottom-left PDF user units), change only
`resolvePageSpace` and every overlay follows.

**Rotation.** pdf.js's `getViewport({ scale })` always returns a page's
RENDERED size — width/height already swapped and the rotation transform
already baked in for a page with a `/Rotate` of 90 or 270 (common for a
landscape schedule or detail sheet embedded in an otherwise-portrait set).
"The PDF page's own scale-1 size" above is therefore always that rendered,
as-displayed size. Every bbox and every declared `page_size` must be measured
in that SAME rendered space — what you see when the page opens normally —
never the page's raw/unrotated content-stream coordinates. Getting this wrong
for a rotated page swaps the evidence's axes once it's transformed against
the page's actual (rotated) size. `evidenceCoords.detectPageSizeMismatch()`
is a heuristic, non-blocking check: if a declared `page_size`'s aspect ratio
looks like the inverse of the PDF's actual rendered page, the viewer shows a
warning (never an auto-correction — nothing here guesses a "fixed"
coordinate).

## Claim-level evidence

An item's evidence can identify which specific attribute it supports, not
just the item's general existence. Each entry in `source.evidence[]` may
carry an optional `claim`: `general` (the default when omitted — full
backward compatibility with evidence that predates this), `quantity`,
`dimension`, `specification`, or `location`.

- **Different claims, different regions.** Quantity, dimension, and
  specification don't have to point at the same place in the drawing, and
  don't have to be on the same page as each other or as the item's default
  `source.page`. The Review Workstation navigates to whichever page a
  claim's evidence is actually on when its `[Evidence]` button is clicked.
- **One region, multiple claims.** When a single region genuinely supports
  more than one claim — e.g. a schedule row listing quantity, dimension, and
  specification together — add one evidence entry per claim, reusing the
  same `bbox`/`page`. Nothing requires separate physical regions when one
  region honestly covers more than one claim, but nothing requires sharing a
  region either: a schedule with distinct columns per attribute should use
  distinct, narrower bboxes per claim instead.
- **Multiple regions, one claim.** A claim can also be supported by more
  than one region (e.g. a quantity confirmed by both a plan count and a
  schedule row) — include every region that supports it; the viewer shows
  them together.
- **Legacy evidence.** An evidence entry with no `claim` field is treated as
  `general` everywhere (`getEvidenceForClaim`/`hasEvidenceForClaim` in
  `evidenceCoords.ts`) — existing analyses need no migration.

## Testing with a real PDF (no client drawing committed)

1. In **Project → Documents**, click **Upload PDF** and pick any multi-page PDF.
   It appears in the list with its page count.
2. In **BOQ → Review Analysis**, paste an analysis JSON whose `source.document`
   matches the uploaded filename (or set `source.document_id` to the document's
   id for exact matching). Include `page` and `evidence[].bbox` in the page's
   coordinate space, and `page_size` if your bboxes aren't in the PDF's own
   scale-1 units.
3. Move between items — the viewer opens the right page and highlights the
   evidence. `Fit to evidence` frames the boxes. Multiple boxes render together.

Sample analysis JSON (adapt the filename, page and bbox to your PDF). The
first item shows plain (unclaimed → `general`) evidence; the second shows
claim-level evidence split across pages, with `quantity` and `dimension`
sharing one schedule-row region and `location` supported by two regions:

```json
{
  "schema_version": "cunstruct.analysis.v1",
  "items": [
    {
      "item": "W1", "quantity": 3, "unit": "nos", "dimension": "6' x 6'9\"",
      "location": "First Floor", "confidence": 0.94, "status": "MEASURED",
      "source": {
        "document": "your-uploaded.pdf", "page": 1,
        "page_size": { "width": 1224, "height": 1584 },
        "evidence": [ { "bbox": [200, 300, 320, 420] }, { "bbox": [520, 300, 640, 420] } ]
      }
    },
    {
      "item": "D1", "quantity": 2, "unit": "nos", "dimension": "3' x 7'",
      "specification": "Flush, teak veneer", "location": "Ground Floor",
      "confidence": 0.9, "status": "MEASURED",
      "source": {
        "document": "your-uploaded.pdf", "page": 1,
        "evidence": [
          { "page": 1, "bbox": [100, 200, 180, 260], "claim": "general" },
          { "page": 3, "bbox": [50, 500, 300, 520], "claim": "quantity" },
          { "page": 3, "bbox": [50, 500, 300, 520], "claim": "dimension" },
          { "page": 1, "bbox": [400, 200, 420, 260], "claim": "location" },
          { "page": 2, "bbox": [80, 80, 100, 140], "claim": "location" }
        ]
      }
    },
    { "item": "Wardrobe", "quantity": null, "status": "PENDING", "location": "Bedroom 2",
      "source": { "document": "your-uploaded.pdf", "page": 2 } }
  ]
}
```

Verifiable behaviours: page navigation, zoom/fit, bbox overlay stays aligned
across zoom/resize, multiple boxes, changing the item changes the page/evidence,
an item with no bbox shows "Evidence coordinates unavailable", and a
missing/deleted drawing shows "Source drawing unavailable" without crashing.

## Security

- Bucket `project-drawings` is **private**; files are reached only via short-lived
  signed URLs.
- `storage.objects` RLS gates every read/insert/delete by the owning project
  (the first path segment is the `project_id`), so a browser can't reach another
  project's drawing by changing an id or path.
- Deleting a drawing removes its storage object(s) and the document record but
  leaves analysis review history intact; a referenced-but-deleted drawing shows
  "Source drawing unavailable".
