# Measurement evidence → product: the adapter boundary

**Status: designed and tested, NOT connected.**
- No product module imports the engine or `src/lib/measurement-quality/`; `evidenceContract.test.ts` asserts it.
- None of the following were modified in this sprint: `analysisSchemaV1`, `toAnalysisPayload`, apply-review, pricing, exports, BOQ creation.

## The contract: `cunstruct.measurement-evidence.v1` (`evidenceContract.ts`)
Each record keeps:
- **Source:** document id, file sha256, page, view, page size.
- **Printed and normalized value:** the raw printed text verbatim, and the normalized value with its unit and unit basis.
- **Geometry:** the line and its decision; the endpoints with their decision, reason and text position; every terminator considered, with the chosen ones flagged.
- **Association:** every end's association, ambiguous candidates included.
- **Scale and conflicts:** the scale region with its calibration and deviation; cross-view and chain conflicts.
- **Decisions:** each stage's decision and the engine's reasons.
- **Engine identity:** the engine fingerprint and record id.
- **Review provenance:** state plus reviewer records, each with `independent`, `blind`, verdict, any corrections, and the source file.

Nothing is collapsed into one confidence number.

## Review provenance decides eligibility, not the engine
- The review `state` is derived from reviewer records (`withReview`). An engine `acceptable` is never a verification.
- `independently-verified` requires at least one independent, blind "correct" record and no independent dissent. Disagreement becomes `needs-adjudication`.
- `downstreamEligibility(e)` is true only when the measurement is independently verified, and, if the association was not `associated`, an independent reviewer named the measured element.

## Path into the existing workflow (when authorized, later)
```
engine record ──evidenceFromEngine──▶ evidence v1 (unreviewed)
   ──blind independent review──▶ withReview ──▶ downstreamEligibility
   ──toReviewWorkflowCandidate──▶ raw cunstruct.analysis.v1 item:
        quantity null, status PENDING, dimension "1730 mm (printed "1,730")", evidence bbox, provenance note
   ──existing parseAnalysisV1 / createAnalysisRun──▶ Review Workstation (PENDING_REVIEW)
   ──a person reviews and computes the BOQ quantity──▶ existing apply-review (VERIFIED/EDITED only)
```

**Existing systems this path touches:**
- **Drawing coverage** (`drawingCoverage.ts`, `coverageOrchestration.ts`): evidence records can later supply "dimension found on page N, view V" signals. Coverage consumes location observations today, and nothing changes there.
- **Review workflow** (`reviewQueue.ts`, `reviewStore.ts`): a candidate enters as an ordinary analysis item in `PENDING_REVIEW`. The workstation shows its dimension and evidence box like any other item.
- **`cunstruct.analysis.v1`:** the candidate uses the exact raw shape `toAnalysisPayload` already emits. The contract test parses it with the unchanged `parseAnalysisV1`.
- **Apply-review** (`applyReview.ts`): items in PENDING_REVIEW, FLAGGED or MARKED_PENDING are never eligible. The test confirms the candidate is `NOT_ELIGIBLE` until reviewed there. Apply-review writes only quantity and unit; the candidate's quantity is null.
- **BOQ generation and pricing:** not reachable. A dimension is not a BOQ quantity. The adapter emits no rate, price or amount field, and turning a dimension into a quantity remains a human step in the Review Workstation.

## Safety tests (`src/lib/measurement-quality/evidenceContract.test.ts`)
- Records serialize and read back losslessly; printed text and coordinates are preserved exactly.
- Every stage decision is kept, and there is no single confidence field.
- Unreviewed evidence, including engine-accepted evidence, is not eligible, and the adapter throws on it.
- Held measurements cannot be marked verified without records; developer review is not independent.
- Ambiguous associations are not applied unless the reviewer names the element.
- Disagreeing reviewers block eligibility.
- A verified candidate has quantity null, is PENDING, and carries no pricing fields. It parses under the existing schema, and existing apply-review classifies it NOT_ELIGIBLE.
- `toAnalysisPayload` still emits `cunstruct.analysis.v1`, and no product code imports the engine or this tooling.
