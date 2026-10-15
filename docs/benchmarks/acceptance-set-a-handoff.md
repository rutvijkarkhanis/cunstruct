# V1 extraction acceptance — Set A handoff

Runs the frozen protocol `extraction-acceptance-protocol.md` (SHA-256
`9b21f641682daaa5cdced30f9c4721ca34a15723e60d4e914c0a2cc57238b489`; verify before use,
do not edit — a change needs a new protocol version and a new reference). Nothing here
needs any drawing used during development; none is in the repository.

## 1. What must be supplied (two inputs, two people)

**A. The drawing — from the product owner, with permission to use it for this test.**
- A drawing set the extractor has never been run on (nothing used during
  development or in earlier benchmarks).
- Vector PDF pages (selectable text); printed text at least ~1.4 mm high.
- Contains (i) a schedule with an explicit QTY / NO. column and (ii) room tags that
  print both an area and its L × W (protocol §1, §3).
- Record on receipt: SHA-256, page count, sheet names, who supplied it and the
  permission it was supplied under. Keep the file outside Git (`benchmark-inputs/**/*.pdf`
  is ignored); commit nothing that reproduces its content.

**B. The reference BOQ — from an estimator who has seen no Cunstruct output.**
- Prepared from that drawing alone, in `cunstruct.reference-boq.v1`.
- `preparedWithoutCunstructOutput: true`; aliases written before any output is shown;
  ambiguous / unmeasurable / out-of-scope lines listed with notes.
- Passes `validateReferenceBoq` with the drawing's SHA-256.

## 2. The estimator's package
Give exactly: the drawing, `reference-boq-handoff.md`, `reference-boq-spec.md`,
`reference-boq-template.json`, and this cover sheet. Before sending, the protocol owner
fills the drawing-specific placeholders (`<…>`) in those three documents: project name,
SHA-256, pages and sheet titles in scope, and, where the brief asks, the sheets' display
rotation, units and scale notes. Nothing else in them changes: the measurement
convention stays as written (gross areas from printed sizes only, counts exact, no
scaling, classify rather than estimate). The estimator must not receive anything else
from `docs/benchmarks/`.

## 3. Order of work (protocol owner)
1. Verify the protocol's and the seven frozen files' SHA-256 (protocol §2).
2. Run `scripts/drawing-ocr/drawing_ocr.py` unchanged on the drawing; save and hash its
   JSON **before** the reference is opened.
3. Receive the reference; validate it; tag every line in-contract / out-of-contract from
   protocol §1 and the drawing alone.
4. Score with `runEndToEnd` (policy `accept-everything`) → `scoreEndToEnd`; also report
   `accept-evidenced-measurements`. No committed command-line driver exists for a new
   drawing: call both functions from `src/lib/e2e/` unchanged, with the in-memory
   database (`src/lib/e2e/inMemorySupabase.ts`), and keep the outputs local.
5. Apply gates G1–G6 (protocol §5). All pass → accepted for the §1 contract only;
   any fail → not accepted, with the failing lines listed.
