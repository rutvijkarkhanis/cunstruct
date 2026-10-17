// DSR CHECK — PERSISTENCE. Decisions on scope suggestions, the pending lines
// an Accept creates, the audited "use the schedule rate" action, and loading
// one schedule from dsr_item. No migration is needed:
//
// * Decisions live in boq.spec._dsr_scope_decisions (key → record), written
//   with a compare-and-swap on boq.updated_at, and are also recorded in
//   boq_line_change_log (field "dsr_scope_decision") when that table exists.
//   A decision someone else changed meanwhile is never overwritten.
// * Accept creates one line per chosen schedule item with quantity PENDING
//   (qty 0, basis PENDING), the item's code/description/unit, NO rate, and
//   external_key dsr-scope:<suggestion>:<code> — so a retry never duplicates
//   it and the suggestion can always find the lines it created.
// * Reject and Defer write only the decision. Nothing is ever deleted.
// * The schedule rate is a separate, audited step: it validates schedule,
//   code and unit, refuses without the history table (like manual rate
//   edits), and is guarded on the line's current rate fields.
import { db, isMissingTable, type DbError } from "@/lib/untypedDb";
import { DSR_SCOPE_DECISIONS_KEY, readBoqSpec, SpecAbort, writeBoqSpecKeys } from "@/lib/boqSpecWrite";
import { throwLineSaveError } from "@/lib/provenanceSave";
import { PENDING_BASIS } from "@/lib/quantity";
import { compareUnit, matchableDescription, scheduleLabel, type DsrItem } from "./catalogue";
import { scopeLineKey, type ScopeSuggestion } from "./scope";

export type ScopeDecision = "accepted" | "rejected" | "deferred";
export interface ScopeDecisionRecord {
  decision: ScopeDecision;
  at: string;
  by: string | null;
  note?: string | null;
  schedule: string;
  /** Accept only: the schedule items chosen and the lines created for them. */
  codes?: string[];
  lineIds?: string[];
}
export type ScopeDecisions = Record<string, ScopeDecisionRecord>;
export const SCOPE_DECISIONS_KEY = DSR_SCOPE_DECISIONS_KEY;

export function decisionsFromSpec(spec: unknown): ScopeDecisions {
  const d = (spec as Record<string, unknown> | null)?.[SCOPE_DECISIONS_KEY];
  return d && typeof d === "object" ? (d as ScopeDecisions) : {};
}

const sameDecision = (a: ScopeDecisionRecord | null | undefined, b: ScopeDecisionRecord | null | undefined) =>
  (a?.decision ?? null) === (b?.decision ?? null) && (a?.at ?? null) === (b?.at ?? null);

/** The stored record already says what this request asks for — the same
 *  person's same decision (a double click, or a retry whose first attempt was
 *  saved but whose reply was lost). Repeating it changes nothing. */
const alreadyDecided = (current: ScopeDecisionRecord | null, want: { decision: ScopeDecision | null; note: string | null; by: string | null; codes?: string[] }) => {
  if (want.decision === null) return current === null;
  if (!current || current.decision !== want.decision || (current.by ?? null) !== want.by) return false;
  if (want.decision === "accepted") return (want.codes ?? []).every((c) => current.codes?.includes(c));
  return (current.note ?? null) === want.note;
};

export type ScopeSaveResult =
  /** `unchanged`: the stored decision already was this one; nothing was written. */
  | { status: "saved"; record: ScopeDecisionRecord | null; historyRecorded: boolean; unchanged?: true }
  /** Someone else decided this suggestion (or changed the BOQ) meanwhile; nothing was saved. */
  | { status: "conflict" };

/**
 * Set (or with `decision: null`, clear — used by Undo) one suggestion's
 * decision. `expected` is the record the person saw (null = undecided).
 * The write goes through the shared guarded spec writer (compare-and-swap on
 * boq.updated_at, bounded retry), changing only SCOPE_DECISIONS_KEY.
 */
