# Measurement Lab (inside the BOQ Review Workstation)

**What it is.** An admin-only evaluation panel, opened from the **Measurement Lab** button in `/ops/boqs/:boqId/review`. It appears both in the header and on the import screen. The lab measures the measurement engines. It never changes an engine, the BOQ, prices, exports or analysis runs.

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
Run both engines unchanged:
- **1de95f6**, the recovered engine: a frozen verbatim copy in `src/lib/measurement-lab/baselines/engine-1de95f6/`.
- **9ac1f71**, the current engine: `src/lib/review`.

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
- **Where data lives.** This browser only, in IndexedDB database `cunstruct-measurement-lab` v2, with stores `runs`, `events` and `refEvents`. This was an owner decision.
- **Durability.** The lab calls `navigator.storage.persist()` and shows the result and the usage. Without persistence the browser **may clear the data under storage pressure**.
- **Back up regularly.** Use **Export backup**, which writes `cunstruct.lab-export.v2`: runs, the verdict log and the reference log.
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
- **Not verified against real Supabase auth.** No test credentials were available, and `.env` points at production. The automated tests mock `useAuth`, and the browser checks used a stub login.

## Guarantees and their tests
| guarantee | where |
|---|---|
| Neither engine is modified: the current core files keep their frozen hashes, and the 1de95f6 copies match the original commit apart from the header and import paths | `baselineIntegrity.test.ts` |
| Engine outputs are frozen: deep-frozen, content-hashed and re-verified on load and import | `core.test.ts`, `labStore.test.ts` |
| Reference and verdict logs are append-only and hash-chained; tampering is detected | `reference.test.ts`, `core.test.ts`, `labStore.test.ts` |
| Stage A is engine-free: the reference module and the capture component import no engine | `reference.test.ts`, `MeasurementLabPanel.test.tsx` |
| Admin only and lazy-loaded: the engines appear only in the `MeasurementLabPanel` chunk (checked in the production build) | `MeasurementLabPanel.test.tsx`, `evidenceContract.test.ts` |
| No path to the BOQ, pricing, exports, analysis runs, apply-review, Supabase or AI | `baselineIntegrity.test.ts`, `aiTrack.test.ts`, `evidenceContract.test.ts` |
| Both engines reproduce: repeated runs give identical output hashes, in the browser and headless | `core.test.ts`; `labCompare.ts --repeat` |

**Headless equivalent.** This uses the same core and gives identical hashes:
```bash
npx vite-node --root . scripts/accuracy/mq/labCompare.ts --pdf <drawing.pdf> --pages 1,3,4 --reference <gold-set.json> --out <private dir> --repeat
```
