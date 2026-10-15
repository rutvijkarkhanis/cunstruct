// MANUAL RATE EDITS — the BOQ editor's inline rate field, audited.
//
// A manual edit changes boq_line.custom_rate through applyFinding's
// compare-and-swap (only if the line still shows the rate the user edited
// from), then records the before/after in boq_line_change_log, the same audit
// table every Apply uses. There is no database function that can do both
// atomically without a new migration, so a failed audit insert is compensated:
// the rate is put back (guarded on the new value), and the caller is told
// exactly what happened — an unaudited change is never reported as success.
// If the audit table doesn't exist on this database yet (migration
// 20260921000000_boq_review_apply.sql not applied), nothing is written at all.
//
// Adoption history (boq_line_rate_adoption) is never touched. A line whose
// custom_rate no longer equals its latest adopted rate is reported as
// "changed after adoption"; the adoption record stays as history.

import { applyManualRate } from "@/lib/applyFinding";
import { db, isMissingTable } from "@/lib/untypedDb";

export interface RateEditLine {
  id: string;
  custom_rate: number | null;
  dsr_rate: number | null;
  unit: string | null;
}

export interface AdoptionSummary {
  boq_line_id: string | null;
  adopted_rate: number;
  source_label: string;
  confirmed_at: string;
}

export type AdoptionState =
  | { kind: "none" }
  | { kind: "adopted"; record: AdoptionSummary }              // the current rate IS the latest adopted rate
  | { kind: "changed_after_adoption"; record: AdoptionSummary }; // a later manual edit replaced it

/** The line's adoption status from its latest adoption record (by confirmation time). */
export function adoptionStateFor(line: Pick<RateEditLine, "id" | "custom_rate">, records: AdoptionSummary[]): AdoptionState {
  const latest = records
    .filter((r) => r.boq_line_id === line.id)
    .sort((a, b) => b.confirmed_at.localeCompare(a.confirmed_at))[0];
  if (!latest) return { kind: "none" };
  return line.custom_rate != null && Number(line.custom_rate) === Number(latest.adopted_rate)
    ? { kind: "adopted", record: latest }
    : { kind: "changed_after_adoption", record: latest };
}

export type ManualRateResult =
  | { status: "applied" }
  | { status: "conflict" }
  /** The audit table isn't on this database yet; nothing was written. */
  | { status: "audit_unavailable" }
  /** The rate was written but its audit row wasn't; `reverted` says whether the rate was put back. */
  | { status: "audit_failed"; reverted: boolean; message: string };

export async function applyManualRateEdit(args: {
  boqId: string;
  line: RateEditLine;
  newRate: number | null;
  changedBy: string | null;
}): Promise<ManualRateResult> {
  const { line, newRate } = args;
  // Read-only check first, so a database without audit history never sees an
  // unaudited write (not even one that would be reverted).
  const probe = await db.from("boq_line_change_log").select("id").limit(0);
  if (isMissingTable("boq_line_change_log", probe.error)) return { status: "audit_unavailable" };

  const ok = await applyManualRate(line.id, newRate, { custom_rate: line.custom_rate, dsr_rate: line.dsr_rate, unit: line.unit });
  if (!ok) return { status: "conflict" };

  const { error } = await db.from("boq_line_change_log").insert({
    boq_id: args.boqId, boq_line_id: line.id, review_item_id: null, field: "custom_rate",
    old_value: line.custom_rate == null ? null : String(line.custom_rate),
    new_value: newRate == null ? null : String(newRate),
    changed_by: args.changedBy,
  });
  if (!error) return { status: "applied" };

  // Compensate: put the previous rate back, but only if nothing else has
  // changed the line since our write.
  let reverted = false;
  try {
    reverted = await applyManualRate(line.id, line.custom_rate, { custom_rate: newRate, dsr_rate: line.dsr_rate, unit: line.unit });
  } catch {
    reverted = false;
  }
  return { status: "audit_failed", reverted, message: error.message };
}

const fmt = (n: number | null) => (n == null ? "the DSR rate" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

/** The user-facing outcome of a non-successful edit. */
export function manualRateFailureMessage(r: Exclude<ManualRateResult, { status: "applied" }>, newRate: number | null): string {
  if (r.status === "conflict") return "This line's rate was changed elsewhere since you opened it — nothing was saved. The current rate is shown.";
  if (r.status === "audit_unavailable") return "Rate not changed: rate edits are audited, and audit history is not set up on this database yet (migration 20260921000000_boq_review_apply.sql has not been applied). Nothing was saved.";
  return r.reverted
    ? `Rate not changed: its audit record couldn't be saved (${r.message}). The previous rate was kept.`
    : `The rate was changed to ${fmt(newRate)} but its audit record couldn't be saved (${r.message}), and restoring the previous rate failed. Check this line.`;
}
