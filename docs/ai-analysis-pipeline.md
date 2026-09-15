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
- `PROCESSING` → treated as in-flight, skipped (never re-sent);
- `FAILED` → retryable, via a **conditional** `UPDATE … WHERE status='FAILED'`
  that only succeeds for whoever wins that race too.

`SUCCEEDED` is never overwritten by anything but a genuine new contract/
model/content combination (a new unique key). Nothing ever "un-succeeds" a
row in place.

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
invented. `estimateCostUsd()` is explicitly a pre-generation estimate (byte
size ÷ 4 as a token proxy, plus an assumed output-token count) and the UI
labels it "Estimated cost", never "Exact cost" — actual token usage is
recorded on `analysis_run` (`input_tokens`, `output_tokens`, `total_tokens`,
`actual_cost_usd`) only after a real OpenAI response comes back, and stays
internal-only data.

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
| Which files, by name ("Review files") | ✅ | ✅ |
| Duplicate / in-flight counts | ✅ | ✅ |
| [Generate analysis] / [Open existing analysis] | ✅ | ✅ |
| Provider, model id | ❌ | ✅ |
| Contract version | ❌ | ✅ |
| Estimated cost | ❌ | ✅ |
| Force re-analyse | ❌ | ✅ |
| Token counts, actual cost, raw API config | ❌ (nowhere in the UI at all) | — (DB-only; not surfaced even to admin UI in this iteration) |

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
