// AI ANALYSIS — the ONLY place Cunstruct calls OpenAI to generate a drawing
// analysis. Runs server-side (Supabase Edge Function / Deno); OPENAI_API_KEY
// lives only in this function's environment and is never returned to a
// caller, logged, or embedded in a response.
//
// Every request runs AS the calling user (their JWT is forwarded to a
// Supabase client built with the anon key — see `authedClient` below), so
// every read/write here goes through the SAME RLS policies as the rest of
// the app: only staff (ops/admin) can write analysis_run/analysis_review_item
// /analysis_run_source (existing "staff manage" policies), so only staff can
// actually trigger a generation — a project owner can request `preflight`
// (owner-read RLS) but `generate` will fail at the insert step for them,
// exactly like the existing JSON-import path already requires staff.
//
// Three actions, one endpoint (`{ action: "preflight" | "generate" |
// "model_config", ... }`):
//   preflight     — the ONLY thing a normal user sees: counts, no OpenAI call.
//   generate      — claims new eligible files (DB-enforced, idempotent) and
//                   calls OpenAI for exactly those; never re-sends a file
//                   already SUCCEEDED or currently PROCESSING elsewhere.
//   model_config  — admin-only; returns the model allowlist for the internal
//                   controls panel. A non-admin caller gets 403 — the
//                   SHOW_INTERNAL_AI_CONTROLS client flag is presentation
//                   only, this is the real gate.
//
// See docs/ai-analysis-pipeline.md for the full design write-up.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.22.4";
import { ANALYSIS_CONTRACT_VERSION, DEFAULT_PROVIDER, resolveAnalysisMode, modeRequiresBoqScope, type AnalysisMode } from "../_shared/contract.ts";
import { DEFAULT_MODEL, SUPPORTED_MODELS, actualCostUsd, estimateCostRange, resolveModel } from "../_shared/modelConfig.ts";
import { computePreflight, resolveRequestedToSend, type EligibleFile, type LedgerRow } from "../_shared/preflight.ts";
import { parseAnalysisV1, buildReviewItems } from "../_shared/analysisValidation.ts";
import { generateAnalysisViaOpenAI } from "../_shared/openaiClient.ts";
import { CUNSTRUCT_ANALYSIS_JSON_SCHEMA, CUNSTRUCT_OBSERVATION_JSON_SCHEMA, CUNSTRUCT_IDENTIFY_JSON_SCHEMA, CUNSTRUCT_FIND_SIMILAR_JSON_SCHEMA } from "../_shared/openaiSchema.ts";
import { canSendToProvider } from "../../../src/lib/security/dataClassification.ts";
import { buildAnalysisPrompt, buildObservationPrompt } from "../../../src/lib/review/analysisPrompt.ts";
import { buildIdentifyPrompt } from "../../../src/lib/review/identifyPrompt.ts";
import { parseIdentifyResultV1 } from "../../../src/lib/review/identifySchemaV1.ts";
import { handleFindSimilar } from "./findSimilarHandler.ts";
import { folderBreadcrumb } from "../_shared/folderContext.ts";
import { buildStaleReclaimFilter } from "../_shared/claiming.ts";
import { parseObservationsV1 } from "../_shared/observationValidation.ts";
import { resolveObservationSource, type ClaimedFile } from "../_shared/observationSource.ts";

// A PROCESSING claim with no completed_at older than this is presumed dead
// (the edge function that made it crashed/timed out) and becomes reclaimable,
// same as a FAILED one — see reclaimIfEligible() and docs/ai-analysis-pipeline.md
// "Stale PROCESSING recovery". Supabase Edge Functions are killed at a hard
// wall-clock limit (a few minutes); comfortably above that and above the time
// an OpenAI Responses call over a handful of PDFs realistically takes.
const STALE_PROCESSING_MS = 10 * 60 * 1000; // 10 minutes

const DRAWINGS_BUCKET = "project-drawings";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const BodySchema = z.object({
  action: z.enum(["preflight", "generate", "model_config", "identify", "find_similar"]),
  projectId: z.string().uuid().optional(),
  boqId: z.string().uuid().nullable().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
  // Admin-only inputs — silently ignored for a non-admin caller (see resolveModel()).
  model: z.string().optional(),
  forceReanalyse: z.boolean().optional(),
  // Loosely typed here (any string passes shape validation) — the actual
  // BOQ/LOCATION/BOQ_AND_LOCATION enum check happens via resolveAnalysisMode()
  // below, which is also the single source of truth ANALYSIS_MODES itself
  // lives in (contract.ts), so this schema never drifts from it.
  mode: z.string().optional(),
  // Click-to-Identify only (action === "identify") — additive, optional,
  // ignored by every other action. A single document+page+point, never a
  // whole-project batch like generate's documentIds.
  documentId: z.string().uuid().optional(),
  page: z.number().int().positive().optional(),
  point: z.object({ x: z.number(), y: z.number() }).optional(),
  nearbyText: z.array(z.string()).max(12).optional(),
  // Find Similar only (action === "find_similar") — additive, optional,
  // ignored by every other action. The already-confirmed identification to
  // search for more occurrences of; reuses `documentId` above (the same
  // resolved document identify ran against) rather than a second field.
  reference: z.object({
    label: z.string().min(1),
    description: z.string().optional(),
    evidence: z.array(z.object({
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      page: z.number().int().positive().optional(),
      label: z.string().optional(),
      claim: z.enum(["general", "quantity", "dimension", "specification", "location"]).optional(),
    })).default([]),
  }).optional(),
});

