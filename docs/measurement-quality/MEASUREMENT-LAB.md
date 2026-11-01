# Measurement Lab (inside the BOQ Review Workstation)

**What it is.** An admin-only evaluation panel, opened from the **Measurement Lab** button in the BOQ review workstation (`/ops/projects/:id/boqs/:boqId/review` on the app subdomain, `track.cunstruct.com`). It appears both in the header and on the import screen. The lab measures the measurement engines. It never changes an engine, the BOQ, prices, exports or analysis runs.

**Order of work.** Evaluation lab, then verification, then comparison, and only then improvements.

## Workflow

### Stage A — blind reference
Upload a drawing. Before any engine output exists, the reviewer records each dimension from the drawing:
- page, view and element;
- the printed text, the value and the unit;
- the text point, and the start and end points (clicked on the drawing);
- the associated element;
- derivability: `derivable`, `ambiguous` or `not-derivable`.

Stage A shows **no** engine controls, runs or results.

- **Before locking,** drafts can be added, edited and withdrawn. A withdrawal needs a reason.
- **Locking** is refused while any derivable record is incomplete. An ambiguous or non-derivable record needs a note.
- **Engine runs that already existed** for this drawing are recorded in the log (`engine_runs_existed`), and the reference is labelled *may not be blind*.

### Stage B — engines revealed after lock
Run both engines unchanged. Each is a **byte-identical frozen copy** of its original commit's engine files and their full dependency closure, under `src/lib/measurement-lab/baselines/` (each directory's `FROZEN.json` lists source commit and sha256 per file):
- **1de95f6**, the recovered engine: `engine-1de95f6/` (5 files).
- **9ac1f71**, the candidate engine: `engine-9ac1f71/` (7 files).

Neither is the production measurement engine. Production code in `src/lib/review` is untouched, and nothing outside the lab can import these copies (enforced by `baselineIntegrity.test.ts`).

After the lock, the reference changes only through:
- an **amendment**, which needs a reason. The original value is kept, and the history appears in the UI and the report.
- **add-after-reveal**, which is flagged and excluded from the blind scope.

Scoring offers two scopes:
- **blind**: the reference as locked;
- **amended**: the reference after amendments.

The report states which scope it used.

**Historical mode.** A Gold Set JSON can be loaded in place of a blind reference. It is labelled *historical benchmark, not a blind founder reference*.

### Five things kept apart
| record | where | mutable? |
|---|---|---|
| Human reference | reference log, `RefEvent` | append-only and hash-chained; amendments keep the original |
| Engine output | frozen run, `FrozenRun` | never; content-hashed, deep-frozen and re-verified on load |
| Human verdict on an engine measurement (correct / incorrect / unclear) | correction log, `CorrectionEvent` | append-only; a later verdict supersedes but doesn't erase |
| Corrected measurement (allowed only with *incorrect*) | inside the verdict event | as above |
| Adjudicated measurement | — | **Not implemented**: a single reviewer can't adjudicate |

**Lab verdicts are not independent reviews.** Engine overlays are visible in Stage B. Independent validation uses the blind review packages; see REVIEW-PROTOCOL.md.

## Review workspace (Stage B)
Once an engine run is under review, the setup cards fold into one summary line ("Show setup" opens them again). The drawing is the main surface, with the measurement list on its left and a collapsible inspector on its right.

- **Two-way linking.** Every measurement with a page position is a clickable marker on the drawing. Clicking one selects it; selecting one in the list highlights its text, dimension line and endpoints and zooms to them, moving to the right page. A measurement without a position gets no marker, and the Lab says that precise location linking is unavailable, naming the page.
- **Inspector.** Shows the measurement's identity, the engine's result, your verdict, its current value and where that value comes from. It then lists every source-evidence fact labelled *available*, *derived*, *missing* or *unresolved*:
  - printed text and its location;
  - dimension line and endpoints;
  - endpoint distance (derived, in drawing units);
  - scale: always *missing*, because the frozen run does not record one; the value comes from the printed text;
  - associated element;
  - conflicts reported by the engine.

  The inspector also shows the engine version and output hash, and every verdict as a change receipt.
- **What changed?** For each measurement, and for the whole run (newest first), every receipt shows:
  - previous status → new verdict;
  - value before → after, and whether the value changed;
  - reason, reviewer, time;
  - the log event's hash.

  Receipts are derived from the append-only log. The engine's frozen output is never changed, and nothing is applied to the BOQ.
