// LINE REMOVAL — removing a BOQ line so that undo puts back exactly what was
// removed: the whole stored row (identity, source, provenance, quantity status,
// basis, drawing reference, location…) and the links other records held to it.
//
// Removal snapshots the full row (select *) rather than the columns an editor
// happens to show, so a column added later is restored too. Records that point
// at the line with ON DELETE SET NULL (audit findings, the change log, rate
// adoptions/reviews) lose that link when the row goes; their ids are recorded
// so undo can point them back. Records that would be DELETED with the line
// (ON DELETE CASCADE: vendor quotations, rate reviews, DSR mappings) cannot be
// brought back by re-inserting the row, so a line that has any is not removed
// at all — the caller is told why. Nothing here needs a schema change.
//
// Guarded and recorded (docs/closure/B-audit-policy.md):
// * `expected` — the values the person saw. Removal is refused when the stored
//   line no longer holds them (someone changed it meanwhile), and the delete
//   itself is filtered on them, so a change landing between read and delete
//   is never destroyed. A delete that removes no row (already gone, or
//   filtered out by row-level security) is reported, never shown as removed.
// * `history` — removal writes a boq_line_change_log row (field
//   "line_removed", old_value = the complete removed row as JSON), so the line
//   can be traced and recovered after this browser tab is gone. If that row
//   cannot be written, the line is put back (fail closed). Where the history
//   table does not exist, removal is refused unless `requireHistory` is false
//   (undo of a line added in this session, unchanged since). Restoring writes
//   a "line_restored" row and re-attaches the "line_removed" row to the line.
import { db as defaultDb, isMissingTable, type DbError, type Query } from "@/lib/untypedDb";

/** The values a removal is guarded on: what an editor shows of the line
 *  (shared by the BOQ builder and the workbench). Absent columns are skipped. */
export const REMOVAL_GUARD_COLS = ["description", "section", "qty", "unit", "custom_rate", "dsr_rate", "cost", "included"] as const;
export function removalGuard(line: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of REMOVAL_GUARD_COLS) if (k in line) out[k] = (line as Record<string, unknown>)[k];
  return out;
}

/** A removal refused because the line is no longer as it was seen (changed
 *  or removed elsewhere) — as opposed to one refused for safety reasons
 *  (linked records, no history table) or a failure. */
export const isStaleRemoval = (e: unknown) =>
  e instanceof LineRemovalError && /changed elsewhere since it was loaded|no longer exists|the database removed nothing/.test(e.message);

/** Removal is destructive; without a history table the only record of what
 *  was removed would be this browser tab. Refuse it (exclude the line from the
 *  total instead, which is a recorded, reversible edit). */
export const REMOVAL_REQUIRES_HISTORY = true;

export interface RemovalHistory {
  boqId: string;
  changedBy: string | null;
  /** Default REMOVAL_REQUIRES_HISTORY. */
  requireHistory?: boolean;
}

type Client = { from: (table: string) => Query };

/** References whose rows are deleted along with the line. */
export const CASCADE_REFS: readonly { table: string; column: string; what: string }[] = [
  { table: "vendor_quotation", column: "boq_line_id", what: "vendor quotation" },
  { table: "boq_line_rate_review", column: "boq_line_id", what: "rate review" },
  { table: "boq_line_dsr_mapping", column: "boq_line_id", what: "DSR mapping" },
];

/** References that are set to null when the line is deleted. */
export const SET_NULL_REFS: readonly { table: string; column: string }[] = [
  { table: "boq_audit_finding", column: "boq_line_id" },
  { table: "boq_line_change_log", column: "boq_line_id" },
  { table: "boq_line_rate_adoption", column: "boq_line_id" },
  { table: "boq_line_rate_adoption", column: "source_boq_line_id" },
  { table: "boq_line_rate_review", column: "preferred_boq_line_id" },
];

export interface RemovedLine {
  /** The complete stored row, exactly as read before deletion. */
  row: Record<string, unknown>;
  /** Ids of rows whose reference to the line the deletion cleared. */
  links: { table: string; column: string; ids: string[] }[];
  /** true: a "line_removed" history row was written; false: history not set up
   *  (removal allowed only with requireHistory false); null: not asked to record. */
  historyRecorded: boolean | null;
}

