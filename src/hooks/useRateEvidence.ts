// RATE EVIDENCE DATA — vendor quotations, the estimator's rate review
// (notes + preferred candidate), the project's existing documents (to link a
// quotation's source), and historical rates from the firm's other BOQs.
//
// Writes go ONLY to vendor_quotation and boq_line_rate_review. boq_line —
// this BOQ's and every historical one — is read-only here, as are the DSR
// mapping snapshots. Both tables come from an unapplied migration
// (20261004000000_boq_line_rate_evidence.sql); when missing, storageAvailable
// is false and writes are refused with a clear message.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { db, isMissingTable, type DbResult } from "@/lib/untypedDb";
import type { HistoricalLine, QuotationWrite, RateReview, VendorQuotation } from "@/lib/rateEvidence";

export const QUOTATION_TABLE = "vendor_quotation";
export const REVIEW_TABLE = "boq_line_rate_review";
export const EVIDENCE_UNAVAILABLE_MESSAGE =
  "Rate evidence storage is not set up on this database yet (migration 20261004000000_boq_line_rate_evidence.sql has not been applied). Quotations and preferences can't be saved; historical rates can still be viewed.";

export interface ProjectDocumentRef { id: string; name: string; doc_type: string | null }

const HISTORICAL_COLS =
  "id, boq_id, description, unit, qty, dsr_code, dsr_rate, custom_rate, boq:boq_id(name, status, rate_year, created_at, updated_at, project:project_id(name, location))";

/**
 * Lines from the firm's OTHER BOQs that may be relevant: same DSR code, and/or
 * description containing the search words. Exact rows only — nothing derived.
 */
export async function findHistoricalRates(boqId: string, opts: { code?: string | null; term?: string }): Promise<HistoricalLine[]> {
  const found = new Map<string, HistoricalLine>();
  const add = (r: DbResult) => {
    if (r.error) throw r.error;
    for (const row of (r.data ?? []) as HistoricalLine[]) found.set(row.id, row);
  };
  if (opts.code) {
    add(await db.from("boq_line").select(HISTORICAL_COLS).eq("dsr_code", opts.code).neq("boq_id", boqId).limit(25));
  }
  const words = (opts.term ?? "").replace(/[%,()_]/g, " ").split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
  if (words.length) {
    add(await db.from("boq_line").select(HISTORICAL_COLS).ilike("description", `%${words.join("%")}%`).neq("boq_id", boqId).limit(25));
  }
  return [...found.values()];
}

export function useRateEvidence(boqId: string | undefined | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const { data: projectId } = useQuery({
    queryKey: ["rate-evidence-project", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data } = await db.from("boq").select("project_id").eq("id", boqId!).limit(1);
      return ((data as { project_id: string | null }[] | null)?.[0]?.project_id) ?? null;
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["rate-evidence-docs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("project_document").select("id, name, doc_type").eq("project_id", projectId!).order("name");
      if (error) throw error;
      return (data ?? []) as ProjectDocumentRef[];
    },
  });

  const { data: state, isLoading } = useQuery({
    queryKey: ["rate-evidence", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const [q, r] = await Promise.all([
        db.from(QUOTATION_TABLE).select("*").eq("boq_id", boqId!).order("created_at"),
        db.from(REVIEW_TABLE).select("*").eq("boq_id", boqId!),
      ]);
      if (isMissingTable(QUOTATION_TABLE, q.error) || isMissingTable(REVIEW_TABLE, r.error)) {
        return { available: false, quotations: [] as VendorQuotation[], reviews: [] as RateReview[] };
      }
      if (q.error) throw q.error;
      if (r.error) throw r.error;
      return { available: true, quotations: (q.data ?? []) as VendorQuotation[], reviews: (r.data ?? []) as RateReview[] };
    },
  });
  const storageAvailable = state?.available ?? true;

  const run = async (op: () => PromiseLike<DbResult>, success: string) => {
    if (!storageAvailable) { toast.error(EVIDENCE_UNAVAILABLE_MESSAGE); return false; }
    setBusy(true);
    try {
      const { error } = await op();
      if (error) {
        const missing = isMissingTable(QUOTATION_TABLE, error) || isMissingTable(REVIEW_TABLE, error);
        toast.error(missing ? EVIDENCE_UNAVAILABLE_MESSAGE : error.message);
        return false;
      }
      toast.success(success);
      await qc.invalidateQueries({ queryKey: ["rate-evidence", boqId] });
      return true;
    } finally { setBusy(false); }
  };

  /** Insert a new quotation, or update an existing one (by id). */
  const saveQuotation = (lineId: string, value: QuotationWrite, existingId?: string) =>
    existingId
      ? run(() => db.from(QUOTATION_TABLE).update(value).eq("id", existingId), "Quotation updated")
      : run(() => db.from(QUOTATION_TABLE).insert({ ...value, boq_id: boqId, boq_line_id: lineId, recorded_by: user?.id ?? null }), "Quotation recorded");

  const deleteQuotation = (id: string) =>
    run(() => db.from(QUOTATION_TABLE).delete().eq("id", id), "Quotation removed");

  /** Notes and/or preferred candidate for a line. Pass only the columns being changed. */
  const saveReview = (lineId: string, patch: Partial<Omit<RateReview, "id" | "boq_line_id" | "reviewed_by" | "reviewed_at">>, success = "Rate review saved") =>
    run(() => db.from(REVIEW_TABLE).upsert({
      boq_id: boqId, boq_line_id: lineId, ...patch,
      reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(),
    }, { onConflict: "boq_line_id" }), success);

  return {
    quotations: state?.quotations ?? [], reviews: state?.reviews ?? [], loading: isLoading,
    storageAvailable, busy, documents, saveQuotation, deleteQuotation, saveReview,
  };
}