export async function saveScopeDecision(args: {
  boqId: string; key: string; decision: ScopeDecision | null; expected: ScopeDecisionRecord | null;
  note?: string | null; schedule: string; changedBy: string | null; codes?: string[]; lineIds?: string[];
}): Promise<ScopeSaveResult> {
  const note = args.note?.trim() || null;
  const record: ScopeDecisionRecord | null = args.decision
    ? {
        decision: args.decision, at: new Date().toISOString(), by: args.changedBy, note, schedule: args.schedule,
        ...(args.codes ? { codes: args.codes } : {}), ...(args.lineIds ? { lineIds: args.lineIds } : {}),
      }
    : null;
  const res = await writeBoqSpecKeys<{ kind: "conflict" } | { kind: "unchanged"; current: ScopeDecisionRecord | null }>(args.boqId, (spec) => {
    const decisions = decisionsFromSpec(spec);
    const current = decisions[args.key] ?? null;
    if (!sameDecision(current, args.expected)) {
      return new SpecAbort(alreadyDecided(current, { decision: args.decision, note, by: args.changedBy, codes: args.codes })
        ? { kind: "unchanged" as const, current } : { kind: "conflict" as const });
    }
    const next = { ...decisions };
    if (record) next[args.key] = record; else delete next[args.key];
    return { [SCOPE_DECISIONS_KEY]: next };
  });
  if (res.status === "conflict") return { status: "conflict" };
  if (res.status === "aborted") {
    return res.reason.kind === "unchanged" ? { status: "saved", record: res.reason.current, historyRecorded: true, unchanged: true } : { status: "conflict" };
  }
  const { error: logError } = await db.from("boq_line_change_log").insert({
    boq_id: args.boqId, boq_line_id: null, review_item_id: null, field: "dsr_scope_decision",
    old_value: args.expected ? `${args.expected.decision}: ${args.key}` : `undecided: ${args.key}`,
    new_value: `${record ? record.decision : "undecided"}: ${args.key}${record?.codes?.length ? ` (${record.codes.join(", ")})` : ""}${record?.note ? ` — ${record.note}` : ""}`,
    changed_by: args.changedBy,
  });
  return { status: "saved", record, historyRecorded: !logError };
}

export type AcceptResult =
  | { status: "accepted"; lineIds: string[]; created: number; decision: ScopeSaveResult }
  | { status: "conflict" }
  | { status: "invalid"; reason: string };

/**
 * Accept: add a PENDING line for each chosen schedule item, then record the
 * decision. Lines that already exist for this suggestion+item are reused.
 */
export async function acceptScopeSuggestion(args: {
  boqId: string; suggestion: Pick<ScopeSuggestion, "key" | "title" | "options" | "triggers">; codes: string[];
  expected: ScopeDecisionRecord | null; note?: string | null; schedule: { source: string; year: string | null };
  section?: string | null; changedBy: string | null;
}): Promise<AcceptResult> {
  const label = scheduleLabel(args.schedule.source, args.schedule.year);
  const chosen = args.codes.map((c) => args.suggestion.options.find((o) => o.code === c));
  if (!chosen.length) return { status: "invalid", reason: "Choose at least one schedule item to add." };
  if (chosen.some((o) => !o)) return { status: "invalid", reason: "A chosen item is not one of this suggestion's schedule items." };
  if (chosen.some((o) => o!.source !== args.schedule.source || (o!.rate_year ?? null) !== (args.schedule.year ?? null))) {
    return { status: "invalid", reason: `A chosen item is not from ${label}, the schedule this BOQ is priced on.` };
  }
  // Refuse before writing anything if the decision changed meanwhile — unless
  // it changed to exactly this acceptance by this person (a double click or a
  // retry): then the lines are found again below and nothing is duplicated.
  const current = decisionsFromSpec((await readBoqSpec(args.boqId)).spec)[args.suggestion.key] ?? null;
  if (!sameDecision(current, args.expected)
    && !alreadyDecided(current, { decision: "accepted", note: null, by: args.changedBy, codes: args.codes })) return { status: "conflict" };

  const trigger = args.suggestion.triggers[0];
  const lineIds: string[] = [];
  let created = 0;
  const findLine = async (externalKey: string) => {
    const existing = await db.from("boq_line").select("id").eq("boq_id", args.boqId).eq("external_key", externalKey).limit(1);
    if (existing.error) throwLineSaveError(existing.error);
    return (existing.data as { id: string }[] | null)?.[0] ?? null;
  };
  for (const item of chosen as DsrItem[]) {
    const externalKey = scopeLineKey(args.suggestion.key, item.code);
    const found = await findLine(externalKey);
    if (found) { lineIds.push(found.id); continue; }
    const ins = await db.from("boq_line").insert({
      boq_id: args.boqId,
      section: args.section ?? null,
      dsr_code: item.code,
      description: matchableDescription(item.description),
      unit: item.unit,
      qty: 0,
      quantity_status: "PENDING",
      basis: PENDING_BASIS,
      basis_note: `Accepted from the DSR check: ${label} item ${trigger?.dsrCode ?? "?"} excludes ${trigger?.clause ?? args.suggestion.title}. Quantity to be measured from the drawings; rate not yet matched.`,
      external_key: externalKey,
      included: true,
      source: "manual",
      sort: 9999,
    }).select("id").maybeSingle();
    if (ins.error) {
      // Two concurrent accepts: the other one inserted this line first (the
      // BOQ's identity index refuses a second) — use that line.
      const raced = (ins.error as DbError).code === "23505" ? await findLine(externalKey) : null;
      if (!raced) throwLineSaveError(ins.error as DbError);
      lineIds.push(raced.id);
      continue;
    }
    lineIds.push((ins.data as { id: string }).id);
    created++;
  }
  // Adding further items to an accepted suggestion keeps the earlier ones.
  const prior = args.expected?.decision === "accepted" ? args.expected : null;
  const union = <T,>(a: T[] | undefined, b: T[]) => [...new Set([...(a ?? []), ...b])];
  const decision = await saveScopeDecision({
    boqId: args.boqId, key: args.suggestion.key, decision: "accepted", expected: args.expected, note: args.note?.trim() ? args.note : prior?.note,
    schedule: label, changedBy: args.changedBy, codes: union(prior?.codes, args.codes), lineIds: union(prior?.lineIds, lineIds),
  });
  return { status: "accepted", lineIds, created, decision };
}

