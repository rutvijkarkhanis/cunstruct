// DSR MAPPING DATA — reads a BOQ's lines and their boq_line_dsr_mapping
// decisions, and writes decisions. The ONLY table this hook writes is
// boq_line_dsr_mapping: boq_line (quantities, units, descriptions, source
// evidence, dsr_rate, custom_rate) is read-only here.
//
// The mapping table comes from a migration that may not be applied on every
// deployment (20261003000000_boq_line_dsr_mapping.sql). When it is missing,
// `storageAvailable` is false and every write is refused with a clear message
// — the page still renders lines, and the estimate shows them all as
// unmapped, rather than failing or pretending to save.
//
// Same convention as useShareLinks/useBoqManagement: useQuery for reads,
// plain async mutators, qc.invalidateQueries on success.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db, isMissingTable as missingTable, type DbError, type DbResult } from "@/lib/untypedDb";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { mappingWriteFor, type DsrItemRef, type DsrMappingRow, type MappingDecision } from "@/lib/dsrMapping";
import type { IndicativeLine } from "@/lib/indicativeCosting";

export const MAPPING_TABLE = "boq_line_dsr_mapping";
export const MAPPING_UNAVAILABLE_MESSAGE =
  "DSR mapping storage is not set up on this database yet (migration 20261003000000_boq_line_dsr_mapping.sql has not been applied). Nothing can be saved.";

/** PostgREST/Postgres "table does not exist" — not a generic failure. */
export const isMissingTable = (e: DbError | null | undefined) => missingTable(MAPPING_TABLE, e);

export type MappingLine = IndicativeLine & { dsr_code: string | null; sort: number };

const LINE_COLS = "id, section, dsr_code, description, unit, qty, included, quantity_status, sort";
const LINE_COLS_BASE = "id, section, dsr_code, description, unit, qty, included, sort";
const DSR_COLS = "id, code, description, unit, rate, source, rate_year, subhead";

async function selectLines(boqId: string): Promise<MappingLine[]> {
  let r = await db.from("boq_line").select(LINE_COLS).eq("boq_id", boqId).order("sort");
  if (r.error && /quantity_status|schema cache|does not exist/i.test(r.error.message)) {
    r = await db.from("boq_line").select(LINE_COLS_BASE).eq("boq_id", boqId).order("sort");
  }
  if (r.error) throw r.error;
  return (r.data ?? []) as MappingLine[];
}

/** Server-side DSR search (the table is too large to load whole). Keyed by id — codes repeat across schedules/years. */
export async function searchDsrItems(term: string): Promise<DsrItemRef[]> {
  const q = term.trim().replace(/[%,()]/g, " ");
  if (q.length < 2) return [];
  const { data, error } = await db.from("dsr_item").select(DSR_COLS)
    .eq("billable", true).or(`code.ilike.%${q}%,description.ilike.%${q}%`).limit(40);
  if (error) throw error;
  return (data ?? []) as DsrItemRef[];
}

/** Exact-code candidates for a line that already carries a DSR code (every schedule/year that has it). */
export async function dsrCandidatesForCode(code: string): Promise<DsrItemRef[]> {
  const { data, error } = await db.from("dsr_item").select(DSR_COLS)
    .eq("billable", true).eq("code", code).order("rate_year", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as DsrItemRef[];
}

export function useDsrMapping(boqId: string | undefined | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busyLineId, setBusyLineId] = useState<string | null>(null);

  const { data: boqName } = useQuery({
    queryKey: ["dsr-mapping-boq", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data } = await db.from("boq").select("name").eq("id", boqId!).limit(1);
      return ((data as { name: string }[] | null)?.[0]?.name) ?? null;
    },
  });

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["dsr-mapping-lines", boqId],
    enabled: !!boqId,
    queryFn: () => selectLines(boqId!),
  });

  const { data: mappingState, isLoading: mappingsLoading } = useQuery({
    queryKey: ["dsr-mappings", boqId],
    enabled: !!boqId,
    queryFn: async (): Promise<{ available: boolean; rows: DsrMappingRow[] }> => {
      const { data, error } = await db.from(MAPPING_TABLE).select("*").eq("boq_id", boqId!);
      if (isMissingTable(error)) return { available: false, rows: [] };
      if (error) throw error;
      return { available: true, rows: (data ?? []) as DsrMappingRow[] };
    },
  });
  const storageAvailable = mappingState?.available ?? true;
  const mappings = mappingState?.rows ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["dsr-mappings", boqId] });

  const run = async (lineId: string, op: () => PromiseLike<DbResult>, success?: string) => {
    if (!storageAvailable) { toast.error(MAPPING_UNAVAILABLE_MESSAGE); return false; }
    setBusyLineId(lineId);
    try {
      const { error } = await op();
      if (error) {
        toast.error(isMissingTable(error) ? MAPPING_UNAVAILABLE_MESSAGE : error.message);
        return false;
      }
      if (success) toast.success(success);
      await refresh();
      return true;
    } finally { setBusyLineId(null); }
  };

  /** Record a decision for a line (replacing any earlier one). Always resets include_in_estimate. */
  const decide = (lineId: string, decision: MappingDecision, note?: string | null) =>
    run(lineId, () => db.from(MAPPING_TABLE).upsert({
      boq_id: boqId,
      boq_line_id: lineId,
      ...mappingWriteFor(decision),
      reviewer_note: note?.trim() || null,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: "boq_line_id" }), decision.kind === "select" ? "DSR reference saved" : "Decision saved");

  /** Remove the decision entirely — the line goes back to unmapped. */
  const clear = (lineId: string) =>
    run(lineId, () => db.from(MAPPING_TABLE).delete().eq("boq_line_id", lineId), "Decision cleared");

  /** Explicit opt-in/out of the indicative estimate. Only a `mapped` decision may be included. */
  const setIncluded = (mapping: DsrMappingRow, include: boolean) => {
    if (include && mapping.status !== "mapped") {
      toast.error("Only a confirmed DSR match can be included");
      return Promise.resolve(false);
    }
    return run(mapping.boq_line_id, () => db.from(MAPPING_TABLE)
      .update({ include_in_estimate: include, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", mapping.id));
  };

  return { boqName, lines, linesLoading, mappings, mappingsLoading, storageAvailable, busyLineId, decide, clear, setIncluded };
}
