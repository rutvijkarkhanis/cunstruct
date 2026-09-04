# Cunstruct Security Foundation

Status: **internal, pre-customer-facing.** This document describes the security
boundary Cunstruct is building *toward* future AI-assisted drawing analysis and
BOQ auditing. **No AI provider is integrated.** Nothing here claims the product
is "fully secure" or "zero-retention" — see the status breakdown at the end for
what is actually in place versus what remains.

---

## 1. Authorization model (as it exists today)

- **Auth:** Supabase Auth (email). Every request from the browser carries the
  user's JWT; the browser uses only the Supabase **publishable/anon key**.
- **Roles:** `user_roles` table with `contractor | site_engineer | ops | admin`.
  `public.is_staff(uid)` = ops/admin. `public.has_role(uid, role)`.
- **Project ownership:** `projects.owner_id` (a single user). There is **no
  organization/company table** — isolation is per-owner.
- **Isolation rule enforced in the database (RLS), not the frontend:**
  - **Staff (ops/admin)** manage all projects (the ops dashboard).
  - **A non-staff owner** may read only rows belonging to a project whose
    `owner_id = auth.uid()`, via a join to `projects`.
  - **Global catalogues** (`product`, `dsr_item`, `dsr_coefficient`,
    `stage_master`, `stage_material_mapping`, `boq_template`, `scope_module*`)
    are readable by any authenticated user — they contain no project data.

So: a user who knows Project B's id (or a BOQ id, or an `external_key`) still
cannot read Project B unless they own it or are staff. This is enforced by
Postgres RLS. See `src/lib/security/rlsPolicies.test.ts` for the assertions.

## 2. `external_key` is an identifier, not a capability

`boq_line.external_key` identifies a line so an external audit can be matched
back to it. It **never grants access.** Import matching only ever attaches a
finding to a line in the caller's **already-authorized** BOQ line set; an
`external_key` or `boq_line_id` referencing another project is dropped, never
persisted (`linkFindings`, tested in `src/lib/security/externalKeyAuth.test.ts`).

## 3. Documents & storage

- Today, drawing *analysis* enters as **pasted JSON** (`document_revision.source
  ∈ upload|paste|url`, `eval_json`). No Supabase Storage bucket is configured yet.
- `document_revision.file_path` / `external_url` columns exist for future file
  storage. **When storage is added it MUST be a private bucket** with short-lived
  signed URLs — never a permanent public URL for a confidential drawing. Signed
  URLs must not be logged or persisted. (Not yet implemented — no bucket exists.)

## 4. The future AI boundary (shape only, no provider)

Target architecture, encoded as interfaces in `src/lib/ai/aiBoundary.ts`:

```
Browser  →  Cunstruct server (Supabase Edge Function, Deno)  →  AI provider
```

Never `Browser → provider`, and **never `AI provider → database`.** The provider
holds **no** Cunstruct/Supabase credentials. The server:

1. authorizes the user for the project (RLS / role check),
2. selects the **minimum** inputs for the operation,
3. builds a provider request that is guarded against forbidden data,
4. calls the provider (future),
5. validates the returned JSON (existing `analysisJson` / `auditJson` validators),
6. stores the result under the project — under RLS.

- `AIAnalysisProvider` / `AIAuditProvider` are **empty interfaces** — no
  implementation, no SDK, no provider chosen.
- `buildProviderRequest()` enforces the **minimum-data principle**: only
  explicitly selected, classification-permitted items for the authorized project
  are included; credentials/PII are refused; a final guard rejects any payload
  containing service-role keys, API keys, Supabase URLs, etc.

## 5. Data classification (`src/lib/security/dataClassification.ts`)

| Class | Examples | May be sent to a provider? |
|---|---|---|
| `PUBLIC` | DSR/reference catalogues | Always |
| `CONFIDENTIAL` | project metadata, **drawings**, document content, BOQ, findings | Only when the project's `ai_processing_enabled` is true |
| `HIGHLY_CONFIDENTIAL` | credentials, user PII (email/phone) | **Never** |

Drawings are `CONFIDENTIAL` **by default**. `assertSendableToProvider()` is the
gate a future AI path must call.

## 6. Secrets

- **Client-safe (ship to the browser):** only `VITE_`-prefixed vars — the
  Supabase URL, publishable key, and app URLs. See `docs/environment-variables.md`.
- **Server-only (never `VITE_`, never in the bundle, never in the DB):** the
  Supabase **service-role** key and all future **AI provider API keys**. These
  live in Supabase Edge Function env (`Deno.env.get(...)`) or the deploy
  platform's secret store. The existing WhatsApp functions are the precedent
  (`SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_ACCESS_TOKEN`).