- **Overlay filters.** The register and the drawing always show the same measurements: the active filter, with resolved ones (correct or incorrect) hidden unless **Show reviewed** is ticked or the filter asks for them. Show reviewed is off by default. Behaviour around the selection:
  - **After a verdict:** the selected measurement stays visible ("selected; hidden by the filter") so its receipt can be read.
  - **After a filter change:** if the change hides the selection, the selection is cleared, and **N** continues from where you were.
  - **Measurements without a position:** listed, but never placed on the drawing.
- **Overlapping markers.** When a click lands on a measurement whose box substantially overlaps other visible measurements (at least 30% of the smaller box), a chooser lists them (ID, value, review status, deferred) and the reviewer picks one. Nothing is ever selected by drawing order. A lone marker still selects directly.
- **Defer.** A workflow flag ("come back later"), **not a verdict**:
  - **Storage:** its own append-only, hash-chained log, recording who, when, and defer or undefer.
  - **What it never touches:** verdicts, corrections, frozen runs, or any accuracy metric.
  - **Navigation:** deferred items are counted separately, have their own filter, and are skipped by **N** and by the "unresolved" filter.
  - **Keyboard:** **D** toggles it.
- **Layout.** Both the register and the inspector can be hidden; the drawing takes the space. The inspector reads **Result → Evidence → History**, with the verdict and Defer actions pinned at its bottom.
- **Progress.** Reviewed out of total, with counts for not reviewed, correct, incorrect, unclear and still to resolve. Status comes only from recorded verdicts: opening or selecting a measurement never marks it reviewed. *Unresolved* ("to resolve") means not reviewed, or the latest verdict is unclear, and not deferred. Correctness counts (correct, incorrect, unclear, not reviewed) are shown apart from workflow counts (to resolve, deferred). Filters cover review status (unresolved, deferred, not reviewed, correct, incorrect, unclear) and the engine's own decision. The default filter is *unresolved*.
- **Keyboard** (only inside the Lab, never while typing in a field; switch off with the *keys* tick box; `?` shows the list):

| key | action |
|---|---|
| A | mark correct |
| R / U | mark incorrect / unclear. Without a reason nothing is recorded: the reason field is focused, and Ctrl+Enter (or the button) then records it. |
| N | next unresolved, continuing from the current position even after a verdict removed it from the filtered list |
| P | previous measurement |
| F | zoom the drawing to the selection |
| I | show or hide the inspector |
| ? | the shortcut list |
| D | defer / undefer (a workflow flag, not a verdict) |
| Esc | close the overlap chooser, else clear the selection; with nothing selected, close the Lab |

- **Keys stay in the Lab.** While the Lab is open, no key press reaches the workstation's own shortcuts behind it (V, E, F, P, arrows). Before this change, they could act on the production review item behind the dialog.
- **Drawing identity.** A drawing is identified by the sha256 of its exact bytes, never by its filename:
  - the same file under another name resumes, and the Lab says which name it was saved under;
  - a different file with the same name starts fresh.

  If the fingerprint cannot be computed (or is malformed), the drawing is not opened at all: nothing is restored, saved or keyed to it, and any previously shown drawing is cleared, so a verdict cannot land on the wrong drawing.
- **Resume.** Your place is saved in this browser's localStorage, one entry per drawing (by sha256):
  - project/BOQ route;
  - reference mode, pages and engine;
  - filter and selected measurement;
  - inspector, zoom and shortcut settings;
  - last reviewed measurement.

  The Lab shows the last session when it opens. Choosing the same PDF restores everything, and the viewer zooms back to the selected measurement. Notes:
  - **No content stored.** The saved place holds no verdicts and no drawing content: verdicts stay in the integrity-checked IndexedDB log, and the PDF itself is not stored, so it has to be chosen again.
  - **Viewport.** The exact manual zoom and scroll position is not saved; the viewer re-fits to the selection.
  - **Historical mode.** The Gold Set file has to be chosen again.
  - **Scope.** Clearing site data, or another browser or device, starts without a saved place.
