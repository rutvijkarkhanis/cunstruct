# Deterministic quantity take-off engine

Status: prototype. Runs offline (`scripts/drawing-ocr/takeoff.py`) and hands its results to the app through the existing Import JSON → review → Apply path. Nothing here writes to the database. Results are proven on synthetic fixtures only; no independent accuracy measurement exists.

## Data flow

```
drawing (PDF text layer / OCR / DXF)
  -> schedule_sources + schedule_core        schedules: sizes, room/finish rows, printed totals
  -> any instance counter (optional input)    #231 (src/lib/counting) or #232 (instance_core): count items, analysis.v1
  -> quantity_core                            quantity records (inputs, evidence, status, reasons)
  -> to_analysis_item                         cunstruct.analysis.v1
  -> Import JSON -> review -> Apply           existing, unchanged
  -> boq_line (qty, unit, quantity_status, basis, external_key)
     + analysis_review_item.ai_json (calculationData, notes, candidates)
  -> lineEvidence recomputes the formula; CSV / PDF export the line
```

The engine reads counters through the analysis.v1 contract, not their code, so either counter works.

## Quantities implemented

| Key | Quantity | Unit | Formula sent to the app |
|---|---|---|---|
| `FLOOR:<finish>` | flooring per floor finish: sum of the rooms' floor areas | schedule unit (sqft/sqm) | `SUM_OF_SEGMENTS` / `UNIT_CONVERSION` |
| `SKIRT:<type>` | always insufficient: no perimeters printed | m | none |
| `<mark>` | door/window joinery line: openings counted on floor plans | nos | none (the count is the counter's result) |
| `AREA:<mark>` | opening area: scheduled width × height × count | sqm | `QUANTITY_PER_UNIT_TIMES_UNIT_COUNT` |

Statuses: `calculated`, `pending_review`, `ambiguous`, `conflicting`, `insufficient`. Only `calculated` carries a number; it becomes `MEASURED`. Everything else is `PENDING` with reasons and, where one side is known, candidates.

## Blocked: net quantities (gross − deductions)

Wall finishes, plaster, paint and skirting all need gross minus deductions. `quantity_core.net_of_deductions` computes this under the integrity rules: each opening deducted once, unresolved counts propagate, and over-deduction is refused. The app can't recompute it, though, because no allowlisted formula subtracts.

**Required contract change.** Add one formula id, for example `GROSS_MINUS_DEDUCTIONS`:

- `src/lib/review/measurementValidator.ts`:
  - add it to `FormulaId`, plus a handler;
  - inputs: the first is the gross, and the rest are deductions of the same dimension;
  - result: gross − Σ deductions;
  - refuse fewer than two inputs, mixed dimensions, or a negative result.
- `src/lib/review/analysisSchemaV1.ts`: add the id to `CALCULATION_FORMULA_IDS`. The two-way compile-time check enforces that both lists agree.
- `src/lib/lineEvidence.ts`: add a `FORMULA_JOIN` entry (" − ").

**Coordination needed.** `supabase/functions/_shared/openaiSchema.ts` builds the AI's strict output schema from `CALCULATION_FORMULA_IDS`. Adding an id widens what the AI edge function accepts. That edge function is protected, so the change needs its owner's authorisation and a contract-version decision (`supabase/functions/_shared/contract.ts`). `measurementValidator.ts` also describes itself as an audited module that "stays unmodified", which needs the same sign-off.

Until then, a net quantity can only travel as text, which the app can't verify, so the engine doesn't emit one as `MEASURED`.

## Known gap: count units in the validator

`measurementValidator.ts` knows a dimensionless count only as `count`. Calculation inputs therefore use `count`; the engine maps `nos` at output. The stated unit of a count line (`nos`/`nr`) is still unknown to the validator, so a count calculation's comparison reads "Cannot compare safely" (`INCOMPARABLE`). Adding `nos`/`nr`/`no` aliases to its unit table would fix this; it is the same audited module as above.

## Not done

- No plan geometry: no wall lengths, room outlines or scale.
- No room association for openings, so no per-room deductions.
- Not wired into the app UI.
- No independent validation.
