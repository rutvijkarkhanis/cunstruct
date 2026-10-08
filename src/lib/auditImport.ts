// Persist an external audit into Cunstruct and drive each finding's lifecycle.
//
// Deterministic ingestion only: parse + validate the pasted JSON, match findings
// to BOQ lines where possible, and store a run + its findings. It NEVER edits a
// boq_line — findings are a review layer the user resolves by hand.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseAuditJson } from "./auditJson";
import { linkFindings, isActiveFindingState, type BoqLineRef, type FindingState } from "./auditFindings";
import { recordAuditTrail } from "./security/auditTrail";
import { coverageSignalToFindingInput, COVERAGE_FINDING_SOURCE } from "./review/coverageFindings";
import type { CoverageSignal } from "./review/coverageSignals";

export interface ImportAuditArgs {
  boqId: string;
  projectId?: string | null;
  rawText: string;
  lines: BoqLineRef[];
}

export interface ImportAuditResult {
  runId: string;
  status: "PASS" | "ISSUES_FOUND";
  findingCount: number;
  matchedCount: number;
  warnings: string[];
}

/** DB `state` values ↔ the domain FindingState. */
const STATE_TO_DB: Record<FindingState, string> = {
  OPEN: "open",
  ACCEPTED: "accepted",
  DISMISSED: "dismissed",
  RESOLVED: "resolved",
  KEPT_PENDING: "kept_pending",
};

/**
 * Validate and persist a pasted audit JSON as a run + findings for a BOQ.
 * Throws with a useful message if the JSON is invalid (nothing is written).
 */