export class LineRemovalError extends Error {
  /** Set only when the line WAS removed despite the error (its history row
   *  failed and putting it back failed too): the caller must keep an undo step. */
  removed?: RemovedLine;
  /** Refused only because removal can't be done safely here (no change
   *  history, or linked records it would destroy) — excluding the line from
   *  the total is the safe alternative. Never set for conflicts or read errors. */
  excludeInstead?: boolean;
  constructor(message: string, opts: { excludeInstead?: boolean } = {}) {
    super(message);
    this.excludeInstead = opts.excludeInstead;
  }
}

/** Same stored value: numbers compare numerically (numeric columns may come
 *  back as strings), null and undefined are the same "no value". */
const same = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && typeof (typeof a === "number" ? a : b) === "number" && Number(a) === Number(b));

async function historyAvailable(client: Client): Promise<boolean> {
  const probe = await client.from("boq_line_change_log").select("id").limit(0);
  return !isMissingTable("boq_line_change_log", probe.error);
}

const fail = (what: string, e: DbError): never => {
  throw new LineRemovalError(`${what} — ${e.message}`);
};

/**
 * Snapshot, check and delete one line. Throws LineRemovalError (nothing
 * deleted) when the row can't be read, when any check can't be completed, or
 * when removal would destroy records undo cannot restore.
 */
export async function removeLineWithSnapshot(
  lineId: string,
  client: Client = defaultDb,
  opts: { expected?: Record<string, unknown>; history?: RemovalHistory } = {},
): Promise<RemovedLine> {
  const { expected = {}, history } = opts;
  let record = false;
  if (history) {
    record = await historyAvailable(client);
    if (!record && (history.requireHistory ?? REMOVAL_REQUIRES_HISTORY)) {
      throw new LineRemovalError(
        "Line not removed: removals are recorded in the BOQ's change history, and change history is not set up on this database yet (migration 20260921000000_boq_review_apply.sql has not been applied). Exclude the line from the total instead — that is saved and can be undone.",
        { excludeInstead: true },
      );
    }
  }

  const snap = await client.from("boq_line").select("*").eq("id", lineId).maybeSingle();
  if (snap.error) fail("Line not removed: it could not be read first, so it could not be restored", snap.error);
  if (!snap.data) throw new LineRemovalError("Line not removed: it no longer exists.");
  const row = snap.data as Record<string, unknown>;
  const drifted = Object.keys(expected).filter((k) => !same(row[k], expected[k]));
  if (drifted.length) {
    throw new LineRemovalError(`Line not removed: it was changed elsewhere since it was loaded (${drifted.join(", ")}). The current values are now shown.`);
  }

  for (const ref of CASCADE_REFS) {
    const r = await client.from(ref.table).select("id").eq(ref.column, lineId).limit(1);
    if (r.error) {
      if (isMissingTable(ref.table, r.error)) continue;
      fail(`Line not removed: could not check for a linked ${ref.what}`, r.error);
    }
    if (Array.isArray(r.data) && r.data.length) {
      throw new LineRemovalError(
        `Line not removed: it has a linked ${ref.what}, which would be deleted with it and could not be restored by undo. Exclude the line from the total instead.`,
        { excludeInstead: true },
      );
    }
  }

  const links: RemovedLine["links"] = [];
  for (const ref of SET_NULL_REFS) {
    const r = await client.from(ref.table).select("id").eq(ref.column, lineId);
    if (r.error) {
      if (isMissingTable(ref.table, r.error)) continue;
      fail(`Line not removed: could not record its links in ${ref.table}, so undo could not restore them`, r.error);
    }
    const ids = ((r.data ?? []) as { id: string }[]).map((x) => x.id);
    if (ids.length) links.push({ table: ref.table, column: ref.column, ids });
  }

  // Filtered on what was checked above: a change landing in between is not destroyed.
  let dq = client.from("boq_line").delete().eq("id", lineId);
  for (const k of Object.keys(expected)) dq = row[k] == null ? dq.is(k, null) : dq.eq(k, row[k]);
  const del = await dq.select("id");
  if (del.error) fail("Line not removed", del.error);
  if (!Array.isArray(del.data) || del.data.length === 0) {
    throw new LineRemovalError("Line not removed: the database removed nothing — the line was changed or removed elsewhere, or you do not have permission to remove it. The current lines are now shown.");
  }
  const removed: RemovedLine = { row, links, historyRecorded: history ? record : null };
  if (!history || !record) return removed;

  // The row is gone, so the history row cannot reference it (FK); it carries
  // the whole row instead, and restore re-attaches it like any set-null link.
  const log = await client.from("boq_line_change_log").insert({
    boq_id: history.boqId, boq_line_id: null, review_item_id: null, field: "line_removed",
    old_value: JSON.stringify(row), new_value: null, changed_by: history.changedBy,
  }).select("id");
  const logId = Array.isArray(log.data) ? (log.data[0] as { id?: string } | undefined)?.id : undefined;
  if (!log.error) {
    if (logId) removed.links = [...links, { table: "boq_line_change_log", column: "boq_line_id", ids: [logId] }];
    return removed;
  }
  // Compensate: an unrecorded removal is not allowed to stand.
  let unrestored: RestoreResult["unrestoredLinks"] = [];
  try {
    unrestored = (await restoreRemovedLine({ row, links, historyRecorded: null }, client)).unrestoredLinks;
  } catch (e) {
    const err = new LineRemovalError(
      `The line was removed, but its history record couldn't be saved (${log.error.message}) and putting it back failed (${e instanceof Error ? e.message : String(e)}). Use Undo to restore it.`,
    );
    err.removed = { row, links, historyRecorded: false };
    throw err;
  }
  const note = unrestored.length ? ` ${unrestored.map((u) => `${u.expected - u.restored} link(s) in ${u.table}`).join(", ")} could not be re-attached.` : "";
  throw new LineRemovalError(`Line not removed: its history record couldn't be saved (${log.error.message}). The line was put back.${note}`);
}