- **PDF lifecycle.**
  - **Opening a drawing.** Only the most recently chosen file can become the drawing: a slower, earlier open is dropped when it finishes, and its failure never clears the newer drawing. The temporary pdf.js document used to read page sizes is always destroyed, after its reads have finished, even when reading fails. A drawing's blob URL is not revoked (as before): a viewer finishing a deferred load may still be reading it, and pdf.js throws if it disappears. Each opened drawing therefore stays in memory until the page is reloaded.
  - **Viewers.** Both Lab viewers (Stage A capture and the review workspace) pass `deferDestroyUntilLoaded` to the shared `PdfEvidenceViewer`. A viewer that unmounts while its document is still loading (for example, when locking a reference or importing a backup) destroys that document only after the load settles. pdf.js 4.7 throws an uncaught "Worker was terminated" inside its worker when a document is destroyed mid-load. The prop is opt-in: the production review screen does not pass it, and its teardown is unchanged.
  - **Engine run in progress.** An engine run already running when the Lab closes finishes, is frozen and stored, and then destroys its document.
- **Import counts.** An import reports only what it actually added; re-importing a file that is already stored says there was nothing new.

## Track B (in-house engine + AI review) — UNAVAILABLE
The data contract is defined and tested. No AI call exists anywhere in the lab, and the UI shows Track B as *Unavailable*.

- **Contract.** `src/lib/measurement-lab/aiTrack.ts`, schema `cunstruct.lab-ai-run.v1`. A Track B run:
  - references its Track A run by `run_id` and `output_sha256`;
  - records:
    - provider, model, model version and configuration;
    - prompt version;
    - request and response hashes;
    - status: complete, incomplete or failed;
    - tokens, cost and retries;
  - lists each measurement as kept, changed, added or removed, with a rationale.
- **What the schema refuses:**
  - prices or BOQ quantities;
  - `verified: true`;
  - measurements on a failed response.
- **Integration point** if it is ever enabled: the existing `supabase/functions/ai-analysis` edge function. The key stays server-side.
- **Prerequisites before enabling:**
  - explicit owner authorization for paid calls;
  - a server-side admin check;
  - a cost cap.

## Metrics (all with raw counts and explicit denominators)
*Measurable* means a reference with status OK, which is the same as *derivable*. Ambiguous and non-derivable references are never counted as failures. They appear only in the *accepted on non-measurable* line.

| metric | numerator / denominator |
|---|---|
| detection recall | measurable references matched by any engine measurement / measurable |
| value accuracy | matched with the correct value / matched |
| line, endpoints | correct line (or endpoints) / matched |
| association | correct association / matched measurable references for which the engine produces an association |
| **correct coverage** | correctly accepted / measurable |
| correct acceptance | correctly accepted / accepted (matched to a measurable reference) |
| **incorrect acceptance rate** | incorrectly accepted / accepted |
| correctly held, unnecessarily held, missed | count / measurable |
| review burden | references still needing human review / measurable; held + rejected engine measurements / all engine measurements on the drawing |
| accepted on non-measurable | accepted / non-measurable references |

**Matching.** A measurement matches a reference by position first: the text anchor must be within 12 pt. An equal value is preferred when several candidates are in range.

## Storage and backup
- **Where data lives.** This browser only, in IndexedDB database `cunstruct-measurement-lab` v3, with stores `runs`, `events`, `refEvents` and `deferEvents` (v3 only adds `deferEvents`; existing data is kept). This was an owner decision.
- **Durability.** The lab calls `navigator.storage.persist()` and shows the result and the usage. Without persistence the browser **may clear the data under storage pressure**.
- **Back up regularly.** Use **Export backup**, which writes `cunstruct.lab-export.v3`: runs, the verdict log, the reference log and the defer log. Older `v2` backups (no defer log) still import.
- **Importing a backup:**
  - **Integrity.** Every run hash and both hash chains are re-verified *before* anything is written. A tampered file is refused.
  - **Wrong drawing.** A backup for another drawing is refused.
  - **No overwriting.** Existing records are never overwritten. A diverging log is refused, and re-importing the same file is a no-op.
- **Not covered:**
  - sharing between reviewers or devices;
  - server-side audit;
  - recovery if the browser profile is lost without an export.

### Proposal: Supabase persistence (not implemented, needs approval)
- **Tables:**
  - `lab_runs`: run_id PK, drawing_sha256, engine_id, output_sha256, the measurements as jsonb, created_by, created_at;
  - `lab_reference_events` and `lab_verdict_events`: id, drawing_sha256, seq, prev_hash, hash, body jsonb, reviewer_id = auth.uid(), created_at; UNIQUE(drawing_sha256, seq).
