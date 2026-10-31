/**
 * BLIND HUMAN REFERENCE (Stage A of the Measurement Lab).
 *
 * The founder records the drawing's measurements from the drawing alone, before any engine output is
 * shown. The record is an append-only, hash-chained event log:
 *   draft  → add / edit / withdraw records
 *   lock   → the reference is frozen; only now may engine results be revealed (Stage B)
 *   after  → corrections are explicit `amend` events with a reason; measurements added after the
 *            reveal are `add-after-reveal` events, kept apart from the blind reference
 * The original locked values are never overwritten: `replay` returns both the locked snapshot and the
 * amended state with each record's amendment history.
 *
 * This module deliberately imports NO engine and NO engine output (a test enforces it), so nothing in
 * Stage A can show or prefill engine results. Founder references are internal development evidence,
 * not independent third-party validation.
 */
import { GENESIS, sha256Hex, stableStringify } from "./hashing";
import type { ReferenceDimension } from "@/lib/measurement-quality/ledger";

type P = [number, number];
export type Derivability = "derivable" | "ambiguous" | "not-derivable";
export interface ReferenceMeasurement {
  ref_id: string;
  page: number;
  /** view or floor, as the founder names it */
  view: string;
  /** architectural element the dimension belongs to, e.g. "south wall, ground floor" */
  element: string;
  printed_text: string;
  value: number | null;
  unit: "mm" | "cm" | "m" | "in" | "none-stated" | null;
  /** where the printed text is (used to match engine measurements) */
  text_point: P | null;
  start: P | null;
  end: P | null;
  /** what the ends measure to, e.g. "grid 6 -> grid 7" or "outer face -> outer face" */
  associated_element: string;
  derivability: Derivability;
  notes: string;
}
export type RefEventBody =
  | { type: "add"; record: ReferenceMeasurement }
  | { type: "edit"; record: ReferenceMeasurement }
  | { type: "withdraw"; ref_id: string; reason: string }
  | { type: "lock"; note: string }
  | { type: "amend"; ref_id: string; changes: Partial<Omit<ReferenceMeasurement, "ref_id">>; reason: string }
  | { type: "add-after-reveal"; record: ReferenceMeasurement; reason: string };
export type RefEvent = RefEventBody & {
  seq: number;
  drawing_sha256: string;
  reviewer_id: string;
  reviewer_label: string;
  at: string;
  /** true when engine runs for this drawing already existed when this reference was started: it may not be blind */
  engine_runs_existed: boolean;
  prev_hash: string;
  hash: string;
};

/** Fields a derivable record must have before the reference can be locked. */
export function incompleteFields(r: ReferenceMeasurement): string[] {
  const miss: string[] = [];
  if (!(r.page >= 1)) miss.push("page");
  if (!r.printed_text.trim()) miss.push("printed text");
  if (!r.text_point) miss.push("text location");
  if (r.derivability === "derivable") {
    if (r.value === null || !Number.isFinite(r.value)) miss.push("value");
    if (!r.unit) miss.push("unit");
    if (!r.start) miss.push("start endpoint");
    if (!r.end) miss.push("end endpoint");
    if (!r.associated_element.trim()) miss.push("associated element");
  }
  if (r.derivability !== "derivable" && !r.notes.trim()) miss.push("notes (why it is ambiguous or not derivable)");
  return miss;
}

export interface ReferenceState {
  locked: boolean;
  locked_at: string | null;
  /** records as they were at lock time (the blind reference), or the current draft before lock */
  blind: ReferenceMeasurement[];
  /** blind records with amendments applied, plus records added after the reveal (flagged) */
  current: (ReferenceMeasurement & { amended: boolean; added_after_reveal: boolean; history: { at: string; reviewer_label: string; changes: Record<string, unknown>; reason: string }[] })[];
  engine_runs_existed: boolean;
}

export function replay(log: readonly RefEvent[]): ReferenceState {
  const draft = new Map<string, ReferenceMeasurement>();
  let locked = false, lockedAt: string | null = null, blind: ReferenceMeasurement[] = [];
  const current = new Map<string, ReferenceState["current"][number]>();
  for (const e of log) {
    if (!locked) {
      if (e.type === "add" || e.type === "edit") draft.set(e.record.ref_id, e.record);
      else if (e.type === "withdraw") draft.delete(e.ref_id);
      else if (e.type === "lock") {
        locked = true; lockedAt = e.at; blind = [...draft.values()];
        for (const r of blind) current.set(r.ref_id, { ...r, amended: false, added_after_reveal: false, history: [] });
      }
    } else if (e.type === "amend") {
      const c = current.get(e.ref_id);
      if (c) current.set(e.ref_id, { ...c, ...e.changes, amended: true, history: [...c.history, { at: e.at, reviewer_label: e.reviewer_label, changes: e.changes, reason: e.reason }] });
    } else if (e.type === "add-after-reveal") current.set(e.record.ref_id, { ...e.record, amended: false, added_after_reveal: true, history: [{ at: e.at, reviewer_label: e.reviewer_label, changes: { added: true }, reason: e.reason }] });
  }
  return {
    locked, locked_at: lockedAt,
    blind: locked ? blind : [...draft.values()],
    current: locked ? [...current.values()] : [...draft.values()].map((r) => ({ ...r, amended: false, added_after_reveal: false, history: [] })),
    engine_runs_existed: log.some((e) => e.engine_runs_existed),
  };
}

