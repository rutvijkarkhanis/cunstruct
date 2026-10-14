# Brief for the reference BOQ preparer (quantity surveyor / estimator)

You are preparing an **independent** bill of quantities from the drawing sheets listed below, so
that software output can later be checked against it. Please read all of this
before starting. Full field definitions: `reference-boq-spec.md`.

## What you receive — and must not receive

- **Receive:** the PDF `<project name>`, `<n>` pages (`<sheet titles in scope>`).
  Check its SHA-256 is `<64 hex characters>` (e.g. `sha256sum file.pdf`). If it
  differs, stop and ask.
- **Also receive** exactly three documents: this brief, `reference-boq-spec.md`
  (field definitions) and `reference-boq-template.json` (the format). Nothing else.
- **Do not look at** any Cunstruct screen, export, BOQ, room list, report, or any
  other file in the Cunstruct repository — in particular nothing else in
  `docs/benchmarks/`, which holds software output — before you have finished. If you
  have seen any, say so — the reference cannot then be declared independent.

## What to measure

Every item you can measure or count **from these sheets alone**, under
conventions you state. At minimum, the floor area of every room and space shown;
add anything else the sheets support (e.g. counts of marked doors/windows, if
marked). Anything needing other drawings (sections, structure, services,
specifications) is listed as **out of scope**, not left out.

**One line per room instance.** If three rooms on a floor share one label, that is
three lines, each with its own location. You may add per-floor totals as extra lines.

## How to write each line

| Field | How |
|---|---|
| `id` | Your own unique id, e.g. `R-P1-001` |
| `status` | `measured`, or `ambiguous` (shown but size unclear), `unmeasurable` (shown, no size given), `out_of_scope` (needs other drawings) |
| `item` | **Format: `<what is measured> — <room label exactly as printed>`**, e.g. `Floor area — EXAMPLE ROOM` for a room labelled "EXAMPLE ROOM". Use "Floor area" for room floor areas. For other items, describe plainly. |
| `aliases` | Optional other names you would accept for the same item |
| `unit` | sqm, sqft, m, nos… |
| `quantity` | Your figure — **only** for `measured` lines; leave it out otherwise |
| `floor` | Exactly as in the sheet title (e.g. `First Floor`) |
| `sourcePage` | The page number |
| `evidence` | Where the item is on the page: `{ "page": 1, "bbox": [x1, y1, x2, y2], "pageSize": {"width": W, "height": H} }` — **required whenever the same name occurs more than once anywhere in your list** (on either floor). Mark the room label or the room. |
| `measurementRule` | How you measured this line |
| `note` | Required for ambiguous / unmeasurable / out-of-scope: why there is no quantity |
| `tolerance` | Optional; otherwise counts exact, areas ±1% or 0.05 m², lengths ±1% |

**Coordinates:** measure as the sheet is **displayed and read** (title upright),
origin at the **top-left**, x to the right, y **down**. If a sheet is stored
rotated, coordinates read from a PDF tool's raw page space will be wrong — use the
displayed view. Any unit works if `pageSize` uses the same unit: PDF points (e.g.
595 × 842 for A4) or pixels of a rendered page image (give that image's size).
Approximate boxes are fine; positions within about 5% of the page are accepted.

## Measurement convention for this benchmark (fixed — please follow it)

- **Dimensions used:** only the length × width pair printed for a room on the sheet
  (the size text belonging to that room's label), in the units the sheets state;
  read them as printed.
- **Calculation:** floor area = length × width, gross — no deductions for openings,
  columns, shafts or wall thickness, and no adjustment of the printed figures.
- **Conversion:** 1 ft = 0.3048 m exactly (1 in = 0.0254 m). Report in m² (preferred)
  or ft², and say which.
- **Rounding:** give at least three decimal places, or the unrounded figure. Do not
  round to whole units.
- **No scaling:** never scale a size off the sheet, whatever its scale note. A space with no printed length × width pair — including one with only a
  width (e.g. "x' WIDE") — is `unmeasurable`, with a note.
- **Ambiguous:** a size that is illegible, or that cannot be attributed to one room
  with confidence, is `ambiguous`, with a note.
- **Circulation, balconies, utility, lift, duct and similar spaces:** same rule —
  `measured` when a length × width pair is printed for them, otherwise
  `unmeasurable`. List every labelled space either way.
- **Other items** (e.g. counts of marked doors/windows) are optional; give each its
  own `measurementRule`.

Copy this convention into `measurementConventions` (adding anything else you
decided), and use `measurementRule` on each line for anything specific to it.
Where the sheets do not support a defensible figure, classify the line rather than
estimate.

## Who prepared it

`preparedBy` (name and role, e.g. "A. Rao, Chartered Quantity Surveyor"),
`preparedAt` (date as YYYY-MM-DD), `project`, `drawing.sha256` and
`drawing.pages` (the pages in scope), and `"preparedWithoutCunstructOutput": true` — which you
may set only if the first section above holds.

## Format

JSON as in `reference-boq-template.json` (fill it in; the template is deliberately
invalid until completed). A spreadsheet with the same columns is acceptable; it
will be transcribed to JSON without changing any value, and the transcription
checked back against the spreadsheet.

## What happens next

The reference is validated (checksum, independence, every field rule). If valid,
software output is scored against it with an evaluator that was fixed before
your reference was commissioned. The reference is not changed after results are seen.
The result describes this drawing only.
