# Independent reference BOQ — specification for the first accuracy evaluation

Status: **no reference exists.** Until one is supplied and passes validation, every
end-to-end report says "No reference — accuracy not computed." Nothing in this
repository may be used to build it (see "Independence").

## 1. Drawing and scope

| Field | Value |
|---|---|
| Project | `<project name, as on the title block>` |
| File | `<file name>`, `<pages>`, `<sheet size>`, `<display rotation>`, `<bytes>` |
| SHA-256 | `<64 hex characters, recorded on receipt>` |
| Pages in scope | `<page: sheet title>` for each page — nothing else |

Fill these from the drawing being benchmarked before the brief is sent.

The reference covers **every item a quantity surveyor can measure or count from
the sheets in scope alone**, under the conventions it states. Anything that needs
another drawing (sections, structure, services, finishes schedules) is listed as
out of scope, not omitted.

## 2. One line per measurable item

Format: JSON, `schema_version: "cunstruct.reference-boq.v1"` (validated by
`src/lib/e2e/boqReference.ts`). Each line:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable id, unique in the file (`R-P1-017`) |
| `item` | yes | `<what is measured> — <label exactly as printed>` ("Floor area — EXAMPLE ROOM" for a room labelled "EXAMPLE ROOM") |
| `aliases` | no | Other names the preparer accepts — written before seeing any Cunstruct output |
| `unit` | yes | sqm, sqft, m, nos, cum… |
| `quantity` | `measured` lines only | The preparer's figure, unrounded where possible. Must be absent for `ambiguous`, `unmeasurable` and `out_of_scope` lines |
| `floor` | yes | As printed on the sheet ("First Floor"); `null` only for whole-building items |
| `scope` | no | Flat / zone / block, if the preparer distinguishes one |
| `sourcePage` | yes in practice | The page number the item is on |
| `measurementRule` | yes | e.g. "gross, from the printed room size; no deductions" |
| `tolerance` | no | `{abs?, rel?}`; defaults below apply otherwise |
| `evidence` | **required for any name occurring more than once** (either floor); recommended otherwise | `{page, bbox, pageSize}` of the label or dimension the figure came from: `bbox` = [x1, y1, x2, y2], top-left origin, y down, in the same units as `pageSize` (PDF points: 595 × 842 for these A4 sheets) |
| `status` | optional | `measured` (default) · `ambiguous` · `unmeasurable` · `out_of_scope` |
| `note` | for non-measured | Why the item is ambiguous / unmeasurable / out of scope |

**Granularity:** where the drawing prints a size per room, give **one line per
room instance**, not a per-floor total (e.g. three rooms sharing one label on a
floor are three lines, each with its own evidence box). Totals may be added as separate lines.
The scorer pairs one reference line with one BOQ line; a per-floor total cannot
match per-room lines and would score as misses plus false positives.

## 3. Measurement convention (fixed for this benchmark; copied into `measurementConventions`)

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
- **Repeated rooms:** each counted separately.

Default tolerances if a line sets none: counts exact; areas within 1% or 0.05 m²
(0.5 ft²), whichever is larger; lengths and volumes within 1%.

## 4. Preparer and independence (top-level fields)

- `preparedBy` (name and role), `preparedAt` (YYYY-MM-DD), `project`, `drawing: {sha256, pages}`.
- `preparedWithoutCunstructOutput: true` — the preparer has **not** seen any
  Cunstruct engine output, model run, room list, benchmark file or report. The
  file is rejected without it.
- The reference must **not** be built from: engine output, any model run, any
  benchmark or fixture file, or any file under `docs/benchmarks/` other than the
  brief, this specification and the template. A checker may compare it against the drawing
  afterwards, but corrections must come from the drawing, never from Cunstruct.

## 5. Ambiguous, unmeasurable and out-of-scope items

Every such item gets a line with `status` and `note` (no invented quantity), e.g.
an illegible dimension (`ambiguous`), a space with no printed size
(`unmeasurable`), plastering that needs wall heights from a section
(`out_of_scope`). These lines define what a correct system should **hold for
review** rather than measure.

## 6. How the harness uses it (implemented)

1. **Line status.** `measured` lines need a quantity; `ambiguous`, `unmeasurable`
   and `out_of_scope` lines must have **no** quantity and a `note`. Only measured
   lines count towards scope and quantity accuracy. For ambiguous/unmeasurable
   lines the report shows whether the system identified the item, held it, or
   put a measured number in the BOQ anyway. For out-of-scope lines it lists what
   the system produced; those items are not false positives.
2. **Pairing never uses quantity.** A reference line pairs with a system item of
   the same name only when (a) both have a location and the locations agree on
   the same page, or (b) that name occurs exactly once on each side. Repeated
   rooms therefore need `evidence`; without it they are reported as ambiguous and
   not credited. A second item at an already-paired location is a duplicate; an
   item at a location where no same-name line is, is "location disagrees".
3. **Floor and scope.** Floor is scored from the stored BOQ line's scope (or the
   analysis item's location when it never reached the BOQ — the report counts
   both). A reference `scope` (zone, flat) is counted but **never scored**: the
   BOQ has no independent field to compare it with. Scoring it would need a new
   production field (out of scope here).
4. **Validation** rejects: wrong schema, missing preparer/date/conventions,
   `preparedWithoutCunstructOutput` not `true`, a checksum that is not 64 hex
   characters or not the analysed drawing, pages outside `drawing.pages`, boxes
   with x2 ≤ x1 or y2 ≤ y1, missing `pageSize`, and `evidence.page` disagreeing
   with `sourcePage`. A rejected reference is never scored.

## 7. Existing tender BOQ

None is available in this workspace. If the project has one, the usable subset
is only the lines whose quantity is derivable from the pages in scope alone; each needs its
page and evidence recorded as above, and lines needing other drawings are marked
`out_of_scope`.

## 8. What a run will — and will not — show

With a validated reference the harness reports scope found/missed, quantities
within tolerance, item and floor identity, false positives, items held for review,
and export integrity, each with numerator and denominator. It measures the one
drawing scored; a drawing used while developing the extractor gives optimistic
results and says nothing about other drawings.