- **RLS.** INSERT and SELECT are allowed only where `has_role(auth.uid(),'admin')`. There are **no UPDATE or DELETE policies**, so the logs are append-only at the database level. A trigger checks that `prev_hash` equals the previous row's `hash`.
- **Migration.** A new file in `supabase/migrations/`, with existing files left unedited. Then regenerate `types.ts`.
- **Recovery.** Import from today's `cunstruct.lab-export.v2` files through the same `checkImport` validation, with a server-side re-check of the hashes.

## Authorization
- **Client side.** The launcher renders only for the `admin` role. The panel re-checks `user && roles.includes("admin")`; otherwise it renders a denial. The reviewer identity is `user.id` from `AuthContext`.
- **Server side.** Not applicable today: the lab makes no server calls, and the lazy chunk contains only code. This becomes required if the Supabase proposal or Track B is enabled.
- **Verified against real Supabase auth (non-production).** The release production bundle was run against a local Supabase stack: GoTrue, PostgREST and Postgres, with this repository's migrations applied. Real accounts signed in through `/auth`:
  - **signed out:** redirected to `/auth`;
  - **contractor:** "Operations access required";
  - **ops:** the workstation works, but there's no Lab button, and the Lab chunk is never downloaded;
  - **admin:** the full workflow works, with the reviewer recorded as the real user, and no write requests to the database.

  Self-granting `admin` through the API is refused by row-level security for ops and contractor accounts. The unit tests mock `useAuth`.

## Guarantees and their tests
| guarantee | where |
|---|---|
| Neither engine is modified: all 12 frozen files are byte-identical to their original commits and self-contained, and nothing outside the lab imports them | `baselineIntegrity.test.ts` |
| Engine outputs are frozen: deep-frozen, content-hashed and re-verified on load and import | `core.test.ts`, `labStore.test.ts` |
| Reference and verdict logs are append-only and hash-chained; tampering is detected | `reference.test.ts`, `core.test.ts`, `labStore.test.ts` |
| Stage A is engine-free: the reference module and the capture component import no engine | `reference.test.ts`, `MeasurementLabPanel.test.tsx` |
| Admin only and lazy-loaded: the engines appear only in the `MeasurementLabPanel` chunk (checked in the production build) | `MeasurementLabPanel.test.tsx`, `evidenceContract.test.ts` |
| No path to the BOQ, pricing, exports, analysis runs, apply-review, Supabase or AI | `baselineIntegrity.test.ts`, `aiTrack.test.ts`, `evidenceContract.test.ts` |
| Both engines reproduce: repeated runs give identical output hashes, in the browser and headless | `core.test.ts`; `labCompare.ts --repeat` |
| Inspector facts are labelled available / derived / missing / unresolved; corrections never change the frozen engine value; receipts show before → after | `record.test.ts`, `MeasurementReviewWorkspace.test.tsx` |
| Review status comes only from verdicts; navigation, filters and the saved place (corrupt or blocked storage tolerated) | `reviewState.test.ts`, `MeasurementReviewWorkspace.test.tsx` |
| Correction lifecycle: frozen output immutable; correction stored separately with reason, reviewer and time; original recoverable; survives export/import with every hash; tampering refused; never overwrites | `correctionLifecycle.test.ts` |
| Resume identity is the content fingerprint (renamed copy resumes; same name with other content does not; fingerprint failure opens nothing) | `reviewState.test.ts`, `MeasurementLabPanel.test.tsx` |
| PDF lifecycle: the latest open wins; temporary documents are always destroyed; Lab viewers never destroy a document mid-load; the production default teardown is unchanged | `MeasurementLabPanel.test.tsx`, `PdfEvidenceViewer.lifecycle.test.tsx` |
| Shortcuts never fire while typing, never record Incorrect/Unclear without a reason, and never reach the workstation behind the Lab | `MeasurementReviewWorkspace.test.tsx`, `MeasurementLabLauncher.test.tsx` |

**Headless equivalent.** This uses the same core and gives identical hashes:
```bash
npx vite-node --root . scripts/accuracy/mq/labCompare.ts --pdf <drawing.pdf> --pages 1,3,4 --reference <gold-set.json> --out <private dir> --repeat
```
