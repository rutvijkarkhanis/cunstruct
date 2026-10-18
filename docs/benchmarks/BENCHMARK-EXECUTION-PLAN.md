# Extraction accuracy benchmark — execution plan

**Status: NOT EXECUTED. No extraction accuracy is claimed.** The only scored data so far is Set B (the development set, optimistic by construction) and synthetic controls.

The methodology already exists and is frozen. This plan does not redefine it. It maps the requested elements to it and lists what blocks execution.

## 1. What is already defined (protocol v1 + v1.1 amendment)

| Requested | Where it is defined |
|---|---|
| **Dataset** | Set A: ≥ 1 vector drawing set never run through the extractor, with a QTY schedule and room tags printing area and L × W. Set B is reported only. (`extraction-acceptance-protocol.md` §3) |
| **Ground truth** | An independent estimator's reference BOQ (`cunstruct.reference-boq.v1`), prepared without seeing Cunstruct output and validated against the drawing's SHA-256. (§3, `reference-boq-spec.md`, `reference-boq-handoff.md`) |
| **Methodology** | Extractor output hashed **before** the reference is opened; `runEndToEnd`, policy `accept-everything` (worst case), then `scoreEndToEnd`; `accept-evidenced-measurements` reported alongside. (§4) |
| **Omission metric** | G3 in-contract coverage ≥ 0.70; G4 all-line coverage reported; G5 every in-contract miss sits where an unresolved item was emitted, 100 %, manual. (§5) |
| **False-inclusion metric** | G2: quantities in the BOQ with no reference line, measured-anyway unmeasurable lines, and out-of-scope lines produced; must be 0. (§5) |
| **Unit checks** | G1 counts a unit-family mismatch as an incorrect quantity; must be 0. Tolerances: counts exact; areas ±1 % or 0.05 m²; other units ±1 %. (§4) |
| **Provenance** | G6: paired lines cite the reference's source page, 100 %. (§5) |
| **Acceptance** | All of G1–G6 pass on Set A → accepted for the §1 input contract only. (§6) |

## 2. Done in this sprint (benchmark-enabling only)

- **Freeze drift found and resolved by amendment.** `src/lib/e2e/pipeline.ts` no longer matched its frozen hash; the export gained the "Quantity basis" CSV column. Running v1 as written would have stopped at its own hash check.
  - `extraction-acceptance-protocol-v1.1.md` replaces only §2. This is valid because no reference has been opened.
  - The other six frozen files are unchanged, and the sprint's agents were told not to edit them.
- **Scoring driver added.** `scripts/benchmark/score-set-a.test.ts` (extended in §4) with its own config `scripts/benchmark/vitest.bench.config.ts`; it is not part of the test suite.
  - It verifies the v1.1 hashes, then calls the frozen functions unchanged.
  - It writes both policies' reports, a `gates.json` (G1–G4 and G6 computed, G5 marked manual), and a G5 worksheet listing every missed in-contract line.
  - It refuses G3 if any measured line is not tagged in/out of contract.
  - **Dry run on synthetic inputs only:** a planted wrong area failed G1, and a planted omission gave G3 2/3 and a G5 worksheet row. Command (inputs in the session scratchpad, not committed):

    ```
    BENCH_ANALYSIS=… BENCH_REFERENCE=… BENCH_DRAWING_SHA=… BENCH_CONTRACT=… BENCH_PAGE_SIZES=… BENCH_OUT=… \
      npx vitest run --config scripts/benchmark/vitest.bench.config.ts
    ```

## 3. What blocks execution: inputs, not engineering

| # | Input | Owner |
|---|---|---|
| 1 | A Set A drawing set with usage permission, never run through the extractor (`acceptance-set-a-handoff.md` §1A) | Product owner |
| 2 | An independent estimator's reference BOQ for it (§1B) | Estimator engaged by the product owner |
| 3 | In/out-of-contract tagging of the reference lines, from protocol §1 and the drawing only | Protocol owner |

## 4. Multi-set runner and per-category metrics (E2 harness)

Added after the first driver. **Status: built and tested on synthetic inputs only. No real set has been scored.**

The driver now takes a manifest and scores every set in it.
- Code: `scripts/benchmark/gates.ts` (hashes and gates, moved unchanged from the driver), `metrics.ts` (categories, DSR pricing, metrics), `runner.ts` (manifest, decisions, per-set run, aggregate).
- Synthetic controls: `scripts/benchmark/metrics.test.ts`. They cover an omission, a wrong quantity, a false positive, a unit-family mismatch and an unpriced line. They are not a benchmark.
- It calls the frozen functions unchanged. It does no pairing or tolerance checks of its own: "found" and "within tolerance" are always the frozen scorer's verdicts.