// ── Schedule rate ────────────────────────────────────────────────────────────

export interface ScheduleRateLine { id: string; dsr_code: string | null; dsr_rate: number | null; custom_rate: number | null; unit: string | null }

export type ScheduleRateResult =
  | { status: "applied"; manualRateStillApplies: boolean }
  | { status: "invalid"; reason: string }
  | { status: "conflict" }
  | { status: "audit_unavailable" }
  | { status: "audit_failed"; reverted: boolean; message: string };

/** Why `item` cannot price `line` under this schedule, or null when it can. */
export function scheduleRateProblem(line: ScheduleRateLine, item: DsrItem | null | undefined, schedule: { source: string; year: string | null }): string | null {
  const label = scheduleLabel(schedule.source, schedule.year);
  if (!item) return `The line's code is not an item in ${label}.`;
  if (item.source !== schedule.source || (item.rate_year ?? null) !== (schedule.year ?? null)) return `Item ${item.code} is not from ${label}.`;
  if (line.dsr_code && line.dsr_code.trim() !== item.code) return `The line is coded ${line.dsr_code}, not ${item.code}.`;
  if (item.rate == null) return `${label} item ${item.code} has no rate.`;
  const u = compareUnit(line.unit, item.unit);
  if (u !== "match") return `Unit check failed: the line is in ${line.unit ?? "no unit"}, item ${item.code} in ${item.unit ?? "no unit"}${u === "convertible" ? " — convert the quantity first; no conversion is assumed" : ""}.`;
  return null;
}

async function guardedRate(lineId: string, patch: object, expected: Record<string, unknown>): Promise<boolean> {
  let q = db.from("boq_line").update(patch).eq("id", lineId);
  for (const [k, v] of Object.entries(expected)) q = v == null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select("id");
  if (error) throwLineSaveError(error);
  return Array.isArray(data) && data.length > 0;
}

export async function applyScheduleRate(args: {
  boqId: string; line: ScheduleRateLine; item: DsrItem | null | undefined;
  schedule: { source: string; year: string | null }; changedBy: string | null;
}): Promise<ScheduleRateResult> {
  const { line, item } = args;
  const problem = scheduleRateProblem(line, item, args.schedule);
  if (problem) return { status: "invalid", reason: problem };
  const probe = await db.from("boq_line_change_log").select("id").limit(0);
  if (isMissingTable("boq_line_change_log", probe.error)) return { status: "audit_unavailable" };

  const expected = { dsr_rate: line.dsr_rate, dsr_code: line.dsr_code, custom_rate: line.custom_rate, unit: line.unit };
  const patch = { dsr_rate: item!.rate, dsr_code: item!.code };
  if (!(await guardedRate(line.id, patch, expected))) return { status: "conflict" };
  const label = scheduleLabel(args.schedule.source, args.schedule.year);
  const rows = [{
    boq_id: args.boqId, boq_line_id: line.id, review_item_id: null, field: "dsr_rate",
    old_value: line.dsr_rate == null ? null : String(line.dsr_rate), new_value: `${item!.rate} (${label} ${item!.code})`, changed_by: args.changedBy,
  }];
  if (line.dsr_code !== item!.code) rows.push({ ...rows[0], field: "dsr_code", old_value: line.dsr_code, new_value: item!.code });
  const { error } = await db.from("boq_line_change_log").insert(rows);
  if (!error) return { status: "applied", manualRateStillApplies: line.custom_rate != null };
  let reverted = false;
  try {
    reverted = await guardedRate(line.id, { dsr_rate: line.dsr_rate, dsr_code: line.dsr_code }, { ...expected, ...patch });
  } catch { reverted = false; }
  return { status: "audit_failed", reverted, message: error.message };
}

// ── Catalogue ────────────────────────────────────────────────────────────────

const PAGE = 1000;
/** Every billable item of one schedule, paged (PostgREST caps a response). */
export async function loadDsrSchedule(source: string, year: string | null): Promise<DsrItem[]> {
  const out: DsrItem[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from("dsr_item").select("id, source, rate_year, code, chapter, subhead, description, unit, rate").eq("source", source).eq("billable", true);
    q = year == null ? q.is("rate_year", null) : q.eq("rate_year", year);
    const { data, error } = await q.order("code").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as DsrItem[] | null) ?? [];
    out.push(...rows.map((r) => ({ ...r, rate: r.rate == null ? null : Number(r.rate) })));
    if (rows.length < PAGE) return out;
  }
}