interface ProjectRow {
  id: string;
  project_type: string | null;
  ai_processing_enabled: boolean;
}

interface EligibleRow {
  documentId: string;
  documentRevisionId: string;
  filename: string;
  filePath: string;
  contentHash: string | null;
  byteSize: number;
  pageCount: number | null;
  /** Folder names from root to this document's folder, e.g. ["Floor 2"] — or
   *  [] for Unfiled. DISPLAY ONLY: never read by computePreflight, the
   *  content hash, or the analysis_run_source claim key below. A document
   *  moved between folders keeps the same documentId/contentHash and is
   *  therefore never re-eligible because of this field. */
  folderPath: string[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Load every eligible (PDF, has a stored file) current revision for a project,
 *  hashing on demand any that don't have content_hash yet. The hash is always
 *  computed HERE, server-side, from bytes downloaded from storage — a client
 *  can never supply or influence it. Persisting the hash is best-effort (an
 *  owner-only caller may lack write RLS on document_revision; the freshly
 *  computed value is still used for this request either way). */
async function loadEligibleFiles(supabase: SupabaseClient, projectId: string): Promise<{ totalProjectFiles: number; eligible: EligibleRow[] }> {
  const { data: docs, error: docsErr } = await supabase
    .from("project_document")
    .select("id, name, current_revision_id, folder_id")
    .eq("project_id", projectId);
  if (docsErr) throw docsErr;

  const docIds = (docs ?? []).map((d) => d.id);
  const { data: revs, error: revsErr } = docIds.length
    ? await supabase
        .from("document_revision")
        .select("id, document_id, file_path, mime_type, file_size, original_filename, content_hash, page_count")
        .in("document_id", docIds)
    : { data: [], error: null };
  if (revsErr) throw revsErr;

  // Folder rows are fetched purely to build a display breadcrumb (see
  // EligibleRow.folderPath) — never consulted for identity/eligibility.
  const { data: folders, error: foldersErr } = await supabase
    .from("document_folder")
    .select("id, project_id, parent_id, name, sort")
    .eq("project_id", projectId);
  if (foldersErr) throw foldersErr;

  const revById = new Map((revs ?? []).map((r) => [r.id, r]));
  const eligible: EligibleRow[] = [];
  for (const d of docs ?? []) {
    const r = d.current_revision_id ? revById.get(d.current_revision_id) : undefined;
    if (!r || !r.file_path) continue;
    const looksLikePdf = r.mime_type === "application/pdf" || /\.pdf$/i.test(r.original_filename ?? d.name ?? "");
    if (!looksLikePdf) continue;

    let contentHash: string | null = r.content_hash ?? null;
    if (!contentHash) {
      const { data: blob, error: dlErr } = await supabase.storage.from(DRAWINGS_BUCKET).download(r.file_path);
      if (dlErr || !blob) continue; // unavailable file — not eligible this run, not a fatal error
      const bytes = new Uint8Array(await blob.arrayBuffer());
      contentHash = await sha256Hex(bytes);
      // Best-effort cache; ignore failure (e.g. an owner-only caller without write RLS).
      await supabase.from("document_revision").update({ content_hash: contentHash }).eq("id", r.id);
    }

    eligible.push({
      documentId: d.id,
      documentRevisionId: r.id,
      filename: r.original_filename ?? d.name,
      filePath: r.file_path,
      contentHash,
      byteSize: r.file_size ?? 0,
      pageCount: r.page_count ?? null,
      folderPath: folderBreadcrumb(d.folder_id ?? null, folders ?? []),
    });
  }
  return { totalProjectFiles: (docs ?? []).length, eligible };
}

/** Resolve + download ONE document's current revision file, for the
 *  Click-to-Identify action — deliberately NOT loadEligibleFiles (that
 *  function does project-wide content-hashing/dedup for the batch BOQ/
 *  LOCATION claim machinery, none of which an on-demand single-point
 *  request needs). Throws a plain Error with a user-safe message on any
 *  failure — the caller maps it to a JSON error response. */
async function loadSingleDocumentFile(
  supabase: SupabaseClient, projectId: string, documentId: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const { data: doc, error: docErr } = await supabase
    .from("project_document")
    .select("id, name, current_revision_id, project_id")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (docErr) throw new Error(docErr.message);
  if (!doc || !doc.current_revision_id) throw new Error("Document not found in this project.");

  const { data: rev, error: revErr } = await supabase
    .from("document_revision")
    .select("id, file_path, original_filename")
    .eq("id", doc.current_revision_id)
    .maybeSingle();
  if (revErr) throw new Error(revErr.message);
  if (!rev || !rev.file_path) throw new Error("No drawing file is stored for this document.");

  const { data: blob, error: dlErr } = await supabase.storage.from(DRAWINGS_BUCKET).download(rev.file_path);
  if (dlErr || !blob) throw new Error("Failed to download the drawing file.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { filename: rev.original_filename ?? doc.name, bytes };
}

async function loadLedger(
  supabase: SupabaseClient,
  projectId: string,
  contractVersion: string,
  provider: string,
  model: string,
  mode: AnalysisMode,
  boqId: string | null,
): Promise<LedgerRow[]> {
  let query = supabase
    .from("analysis_run_source")
    .select("content_hash, status, document_id, filename_at_time_of_analysis, analysis_run_id, claimed_at")
    .eq("project_id", projectId)
    .eq("contract_version", contractVersion)
    .eq("provider", provider)
    .eq("model", model)
    // Scopes the ledger to this exact mode — the same pre-filter-before-
    // computePreflight convention contract_version/provider/model already
    // use (see computePreflight's opts.mode doc in preflight.ts). Without
    // this, a LOCATION-mode claim over a file would be seen as "already
    // analysed" by a BOQ-mode preflight for the same file, which is wrong:
    // they are separate analysis_run_source identities by design.
    .eq("mode", mode);
  // Phase A: BOQ/BOQ_AND_LOCATION claims are scoped per-BOQ (a document may
  // feed several disciplines' BOQs independently — see modeRequiresBoqScope's
  // doc and 20261001000000_analysis_run_source_boq_scope.sql). Filtering the
  // ledger by boq_id here is what makes computePreflight() (which just
  // trusts whatever ledger it's handed) agree with the DB's own partial
  // unique index on the same identity. LOCATION deliberately stays
  // project-wide/document-level — never filtered by boq_id — exactly its
  // pre-Phase-A behavior.
  if (modeRequiresBoqScope(mode)) {
    query = query.eq("boq_id", boqId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    contentHash: r.content_hash,
    status: r.status,
    documentId: r.document_id,
    filenameAtTimeOfAnalysis: r.filename_at_time_of_analysis,
    analysisRunId: r.analysis_run_id,
    claimedAtMs: new Date(r.claimed_at).getTime(),
  }));
}

async function isAdminCaller(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Missing Authorization header" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: parsed.error.flatten().fieldErrors }, 400);
  const input = parsed.data;

  // Every query below runs AS this user (their JWT, the anon key) — RLS
  // enforces project access; no service-role key is used anywhere in this
  // function.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "Not authenticated" }, 401);
  const user = userData.user;

  if (input.action === "model_config") {
    if (!(await isAdminCaller(supabase, user.id))) return json({ ok: false, error: "Admin only" }, 403);
    return json({
      ok: true,
      defaultModel: DEFAULT_MODEL,
      models: SUPPORTED_MODELS.map((m) => ({ id: m.id, label: m.label, pricing: m.pricing })),
    });
  }

  if (!input.projectId) return json({ ok: false, error: "projectId is required" }, 400);

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, project_type, ai_processing_enabled")
    .eq("id", input.projectId)
    .maybeSingle<ProjectRow>();
  if (projErr) return json({ ok: false, error: projErr.message }, 500);
  if (!project) return json({ ok: false, error: "Project not found or access denied" }, 404);
  if (!canSendToProvider({ kind: "project_document", aiProcessingEnabled: project.ai_processing_enabled })) {
    return json({ ok: false, error: "AI processing is not enabled for this project." }, 403);
  }

  const isAdmin = await isAdminCaller(supabase, user.id);
  const model = resolveModel(input.model, isAdmin);
  const forceReanalyse = isAdmin && !!input.forceReanalyse;

  // ── action === "identify" (Click-to-Identify) — a single, on-demand,
  // EPHEMERAL per-point request. Deliberately bypasses the whole claiming/
  // ledger/preflight/mode machinery below (that exists to make whole-
  // document BOQ/LOCATION batches idempotent across re-analysis; identify is
  // not a batch, is never re-run automatically, and is never persisted —
  // see the Click-to-Identify investigation report, decision 9: ephemeral
  // unless persistence is demonstrably required, which it isn't here). Never
  // writes to analysis_run/analysis_review_item/analysis_observation, never
  // creates or edits a BOQ line, never fabricates a candidate. ─────────────
  if (input.action === "identify") {
    if (!OPENAI_API_KEY) return json({ ok: false, error: "AI generation is not configured on the server." }, 500);
    if (!input.documentId) return json({ ok: false, error: "documentId is required" }, 400);
    if (!input.page) return json({ ok: false, error: "page is required" }, 400);
    if (!input.point) return json({ ok: false, error: "point is required" }, 400);

    let file: { filename: string; bytes: Uint8Array };
    try {
      file = await loadSingleDocumentFile(supabase, input.projectId, input.documentId);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "Failed to load the drawing file" }, 404);
    }

    const identifyPromptText = buildIdentifyPrompt({ page: input.page, point: input.point, nearbyText: input.nearbyText ?? [] });
    let identifyOpenAiResult;
    try {
      identifyOpenAiResult = await generateAnalysisViaOpenAI(OPENAI_API_KEY, model.id, identifyPromptText, [file], CUNSTRUCT_IDENTIFY_JSON_SCHEMA);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "OpenAI request failed" }, 502);
    }

    const parsedIdentify = parseIdentifyResultV1(identifyOpenAiResult.rawJson, { page: input.page, x: input.point.x, y: input.point.y });
    if (!parsedIdentify.ok || !parsedIdentify.result) {
      return json({ ok: false, error: "OpenAI response failed validation: " + (parsedIdentify.error ?? "unknown error") }, 502);
    }

    // No DB write — see the comment above this branch.
    return json({ ok: true, result: parsedIdentify.result, warnings: parsedIdentify.warnings });
  }

  // ── action === "find_similar" (Find Similar) — given an ALREADY-CONFIRMED
  // identification, search the entire resolved document for other
  // occurrences of the same element type. A single, on-demand, EPHEMERAL
  // request — same discipline as "identify" immediately above: never writes
  // to analysis_run/analysis_review_item/analysis_observation, never
  // creates or edits a BOQ line, never fabricates a match or a location.
  // Reviewer-accessible: deliberately reuses the SAME canSendToProvider/
  // resolveModel path every other action above already went through —
  // no additional isAdminCaller() gate, unlike model_config or the
  // admin-only LOCATION extraction entry point. The actual logic lives in
  // findSimilarHandler.ts (see its own header comment for why) — this
  // branch is just auth/config plumbing + the injected real dependencies. ─
  if (input.action === "find_similar") {
    if (!OPENAI_API_KEY) return json({ ok: false, error: "AI generation is not configured on the server." }, 500);
    const { status, body } = await handleFindSimilar(
      { documentId: input.documentId, reference: input.reference },
      {
        loadDocumentFile: (documentId) => loadSingleDocumentFile(supabase, input.projectId, documentId),
        callOpenAi: (promptText, files) => generateAnalysisViaOpenAI(OPENAI_API_KEY, model.id, promptText, files, CUNSTRUCT_FIND_SIMILAR_JSON_SCHEMA),
      },
    );
    return json(body, status);
  }

  // Omitted mode -> DEFAULT_ANALYSIS_MODE ("BOQ"), the exact backward-
  // compatibility rule: every existing caller that never sends `mode` behaves
  // identically to before this phase. An explicit, unrecognized mode string
  // is rejected outright rather than silently coerced to BOQ.
  const mode: AnalysisMode | null = resolveAnalysisMode(input.mode);
  if (mode === null) {
    return json({ ok: false, error: `Invalid mode: "${input.mode}". Must be one of BOQ, LOCATION, BOQ_AND_LOCATION.` }, 400);
  }
  // Phase A: a BOQ/BOQ_AND_LOCATION claim is scoped per-BOQ (see
  // modeRequiresBoqScope's doc) — never silently fall back to a project-wide
  // (boq_id = null) claim for these modes. Every existing caller already
  // passes a real boqId for BOQ-mode requests, so this rejects only a
  // genuinely malformed request, never today's real traffic.
  if (modeRequiresBoqScope(mode) && !input.boqId) {
    return json({ ok: false, error: "boqId is required for BOQ-mode analysis." }, 400);
  }

  let totalProjectFiles: number;
  let eligible: EligibleRow[];
  try {
    ({ totalProjectFiles, eligible } = await loadEligibleFiles(supabase, input.projectId));
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Failed to load project files" }, 500);
  }

  const ledger = await loadLedger(supabase, input.projectId, ANALYSIS_CONTRACT_VERSION, DEFAULT_PROVIDER, model.id, mode, input.boqId ?? null);
  const preflight = computePreflight(
    totalProjectFiles,
    eligible.map((e): EligibleFile => ({
      documentId: e.documentId, documentRevisionId: e.documentRevisionId, filename: e.filename,
      contentHash: e.contentHash, byteSize: e.byteSize,
    })),
    ledger,
    {
      contractVersion: ANALYSIS_CONTRACT_VERSION, provider: DEFAULT_PROVIDER, model: model.id, mode, forceReanalyse,
      nowMs: Date.now(), staleAfterMs: STALE_PROCESSING_MS,
    },
  );

  const runsFilter = input.boqId ? { column: "boq_id", value: input.boqId } : { column: "project_id", value: input.projectId };
  const { data: existingRuns } = await supabase
    .from("analysis_run")
    .select("id, created_at, item_count, source")
    .eq(runsFilter.column, runsFilter.value)
    .order("created_at", { ascending: false })
    .limit(5);

  // documentId -> folder breadcrumb, purely for display below. Never fed
  // back into computePreflight or the claim key — see EligibleRow.folderPath.
  const folderPathByDocId = new Map(eligible.map((e) => [e.documentId, e.folderPath]));
  const withFolder = (f: { documentId: string; filename: string }) => ({
    documentId: f.documentId, filename: f.filename, folderPath: folderPathByDocId.get(f.documentId) ?? [],
  });

  // Which files are new/already-analysed, by name, is NOT sensitive AI
  // internals (no model id, no pricing, no provider) — it's the exact "which
  // files will/won't be sent" list the spec requires every user to see via
  // "Review files", so it lives in the normal summary, not the admin-only
  // `internal` block below.
  const normalSummary = {
    // Not sensitive (no model/pricing/provider) — same visibility as the file
    // counts above. Echoes what the request resolved to: the caller's own
    // mode if valid, or "BOQ" if omitted.
    mode: preflight.mode,
    totalProjectFiles: preflight.totalProjectFiles,
    totalEligibleDrawingFiles: preflight.totalEligibleDrawingFiles,
    filesPendingHash: preflight.filesPendingHash,
    alreadyAnalysedCount: preflight.alreadyAnalysed.length,
    newFilesCount: preflight.willSend.length,
    duplicateFilesSkipped: preflight.duplicateGroups.reduce((s, g) => s + g.length - 1, 0),
    inFlightCount: preflight.inFlight.length,
    allFilesAlreadyAnalysed: preflight.totalEligibleDrawingFiles > 0 && preflight.willSend.length === 0 && preflight.inFlight.length === 0,
    existingRunCount: existingRuns?.length ?? 0,
    latestRunId: existingRuns?.[0]?.id ?? null,
    // No real document register exists anywhere in this schema today, so
    // DOCUMENT completeness (does the upload set represent every drawing
    // that exists for the project?) is never claimable from upload counts
    // alone — only SOURCE coverage (which uploaded files fed this run) is
    // ever reported as known. See docs/ai-analysis-pipeline.md.
    documentCompleteness: "UNKNOWN" as const,
    willSendFiles: preflight.willSend.map(withFolder),
    alreadyAnalysedFiles: preflight.alreadyAnalysed.map(withFolder),
    duplicateGroups: preflight.duplicateGroups.map((g) => g.map(withFolder)),
  };
  const internal = isAdmin
    ? {
        provider: DEFAULT_PROVIDER,
        model: model.id,
        contractVersion: ANALYSIS_CONTRACT_VERSION,
        forceReanalyse,
        // A range, not a point estimate — see modelConfig.ts's comment on why
        // a single "exact" figure would be false precision here.
        estimatedCost: estimateCostRange(
          model,
          preflight.willSend.map((f) => {
            const e = eligible.find((e) => e.documentRevisionId === f.documentRevisionId);
            return { pageCount: e?.pageCount ?? null, byteSize: e?.byteSize ?? 0 };
          }),
        ),
      }
    : undefined;

  if (input.action === "preflight") {
    return json({ ok: true, preflight: normalSummary, internal });
  }

  // ── action === "generate" ────────────────────────────────────────────────
  if (!OPENAI_API_KEY) return json({ ok: false, error: "AI generation is not configured on the server." }, 500);

  // A caller scoping Generate to specific documents (the LOCATION
  // document-level entry point always requests exactly one) must NOT be
  // filtered against `willSend` — `willSend` already deduplicates by content
  // hash PROJECT-WIDE, so a document that shares byte-identical content with
  // another document in the project may be genuinely new but absent from
  // `willSend` in its own right (a sibling document holds that hash's one
  // `willSend` entry instead). Filtering `willSend` by documentId in that
  // case finds nothing, even though the requested document's content was
  // never sent — the exact production bug this replaces. `newEligible` is
  // NOT deduplicated, so resolving against it (and deduping only WITHIN the
  // requested set) gives back the requested document's own identity whenever
  // its content is new. See resolveRequestedToSend()'s doc comment.
  const toSend = input.documentIds?.length
    ? resolveRequestedToSend(preflight.newEligible, input.documentIds)
    : preflight.willSend;

  if (toSend.length === 0) {
    return json({
      ok: true,
      generated: 0,
      mode,
      allAlreadyAnalysed: normalSummary.allFilesAlreadyAnalysed,
      message: normalSummary.allFilesAlreadyAnalysed
        ? "All uploaded files have already been analysed."
        : "No new eligible files to analyse.",
      latestRunId: normalSummary.latestRunId,
    });
  }

  // ── Claim each file — DB-enforced idempotency via the unique constraint on
  // analysis_run_source(project_id, content_hash, contract_version, provider,
  // model, mode). A losing race (two tabs, a double-click, a retry) always
  // loses the insert here, never the OpenAI call below. Including `mode` in
  // both the insert and the constraint means a LOCATION-mode claim and a
  // BOQ-mode claim over the identical file/contract/model never collide —
  // each mode gets its own independent claim/run. ──────────────────────────
  const claimed: { file: (typeof toSend)[number]; claimId: string }[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  for (const file of toSend) {
    const { data: inserted, error: insertErr } = await supabase
      .from("analysis_run_source")
      .insert({
        project_id: input.projectId, content_hash: file.contentHash, contract_version: ANALYSIS_CONTRACT_VERSION,
        provider: DEFAULT_PROVIDER, model: model.id, mode, status: "PROCESSING",
        document_id: file.documentId, document_revision_id: file.documentRevisionId,
        filename_at_time_of_analysis: file.filename, claimed_by: user.id,
        // Phase A: BOQ/BOQ_AND_LOCATION claims carry the real boq_id they
        // were validated against above — never null (the DB's own
        // analysis_run_source_boq_mode_requires_boq_id check backs this up).
        // LOCATION stays null regardless of what was sent, preserving its
        // document-level (not per-BOQ) identity exactly as before Phase A.
        boq_id: modeRequiresBoqScope(mode) ? input.boqId : null,
      })
      .select("id")
      .single();

    if (!insertErr && inserted) {
      claimed.push({ file, claimId: inserted.id });
      continue;
    }
    if (insertErr?.code !== "23505") {
      skipped.push({ filename: file.filename, reason: "Could not claim this file for analysis." });
      continue;
    }
    // Unique-constraint collision — someone already holds/held this exact
    // (project, content, contract, model, mode) claim. Reclaimable in two
    // cases, both via ONE conditional UPDATE so a concurrent reclaim attempt
    // is still arbitrated by ordinary Postgres row-level locking (whoever's
    // UPDATE commits first "wins"; the loser's WHERE clause re-evaluates
    // against the now-committed row and correctly matches nothing):
    //   1) status = 'FAILED' — always retryable.
    //   2) status = 'PROCESSING' but claimed_at is older than
    //      STALE_PROCESSING_MS — presumed dead (the edge function that made
    //      the claim crashed/timed out before resolving it). A genuinely
    //      live PROCESSING claim (claimed_at recent) never matches this and
    //      stays protected.
    let reclaimQuery = supabase
      .from("analysis_run_source")
      .update({ status: "PROCESSING", claimed_by: user.id, claimed_at: new Date().toISOString(), error: null, completed_at: null })
      .eq("project_id", input.projectId).eq("content_hash", file.contentHash).eq("contract_version", ANALYSIS_CONTRACT_VERSION)
      .eq("provider", DEFAULT_PROVIDER).eq("model", model.id).eq("mode", mode);
    // Match the exact same boq_id scoping the insert above and the ledger
    // query use, so a reclaim can never cross from one BOQ's stale/failed
    // claim into a different BOQ's identity.
    reclaimQuery = modeRequiresBoqScope(mode) ? reclaimQuery.eq("boq_id", input.boqId) : reclaimQuery.is("boq_id", null);
    const { data: reclaimed } = await reclaimQuery
      .or(buildStaleReclaimFilter(Date.now(), STALE_PROCESSING_MS))
      .select("id")
      .maybeSingle();
    if (reclaimed) claimed.push({ file, claimId: reclaimed.id });
    else skipped.push({ filename: file.filename, reason: "Already analysed or currently being analysed elsewhere." });
  }

  if (claimed.length === 0) {
    return json({ ok: true, generated: 0, mode, message: "All selected files are already analysed or being analysed elsewhere.", skipped });
  }

  // ── Download bytes for every claimed file, call OpenAI once for the batch ──
  const filesForOpenAi: { filename: string; bytes: Uint8Array }[] = [];
  for (const { file } of claimed) {
    const eligibleRow = eligible.find((e) => e.documentRevisionId === file.documentRevisionId)!;
    const { data: blob, error: dlErr } = await supabase.storage.from(DRAWINGS_BUCKET).download(eligibleRow.filePath);
    if (dlErr || !blob) {
      await failClaims(supabase, claimed.map((c) => c.claimId), "Source file could not be downloaded for analysis.");
      return json({ ok: false, error: "Failed to read one or more source files.", skipped }, 500);
    }
    filesForOpenAi.push({ filename: file.filename, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }

  // The persisted analysis_run.estimated_cost_usd column holds a single
  // number (no schema change needed for this) — the midpoint of the honest
  // low/high range computed the same way the preflight response shows it.
  // The range itself isn't discarded information the reviewer needed: it
  // mattered for the pre-generation decision, not for this after-the-fact
  // audit record, which also carries the REAL actual_cost_usd right next to it.
  // Computed once here (mode-independent) rather than duplicated in the BOQ
  // and LOCATION branches below.
  const claimedCostRange = estimateCostRange(
    model,
    claimed.map(({ file }) => {
      const e = eligible.find((e) => e.documentRevisionId === file.documentRevisionId);
      return { pageCount: e?.pageCount ?? null, byteSize: e?.byteSize ?? 0 };
    }),
  );
  const estimatedCostUsd = Math.round(((claimedCostRange.lowUsd + claimedCostRange.highUsd) / 2) * 10_000) / 10_000;

  // ── mode === "LOCATION": observation extraction, entirely separate from the
  // BOQ path below — different prompt, different schema, different parser,
  // persists to analysis_observation instead of analysis_review_item. Never
  // reached for "BOQ" or "BOQ_AND_LOCATION" (the latter still runs the
  // unchanged BOQ path below, per Phase 3's documented limitation — actually
  // combining both extractions is Phase 5's job). ──────────────────────────
  if (mode === "LOCATION") {
    const observationPromptText = buildObservationPrompt({ projectType: project.project_type ?? undefined });
    let locationResult;
    try {
      locationResult = await generateAnalysisViaOpenAI(OPENAI_API_KEY, model.id, observationPromptText, filesForOpenAi, CUNSTRUCT_OBSERVATION_JSON_SCHEMA);
    } catch (e) {
      const message = e instanceof Error ? e.message : "OpenAI request failed";
      await failClaims(supabase, claimed.map((c) => c.claimId), message);
      return json({ ok: false, error: message, skipped }, 502);
    }

    const parsedObservations = parseObservationsV1(locationResult.rawJson);
    if (!parsedObservations.ok || !parsedObservations.observations) {
      await failClaims(supabase, claimed.map((c) => c.claimId), parsedObservations.error ?? "OpenAI response failed schema validation.");
      return json({ ok: false, error: "OpenAI response failed validation: " + (parsedObservations.error ?? "unknown error"), skipped }, 502);
    }

    // Layer B: pin each observation to an exact claimed document/revision.
    // For a multi-file batch, never trusts the model's own documentId/document
    // without checking it against what was actually sent this batch. For a
    // single-file batch (documentIds always has exactly one for a LOCATION
    // document-level request), the claimed file itself is authoritative
    // regardless of what the model says — see resolveObservationSource()'s
    // doc comment. An observation that still can't be pinned is dropped
    // entirely, never persisted with a guessed source.
    const claimedFiles: ClaimedFile[] = claimed.map(({ file }) => ({
      documentId: file.documentId, documentRevisionId: file.documentRevisionId, filename: file.filename,
    }));
    const pinned: { documentId: string; revisionId: string; obs: (typeof parsedObservations.observations)[number] }[] = [];
    for (const obs of parsedObservations.observations) {
      const resolved = resolveObservationSource({ documentId: obs.source.documentId, document: obs.source.document }, claimedFiles);
      if (resolved) pinned.push({ documentId: resolved.documentId, revisionId: resolved.revisionId, obs });
    }

    // A NON-empty model response where NOTHING could be pinned to a real
    // document/revision is a genuine attribution failure (the model
    // referenced sources that don't match what was actually sent) — still a
    // hard error. A genuinely EMPTY response (parsedObservations.observations
    // was [] from parseObservationsV1 — the model honestly found nothing on
    // this drawing) is NOT the same failure: there's nothing to pin because
    // there was nothing to begin with, and that falls through to persist a
    // real analysis_run with zero analysis_observation rows below, reported
    // to the caller as a genuine (not fabricated) zero — never this error.
    if (parsedObservations.observations.length > 0 && pinned.length === 0) {
      await failClaims(supabase, claimed.map((c) => c.claimId), "No observation could be pinned to an exact source document/revision.");
      return json({ ok: false, error: "No observation could be pinned to an exact source document/revision.", skipped }, 502);
    }

    const { data: locationRun, error: locationRunErr } = await supabase
      .from("analysis_run")
      .insert({
        boq_id: input.boqId ?? null, project_id: input.projectId,
        schema_version: "cunstruct.observation.v1", source: "ai_api",
        provider: DEFAULT_PROVIDER, model: model.id, mode,
        // item_count is left at its column default (0) — it means "number of
        // analysis_review_item rows" today (see reviewStore.latestRunForBoq),
        // and a LOCATION run genuinely has zero of those. The observation
        // count is reported separately below as observationCount, never
        // folded into this column.
        created_by: user.id, contract_version: ANALYSIS_CONTRACT_VERSION,
        input_tokens: locationResult.inputTokens, output_tokens: locationResult.outputTokens, total_tokens: locationResult.totalTokens,
        estimated_cost_usd: estimatedCostUsd, actual_cost_usd: actualCostUsd(model, locationResult.inputTokens, locationResult.outputTokens),
        cost_currency: "USD",
      })
      .select("id")
      .single();
    if (locationRunErr || !locationRun) {
      await failClaims(supabase, claimed.map((c) => c.claimId), "Failed to persist the analysis run.");
      return json({ ok: false, error: locationRunErr?.message ?? "Failed to persist the analysis run." }, 500);
    }

    const observationRows = pinned.map(({ documentId, revisionId, obs }) => ({
      run_id: locationRun.id, project_id: input.projectId,
      document_id: documentId, revision_id: revisionId,
      observation_type: obs.observationType, mark: obs.mark ?? null, scope_hint: obs.scopeHint ?? null,
      location_text: obs.locationText ?? null, attributes: obs.attributes, evidence: obs.source,
      evidence_completeness: obs.evidenceCompleteness,
    }));
    // Nothing to insert for a genuine zero-result — skip the call entirely
    // rather than sending an empty insert (and never treat "no rows to
    // write" as a write failure).
    const { error: obsErr } = observationRows.length > 0
      ? await supabase.from("analysis_observation").insert(observationRows)
      : { error: null };
    if (obsErr) {
      // Compensating cleanup — the same shape as ProjectDocuments.tsx's
      // uploadOnePdf() catch block (insert parent, insert child, delete the
      // parent back out on child-insert failure) — never leave an orphaned
      // run behind for this new path.
      await supabase.from("analysis_run").delete().eq("id", locationRun.id);
      await failClaims(supabase, claimed.map((c) => c.claimId), "Failed to persist observations.");
      return json({ ok: false, error: obsErr.message }, 500);
    }

    await supabase
      .from("analysis_run_source")
      .update({ status: "SUCCEEDED", analysis_run_id: locationRun.id, completed_at: new Date().toISOString() })
      .in("id", claimed.map((c) => c.claimId));

    return json({
      ok: true,
      generated: claimed.length,
      runId: locationRun.id,
      mode,
      observationCount: observationRows.length,
      skipped,
      sourceCoverage: claimed.map((c) => c.file.filename),
    });
  }

  // ── mode === "BOQ" or "BOQ_AND_LOCATION": today's exact, unchanged BOQ
  // extraction path. ─────────────────────────────────────────────────────
  const promptText = buildAnalysisPrompt({ projectType: project.project_type ?? undefined });
  let openAiResult;
  try {
    openAiResult = await generateAnalysisViaOpenAI(OPENAI_API_KEY, model.id, promptText, filesForOpenAi, CUNSTRUCT_ANALYSIS_JSON_SCHEMA);
  } catch (e) {
    const message = e instanceof Error ? e.message : "OpenAI request failed";
    await failClaims(supabase, claimed.map((c) => c.claimId), message);
    return json({ ok: false, error: message, skipped }, 502);
  }

  const parsedAnalysis = parseAnalysisV1(openAiResult.rawJson);
  if (!parsedAnalysis.ok || !parsedAnalysis.analysis) {
    await failClaims(supabase, claimed.map((c) => c.claimId), parsedAnalysis.error ?? "OpenAI response failed schema validation.");
    return json({ ok: false, error: "OpenAI response failed validation: " + (parsedAnalysis.error ?? "unknown error"), skipped }, 502);
  }

  const { data: run, error: runErr } = await supabase
    .from("analysis_run")
    .insert({
      boq_id: input.boqId ?? null, project_id: input.projectId,
      schema_version: parsedAnalysis.analysis.schemaVersion, source: "ai_api",
      provider: DEFAULT_PROVIDER, model: model.id, mode, item_count: parsedAnalysis.analysis.items.length,
      created_by: user.id, contract_version: ANALYSIS_CONTRACT_VERSION,
      input_tokens: openAiResult.inputTokens, output_tokens: openAiResult.outputTokens, total_tokens: openAiResult.totalTokens,
      estimated_cost_usd: estimatedCostUsd, actual_cost_usd: actualCostUsd(model, openAiResult.inputTokens, openAiResult.outputTokens),
      cost_currency: "USD",
    })
    .select("id")
    .single();
  if (runErr || !run) {
    await failClaims(supabase, claimed.map((c) => c.claimId), "Failed to persist the analysis run.");
    return json({ ok: false, error: runErr?.message ?? "Failed to persist the analysis run." }, 500);
  }

  const reviewItems = buildReviewItems(parsedAnalysis.analysis.items);
  const rows = reviewItems.map((it, i) => ({
    run_id: run.id, boq_id: input.boqId ?? null, project_id: input.projectId,
    item_key: it.ai.key, item_name: it.ai.item, ai_json: it.ai, reviewer_json: null,
    review_status: it.reviewStatus, sort: i,
  }));
  const { error: itemsErr } = await supabase.from("analysis_review_item").insert(rows);
  if (itemsErr) {
    await failClaims(supabase, claimed.map((c) => c.claimId), "Failed to persist review items.");
    return json({ ok: false, error: itemsErr.message }, 500);
  }

  await supabase
    .from("analysis_run_source")
    .update({ status: "SUCCEEDED", analysis_run_id: run.id, completed_at: new Date().toISOString() })
    .in("id", claimed.map((c) => c.claimId));

  return json({
    ok: true,
    generated: claimed.length,
    runId: run.id,
    mode,
    itemCount: reviewItems.length,
    skipped,
    // Honest, non-inflated coverage statement — this run covers ONLY the
    // files just claimed, never framed as a full-project analysis.
    sourceCoverage: claimed.map((c) => c.file.filename),
  });
});

async function failClaims(supabase: SupabaseClient, claimIds: string[], error: string): Promise<void> {
  if (!claimIds.length) return;
  await supabase.from("analysis_run_source").update({ status: "FAILED", error, completed_at: new Date().toISOString() }).in("id", claimIds);
}
