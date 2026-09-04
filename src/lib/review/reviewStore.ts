// REVIEW STORE — persist an analysis run + its review items (RLS-enforced).
//
// Saves the immutable AI analysis and the reviewer's decisions. It NEVER writes
// to boq_line — importing/reviewing an analysis cannot change the BOQ. Reviewer
// corrections live only in analysis_review_item.reviewer_json until a human takes
// a separate, explicit "apply to BOQ" action elsewhere.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { recordAuditTrail } from "@/lib/security/auditTrail";
import type { AnalysisV1 } from "./analysisSchemaV1";
import { buildReviewItems, type ReviewItem, type ReviewStatus, type ReviewerValues, type FlagReason } from "./reviewQueue";

export interface CreateRunArgs {
  boqId?: string | null;
  projectId?: string | null;
  analysis: AnalysisV1;
  source: "json_import" | "ai_api";
  provider?: string | null;
  model?: string | null;
}

/** Persist a validated analysis as a run + one review item per analysis item. */
export async function createAnalysisRun(args: CreateRunArgs): Promise<{ runId: string; items: ReviewItem[] }> {
  const { data: userData } = await supabase.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { data: run, error: runErr } = await supabase
    .from("analysis_run")
    .insert({
      boq_id: args.boqId ?? null,
      project_id: args.projectId ?? null,
      schema_version: args.analysis.schemaVersion,
      source: args.source,
      provider: args.provider ?? null,
      model: args.model ?? null,
      item_count: args.analysis.items.length,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = (run as { id: string }).id;

  const reviewItems = buildReviewItems(args.analysis.items);
  const rows = reviewItems.map((it, i) => ({
    run_id: runId,
    boq_id: args.boqId ?? null,
    project_id: args.projectId ?? null,
    item_key: it.ai.key,
    item_name: it.ai.item,
    ai_json: it.ai as unknown as Json,
    reviewer_json: null,
    review_status: it.reviewStatus,
    sort: i,
  }));
  const { error: itemsErr } = await supabase.from("analysis_review_item").insert(rows);
  if (itemsErr) throw itemsErr;

  // Audit-trail the import (safe metadata only — no analysis content).
  await recordAuditTrail({
    operation: args.source === "ai_api" ? "analysis.ai_import" : "analysis.json_import",
    projectId: args.projectId ?? null,
    resourceType: "boq",
    resourceId: args.boqId ?? undefined,
    provider: args.provider ?? undefined,
    model: args.model ?? undefined,
  });

  return { runId, items: reviewItems };
}

export interface StoredReviewItem extends ReviewItem {
  id: string;
}

/** Load the review items for a run, reconstructing AI value + reviewer overrides. */
export async function loadReviewItems(runId: string): Promise<StoredReviewItem[]> {
  const { data, error } = await supabase
    .from("analysis_review_item")
    .select("id, item_key, item_name, ai_json, reviewer_json, review_status, flag_reason, review_note, reviewed_at, sort")
    .eq("run_id", runId)
    .order("sort");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    ai: r.ai_json as AnalysisV1["items"][number],
    reviewer: (r.reviewer_json as ReviewerValues | null) ?? undefined,
    reviewStatus: r.review_status as ReviewStatus,
    flagReason: (r.flag_reason as FlagReason | null) ?? undefined,
    reviewNote: r.review_note ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
  }));
}

/** The most recent analysis run for a BOQ, or null. */
export async function latestRunForBoq(boqId: string): Promise<{ id: string; source: string; item_count: number; created_at: string } | null> {
  const { data, error } = await supabase
    .from("analysis_run")
    .select("id, source, item_count, created_at")
    .eq("boq_id", boqId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return (data && data[0]) ?? null;
}

export interface SaveReviewArgs {
  itemId: string;
  reviewStatus: ReviewStatus;
  reviewer?: ReviewerValues | null;
  flagReason?: FlagReason | null;
  reviewNote?: string | null;
}

/** Save one reviewer decision. Writes ONLY the review row — never a boq_line. */
export async function saveReviewDecision(args: SaveReviewArgs): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("analysis_review_item")
    .update({
      review_status: args.reviewStatus,
      reviewer_json: (args.reviewer ?? null) as Json | null,
      flag_reason: args.flagReason ?? null,
      review_note: args.reviewNote ?? null,
      reviewed_by: userData?.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", args.itemId);
  if (error) throw error;
}
