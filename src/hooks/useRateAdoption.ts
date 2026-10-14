// RATE ADOPTION DATA — the BOQ's commercial line fields (custom_rate /
// dsr_rate, read fresh for the preview's compare-and-swap) and the adoption
// history, plus the single confirmed write (lib/rateAdoption.applyRateAdoption).
//
// Adoption needs boq_line_rate_adoption (migration
// 20261005000000_boq_line_rate_adoption.sql). While that table is missing,
// selection and preview still work, but adoption is refused BEFORE any write
// — a commercial rate must never change without its provenance record.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { db, isMissingTable } from "@/lib/untypedDb";
import { applyRateAdoption, type AdoptionSources, type CommercialLine } from "@/lib/rateAdoption";
import type { EvidenceItem } from "@/lib/rateEvidence";

export const ADOPTION_TABLE = "boq_line_rate_adoption";
export const ADOPTION_UNAVAILABLE_MESSAGE =
  "Rate adoption is not set up on this database yet (migration 20261005000000_boq_line_rate_adoption.sql has not been applied). You can review and preview, but no rate can be adopted until its audit record can be stored.";

export interface RateAdoptionRecord {
  id: string;
  boq_line_id: string | null;
  previous_rate: number | null;
  previous_basis: string;
  adopted_rate: number;
  source_kind: string;
  source_label: string;
  source_unit: string | null;
  source_date: string | null;
  acknowledged_caveats: string[];
  confirmation_text: string;
  confirmed_by: string;
  confirmed_at: string;
}

/** The BOQ's adoption records, newest first; `available: false` while the table is unmigrated. Shared query key ["rate-adoption", boqId]. */
export async function fetchAdoptionHistory(boqId: string): Promise<{ available: boolean; records: RateAdoptionRecord[] }> {
  const { data, error } = await db.from(ADOPTION_TABLE).select("*").eq("boq_id", boqId).order("confirmed_at", { ascending: false });
  if (isMissingTable(ADOPTION_TABLE, error)) return { available: false, records: [] };
  if (error) throw error;
  return { available: true, records: (data ?? []) as RateAdoptionRecord[] };
}

export function useRateAdoption(boqId: string | undefined | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const { data: commercialLines = [] } = useQuery({
    queryKey: ["rate-adoption-lines", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data, error } = await db.from("boq_line").select("id, description, unit, qty, dsr_rate, custom_rate").eq("boq_id", boqId!);
      if (error) throw error;
      return (data ?? []) as CommercialLine[];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["rate-adoption", boqId],
    enabled: !!boqId,
    queryFn: () => fetchAdoptionHistory(boqId!),
  });
  const adoptionAvailable = history?.available ?? false;

  /** The one write path. Returns true only when the rate was applied and audited. */
  const adopt = async (line: CommercialLine, item: EvidenceItem, sources: AdoptionSources, acknowledged: string[]) => {
    if (!adoptionAvailable) { toast.error(ADOPTION_UNAVAILABLE_MESSAGE); return false; }
    if (!user?.id || !boqId) { toast.error("Sign in as a reviewer to adopt a rate"); return false; }
    setBusy(true);
    try {
      const result = await applyRateAdoption({
        boqId, line, item, sources, acknowledged, confirmedBy: user.id, today: new Date().toISOString().slice(0, 10),
      });
      if (result.status === "conflict") toast.error(result.message);
      else toast.success("Rate adopted into the BOQ");
      return result.status === "applied";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rate adoption failed");
      return false;
    } finally {
      setBusy(false);
      // Refresh everything that shows this line's commercial rate, including the BOQ editor.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["rate-adoption-lines", boqId] }),
        qc.invalidateQueries({ queryKey: ["rate-adoption", boqId] }),
        qc.invalidateQueries({ queryKey: ["boq-lines", boqId] }),
      ]);
    }
  };

  return { commercialLines, records: history?.records ?? [], adoptionAvailable, busy, adopt };
}
