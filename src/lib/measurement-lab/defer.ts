/**
 * DEFER — a review WORKFLOW flag ("come back to this later"), deliberately kept apart from verdicts.
 *
 * Deferring says nothing about whether a measurement is correct: it never touches the verdict log, the
 * corrections or the frozen engine output, and accuracy metrics never read it. It is its own append-only,
 * hash-chained log (same chaining as the verdict log), so every defer/undefer keeps who and when.
 */
import { deepFreeze, GENESIS, sha256Hex, stableStringify } from "./hashing";

export interface DeferEvent {
  seq: number;
  run_id: string;
  measurement_id: string;
  /** true = deferred, false = undeferred */
  deferred: boolean;
  note: string;
  /** the authenticated user id (from the signed-in session) */
  reviewer_id: string;
  reviewer_label: string;
  at: string;
  prev_hash: string;
  hash: string;
}

/** The current defer flag per measurement for one run (latest event wins). */
export function deferredSet(log: readonly DeferEvent[], runId: string): Set<string> {
  const s = new Set<string>();
  for (const e of log) if (e.run_id === runId) { if (e.deferred) s.add(e.measurement_id); else s.delete(e.measurement_id); }
  return s;
}

/** Returns a NEW frozen log with one event appended. Refuses a redundant event (deferring what is already
 *  deferred, or undeferring what is not) and an event without an authenticated reviewer. */
export async function appendDefer(log: readonly DeferEvent[], e: { run_id: string; measurement_id: string; deferred: boolean; note?: string; reviewer_id: string; reviewer_label?: string }, now = new Date()): Promise<readonly DeferEvent[]> {
  if (!e.reviewer_id?.trim()) throw new Error("an authenticated reviewer is required");
  const isDeferred = deferredSet(log, e.run_id).has(e.measurement_id);
  if (e.deferred === isDeferred) throw new Error(e.deferred ? "already deferred" : "not deferred");
  const body = { seq: log.length, run_id: e.run_id, measurement_id: e.measurement_id, deferred: e.deferred, note: e.note ?? "", reviewer_id: e.reviewer_id.trim(), reviewer_label: (e.reviewer_label ?? "").trim(), at: now.toISOString(), prev_hash: log.length ? log[log.length - 1].hash : GENESIS };
  const ev = deepFreeze({ ...body, hash: await sha256Hex(stableStringify(body)) });
  return Object.freeze([...log, ev]);
}

/** Checks the whole chain; returns the first broken seq, or null when intact. */
export async function verifyDeferLog(log: readonly DeferEvent[]): Promise<number | null> {
  let prev = GENESIS;
  for (const [i, ev] of log.entries()) {
    const { hash, ...body } = ev;
    if (ev.seq !== i || ev.prev_hash !== prev || (await sha256Hex(stableStringify(body))) !== hash) return i;
    prev = hash;
  }
  return null;
}
