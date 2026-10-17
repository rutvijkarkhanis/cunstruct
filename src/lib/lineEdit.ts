// MANUAL LINE EDITS — guarded and recorded, the same way manual rate edits
// are (lib/manualRateEdit). Covers quantity, unit, description, section,
// included and cost; rates keep their own audited path.
//
// 1. Compare-and-swap: the write takes effect only if the line still has the
//    values the person edited from — the quantity and unit always (they define
//    what the number means), plus every other field being changed.
//    A change saved meanwhile by someone else is never silently overwritten —
//    the caller is told, and nothing is written.
// 2. History: each changed field gets a boq_line_change_log row (who, when,
//    from, to) — the audit table Apply and rate edits already use. A failed
//    history insert is compensated: the edit is put back (guarded on the new
//    values) and the caller is told exactly what happened.
// 3. Where that table does not exist yet (migration
//    20260921000000_boq_review_apply.sql not applied — the case in production
//    today), the guarded edit is still saved and the result says it was NOT
//    recorded (decision D1-b, docs/closure/B-audit-policy.md: fail open with
//    disclosure while the table is absent; fail closed once it exists).
//
// Undo goes through the same path with the edited values as the expected
// state, so it never reverts someone else's later change.
import { db, isMissingTable } from "@/lib/untypedDb";
import { throwLineSaveError } from "@/lib/provenanceSave";

export interface EditableLine {
  id: string; qty: number; unit: string | null; quantity_status?: string | null; basis?: string | null;
  description?: string | null; section?: string | null; included?: boolean; cost?: number | null;
}
export type LineEditPatch = {
  qty?: number; unit?: string | null; basis?: string | null; quantity_status?: string | null;
  description?: string | null; section?: string | null; included?: boolean; cost?: number | null;
};

/** Fields recorded in the line's history when changed (basis/status are
 *  derived from the quantity edit and recorded through it). */
const HISTORY_FIELDS = ["qty", "unit", "description", "section", "included", "cost"] as const;
/** Fields the write is guarded on when they are being changed. */
const GUARDED = new Set<string>(HISTORY_FIELDS);

/** A guarded update: true when it took effect, false when the line no longer
 *  held the expected values (nothing written). Other errors throw. */
async function guardedUpdate(lineId: string, patch: LineEditPatch, expected: Record<string, unknown>): Promise<boolean> {
  let q = db.from("boq_line").update(patch).eq("id", lineId);
  for (const [k, v] of Object.entries(expected)) q = v == null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select("id");
  if (error) throwLineSaveError(error);
  return Array.isArray(data) && data.length > 0;
}

function expectedFor(line: EditableLine, patch: LineEditPatch): Record<string, unknown> {
  const touchesQty = "qty" in patch || "unit" in patch || "basis" in patch || "quantity_status" in patch;
  const exp: Record<string, unknown> = {};
  if (touchesQty) { exp.qty = line.qty; exp.unit = line.unit ?? null; }
  for (const k of Object.keys(patch)) if (GUARDED.has(k)) exp[k] = (line as unknown as Record<string, unknown>)[k] ?? null;
  return exp;
}

export type LineEditResult =
  | { status: "saved"; recorded: boolean }
  | { status: "conflict" }
  /** Written, but the history row was not; `reverted` says whether the edit was put back. */
  | { status: "history_failed"; reverted: boolean; message: string };

const show = (v: unknown) => (v == null ? null : String(v));

/** Fields of the patch that change the line, as history rows would record them. */
function changedFields(line: EditableLine, patch: LineEditPatch): { field: string; from: string | null; to: string | null }[] {
  const rows: { field: string; from: string | null; to: string | null }[] = [];
  for (const f of HISTORY_FIELDS) {
    if (!(f in patch)) continue;
    const before = (line as unknown as Record<string, unknown>)[f] ?? null, after = (patch as Record<string, unknown>)[f] ?? null;
    if (before !== after) rows.push({ field: f, from: show(before), to: show(after) });
  }
  return rows;
}

