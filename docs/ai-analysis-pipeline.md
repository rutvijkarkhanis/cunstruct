# AI drawing-analysis pipeline

How Cunstruct generates a `cunstruct.analysis.v1` review run from uploaded
drawings via OpenAI, and the safeguards that make it safe to expose a
paid, external API call to a product feature.

## Where it runs

`supabase/functions/ai-analysis/index.ts` — a Supabase Edge Function, the
same pattern as `whatsapp-send`/`whatsapp-webhook`. `vercel.json` shows this
app is deployed to Vercel as a pure static SPA (no serverless routes), so a
Vercel API route was never an option; Supabase Edge Functions are the
existing, already-proven place server-side secret-using code runs.

`OPENAI_API_KEY` is a Supabase Edge Function secret. It is read once via
`Deno.env.get("OPENAI_API_KEY")`, never logged, never returned in a
response, and never referenced from anything under `src/` (enforced
structurally: the model/pricing config and the OpenAI client both live only
under `supabase/functions/_shared/`, which nothing in `src/` imports).

Every request to the function runs **as the calling user** — their JWT is
forwarded and used to build the Supabase client (anon key + `Authorization`
header), so every read/write goes through the exact same RLS policies as
the rest of the app. No service-role key is used anywhere in this feature.
Concretely: only staff (`ops`/`admin`) can write `analysis_run` /
`analysis_review_item` / `analysis_run_source` (the existing "staff manage"
RLS policies), so only staff can actually trigger a generation — a project
owner can call `preflight` (owner-read RLS) but `generate` fails at the
first insert for them, exactly like the existing JSON-import path already
requires staff.

## Compound identity: what decides "already analysed"

A file is only ever re-sent to OpenAI when **either** half of this changes:

1. **Content** — SHA-256 of the actual bytes, computed server-side. Never
   the filename, folder, upload timestamp, or document id. Renaming a file,
   moving it to a different folder, or re-uploading it as a "new" document
   all produce the same hash and are therefore recognised as the same file.
2. **Contract** — `ANALYSIS_CONTRACT_VERSION` (`supabase/functions/_shared/contract.ts`)
   + provider + model. Bumping the contract version (a deliberate prompt/
   schema/extraction-rule change) makes every previously-analysed file
   eligible again as ordinary "new work" — this is how a real upgrade
   propagates, without needing a separate "force" flag for it.

The hash is computed **on demand**, inside the edge function, by
downloading the file's bytes from the private `project-drawings` storage
bucket (via the same RLS-respecting client) and hashing with
`crypto.subtle.digest("SHA-256", …)`. It is never accepted from the client.
The upload pipeline itself (`ProjectDocuments.tsx`, `drawingStorage.ts`) is
untouched — hashing is entirely a read-side concern of this feature, so the
freshly-verified folder-upload flow has zero exposure to this change.

### Folders are organizational metadata only

