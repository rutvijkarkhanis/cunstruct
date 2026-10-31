# Measurement quality platform

This is infrastructure around the **frozen** vector measurement engine (`src/lib/review/linearDimensions.ts`, `dimensionTerminators.ts`, `dimensionAssociation.ts`, `pdfGeometry.ts` and the files they import).

- It never changes the engine.
- It is never imported by product code; a test enforces this.
- Drawings, renders, review packages and answer keys are private and stay **outside Git**. Every CLI refuses to write inside the repository.

| piece | code | doc |
|---|---|---|
| Per-measurement ledger, metrics, accounting | `src/lib/measurement-quality/ledger.ts`, `metrics.ts`; CLI `scripts/accuracy/mq/buildLedger.ts` | [METRICS.md](METRICS.md) |
| Engine freeze manifest | `scripts/accuracy/mq/fingerprint.ts`, `freezeManifest.ts` | below |
| Dataset manifests and role guard | `src/lib/measurement-quality/datasetManifest.ts` | [DATASETS.md](DATASETS.md) |
| PDF intake diagnostic | `intakeClassify.ts`; CLI `scripts/accuracy/mq/intake.ts` | [DATASETS.md](DATASETS.md) |
| Blinded review packages, scoring, agreement | `reviewPackages.ts`, `reviewScoring.ts`; CLIs `makeReviewPackages.ts`, `scoreReviews.ts`, `audit_review_packages.py`; blind app `scripts/accuracy/mq/review-app/` | [REVIEW-PROTOCOL.md](REVIEW-PROTOCOL.md), [REVIEW-OPERATING-PROCEDURE.md](REVIEW-OPERATING-PROCEDURE.md), [REVIEWER-INSTRUCTIONS.md](REVIEWER-INSTRUCTIONS.md) |
| Release levels | — | [RELEASE-SCORECARD.md](RELEASE-SCORECARD.md) |
| Production review UI (design only) | — | [PRODUCTION-REVIEW-UI-SPEC.md](PRODUCTION-REVIEW-UI-SPEC.md) |
| Evidence workbench (offline) | `scripts/accuracy/mq/workbench/`, `buildWorkbench.ts` | below |
| Held/rejected classification and register | `failureReasons.ts`; CLI `analyzeFailures.ts` | output `HELD-REJECTED-ANALYSIS.md` |
| Measurement-evidence contract v1 | `evidenceContract.ts`; CLI `exportEvidence.ts` | [ADAPTER-BOUNDARY.md](ADAPTER-BOUNDARY.md) |
| Validation runner | `scripts/accuracy/mq/validate.ts` | [VALIDATION-DATA-SPEC.md](VALIDATION-DATA-SPEC.md) |

## Reproduce the W976646 baseline
Run everything from the repository root. `$P` is a private directory outside the repository.

```bash
npx vite-node --root . scripts/accuracy/mq/freezeManifest.ts --out $P/ENGINE-FREEZE-MANIFEST.json
npx vite-node --root . scripts/accuracy/mq/runEngine.ts --pdf <ArchitecturalDrawingsXrayfacility.pdf> --pages 1,3,4 --out $P/run
npx vite-node --root . scripts/accuracy/mq/buildLedger.ts --engine $P/run/engine-output.json --gold <W976646-gold-set.json> --out $P/baseline
# or, as one guarded step:
npx vite-node --root . scripts/accuracy/mq/validate.ts --manifest <W976646.manifest.json> --purpose development-benchmark \
  --root <dir with the PDFs> --reference <W976646-gold-set.json> --freeze $P/ENGINE-FREEZE-MANIFEST.json --out $P/dev-run
```

Expected fingerprints (2026-10-31):
- Drawing `cf4ab6b8…`.
- `engine-output.json` sha256 `cecb7216…`. This file is deterministic: timings are written to `run-record.json` instead.
- `ledger.json` sha256 `1d5883ab…`.

## The freeze manifest
`freezeManifest.ts` follows every relative and `@/` import from the engine entry points. It hashes each reached file, both runtime and type-only, and records:
- the pdfjs-dist build file;
- package and runtime versions;
- config hashes;
- the commands.

The **candidate fingerprint** is the sha256 of the sorted `<sha256>  <path>` lines. It identifies the engine independently of Git, because the candidate is uncommitted. `--check <earlier manifest>` exits non-zero if any engine file changed.

## Workbench
```bash
npx vite-node --root . scripts/accuracy/mq/buildWorkbench.ts --engine $P/run/engine-output.json --ledger $P/baseline/ledger.json \
  --gold <gold-set.json> --pdf <drawing.pdf> --manifest <W976646.manifest.json> --out $P/workbench
# then open $P/workbench/index.html in a browser (file://, no server, no network)
```
The workbench shows engine evidence. It is therefore a developer and QA tool, **not** a blinded review instrument.
