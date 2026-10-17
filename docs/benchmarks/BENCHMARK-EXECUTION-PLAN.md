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
- **Scoring driver added.** `scripts/benchmark/score-set-a.test.ts` with its own config `scripts/benchmark/vitest.bench.config.ts`; it is not part of the test suite.
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

## 4. Run order once the inputs exist

1. Verify the hashes: `npx vitest run --config scripts/benchmark/vitest.bench.config.ts` with no inputs; the hash test must pass.
2. Run `scripts/drawing-ocr/drawing_ocr.py` on the drawing. Save and SHA-256 its JSON **before** opening the reference.
3. Receive and validate the reference, then write the contract tagging JSON.
4. Run the driver with all inputs, and fill in `g5-worksheet.json` by hand.
5. Report every gate with its value. Any failure means **not accepted**, with the failing lines listed. Record the working-tree commit.

Keep `benchmark-inputs/**` out of Git.
