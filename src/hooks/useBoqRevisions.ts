// COMMERCIAL REVISIONS DATA — list a BOQ's frozen revisions, freeze a new one
// (the create_boq_commercial_revision RPC, the only write path), and export a
// saved revision from its OWN rows. Nothing here reads or writes the working
// BOQ's lines; the caller supplies the snapshot.
//
// The tables/RPC come from an unapplied migration
// (20261006000000_boq_commercial_revision.sql). While missing, `available` is
// false and freezing is refused; the live BOQ and its exports are unaffected.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db, isMissingTable, rpc } from "@/lib/untypedDb";
import { buildBoqCsv, downloadCsv, openDsrQuote } from "@/lib/boqDsrDocument";
import {
  csvRowsFrom, pendingItemsFrom, revisionFileStem, revisionQuotePayload,
  type RevisionLimitation, type RevisionLine, type StoredRevision,
} from "@/lib/boqRevision";

export const REVISION_TABLE = "boq_commercial_revision";
export const REVISION_LINE_TABLE = "boq_commercial_revision_line";
export const REVISIONS_UNAVAILABLE_MESSAGE =
  "Commercial revisions are not set up on this database yet (migration 20261006000000_boq_commercial_revision.sql has not been applied). The working BOQ and its exports are unaffected.";

export interface RevisionHeaderDraft {
  boq_name: string;
  project_name: string | null;
  context: Record<string, unknown>;
  commercials: unknown;
  works_total: number;
  grand_total: number;
  priced_line_count: number;
  limitations: RevisionLimitation[];
  limitations_acknowledged: boolean;
  issue_note: string | null;
}

export async function loadRevisionLines(revisionId: string): Promise<RevisionLine[]> {
  const { data, error } = await db.from(REVISION_LINE_TABLE).select("*").eq("revision_id", revisionId).order("position");
  if (error) throw error;
  return (data ?? []) as RevisionLine[];
}

export function useBoqRevisions(boqId: string | undefined | null) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["boq-revisions", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data, error } = await db.from(REVISION_TABLE).select("*").eq("boq_id", boqId!).order("revision_no", { ascending: false });
      if (isMissingTable(REVISION_TABLE, error)) return { available: false, revisions: [] as StoredRevision[] };
      if (error) throw error;
      return { available: true, revisions: (data ?? []) as StoredRevision[] };
    },
  });

  /** Freeze the supplied snapshot. Returns the new revision id, or null. */
  const createRevision = async (header: RevisionHeaderDraft, lines: RevisionLine[]): Promise<string | null> => {
    if (data && !data.available) { toast.error(REVISIONS_UNAVAILABLE_MESSAGE); return null; }
    if (!boqId) return null;
    if (header.limitations.length > 0 && !header.limitations_acknowledged) {
      toast.error("Acknowledge the listed limitations before freezing this revision");
      return null;
    }
    setBusy(true);
    try {
      const { data: id, error } = await rpc("create_boq_commercial_revision", { p_boq_id: boqId, p_header: header, p_lines: lines });
      if (error) {
        toast.error(/create_boq_commercial_revision|schema cache|could not find/i.test(error.message) ? REVISIONS_UNAVAILABLE_MESSAGE : error.message);
        return null;
      }
      toast.success("Commercial revision frozen");
      await qc.invalidateQueries({ queryKey: ["boq-revisions", boqId] });
      return id as string;
    } finally { setBusy(false); }
  };

  /** Export a saved revision from its own rows — never the working BOQ. */
  const exportRevision = async (rev: StoredRevision, kind: "pdf" | "pdf_blank" | "csv") => {
    try {
      const lines = await loadRevisionLines(rev.id);
      if (!lines.length) { toast.error("This revision has no saved lines"); return; }
      if (kind === "csv") {
        // Built from the revision's own saved rows only; pending lines go to the pending section.
        const rows = csvRowsFrom(lines);
        const pending = pendingItemsFrom(lines);
        if (!rows.length && !pending.length) { toast.error("Nothing to export in this revision"); return; }
        downloadCsv(`${revisionFileStem(rev)}_BOQ.csv`, buildBoqCsv(rows, {
          boqName: `${rev.boq_name} — ${rev.label}`, project: rev.project_name, generatedOn: `${rev.issued_at.slice(0, 10)} (${rev.label}, frozen)`,
          commercials: rev.commercials, frozenAs: `${rev.label}, frozen ${rev.issued_at.slice(0, 10)}`,
        }, pending));
        return;
      }
      const payload = revisionQuotePayload(rev, lines, kind === "pdf_blank");
      if (!payload.subheads.length && !payload.pendingItems?.length) { toast.error("Nothing to export in this revision"); return; }
      if (!openDsrQuote(payload, { autoPrint: kind === "pdf" })) toast.error("Allow pop-ups to export");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load this revision");
    }
  };

  return {
    revisions: data?.revisions ?? [], available: data?.available ?? true, loading: isLoading, busy,
    createRevision, exportRevision,
  };
}