export async function importAuditRun(args: ImportAuditArgs): Promise<ImportAuditResult> {
  const parsed = parseAuditJson(args.rawText);
  if (!parsed.ok) throw new Error(parsed.error ?? "Invalid audit JSON.");

  const linked = linkFindings(parsed.findings, args.lines);
  const matchedCount = linked.filter((f) => f.matched).length;

  const { data: userData } = await supabase.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { data: run, error: runErr } = await supabase
    .from("boq_audit_run")
    .insert({
      boq_id: args.boqId,
      project_id: args.projectId ?? null,
      status: parsed.status ?? "ISSUES_FOUND",
      source: "external",
      raw_json: safeJson(args.rawText),
      finding_count: linked.length,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = (run as { id: string }).id;

  if (linked.length) {
    const rows = linked.map((f, i) => ({
      run_id: runId,
      boq_id: args.boqId,
      boq_line_id: f.boqLineId ?? null,
      external_key: f.externalKey ?? null,
      finding_type: f.findingType,
      action: f.action ?? null,
      scope: f.scope ?? null,
      category: f.category ?? null,
      item: f.item ?? null,
      location: f.location ?? null,
      current_value: f.currentValue ?? null,
      recommended_value: f.recommendedValue ?? null,
      recommended_method: f.recommendedMethod ?? null,
      recommended_unit: f.recommendedUnit ?? null,
      reason: f.reason ?? null,
      evidence: f.evidence ?? null,
      state: "open",
      sort: i,
    }));
    const { error: findErr } = await supabase.from("boq_audit_finding").insert(rows);
    if (findErr) throw findErr;
  }

  // Record the import in the application audit trail (safe metadata only — no
  // findings content, no pasted JSON). Best-effort; never blocks the import.
  await recordAuditTrail({
    operation: "audit.import",
    projectId: args.projectId ?? null,
    resourceType: "boq",
    resourceId: args.boqId,
    status: "ok",
  });

  return {
    runId,
    status: parsed.status ?? "ISSUES_FOUND",
    findingCount: linked.length,
    matchedCount,
    warnings: parsed.warnings,
  };
}

/** Update one finding's lifecycle state. Records who/when for terminal states. */
export async function setFindingState(findingId: string, state: FindingState): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const terminal = state === "DISMISSED" || state === "RESOLVED";
  const { error } = await supabase
    .from("boq_audit_finding")
    .update({
      state: STATE_TO_DB[state],
      resolved_by: terminal ? userData?.user?.id ?? null : null,
      resolved_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", findingId);
  if (error) throw error;
}

/** Best-effort parse so raw_json is stored as jsonb; falls back to a wrapper. */
function safeJson(text: string): Json {
  try { return JSON.parse(text) as Json; } catch { return { raw: text }; }
}

// ── Coverage integration (PR #156) — Coverage is another PRODUCER of this
// SAME boq_audit_run/boq_audit_finding system, never a second insert path
// with its own semantics. Extends this file rather than duplicating its
// conventions (supabase client, recordAuditTrail, the `state: "open"`
// literal importAuditRun already uses) in a separate module. ─────────────

/** Matches ONLY the partial unique index 20261002000000_boq_audit_finding_
 *  signal_key.sql adds on (signal_key) WHERE signal_key IS NOT NULL — never
 *  any other 23505 a future, unrelated constraint might add. Same
 *  discipline as applyFinding.ts's isBoqLineIdentityConflict. */
const COVERAGE_FINDING_SIGNAL_CONFLICT_RE = /boq_audit_finding_signal_key_idx/i;

function isCoverageFindingSignalConflict(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "23505" && COVERAGE_FINDING_SIGNAL_CONFLICT_RE.test(error.message ?? "");
}

export interface PersistCoverageFindingsResult {
  /** The boq_audit_run created for this call's genuinely NEW findings, or
   *  null when nothing new was created (every signal already had a
   *  finding — the common, steady-state case after the first run). Never
   *  creates an empty/meaningless run: if every candidate insert loses a
   *  race to a concurrent call, the just-created run is deleted rather than
   *  left behind with zero findings attached. */
  runId: string | null;
  createdCount: number;
  /** Signals that already had a finding (by signal_key) — either found by
   *  the pre-check, or lost a narrow insert-time race to a concurrent call;
   *  either way, that finding's existing lifecycle state is left untouched. */
  skippedCount: number;
}

/**
 * Persist deterministic Coverage signals (coverageSignals.ts) into the
 * EXISTING boq_audit_finding table, idempotently: the same signal (by its
 * stable signalKey) never creates a second finding, and an existing
 * finding's human disposition (accepted/dismissed/resolved/kept_pending) is
 * NEVER touched by a later Coverage run that regenerates the same signal —
 * this function only ever INSERTs a brand-new row for a signal that has
 * none yet; an existing row for that signal_key is left completely alone.
 *
 * Mirrors importAuditRun()'s shape (same supabase client, same
 * recordAuditTrail convention, same "state: open" literal) but inserts one
 * candidate at a time rather than bulk — a bulk multi-row insert would
 * abort ENTIRELY on a single conflicting row, which is exactly the common
 * case here (most signals already have a finding after the first run).
 * Never calls Supabase `.upsert()`: PostgREST cannot target a PARTIAL
 * unique index via onConflict (only boq_document's own FULL, non-partial
 * unique(boq_id, document_id) supports that) — see this file's own
 * COVERAGE_FINDING_SIGNAL_CONFLICT_RE and applyFinding.ts's identical
 * insert-then-catch-23505 precedent for boq_line's partial identity
 * indexes.
 *
 * Never writes boq_line_id/external_key (Coverage performs no line
 * matching beyond its own deterministic signal identity), never a
 * quantity, never an automatic BOQ mutation — purely advisory rows in the
 * existing Finding system, for a human to act on via the existing
 * BoqAuditReview.tsx lifecycle.
 */
export async function persistCoverageFindings(args: {
  boqId: string;
  projectId?: string | null;
  signals: CoverageSignal[];
}): Promise<PersistCoverageFindingsResult> {
  if (args.signals.length === 0) return { runId: null, createdCount: 0, skippedCount: 0 };

  // Narrows the common steady-state case (nothing new since the last run)
  // to zero writes. This is an optimization, NOT the idempotency guarantee
  // itself — the partial unique index enforced per-insert below is.
  const { data: existing, error: existingErr } = await supabase
    .from("boq_audit_finding")
    .select("signal_key")
    .eq("boq_id", args.boqId)
    .not("signal_key", "is", null);
  if (existingErr) throw existingErr;
  const existingKeys = new Set((existing ?? []).map((r) => r.signal_key as string));

  const candidates = args.signals.filter((s) => !existingKeys.has(s.signalKey));
  const alreadyKnownCount = args.signals.length - candidates.length;
  if (candidates.length === 0) return { runId: null, createdCount: 0, skippedCount: alreadyKnownCount };

  const { data: userData } = await supabase.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { data: run, error: runErr } = await supabase
    .from("boq_audit_run")
    .insert({
      boq_id: args.boqId,
      project_id: args.projectId ?? null,
      status: "ISSUES_FOUND",
      source: COVERAGE_FINDING_SOURCE,
      finding_count: 0, // corrected below to the real inserted count
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (runErr || !run) throw runErr ?? new Error("Failed to create the Coverage audit run.");
  const runId = (run as { id: string }).id;

  let createdCount = 0;
  let racedCount = 0;
  for (const [i, signal] of candidates.entries()) {
    const input = coverageSignalToFindingInput(signal);
    const { error } = await supabase.from("boq_audit_finding").insert({
      run_id: runId,
      boq_id: args.boqId,
      finding_type: input.findingType,
      item: input.item,
      reason: input.reason,
      evidence: input.evidence,
      state: "open",
      sort: i,
      signal_key: input.signalKey,
    });
    if (error) {
      if (isCoverageFindingSignalConflict(error)) { racedCount++; continue; }
      throw error;
    }
    createdCount++;
  }

  if (createdCount === 0) {
    // Every candidate lost a race to a concurrent call — never leave a
    // meaningless, empty run behind (same compensating-cleanup discipline
    // as ai-analysis/index.ts's LOCATION branch deleting its analysis_run
    // when zero observations end up persisted).
    await supabase.from("boq_audit_run").delete().eq("id", runId);
    return { runId: null, createdCount: 0, skippedCount: alreadyKnownCount + racedCount };
  }

  await supabase.from("boq_audit_run").update({ finding_count: createdCount }).eq("id", runId);

  // Safe metadata only — no finding content, matching importAuditRun's own
  // audit-trail call exactly.
  await recordAuditTrail({
    operation: "audit.coverage_import",
    projectId: args.projectId ?? null,
    resourceType: "boq",
    resourceId: args.boqId,
    status: "ok",
  });

  return { runId, createdCount, skippedCount: alreadyKnownCount + racedCount };
}

/** The exact reverse of STATE_TO_DB above — needed here because this is the
 *  one place in this module that reads `state` BACK out of the database
 *  (every other function only ever writes it). Same literal mapping
 *  BoqAuditReview.tsx's own local DB_TO_STATE already uses. */
const DB_TO_FINDING_STATE: Record<string, FindingState> = {
  open: "OPEN", accepted: "ACCEPTED", dismissed: "DISMISSED", resolved: "RESOLVED", kept_pending: "KEPT_PENDING",
};

/**
 * Active (non-terminal, per isActiveFindingState) Coverage findings, counted
 * per boqId — ONE query, scoped to exactly `boqIds` (never every project's
 * findings, never one query per BOQ). Identifies Coverage findings by the
 * actual schema field PR #156 established (`boq_audit_run.source =
 * "coverage_engine"`, via the standard PostgREST embedded-filter join this
 * codebase already uses elsewhere — see OpsProjectDetail.tsx's own
 * `forecasts!inner(...)`), never by parsing `reason`/`evidence` text.
 *
 * Returns only boqIds that have at least one active Coverage finding — a
 * BOQ with none is simply absent from the result, never a zero entry; the
 * caller (computeProjectReadiness.ts) defaults a missing key to 0.
 */
export async function loadActiveCoverageFindingCounts(boqIds: string[]): Promise<Record<string, number>> {
  if (boqIds.length === 0) return {};

  const { data, error } = await supabase
    .from("boq_audit_finding")
    .select("boq_id, state, boq_audit_run!inner(source)")
    .in("boq_id", boqIds)
    .eq("boq_audit_run.source", COVERAGE_FINDING_SOURCE);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const state = DB_TO_FINDING_STATE[row.state as string];
    if (state && !isActiveFindingState(state)) continue; // human already settled this one
    const boqId = row.boq_id as string;
    counts[boqId] = (counts[boqId] ?? 0) + 1;
  }
  return counts;
}