### 4.1 Commands

```
# 1. Hash check and synthetic controls (no inputs needed). Every test must pass.
npx vitest run --config scripts/benchmark/vitest.bench.config.ts

# 2. Every set in a manifest
BENCH_MANIFEST=benchmark-inputs/<run>/manifest.json BENCH_OUT=benchmark-inputs/<run>/out \
  npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a

# 3. One set, as before. BENCH_DECISIONS is optional.
BENCH_ANALYSIS=… BENCH_REFERENCE=… BENCH_DRAWING_SHA=… BENCH_CONTRACT=… BENCH_PAGE_SIZES=… [BENCH_DECISIONS=…] BENCH_OUT=… \
  npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a
```

- Commands 2 and 3 check the frozen hashes again before scoring.
- The run fails if any set could not be scored. The reason is in `<out>/<set>/error.json`; other sets are still scored.

### 4.2 Manifest (`cunstruct.benchmark-manifest.v1`)

```json
{
  "schema_version": "cunstruct.benchmark-manifest.v1",
  "sets": [
    {
      "id": "set-a-1",
      "role": "acceptance",
      "documentName": "…",
      "drawingSha256": "<64 hex: the drawing PDF>",
      "analysis": "set-a-1/extractor-output.json",
      "analysisSha256": "<64 hex, recorded before the reference was opened (optional; checked when given)>",
      "reference": "set-a-1/reference.json",
      "contract": "set-a-1/contract.json",
      "pageSizes": "set-a-1/page-sizes.json",
      "decisions": "set-a-1/review-decisions.json"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `role` | `acceptance` for Set A, where the gates decide. `development` for Set B: reported only, never pooled with acceptance sets. |
| Paths | Resolved relative to the manifest file. |
| `contract` | `{lineId: "in" \| "out"}`. Can be a path or an inline object. |
| `pageSizes` | `{"<page>": {width, height}}`. Can be a path or an inline object. |
| `decisions` | Optional. |

### 4.3 Human review decisions (`cunstruct.review-decisions.v1`)

This file is what a person decided about the extractor's items. It is the only input to the "human-corrected" figures.

```json
{
  "schema_version": "cunstruct.review-decisions.v1",
  "analysisSha256": "<SHA-256 of the exact extractor output file>",
  "reviewedBy": "…",
  "reviewedAt": "2026-…",
  "reviewedWithoutReference": true,
  "decisions": [
    { "key": "W1", "action": "accept" },
    { "key": "R7", "action": "reject", "note": "not on this drawing" },
    { "key": "R9", "action": "correct", "quantity": 12.4, "unit": "sqm", "item": "optional corrected name" }
  ]
}
```

- **One decision per item.** `key` is the analysis item key, resolved as the parser resolves it: `key`, then `external_key`, then `id`, then the item name.
- **Rejected if any check fails:**
  - an item has no decision, or has two;
  - a key is not in the analysis, or two items share a key;
  - the hash is not the analysis file's hash;
  - `reviewedWithoutReference` is not `true`.
- **How it is applied:** rejected items are removed. A corrected item takes the reviewer's quantity and becomes MEASURED; the reviewer's `unit` and `item` replace the extractor's when given. The result then goes through the same frozen pipeline (`accept-everything`) and scorer.
- **Not modelled:** lines the reviewer adds, and the review UI's record of reviewer corrections.

### 4.4 Outputs

Outputs stay under `benchmark-inputs/` and are never committed.

**Per set, in `<out>/<set id>/`:**

| File | Contents |
|---|---|
| `report-accept-everything.json`, `report-accept-evidenced-measurements.json` | The frozen scorer's reports. |
| `gates.json` | G1–G6 for both policies, with the set id, role and the analysis and drawing SHA-256. G5 is `"manual"`. |
| `g5-worksheet.json` | One row per missed in-contract line, to fill in by hand. |
| `metrics.json` | `rawMachine` and `humanCorrected` (null without a decisions file), each labelled. Each has `byCategory` (every category plus `all`), `lines` (one record per measured reference line: outcome, quantities, % error, price or unpriced reason) and `systemItems` (category, fate, standing). `method` states every definition below. |
| `report-human-corrected.json`, `analysis-human-corrected.json` | Only with a decisions file. |

**For the whole run, in `<out>/summary.json`:**
- the commit at HEAD and whether tracked files differ from it;
- whether the frozen hashes match;
- per set: its outcome (`NOT ACCEPTED — failing: …`, `computed gates pass — G5 manual worksheet outstanding…`, `development set …`, or `NOT SCORED — <reason>`) and its accept-everything gates;
- `aggregate.acceptance` and `aggregate.development`. Each has `rawMachine` (every scored set of that role) and `humanCorrected` (only the sets with a decisions file, which it lists).

### 4.5 Metric definitions (per category; also in `metrics.json → method`)

**Categories.** Taken from the reference line's item name and unit. The first rule that holds wins.

| Order | Category | Rule |
|---|---|---|
| 1 | `floor_areas` | floor / carpet / built-up / plinth / room / covered area, with an area unit |
| 2 | `finishes` | plaster, paint, tile, flooring, skirting, dado, putty, distemper, emulsion, polish, cladding, granite, marble, kota, terrazzo, screed, pointing, whitewash, primer, ceiling |
| 3 | `doors_windows` | door, window, ventilator, shutter, louver |
| 4 | `structural` | RCC, PCC, concrete, footing, foundation, column, beam, slab, lintel, reinforcement, rebar, TMT, steel, shuttering, centering, formwork |
| 5 | `masonry` | brick, block, masonry, wall |
| 6 | `other` | none of the above |

- A system item paired to a reference line takes that line's category.
- An unpaired system item is categorised by its own name and unit.

**Metrics.**

| Metric | Definition |
|---|---|
| Raw machine recall | Measured reference lines the scorer paired ÷ measured reference lines. Missed, ambiguous and held lines are listed. |
| Precision | System items in the BOQ as MEASURED that are paired to a measured reference line ÷ system items in the BOQ as MEASURED. Items that are not paired are broken down: no reference, duplicate, location disagrees, ambiguous, or paired to a non-measured line. Pending and never-applied items are reported but are not in the ratio. |
| Quantity error | \|q_sys − q_ref\| / q_ref × 100 on paired lines that are in the BOQ as measured and whose units convert (sqm ↔ sqft only). Reported as the median (mean of the two middle values) and the nearest-rank p90. A unit-family mismatch is listed and never given a % error. |
| ₹-weighted error | Σ\|Δq\|×rate ÷ Σ q_ref×rate over **priced** measured reference lines. `matched` covers paired lines in the BOQ as measured; a unit mismatch counts as \|Δq\| = q_ref. `withOmissions` adds missed, ambiguous and held lines at \|Δq\| = q_ref. False positives have no reference line and are not priced. `unpricedShare` = unpriced lines ÷ measured lines. A ratio with nothing to divide by is `null`, never 0. |

**Pricing.** Rates come from the DSR 2023 seed (`supabase/migrations/20260731001000_dsr_seed_civil.sql`), read with `src/lib/dsr/seedFixture.ts` and matched with `src/lib/dsr/match.ts`.
1. If the reference line states a code in the optional field `dsrCode`, that code is used. The matcher must call it `reliable` for the line. A code that is not in the schedule leaves the line unpriced; no other item is substituted.
2. Otherwise, the matcher's `reliable` description match is used.
3. In both cases the DSR unit must equal the line's unit, and the item must have a rate.
4. Anything else is unpriced, with the reason recorded.

`dsrCode` is not part of `cunstruct.reference-boq.v1`. The validator ignores it, and only the independent preparer may add it.

## 5. Run order once the inputs exist

1. Verify the hashes and controls: `npx vitest run --config scripts/benchmark/vitest.bench.config.ts`. Every test must pass.
2. Run `scripts/drawing-ocr/drawing_ocr.py` on each drawing. Save its JSON and record its SHA-256 **before** opening the reference. Put the hash in the manifest as `analysisSha256`.
3. Receive and validate each reference, then write the contract tagging JSON.
4. Optional, for human-corrected figures: a reviewer who has not seen the reference writes the decisions file for each extractor output.
5. Write the manifest and run command 2 of §4.1. Fill in each `g5-worksheet.json` by hand.
6. Report every gate with its value, then the per-category raw-machine metrics. Report the human-corrected metrics **separately**, never in the same table. Any gate failure means **not accepted**, with the failing lines listed. Record `summary.json → workingTree.head`.

Keep `benchmark-inputs/**` out of Git.