export async function saveLineEdit(args: {
  boqId: string; line: EditableLine; patch: LineEditPatch; changedBy: string | null;
}): Promise<LineEditResult> {
  const { line, patch } = args;
  const probe = await db.from("boq_line_change_log").select("id").limit(0);
  const historyAvailable = !isMissingTable("boq_line_change_log", probe.error);

  const ok = await guardedUpdate(line.id, patch, expectedFor(line, patch));
  if (!ok) return { status: "conflict" };
  if (!historyAvailable) return { status: "saved", recorded: false };

  const rows = changedFields(line, patch).map((r) => ({
    boq_id: args.boqId, boq_line_id: line.id, review_item_id: null, field: r.field,
    old_value: r.from, new_value: r.to, changed_by: args.changedBy,
  }));
  if (!rows.length) return { status: "saved", recorded: true };
  const { error } = await db.from("boq_line_change_log").insert(rows);
  if (!error) return { status: "saved", recorded: true };

  // Compensate: restore every field of the patch, but only if the line still
  // holds what we just wrote.
  const restore: LineEditPatch = {};
  for (const k of Object.keys(patch) as (keyof LineEditPatch)[]) (restore as Record<string, unknown>)[k] = line[k] ?? null;
  let reverted = false;
  try {
    reverted = await guardedUpdate(line.id, restore, expectedFor({ ...line, ...patch } as EditableLine, restore));
  } catch { reverted = false; }
  return { status: "history_failed", reverted, message: error.message };
}

/** Whether the line now holds the edit — true also when its history failed
 *  and putting the previous value back failed too. Callers keep an undo step
 *  for exactly these, so the undo history matches the database. */
export const editTookEffect = (r: LineEditResult) =>
  r.status === "saved" || (r.status === "history_failed" && !r.reverted);

/** What to tell the person when an edit did not simply save and record. */
export function lineEditMessage(r: LineEditResult, what = "Change"): string | null {
  if (r.status === "conflict") return `${what} not saved: this line was changed elsewhere since it was loaded. The current values are now shown.`;
  if (r.status === "history_failed") {
    return r.reverted
      ? `${what} not saved: its history record couldn't be saved (${r.message}). The previous value was kept.`
      : `${what} was saved, but its history record couldn't be saved (${r.message}) and putting the previous value back failed. Check this line.`;
  }
  return r.recorded ? null : `${what} saved. Change history is not set up on this database, so it is not in the line's history.`;
}

export type LineAddResult =
  | { status: "added"; id: string; row: Record<string, unknown>; recorded: boolean }
  /** Inserted, but its history row was not; `removed` says whether the new
   *  line was taken out again (it is unchanged and nothing references it). */
  | { status: "history_failed"; id: string; row: Record<string, unknown>; removed: boolean; message: string };

/**
 * Add a line and record its creation (field "line_created" plus its initial
 * qty and unit, as Apply records the lines it creates). Same policy as edits:
 * saved with disclosure where the history table is absent; removed again when
 * the table exists but the history row fails. Insert errors throw.
 */
export async function addLineRecorded(args: {
  boqId: string; row: Record<string, unknown>; changedBy: string | null;
}): Promise<LineAddResult> {
  const probe = await db.from("boq_line_change_log").select("id").limit(0);
  const historyAvailable = !isMissingTable("boq_line_change_log", probe.error);

  const ins = await db.from("boq_line").insert(args.row).select("*");
  if (ins.error) throwLineSaveError(ins.error);
  const row = (Array.isArray(ins.data) ? ins.data[0] : ins.data) as Record<string, unknown> | undefined;
  const id = row?.id as string | undefined;
  if (!row || !id) throw new Error("The line was not added: the database returned no row.");
  if (!historyAvailable) return { status: "added", id, row, recorded: false };

  const base = { boq_id: args.boqId, boq_line_id: id, review_item_id: null, changed_by: args.changedBy };
  const { error } = await db.from("boq_line_change_log").insert([
    { ...base, field: "line_created", old_value: null, new_value: show(row.description) },
    { ...base, field: "qty", old_value: null, new_value: show(row.qty) },
    ...(row.unit != null ? [{ ...base, field: "unit", old_value: null, new_value: show(row.unit) }] : []),
  ]);
  if (!error) return { status: "added", id, row, recorded: true };

  let removed = false;
  try {
    const del = await db.from("boq_line").delete().eq("id", id).select("id");
    removed = !del.error && Array.isArray(del.data) && del.data.length > 0;
  } catch { removed = false; }
  return { status: "history_failed", id, row, removed, message: error.message };
}

export function lineAddMessage(r: LineAddResult): string | null {
  if (r.status === "history_failed") {
    return r.removed
      ? `Line not added: its history record couldn't be saved (${r.message}).`
      : `The line was added, but its history record couldn't be saved (${r.message}) and taking it out again failed. Check the BOQ.`;
  }
  return r.recorded ? null : "Line added. Change history is not set up on this database, so it is not in the BOQ's history.";
}
