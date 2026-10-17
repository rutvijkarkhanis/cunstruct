# Extraction acceptance protocol v1.1 — amendment, 16 Oct 2026

Supersedes **only §2** of `extraction-acceptance-protocol.md` (v1, frozen 2026-10-14, SHA-256 `9b21f641…b489`), which is not edited. Every other section of v1 applies unchanged: input contract, drawings and references, scoring run, gates G1–G6 and outcome.

## Why this is allowed

v1 says a change to the frozen software needs a new protocol version and a new reference. **No reference has been opened or scored under v1**: Set A has not been supplied, so no "new reference" is owed. This amendment is issued before any reference exists.

## The change

`src/lib/e2e/pipeline.ts` differs from its v1 hash by one line: `CSV_HEADER` gained the `"Quantity basis"` column, which the BOQ CSV export now writes. Without it the harness could not parse the export.
- Extraction is unchanged (`drawing_ocr.py`, `layout.py` hashes unchanged).
- Matching is unchanged.
- Scoring and the review policy are unchanged.

## §2 (v1.1): frozen software

| File | SHA-256 |
|---|---|
| scripts/drawing-ocr/drawing_ocr.py | 13e8dcd010fc22797a64ae946b14de972102d57c96cf2c24a1cf7e01850441f9 |
| scripts/drawing-ocr/layout.py | 87c6345f1e993c313a6263149afd40798f48df4dffa49a64f58cb6254675a679 |
| src/lib/e2e/boqEndToEndScorer.ts | 22bf1de1f2c7336159096f4c06b08f158b6afaed478af096090b7dc278e0857a |
| src/lib/e2e/boqReference.ts | 8a5d6fd6f8d64c6da39b0d8ab4978f935349f1219dcb45e2e3b3508db545ffec |
| src/lib/e2e/referenceMatching.ts | 9a0a71fba6cd20613f35416726e020760df0c0a206b6310b9f09fe90a6a787b4 |
| src/lib/e2e/pipeline.ts | ea71ff7db31b56b598ca31d6d4817bfde9544b889f6380d7e81a066e27ff5357 |
| src/lib/e2e/reviewPolicy.ts | 95864f01295404dc1708f8f533b2f37b1c41e2006465a97053a2f050cfa36014 |

These are checked by `scripts/benchmark/score-set-a.test.ts`, which refuses to report gates if any hash differs.

**Caveat.** `pipeline.ts` runs the real Apply and export code, which is not frozen. Changes to those modules between now and the Set A run change what is measured. Record the commit SHA of the working tree at the Set A run.