- The committed `.env` holds **only** publishable `VITE_` keys (safe to version).
  `.gitignore` now blocks `.env.local` / `.env.*.local` so a server secret can't
  be committed by accident. Enforced by `src/lib/security/secrets.test.ts`.

## 7. Minimum-data & no-DB-access (hard rules)

- The AI provider receives **only** the explicitly selected inputs for one
  operation — never other projects, the supplier/product tables, the whole user
  base, the rate database, or app secrets.
- The AI provider has **no database credentials**. There is no `AI → Supabase`
  path. Even a successful prompt injection cannot reach another project, because
  the provider simply has nothing to authenticate with.

## 8. Untrusted input / prompt injection (principle, not a system)

Uploaded/pasted document content is **untrusted input**. The defense is
architectural, not clever prompting: the AI layer has no credentials and no
database access, and all provider output is re-validated by Cunstruct's
deterministic JSON validators before it touches the BOQ. A valid-looking payload
still has to pass schema/enum/quantity validation **and** RLS for the authorized
project.

## 9. Audit trail (`ai_operation_log`, `src/lib/security/auditTrail.ts`)

Records safe metadata for sensitive operations: user, project, operation,
resource type/id, abstract provider/model label, status, correlation id,
timestamp. It stores **no document content, no prompts, no AI responses.** Used
today for `audit.import`; ready for future `analysis.request` / `audit.request`.
Owner-readable for transparency; staff-managed.

## 10. Logging (`src/lib/security/safeLog.ts`)

One small utility emits metadata only and scrubs forbidden keys (tokens, secrets,
prompts, responses, signed URLs, drawing content, email/phone). Existing edge
functions were fixed to stop logging an access-token prefix/length, full API
response bodies, and raw phone numbers.

## 11. Retention & deletion (`src/lib/security/projectDeletion.ts`)

Project data cascades from the `projects` row via `on delete cascade`, so
`deleteProjectAndData(projectId)` (RLS-enforced: staff only) removes a project's
scopes, documents, revisions, BOQs, lines, audit runs/findings, rooms, forecasts,
catalog gaps and AI operation log — and nothing from another project. What
survives by design (e.g. sales-order history, document-derived null refs) is
documented in that file. Cascade integrity is asserted in
`projectDeletion.test.ts`.

---

## Status breakdown

### A. Implemented now
- Per-owner project isolation via RLS across all project-scoped tables (verified
  by tests over the migration artifacts).
- `external_key` proven non-authorizing; foreign line refs dropped on import.
- Data-classification model + provider-send gate.
- Provider-agnostic AI boundary interfaces + minimum-data request builder + a
  forbidden-data guard (no provider, no SDK).
- `ai_operation_log` audit trail + safe logging utility; edge-function log leaks
  fixed.
- `.gitignore` hardening; secret-exposure scan test.
- Project-scoped deletion helper backed by the existing cascade FKs.
- `projects.ai_processing_enabled` switch (default off).

### B. Depends on AI provider selection
- The actual `AIAnalysisProvider` / `AIAuditProvider` adapters and their
  server-side (Edge Function) implementation.
- Provider API key handling, model/config choices, provider retention terms.
- Whether/what data leaves the region; DPA and enterprise terms.

### C. Required before customer launch
- Private Storage bucket + short-lived signed-URL access for real drawing files
  (no bucket exists yet).
- A real per-project **AI consent** flow (the `ai_processing_enabled` flag is the
  backend hook only; there is no consent UI, and none should be claimed).
- Legal/privacy review of retention, PII handling (customer phone numbers already
  flow through WhatsApp), and any provider data-processing agreement.
- Server-side write path for `ai_operation_log` (today it's written from the
  authenticated client under RLS; sensitive AI ops should be logged server-side).
- Penetration test of RLS with real multi-tenant data; consider organization
  tenancy if projects will be shared across a company.

### D. Not yet implemented (intentionally)
- Any AI/LLM/OpenAI/Anthropic/Gemini integration, PDF parsing, OCR, CV.
- SSO, SOC 2, SIEM/DLP, KMS, customer consent workflow, compliance certifications.
- Organization/multi-tenant model beyond per-owner isolation.

**Do not represent Cunstruct as "secure", "confidential", or "zero-retention" to
customers on the basis of this foundation.** It makes the app *structurally
ready* for a secure AI integration; the claims depend on items in B and C.