This branch combines the document-folders feature (`claude/document-folders`)
with this pipeline. `loadEligibleFiles()` in `index.ts` reads
`project_document.folder_id` and resolves it to a breadcrumb (`folderBreadcrumb()`,
re-exported unmodified from `src/lib/documentFolders.ts` via
`supabase/functions/_shared/folderContext.ts` — same reuse pattern as the
parser) **purely to label the preflight response** for the "Review files"
list. That breadcrumb is attached to the response *after* `computePreflight()`
has already run — `EligibleFile`/`LedgerRow` (the identity/dedup types) have
no folder-shaped field at all, so there is no code path by which a folder
move, rename, or reorganization can affect content hashing, duplicate
detection, claiming, or `analysis_run`/`analysis_run_source` identity. This
is verified by `src/lib/ai/preflight.test.ts` (folder never enters
`computePreflight`'s inputs) and was additionally checked empirically against
a "Floor 1/Floor 2/Floor 3 + a byte-identical duplicate uploaded into a
different folder" scenario before this branch existed.

## The ledger: `analysis_run_source`

One new table (`supabase/migrations/20260923000000_ai_analysis_pipeline.sql`)
does three jobs at once, deliberately unified rather than split, because
they're really one fact — "this exact file content, under this exact
contract/model, was already claimed for analysis":

| Question | Answered by |
|---|---|
| Duplicate/cost protection — has this content already been analysed under this contract? | The row's existence + `status` |
| Concurrency/idempotency — is another request processing this right now? | `status = 'PROCESSING'` blocks a second claim |
| Source provenance — which document/revision/filename produced which run? | `document_id`, `document_revision_id`, `filename_at_time_of_analysis`, `analysis_run_id` |

A `unique (project_id, content_hash, contract_version, provider, model)`
constraint is the actual concurrency control: claiming a file is a plain
`INSERT … status='PROCESSING'`. Two tabs, a double-click, or a retry race on
that insert — Postgres lets exactly one succeed. The loser sees a unique-
violation (`error.code === "23505"`), re-reads the existing row, and:

- `SUCCEEDED` → treated as a duplicate-already-analysed, skipped;
- `PROCESSING` → treated as in-flight, skipped (never re-sent) — **unless
  stale**, see below;
- `FAILED` → retryable, via a **conditional** `UPDATE … WHERE status='FAILED'`
  that only succeeds for whoever wins that race too.

`SUCCEEDED` is never overwritten by anything but a genuine new contract/
model/content combination (a new unique key). Nothing ever "un-succeeds" a
row in place.

### Stale PROCESSING recovery

A `PROCESSING` claim is made right before the edge function starts its real
work (downloading bytes, calling OpenAI, persisting the result) and is only
ever resolved to `SUCCEEDED`/`FAILED` at the end. If the function is killed
mid-flight — a crash, or Supabase's hard wall-clock execution limit — that
row would otherwise stay `PROCESSING` forever, permanently blocking that
exact (project, content, contract, model) combination from ever being
retried, since only `FAILED` was originally reclaimable.

Fix: `STALE_PROCESSING_MS` (10 minutes, `index.ts`) — a `PROCESSING` claim
whose `claimed_at` is older than this is treated exactly like `FAILED`:
reclaimable. No new column was needed; `analysis_run_source.claimed_at`
already existed and is simply reused as the liveness timestamp, updated to
`now()` on every successful claim *and* every successful reclaim.

10 minutes was chosen as comfortably above (a) Supabase Edge Functions' own
execution wall-clock limit (a few minutes) and (b) how long an OpenAI
Responses call over a handful of PDFs realistically takes — so a claim still
`PROCESSING` past that point is not "just slow," it's dead.

The reclaim condition — `status = 'FAILED' OR (status = 'PROCESSING' AND
claimed_at < now() - 10m)` — is built by `buildStaleReclaimFilter()` in
`supabase/functions/_shared/claiming.ts` and applied as the WHERE clause of
one conditional `UPDATE`, the same mechanism `FAILED` retry already used.
This preserves every invariant `FAILED` retry already had:

- **A genuinely live claim stays protected** — its `claimed_at` is recent,
  so the PROCESSING branch of the filter doesn't match it.
- **Concurrent reclaim attempts still can't double-claim** — Postgres takes
  a row lock on the first `UPDATE` to reach the row; a second, concurrent
  `UPDATE` targeting the same row blocks until the first commits, then
  re-evaluates the *same* WHERE clause against the now-committed row (whose
  `claimed_at` the first `UPDATE` just set to "now") — so the second one's
  `claimed_at < cutoff` condition is now false, and it correctly claims
  nothing. No extra locking beyond the `UPDATE` itself was added.
- **`SUCCEEDED` never matches** — the filter has no `SUCCEEDED` branch at
  all, by construction (`claiming.test.ts` asserts the built filter string
  never contains the word `SUCCEEDED`).

`computePreflight()` uses the identical rule (`isStale()`, the same function
the DB filter is built from) to decide whether to show a `PROCESSING` file
as "in flight" (protected) or as sendable ("new") — so the preflight display
never lies about a file being stuck in-flight forever when Generate would
actually be able to unstick it.

## Preflight — before any OpenAI call

`supabase/functions/_shared/preflight.ts` (`computePreflight`) is a pure
function (no I/O) that takes the project's eligible files and the current
ledger and returns, honestly:

- total project files, total eligible drawings, files still missing a hash;
- which files are already analysed, new, in-flight, or duplicates of each
  other (by content hash — two differently-named/foldered files with
  identical bytes are sent **once**);
- what `generate` would actually send right now (`willSend`).

The `preflight` action returns this with **zero OpenAI calls**. If
`newFilesCount` is 0, the UI's Generate button turns into **"Open existing
analysis"**, which opens the most recent run directly — exactly the
"All uploaded files have already been analysed" behaviour required, with no
network call to OpenAI.

**Completeness** is reported honestly along two separate axes, never
collapsed into one score: *source coverage* (which uploaded files fed a
given run — always known, from the ledger) and *document completeness*
(does the upload set represent every drawing that exists for the project —
**always `UNKNOWN`**, because no document register exists anywhere in this
schema to compare against). The UI states this in words rather than
inventing a percentage.

## Model selection & cost — real server-side gating, not a UI flag

`supabase/functions/_shared/modelConfig.ts` holds the allowlist and pricing
table. It is **never imported from `src/`** — that, not the
`SHOW_INTERNAL_AI_CONTROLS` flag, is what actually keeps model ids and
pricing out of the client bundle (verified by grepping the production build
output — see the final report).

`resolveModel(requestedModel, isAdmin)` is the *only* place a client-
supplied model id can take effect, and only when `isAdmin` (checked by
querying `user_roles` for `role = 'admin'` with the caller's own RLS-scoped
client) is true **and** the id is in the allowlist; every other caller —
including an admin requesting an unknown id — gets `DEFAULT_MODEL`. No
user-supplied string ever reaches the OpenAI request unchecked.

`VITE_SHOW_INTERNAL_AI_CONTROLS` only controls whether the browser *asks*
for/renders the admin block. The response's `internal` field is present
**only** when the server has independently verified the caller is an admin
— a non-admin who flips the flag on gets `internal: undefined` and the
panel renders nothing extra, by construction (see `AiApiPanel.tsx`).

Pricing (`SUPPORTED_MODELS` in `modelConfig.ts`) was checked against
OpenAI's published per-token pricing as of **2026-09-13** (gpt-4o
$2.50/$10.00 per M input/output tokens, gpt-4o-mini $0.15/$0.60) — not
invented.

