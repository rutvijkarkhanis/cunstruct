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

Sample analysis JSON (adapt the filename, page and bbox to your PDF):

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
