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
import { ANALYSIS_CONTRACT_VERSION, DEFAULT_PROVIDER } from "../_shared/contract.ts";
import { DEFAULT_MODEL, SUPPORTED_MODELS, actualCostUsd, estimateCostRange, resolveModel } from "../_shared/modelConfig.ts";
import { computePreflight, type EligibleFile, type LedgerRow } from "../_shared/preflight.ts";
import { parseAnalysisV1, buildReviewItems } from "../_shared/analysisValidation.ts";
import { generateAnalysisViaOpenAI } from "../_shared/openaiClient.ts";
import { canSendToProvider } from "../../../src/lib/security/dataClassification.ts";
import { buildAnalysisPrompt } from "../../../src/lib/review/analysisPrompt.ts";
import { folderBreadcrumb } from "../_shared/folderContext.ts";
import { buildStaleReclaimFilter } from "../_shared/claiming.ts";

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
  action: z.enum(["preflight", "generate", "model_config"]),
  projectId: z.string().uuid().optional(),
  boqId: z.string().uuid().nullable().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
  // Admin-only inputs — silently ignored for a non-admin caller (see resolveModel()).
  model: z.string().optional(),
  forceReanalyse: z.boolean().optional(),
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

async function loadLedger(
  supabase: SupabaseClient,
  projectId: string,
  contractVersion: string,
  provider: string,
  model: string,
): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from("analysis_run_source")
    .select("content_hash, status, document_id, filename_at_time_of_analysis, analysis_run_id, claimed_at")
    .eq("project_id", projectId)
    .eq("contract_version", contractVersion)
    .eq("provider", provider)
    .eq("model", model);
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

  let totalProjectFiles: number;
  let eligible: EligibleRow[];
  try {
    ({ totalProjectFiles, eligible } = await loadEligibleFiles(supabase, input.projectId));
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Failed to load project files" }, 500);
  }

  const ledger = await loadLedger(supabase, input.projectId, ANALYSIS_CONTRACT_VERSION, DEFAULT_PROVIDER, model.id);
  const preflight = computePreflight(
    totalProjectFiles,
    eligible.map((e): EligibleFile => ({
      documentId: e.documentId, documentRevisionId: e.documentRevisionId, filename: e.filename,
      contentHash: e.contentHash, byteSize: e.byteSize,
    })),
    ledger,
    {
      contractVersion: ANALYSIS_CONTRACT_VERSION, provider: DEFAULT_PROVIDER, model: model.id, forceReanalyse,
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

  let toSend = preflight.willSend;
  if (input.documentIds?.length) {
    const requested = new Set(input.documentIds);
    toSend = toSend.filter((f) => requested.has(f.documentId));
  }

  if (toSend.length === 0) {
    return json({
      ok: true,
      generated: 0,
      allAlreadyAnalysed: normalSummary.allFilesAlreadyAnalysed,
      message: normalSummary.allFilesAlreadyAnalysed
        ? "All uploaded files have already been analysed."
        : "No new eligible files to analyse.",
      latestRunId: normalSummary.latestRunId,
    });
  }

  // ── Claim each file — DB-enforced idempotency via the unique constraint on
  // analysis_run_source(project_id, content_hash, contract_version, provider,
  // model). A losing race (two tabs, a double-click, a retry) always loses
  // the insert here, never the OpenAI call below. ──────────────────────────
  const claimed: { file: (typeof toSend)[number]; claimId: string }[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  for (const file of toSend) {
    const { data: inserted, error: insertErr } = await supabase
      .from("analysis_run_source")
      .insert({
        project_id: input.projectId, content_hash: file.contentHash, contract_version: ANALYSIS_CONTRACT_VERSION,
        provider: DEFAULT_PROVIDER, model: model.id, status: "PROCESSING",
        document_id: file.documentId, document_revision_id: file.documentRevisionId,
        filename_at_time_of_analysis: file.filename, claimed_by: user.id,
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
    // (project, content, contract, model) claim. Reclaimable in two cases,
    // both via ONE conditional UPDATE so a concurrent reclaim attempt is
    // still arbitrated by ordinary Postgres row-level locking (whoever's
    // UPDATE commits first "wins"; the loser's WHERE clause re-evaluates
    // against the now-committed row and correctly matches nothing):
    //   1) status = 'FAILED' — always retryable.
    //   2) status = 'PROCESSING' but claimed_at is older than
    //      STALE_PROCESSING_MS — presumed dead (the edge function that made
    //      the claim crashed/timed out before resolving it). A genuinely
    //      live PROCESSING claim (claimed_at recent) never matches this and
    //      stays protected.
    const { data: reclaimed } = await supabase
      .from("analysis_run_source")
      .update({ status: "PROCESSING", claimed_by: user.id, claimed_at: new Date().toISOString(), error: null, completed_at: null })
      .eq("project_id", input.projectId).eq("content_hash", file.contentHash).eq("contract_version", ANALYSIS_CONTRACT_VERSION)
      .eq("provider", DEFAULT_PROVIDER).eq("model", model.id)
      .or(buildStaleReclaimFilter(Date.now(), STALE_PROCESSING_MS))
      .select("id")
      .maybeSingle();
    if (reclaimed) claimed.push({ file, claimId: reclaimed.id });
    else skipped.push({ filename: file.filename, reason: "Already analysed or currently being analysed elsewhere." });
  }

  if (claimed.length === 0) {
    return json({ ok: true, generated: 0, message: "All selected files are already analysed or being analysed elsewhere.", skipped });
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

  const promptText = buildAnalysisPrompt({ projectType: project.project_type ?? undefined });
  let openAiResult;
  try {
    openAiResult = await generateAnalysisViaOpenAI(OPENAI_API_KEY, model.id, promptText, filesForOpenAi);
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

  // The persisted analysis_run.estimated_cost_usd column holds a single
  // number (no schema change needed for this) — the midpoint of the honest
  // low/high range computed the same way the preflight response shows it.
  // The range itself isn't discarded information the reviewer needed: it
  // mattered for the pre-generation decision, not for this after-the-fact
  // audit record, which also carries the REAL actual_cost_usd right next to it.
  const claimedCostRange = estimateCostRange(
    model,
    claimed.map(({ file }) => {
      const e = eligible.find((e) => e.documentRevisionId === file.documentRevisionId);
      return { pageCount: e?.pageCount ?? null, byteSize: e?.byteSize ?? 0 };
    }),
  );
  const estimatedCostUsd = Math.round(((claimedCostRange.lowUsd + claimedCostRange.highUsd) / 2) * 10_000) / 10_000;
  const { data: run, error: runErr } = await supabase
    .from("analysis_run")
    .insert({
      boq_id: input.boqId ?? null, project_id: input.projectId,
      schema_version: parsedAnalysis.analysis.schemaVersion, source: "ai_api",
      provider: DEFAULT_PROVIDER, model: model.id, item_count: parsedAnalysis.analysis.items.length,
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
