# Production measurement review UI: specification (design only, not implemented)

**Status.** This is a specification only. Nothing here is implemented, no route or navigation item is added, and the engine stays inactive in product code. Pricing, BOQ creation and apply-review are unchanged. Implementation requires owner approval, and Level 3 of RELEASE-SCORECARD.md first.

**Purpose.** Let an ops reviewer inspect engine-extracted dimensions on a stored drawing and decide on each one, keeping a complete audit trail. The decision is to accept, hold or reject it, or to correct it. A decided measurement then enters the **existing** Review Workstation as a pending dimension claim.

## 1. Placement and access
- **Route:** `/ops/projects/:projectId/documents/:documentId/measurements`. It sits inside `OpsLayout` and is gated by `useAuth().roles` containing `ops` or `admin`. There is no storefront or contractor entry.
- **Entry point:** a "Measurements" action on a drawing in the existing project documents panel. It is shown only when a measurement run exists for that document revision.
- **Data:** React Query hooks in `src/hooks/useMeasurementReview.ts`. Never `useState` + `useEffect` for async data.

## 2. Data model (proposal; requires a new migration when approved)
All tables are new. Existing tables are untouched.

**`measurement_run`**
- Columns: `id`, `document_id`, `document_revision_id`, `file_sha256`, `engine_fingerprint`, `engine_core_fingerprint`, `dataset_role` (must not be holdout), `created_by`, `created_at`, `status`.
- One run per document revision and engine fingerprint.

**`measurement_evidence`**
- Columns: `id`, `run_id`, `engine_record_id`, `evidence jsonb` (cunstruct.measurement-evidence.v1, validated on write), `printed_text`, `value`, `unit`, `page`, `overall`.
- Immutable after insert.

**`measurement_review_event`**: append-only, never updated or deleted.
- Columns: `id`, `evidence_id`, `reviewer_id` (auth user), `reviewer_role`, `independent boolean`, `blind boolean`, `action` (accept | hold | reject | correct | comment | adjudicate | export), `payload jsonb` (corrected value, endpoints, resolved element, reason), `client_session_id`, `created_at`.

**View `measurement_review_state`**: the latest decision per evidence, derived from events, never stored.

**RLS:**
- Read: ops and admin.
- Insert events: ops and admin, with `reviewer_id = auth.uid()`.
- No update or delete policy on events.

## 3. Screen layout
Three panes, matching the evidence workbench so the two can be compared.
1. **Left: measurement list.**
   - Columns: printed text, page and view, engine outcome, review state, flags (conflict, ambiguous association, scale).
   - Filters: page, view, engine outcome, primary failure reason, measurement type, scale region, review state, "needs my decision".
   - Keyboard: j/k to move.
2. **Centre: drawing viewer.**
   - Reuses `PdfEvidenceViewer` (pdf.js render, `evidenceCoords.ts` transforms), so drawings are rendered from the stored file at any zoom. Images are not pre-rendered.
   - Zoom, pan and "fit measurement".
3. **Right: decision panel** (sections 5–7).

## 4. Overlays (each independently toggleable; legend always visible)
| overlay | source | style |
|---|---|---|
| printed text box | `printed.text_anchor_pt`, height | orange outline |
| dimension line | `line` | blue solid |
| endpoints | `endpoints.start/end` | red dots |
| terminators | `terminators[]` | magenta; chosen ones filled, candidates hollow; kind labelled |
| associated element | `association.ends[]` (shape geometry resolved from the stored drawing) | green |
| alternative interpretations | ambiguous end candidates, candidate terminators, competing parallel lines | grey dashed |
| grid bubbles | the page's grid tags | purple rings |
| scale region | region extent and reach | blue thin and dashed |
| reviewer correction | the latest `correct` event | black crosshair, labelled with the reviewer |

The engine and the reviewer must never share a visual treatment. A Gold Set reference is never shown in production.

## 5. Values and association (decision panel, top)
- **Original printed text**, verbatim (for example "1,730"). **Normalized value and unit**, with the unit basis (printed or sheet note).
- **Measured length at the region scale**, with the deviation and tolerance. Labelled as a check, never as the value.
- **Each end's association** in words ("grid 6", "outer face of wall, via extension line"), with the engine's evidence sentence.
- **Alternatives**, listed when the association is ambiguous. Each one is selectable, which highlights it on the drawing.
- **Conflicts**: cross-view values and chain totals, each with a link to the other measurement.

## 6. Decisions
- **Accept.** Allowed only when the engine outcome is acceptable or the reviewer has supplied a correction, and the association is resolved.
  - If the engine's association is ambiguous, the reviewer must pick an alternative or describe the element. Accept is disabled until they do.
- **Hold**, with a mandatory reason from a list plus free text: ambiguous, conflict between views, insufficient evidence, needs RFI, other.
- **Reject**, with a mandatory reason: not a dimension, wrong line, wrong value, other.
- **Correct.** The reviewer can:
  - set the value;
  - click the endpoints (snapping to drawn geometry, with the snap shown);
  - pick or name each end's element.

  The correction is stored as a new event. The engine record is never edited.
- **Reviewer identity:** taken from the session, never typed. Each decision also records role, independence and timestamp.
- **Confidence:** high, medium or low, with the same definitions as the reviewer instructions.

## 7. History, resume and audit
- **Evidence history:** a timeline of all events for the measurement, showing who, what, when and the payload. Earlier decisions stay visible. A later decision supersedes but never erases.
- **Resume state:** the last filter, selection and zoom are kept per user. They are stored in localStorage as a convenience only; the authoritative state is the event log. Opening the page jumps to the first measurement that needs a decision.
- **Concurrent edits:** an optimistic check on the latest event id. If another reviewer decided meanwhile, show both and ask; never overwrite.
- **Audit log export:** CSV and JSON of all events for a run. Each export carries the engine fingerprint, file hash and run id, and is itself recorded as an `export` event.

## 8. Export into the existing review workflow
1. "Send to Review Workstation" is offered only for measurements whose state is `accept` (or `correct` + `accept`) and whose `downstreamEligibility` is true. For pilot use, that means independently verified.
2. Each one is converted with `toReviewWorkflowCandidate` (quantity **null**, status **PENDING**, dimension text, evidence box, provenance note). The batch is posted through the existing `createAnalysisRun`, unchanged.
3. The items then appear in `BoqReviewWorkstation` as `PENDING_REVIEW`.
   - Turning a dimension into a BOQ quantity is a separate human step there.
   - Apply-review, pricing and BOQ creation stay exactly as they are.
   - No path from this screen writes `boq_line` or any price.
4. Re-sending is idempotent: the key is `evidence_id`. The analysis run id is recorded on the export event.

## 9. Non-goals and safety tests to add at implementation time
- **Non-goals:** no automatic acceptance into BOQ; no pricing; no editing of engine output; no use of holdout datasets; no raster drawings in the vector view.
- **Tests:**
  - RLS forbids event update and delete.
  - Accept is disabled for an unresolved ambiguous association.
  - Export refuses ineligible evidence.
  - The exported items parse with `parseAnalysisV1` and classify NOT_ELIGIBLE in apply-review until reviewed.
  - No route renders for contractor or site_engineer roles.
  - The existing analysis and apply-review contract tests pass unchanged.