export interface RestoreResult {
  /** Links that could not be pointed back at the restored line. */
  unrestoredLinks: { table: string; column: string; expected: number; restored: number; error?: string }[];
  /** "line_restored" history row: true written, false failed or table absent
   *  (`historyError` says why), null not asked to record. The line stays
   *  restored either way — removing it again would be an unrecorded
   *  destructive change; the caller tells the person. */
  historyRecorded: boolean | null;
  historyError?: string;
}

/**
 * Undo a removal: re-insert the exact row (same id), then point recorded
 * links back at it — only where the link is still empty, so a record
 * re-pointed elsewhere in the meantime is left alone. Throws when the row
 * itself can't be re-inserted; a link that can't be restored is reported in
 * the result, never hidden.
 */
export async function restoreRemovedLine(removed: RemovedLine, client: Client = defaultDb, history?: RemovalHistory): Promise<RestoreResult> {
  const ins = await client.from("boq_line").insert(removed.row);
  if (ins.error) fail("Line not restored", ins.error);
  const lineId = removed.row.id as string;
  const unrestoredLinks: RestoreResult["unrestoredLinks"] = [];
  for (const link of removed.links) {
    const r = await client.from(link.table).update({ [link.column]: lineId })
      .in("id", link.ids).is(link.column, null).select("id");
    const restored = Array.isArray(r.data) ? r.data.length : 0;
    if (r.error || restored < link.ids.length) {
      unrestoredLinks.push({ table: link.table, column: link.column, expected: link.ids.length, restored, error: r.error?.message });
    }
  }
  if (!history) return { unrestoredLinks, historyRecorded: null };
  const log = await client.from("boq_line_change_log").insert({
    boq_id: history.boqId, boq_line_id: lineId, review_item_id: null, field: "line_restored",
    old_value: null, new_value: null, changed_by: history.changedBy,
  });
  if (!log.error) return { unrestoredLinks, historyRecorded: true };
  return {
    unrestoredLinks, historyRecorded: false,
    historyError: isMissingTable("boq_line_change_log", log.error) ? "change history is not set up on this database" : log.error.message,
  };
}