/** Appends one event, enforcing the Stage A / Stage B rules. Returns a new frozen log. */
export async function appendReferenceEvent(
  log: readonly RefEvent[],
  body: RefEventBody,
  who: { reviewer_id: string; reviewer_label: string; drawing_sha256: string; engine_runs_existed: boolean },
  now = new Date(),
): Promise<readonly RefEvent[]> {
  if (!who.reviewer_id) throw new Error("an authenticated reviewer is required");
  const s = replay(log);
  if (!s.locked && (body.type === "amend" || body.type === "add-after-reveal")) throw new Error("amendments apply only to a locked reference");
  if (s.locked && (body.type === "add" || body.type === "edit" || body.type === "withdraw" || body.type === "lock"))
    throw new Error("the reference is locked: change it only with an explicit amendment");
  if ((body.type === "add" || body.type === "add-after-reveal") && s.current.some((r) => r.ref_id === body.record.ref_id)) throw new Error(`reference ${body.record.ref_id} already exists`);
  if (body.type === "edit" && !s.blind.some((r) => r.ref_id === body.record.ref_id)) throw new Error(`no draft reference ${body.record.ref_id}`);
  if (body.type === "lock") {
    if (!s.blind.length) throw new Error("record at least one measurement before locking");
    const bad = s.blind.map((r) => [r.ref_id, incompleteFields(r)] as const).filter(([, m]) => m.length);
    if (bad.length) throw new Error(`incomplete: ${bad.map(([id, m]) => `${id} (${m.join(", ")})`).join("; ")}`);
  }
  if ((body.type === "amend" || body.type === "add-after-reveal" || body.type === "withdraw") && !body.reason.trim()) throw new Error("a reason is required");
  if (body.type === "amend") {
    if (!s.current.some((r) => r.ref_id === body.ref_id)) throw new Error(`no reference ${body.ref_id}`);
    if ("ref_id" in (body.changes as object)) throw new Error("ref_id cannot be amended");
  }
  const prev = log.length ? log[log.length - 1].hash : GENESIS;
  const ev = { ...body, seq: log.length, drawing_sha256: who.drawing_sha256, reviewer_id: who.reviewer_id, reviewer_label: who.reviewer_label, at: now.toISOString(), engine_runs_existed: who.engine_runs_existed || s.engine_runs_existed, prev_hash: prev } as Omit<RefEvent, "hash">;
  const hash = await sha256Hex(stableStringify(ev));
  return Object.freeze([...log, Object.freeze({ ...ev, hash } as RefEvent)]);
}

export async function verifyReferenceLog(log: readonly RefEvent[]): Promise<number | null> {
  let prev = GENESIS;
  for (const [i, e] of log.entries()) {
    const { hash, ...body } = e;
    if (e.seq !== i || e.prev_hash !== prev || (await sha256Hex(stableStringify(body))) !== hash) return i;
    prev = hash;
  }
  return null;
}

/** Converts the locked reference to the scorer's reference shape. `which`: the blind (locked) values,
 *  or the amended values. Records added after the reveal are excluded from the blind set. */
export function toReferenceDimensions(s: ReferenceState, drawingSha: string, which: "blind" | "amended"): ReferenceDimension[] {
  if (!s.locked) throw new Error("only a locked reference can be scored");
  const recs = which === "blind" ? s.blind : s.current;
  return recs.map((r) => {
    const st = r.start ?? r.text_point ?? [0, 0], en = r.end ?? r.text_point ?? [0, 0];
    const horizontal = Math.abs(en[0] - st[0]) >= Math.abs(en[1] - st[1]);
    return {
      gold_id: r.ref_id, kind: "linear_dimension" as const, file: "", sha256: drawingSha, page: r.page, view: r.view, view_scale: "", printed_text: r.printed_text,
      value: r.value ?? Number.NaN, unit: r.unit === "none-stated" ? null : r.unit, orientation: horizontal ? "horizontal" : "vertical",
      text_center_pt: r.text_point ?? st, endpoints_pt: r.start && r.end ? [r.start, r.end] : null, associated_element: r.associated_element,
      reference_status: r.derivability === "derivable" ? "OK" : r.derivability === "ambiguous" ? "AMBIGUOUS" : "NOT-DERIVABLE",
      verification: `FOUNDER REFERENCE (${which === "blind" ? "blind, locked" : "locked + amendments"}${s.engine_runs_existed ? "; engine output existed before this reference was started — may not be blind" : ""}); internal development evidence, not independent`,
    };
  });
}
