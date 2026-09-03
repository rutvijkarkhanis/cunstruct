// Persist an external audit into Cunstruct and drive each finding's lifecycle.
//
// Deterministic ingestion only: parse + validate the pasted JSON, match findings
// to BOQ lines where possible, and store a run + its findings. It NEVER edits a
// boq_line — findings are a review layer the user resolves by hand.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseAuditJson } from "./auditJson";
import { linkFindings, type BoqLineRef, type FindingState } from "./auditFindings";
import { recordAuditTrail } from "./security/auditTrail";

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
