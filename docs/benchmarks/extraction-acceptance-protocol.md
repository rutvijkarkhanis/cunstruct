# V1 extraction acceptance protocol — FROZEN 2026-10-14

Frozen **before** any independent reference exists or is scored. Nothing below may change
after a reference is opened; a change requires a new protocol version and a new reference.
Built on the existing repository protocol: `docs/benchmarks/reference-boq-spec.md`
(format `cunstruct.reference-boq.v1`), `reference-boq-handoff.md` (preparer brief),
`reference-boq-template.json`, validated by `src/lib/e2e/boqReference.ts` and scored by
`src/lib/e2e/boqEndToEndScorer.ts`.

## 1. Frozen input contract (`scripts/drawing-ocr/drawing_ocr.py` docstring)
Vector PDF pages; printed text ≥ ~1.4 mm (16 px at 300 dpi). Quantities only from: an explicit
QTY / NO. schedule column; a printed "N No."; a printed total row whose parts sum to its
printed SUM; a room tag whose printed area equals its printed L × W; a finish total built
only from such areas. Everything else is unresolved for review. Raster pages are refused.
Not attempted: symbol counting, scaling, dimension chains.

## 2. Frozen software (SHA-256 at freeze)
| File | SHA-256 |
|---|---|
| scripts/drawing-ocr/drawing_ocr.py | 13e8dcd010fc22797a64ae946b14de972102d57c96cf2c24a1cf7e01850441f9 |
| scripts/drawing-ocr/layout.py | 87c6345f1e993c313a6263149afd40798f48df4dffa49a64f58cb6254675a679 |
| src/lib/e2e/boqEndToEndScorer.ts | 22bf1de1f2c7336159096f4c06b08f158b6afaed478af096090b7dc278e0857a |
| src/lib/e2e/boqReference.ts | 8a5d6fd6f8d64c6da39b0d8ab4978f935349f1219dcb45e2e3b3508db545ffec |
| src/lib/e2e/referenceMatching.ts | 9a0a71fba6cd20613f35416726e020760df0c0a206b6310b9f09fe90a6a787b4 |
| src/lib/e2e/pipeline.ts | 6a887d6d3fa0d01158d946d514e99fdc2c031b9690933c43c28a25fcd57335a4 |
| src/lib/e2e/reviewPolicy.ts | 95864f01295404dc1708f8f533b2f37b1c41e2006465a97053a2f050cfa36014 |
The extractor runs unchanged on each drawing and its output JSON is saved and hashed
**before** the reference is opened (precedent: `benchmark-inputs/external-20261013/RESULTS.md`).

## 3. Drawings and references
- **Set A — acceptance (required):** at least one vector drawing set the extractor has never
  been run on, containing (i) a schedule with an explicit QTY column and (ii) room tags that
  print both an area and L × W. Supplied by the product owner; SHA-256 recorded on receipt.
- **Set B — development (reported, not accepting):** the Arab Creators set
  (`af382dca…f9db5`). Its results are optimistic by construction (extractor built on it).
- **Reference preparer:** an estimator who has seen no Cunstruct output, briefed with
  `reference-boq-handoff.md` adapted per drawing (SHA, pages, sheet names; the measurement
  convention section stays: gross areas from printed sizes, counts exact). The reference sets
  `preparedWithoutCunstructOutput: true`, writes aliases before any output is shown, and lists
  ambiguous / unmeasurable / out-of-scope lines with notes. It must pass `validateReferenceBoq`
  with the drawing's SHA-256.
- **Contract classification:** before scoring, the protocol owner tags each reference line
  `in-contract` / `out-of-contract` from §1 and the drawing alone, without extractor output.

## 4. Scoring run (frozen)
Extractor JSON → `runEndToEnd` with policy **`accept-everything`** (the extractor's own claims,
no human filtering — worst case for errors) → `scoreEndToEnd(run, reference)`. Tolerances are
the repository defaults: counts exact; areas ±1 % or 0.05 m² (0.5 ft²); other units ±1 %;
unit families must match. The `accept-evidenced-measurements` run is reported alongside.

## 5. Frozen acceptance gates (Set A; all must pass)
| Gate | Measure (scorer field) | Threshold |
|---|---|---|
| G1 Correctness | `accuracy.quantities.incorrect` (includes unit mismatch) | **0** |
| G2 No unsupported quantities | `falsePositives.inBoq` + `nonMeasurable.measuredAnyway` + `outOfScope.producedBySystem` | **0** |
| G3 Coverage, in-contract | `scope.found / scope.of` over in-contract measured lines | **≥ 0.70** |
| G4 Coverage, all measured lines | `scope.found / scope.of` over all measured lines | reported; no threshold |
| G5 No silent omission | every missed in-contract line lies on a page/region where the extractor emitted an unresolved item (manual check, one row per miss) | **100 %** |
| G6 Provenance | paired lines whose source page equals the reference `sourcePage` | **100 %** |
Set B must pass G1 and G2; its coverage is reported only.

## 6. Outcome
All gates pass on Set A → extraction **accepted** for the §1 contract only. Any gate fails →
**not accepted**; report the failing lines; a fix requires a new protocol version and a
drawing not used for that fix. No accuracy claim beyond §1.
