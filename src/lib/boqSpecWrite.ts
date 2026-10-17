// GUARDED WRITES TO boq.spec — the one way to change keys of a BOQ's spec.
//
// boq.spec is a single jsonb column that several features keep keys in (the
// builder's commercials and letterhead, the DSR check's scope decisions, …).
// PostgREST can only replace the whole column, so every writer must:
//
//   1. read spec and updated_at;
//   2. change ONLY its own keys on what it read (a key set to undefined is removed);
//   3. write the whole spec back with a compare-and-swap on updated_at, and
//      move updated_at forward — so any other writer that read before this
//      write fails its own compare-and-swap instead of overwriting it;
//   4. on a lost compare-and-swap, re-read and re-apply (bounded), and if it
//      still loses, report a conflict — never write blind.
//
// A writer that skips step 3 (no guard, or no updated_at bump) re-opens the
// lost-update window for everyone, so all spec writers go through here.
import { db } from "@/lib/untypedDb";

export type Spec = Record<string, unknown>;
/** Keys to set; a key whose value is `undefined` is removed. */
export type SpecPatch = Record<string, unknown>;

export type SpecWriteResult<R> =
  | { status: "saved"; spec: Spec; updatedAt: string; attempts: number }
  /** `build` decided not to write (e.g. the value it guards changed). Nothing was written. */
  | { status: "aborted"; reason: R; attempts: number }
  /** The BOQ changed under every attempt. Nothing was written. */
  | { status: "conflict"; attempts: number };

export const SPEC_WRITE_ATTEMPTS = 3;

export async function readBoqSpec(boqId: string): Promise<{ spec: Spec; updatedAt: string }> {
  const { data, error } = await db.from("boq").select("spec, updated_at").eq("id", boqId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This BOQ could not be found.");
  const row = data as { spec: Spec | null; updated_at: string };
  return { spec: row.spec && typeof row.spec === "object" ? row.spec : {}, updatedAt: row.updated_at };
}

/** A new updated_at strictly after the one read, even if this clock is behind
 *  the database's or two writes land in the same millisecond. */
export function nextUpdatedAt(previous: string | null | undefined, now: number = Date.now()): string {
  const prev = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isFinite(prev) ? Math.max(now, prev + 1) : now).toISOString();
}

export function applySpecPatch(spec: Spec, patch: SpecPatch): Spec {
  const next: Spec = { ...spec };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]; else next[k] = v;
  }
  return next;
}

/**
 * Change some keys of a BOQ's spec, guarded. `build` receives the spec as
 * currently stored and returns the keys to change, or a SpecAbort to write
 * nothing (`new SpecAbort(reason)`). It is called again on every retry,
 * against the fresh spec.
 */
export async function writeBoqSpecKeys<R = never>(
  boqId: string,
  build: (current: Spec) => SpecPatch | SpecAbort<R>,
  opts: { attempts?: number } = {},
): Promise<SpecWriteResult<R>> {
  const attempts = Math.max(1, opts.attempts ?? SPEC_WRITE_ATTEMPTS);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { spec, updatedAt } = await readBoqSpec(boqId);
    const built = build(spec);
    if (built instanceof SpecAbort) return { status: "aborted", reason: built.reason as R, attempts: attempt };
    const next = applySpecPatch(spec, built);
    const stamp = nextUpdatedAt(updatedAt);
    const { data, error } = await db.from("boq")
      .update({ spec: next, updated_at: stamp })
      .eq("id", boqId).eq("updated_at", updatedAt).select("id");
    if (error) throw new Error(error.message);
    if (Array.isArray(data) && data.length > 0) return { status: "saved", spec: next, updatedAt: stamp, attempts: attempt };
  }
  return { status: "conflict", attempts };
}

/** Returned by `build` to write nothing (see writeBoqSpecKeys). */
export class SpecAbort<R> {
  constructor(readonly reason: R) {}
}

/** Spec keys that belong to ONE BOQ (they refer to its lines and its review)
 *  and must never be copied to another BOQ or a contractor's defaults. */
export const DSR_SCOPE_DECISIONS_KEY = "_dsr_scope_decisions";
export const BOQ_SCOPED_SPEC_KEYS: readonly string[] = [DSR_SCOPE_DECISIONS_KEY];

/** A BOQ's spec as reusable defaults: everything except BOQ-scoped keys. */
export function reusableSpec(spec: Spec | null | undefined): Spec {
  const out: Spec = { ...(spec ?? {}) };
  for (const k of BOQ_SCOPED_SPEC_KEYS) delete out[k];
  return out;
}

export class SpecWriteConflictError extends Error {
  constructor() {
    super("Not saved: this BOQ was changed elsewhere at the same time, repeatedly. Reload and try again.");
    this.name = "SpecWriteConflictError";
  }
}