### Cost estimate: a range, not a point figure

The first version of this estimator used `byte_size ÷ 4` as an input-token
proxy. An audit flagged this as too crude for architectural PDFs: OpenAI's
Responses API renders each PDF page as **both** extracted text and a page
*image* (the `input_file` content type's `detail` field), and image tokens
are billed by tiling — 170 tokens/tile + an 85-token base charge per image
(OpenAI's published vision-pricing docs; e.g. a 1024×1024 image = 4 tiles =
765 tokens). Neither the exact render resolution/tile count OpenAI will
choose for a given page, nor the extracted-text volume (a blank elevation
vs. a dense door/window schedule), is knowable before the call — so a
single number would be false precision the API itself doesn't support
pre-call.

`estimateCostRange()` (`modelConfig.ts`) now uses `document_revision.page_count`
(already captured at upload time) as the basis, producing a **LOW/HIGH
range**: 300 tokens/page (≈1 tile, light text) to 1,500 tokens/page (≈4+
tiles, a detailed high-resolution page, more text), at whichever model's
published per-token rate applies. A file whose page count isn't known yet
(rare) falls back to the old byte-based proxy for that file only, and the
response's `basis` field (`"page_count"` vs `"mixed"`) tells the admin panel
when that happened. The UI (`AiApiPanel.tsx`) always renders this as
`$low–$high`, explicitly captioned "a range, not exact," never a bare
number — there is no code path that produces a single "the cost is $X"
figure pre-generation.

This is computed entirely server-side from server-loaded page counts/byte
sizes and the server-resolved model; the request body has no cost- or
token-related field at all, so the client has no channel to influence it —
verified by `src/lib/ai/modelConfig.test.ts`'s "the client cannot influence
the estimate" structural test.

Actual token usage is recorded on `analysis_run` (`input_tokens`,
`output_tokens`, `total_tokens`, `actual_cost_usd`) only after a real
OpenAI response comes back — a single real number, since at that point it's
no longer an estimate — and stays internal-only data. The persisted
`analysis_run.estimated_cost_usd` column (a single number, unchanged schema)
holds the midpoint of the range that was shown before Generate was clicked,
kept purely as an audit record next to the real `actual_cost_usd` beside it.

## Generation flow

1. `generate` recomputes eligibility/preflight itself — it never trusts a
   client-supplied file list beyond intersecting it with what the server
   independently determined is actually new and eligible.
2. Claims every file to send (see the ledger section above).
3. Downloads each claimed file's bytes and calls OpenAI's **Responses API**
   with a native PDF `input_file` (uploaded first via the Files API) and
   **Structured Outputs** (`text.format: json_schema, strict: true`,
   schema in `supabase/functions/_shared/openaiSchema.ts`) — so the model's
   raw output is schema-conformant JSON, not prose to scrape.
4. The raw JSON is run through **the existing, already-tested**
   `parseAnalysisV1` — re-exported unmodified from
   `src/lib/review/analysisSchemaV1.ts` (see "Reuse, not a second
   validator" below) — never a separate/looser check. A response that fails
   validation fails the whole claimed batch (`FAILED`, retryable);
   nothing partially-valid is ever persisted.
5. On success: one `analysis_run` (source `'ai_api'`, with
   `contract_version`/provider/model/token/cost columns filled in) +
   one `analysis_review_item` per item, built via the existing
   `buildReviewItems` — identical shape to a JSON-imported run, so the
   entire existing review workstation, evidence viewer, and Apply-to-BOQ
   flow work completely unchanged.
6. Each claimed ledger row flips to `SUCCEEDED` (linked to the new run) or
   `FAILED` (with a short error, no payload) — a partial-failure batch is
   never reported as fully successful; `skipped`/failed files stay
   retryable without resending the files that already succeeded.
7. The run's honest coverage (`sourceCoverage`) lists only the files that
   fed *this* run — never framed as a full-project analysis.

## Reuse, not a second validator

The spec is explicit that OpenAI's output must be validated by "the
EXISTING `parseAnalysisV1` parser" — not a second, possibly-drifting
implementation. Two small, behaviour-preserving edits made that literal
reuse possible from a Deno edge function, which has no `@/` path alias and
(unlike Vite) requires explicit file extensions on every relative import:

- `src/lib/review/analysisSchemaV1.ts`: `"@/lib/boqEvalJson"` →
  `"../boqEvalJson.ts"`
- `src/lib/review/reviewQueue.ts`: `"./analysisSchemaV1"` →
  `"./analysisSchemaV1.ts"`

Both are pure path-syntax changes (same resolved file, verified identical
behaviour by the full pre-existing test suite passing unchanged).
`supabase/functions/_shared/analysisValidation.ts` then does
`export { parseAnalysisV1 } from "../../../src/lib/review/analysisSchemaV1.ts"`
— a straight re-export, not a copy, so there is no second implementation to
drift. `src/lib/ai/analysisValidation.test.ts` asserts the re-exported
function is `toBe()` (reference-equal to) the directly-imported one, and
separately proves a payload shaped exactly like `openaiSchema.ts`'s strict
JSON Schema parses cleanly through it.

`tsconfig.app.json` already had `allowImportingTsExtensions: true` set
before this change, which is what makes the explicit-extension imports
resolve identically under Vite/Vitest as well as Deno.

## Evidence

The extraction prompt (`buildAnalysisPrompt`, unchanged) already instructs
the model to omit evidence rather than fabricate it, and `parseAnalysisV1`
already drops any evidence entry without a valid bbox rather than inventing
one. This feature adds nothing new here — it reuses the existing
prompt/schema/parser as-is, so an OpenAI-generated run gets exactly the
same "no evidence fabricated, PENDING when unsure" guarantees a
JSON-imported run already has. Whether OpenAI's real output reliably
includes usable bbox coordinates in practice is exactly what the manual
test below is for; nothing in this implementation assumes it does.

## What a normal user sees vs. what's internal

| | Normal user | Internal (admin, flag on, server-verified) |
|---|---|---|
| File counts (total/new/already-analysed) | ✅ | ✅ |
| Which files, by name, grouped by folder ("Review files") | ✅ | ✅ |
| Duplicate / in-flight counts | ✅ | ✅ |
| [Generate analysis] / [Open existing analysis] | ✅ | ✅ |
| Provider, model id | ❌ | ✅ |
| Contract version | ❌ | ✅ |
| Estimated cost (as a range) | ❌ | ✅ |
| Force re-analyse | ❌ | ✅ |
| Token counts, actual cost, raw API config | ❌ (nowhere in the UI at all) | — (DB-only; not surfaced even to admin UI in this iteration) |

Folder names/paths are **not** treated as sensitive — they're the user's own
organizational metadata, shown to every user via `willSendFiles`/
`alreadyAnalysedFiles`' `folderPath` field, grouped under a heading like
"Floor 2" in `AiApiPanel.tsx`'s "Review files" list. This is a display-only
grouping computed from `project_document.folder_id` after the identity/cost
logic has already run — see "Folders are organizational metadata only" above.

## Known limitations (not addressed in this milestone)

- **Cross-run reconciliation.** If files are analysed incrementally (run 1
  covers documents A–L, run 2 covers M–T added later), the two runs are
  never merged into one coherent analysis — each `analysis_run` is
  independent by design (never resend a succeeded file), and
  `latestRunForBoq()`/the review workstation only ever load the single most
  recent run for a BOQ. A reviewer opening the workstation after run 2 will
  not see run 1's items. This is a known, deliberate scope boundary — not
  solved here, not to be solved by resending succeeded files, and not a
  change to the cost-safety model. Source coverage per run stays honest
  (`sourceCoverage` never claims to cover files it didn't).
- **No per-request file-count/size cap.** A single Generate call sends every
  currently-new eligible file in one OpenAI request; there is no batching
  or graceful degradation if a project's new-file set is too large for one
  request/model context. For the first real test, keep the selected set
  small (see "Manual verification" below).

## Manual verification (the one real OpenAI call)

Automated tests never call OpenAI — every test above mocks the network
boundary (`analysisClient.ts` in the browser tests, or tests the pure
`_shared` logic directly). To verify the real integration end-to-end,
**intentionally and manually**:

1. Deploy this branch's edge function: `supabase functions deploy ai-analysis`.
2. Set the secret: `supabase secrets set OPENAI_API_KEY=sk-...`.
3. Apply the migration: `supabase db push` (or run
   `20260923000000_ai_analysis_pipeline.sql` via the dashboard).
4. In the app, open a project with `ai_processing_enabled = true` and at
   least one uploaded PDF drawing, as an `ops`/`admin` user.
5. Open a BOQ → Review → **Use AI API**. Confirm the preflight counts match
   what you expect (new vs. already-analysed).
6. Click **Generate analysis** exactly once. Confirm:
   - exactly one `analysis_run` row is created (`source='ai_api'`), with
     `contract_version`/`model`/token/cost columns populated;
   - one `analysis_run_source` row per file, `status='SUCCEEDED'`;
   - the review workstation opens with the generated items, and Verify/
     Edit/Flag/Evidence all behave identically to a JSON-imported run.
7. Reload the page and re-open **Use AI API** for the same project *without
   uploading anything new*: confirm it now shows "All uploaded files have
   already been analysed" and Generate makes **no** OpenAI call (check the
   OpenAI dashboard's usage log shows no new request).
8. Optional: as an admin with `VITE_SHOW_INTERNAL_AI_CONTROLS=true`, toggle
   **Force re-analyse** and confirm it (and only it) resends the same file
   under the same contract, creating a second `analysis_run_source` row for
   the same content hash.

This is the first point at which the exact OpenAI Responses API request
shape (`input_file` + `text.format: json_schema`) and the schema in
`openaiSchema.ts` get exercised against the real API — they could not be
exercised automatically without spending real credits, so treat step 6 as
the acceptance test for that wiring specifically, not just a smoke test.
