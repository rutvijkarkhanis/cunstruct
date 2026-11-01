/**
 * Measurement Lab storage: this browser only (IndexedDB), by owner decision — no database tables, no
 * migration. Frozen runs are stored once and never replaced. The correction log is append-only: an
 * event is written only if it extends the stored chain (same seq, same prev_hash). There is no update
 * or delete API. Everything can be exported as JSON for safekeeping.
 */
import { verifyLog, verifyRun, type CorrectionEvent, type FrozenRun } from "./core";
import { verifyReferenceLog, type RefEvent } from "./reference";

export interface LabStore {
  putRun(run: FrozenRun): Promise<void>;
  getRuns(inputSha256: string): Promise<FrozenRun[]>;
  appendEvent(ev: CorrectionEvent): Promise<void>;
  getLog(inputSha256: string): Promise<CorrectionEvent[]>;
  /** blind reference log for one drawing (append-only, same chain rule) */
  appendRefEvent(ev: RefEvent): Promise<void>;
  getRefLog(drawingSha256: string): Promise<RefEvent[]>;
}

/** In-memory store with the same rules (tests, and the fallback when IndexedDB is unavailable). */
export function memoryStore(): LabStore {
  const runs = new Map<string, FrozenRun>(), logs = new Map<string, CorrectionEvent[]>(), refs = new Map<string, RefEvent[]>();
  const key = (runId: string) => runId.split(":")[1];
  return {
    async putRun(run) {
      if (!(await verifyRun(run))) throw new Error("run does not match its output hash");
      const old = runs.get(run.run_id);
      if (old && old.output_sha256 !== run.output_sha256) throw new Error("a frozen run cannot be replaced");
      if (!old) runs.set(run.run_id, run);
    },
    async getRuns(sha) { return [...runs.values()].filter((r) => r.input.sha256 === sha); },
    async appendEvent(ev) {
      const k = key(ev.run_id), log = logs.get(k) ?? [];
      const prev = log.length ? log[log.length - 1].hash : "0".repeat(64);
      if (ev.seq !== log.length || ev.prev_hash !== prev) throw new Error("correction log is append-only: event does not extend the stored chain");
      logs.set(k, [...log, ev]);
    },
    async getLog(sha) { return logs.get(sha.slice(0, 12)) ?? []; },
    async appendRefEvent(ev) {
      const log = refs.get(ev.drawing_sha256) ?? [];
      const prev = log.length ? log[log.length - 1].hash : "0".repeat(64);
      if (ev.seq !== log.length || ev.prev_hash !== prev) throw new Error("reference log is append-only: event does not extend the stored chain");
      refs.set(ev.drawing_sha256, [...log, ev]);
    },
    async getRefLog(sha) { return refs.get(sha) ?? []; },
  };
}

const DB = "cunstruct-measurement-lab", VERSION = 2;
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "run_id" }).createIndex("input", "input.sha256");
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: ["drawing", "seq"] });
      if (!db.objectStoreNames.contains("refEvents")) db.createObjectStore("refEvents", { keyPath: ["drawing_sha256", "seq"] });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = <T,>(db: IDBDatabase, store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
  new Promise<T>((res, rej) => { const t = db.transaction(store, mode); const q = f(t.objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });

/** IndexedDB store; falls back to memory (and says so) when the browser blocks storage. It also asks
 *  the browser to keep the data (navigator.storage.persist) and reports usage against the quota. */
export async function browserStore(): Promise<{ store: LabStore; persistent: boolean; durable: boolean | null; usage: { used: number; quota: number } | null }> {
  let db: IDBDatabase;
  try { db = await open(); } catch { return { store: memoryStore(), persistent: false, durable: null, usage: null }; }
  let durable: boolean | null = null, usage: { used: number; quota: number } | null = null;
  try { durable = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { durable = null; }
  try { const e = await navigator.storage?.estimate?.(); if (e) usage = { used: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { usage = null; }
  return {
    persistent: true, durable, usage,
    store: {
      async putRun(run) {
        if (!(await verifyRun(run))) throw new Error("run does not match its output hash");
        const old = await tx<FrozenRun | undefined>(db, "runs", "readonly", (s) => s.get(run.run_id));
        if (old && old.output_sha256 !== run.output_sha256) throw new Error("a frozen run cannot be replaced");
        if (!old) await tx(db, "runs", "readwrite", (s) => s.add(run)); // add() refuses to overwrite
      },
      async getRuns(sha) {
        const all = await tx<FrozenRun[]>(db, "runs", "readonly", (s) => s.index("input").getAll(sha));
        const ok: FrozenRun[] = [];
        for (const r of all) if (await verifyRun(r)) ok.push(r); // a run altered in storage is dropped, never shown
        return ok;
      },
      async appendEvent(ev) {
        const drawing = ev.run_id.split(":")[1];
        const log = (await tx<(CorrectionEvent & { drawing: string })[]>(db, "events", "readonly", (s) => s.getAll(IDBKeyRange.bound([drawing, 0], [drawing, Infinity]))));
        const prev = log.length ? log[log.length - 1].hash : "0".repeat(64);
        if (ev.seq !== log.length || ev.prev_hash !== prev) throw new Error("correction log is append-only: event does not extend the stored chain");
        await tx(db, "events", "readwrite", (s) => s.add({ ...ev, drawing })); // add() refuses to overwrite a seq
      },
      async getLog(sha) {
        const log = await tx<(CorrectionEvent & { drawing: string })[]>(db, "events", "readonly", (s) => s.getAll(IDBKeyRange.bound([sha.slice(0, 12), 0], [sha.slice(0, 12), Infinity])));
        const clean = log.map(({ drawing: _d, ...e }) => e as CorrectionEvent);
        if ((await verifyLog(clean)) !== null) throw new Error("stored correction log failed its hash-chain check");
        return clean;
      },
      async appendRefEvent(ev) {
        const log = await tx<RefEvent[]>(db, "refEvents", "readonly", (s) => s.getAll(IDBKeyRange.bound([ev.drawing_sha256, 0], [ev.drawing_sha256, Infinity])));
        const prev = log.length ? log[log.length - 1].hash : "0".repeat(64);
        if (ev.seq !== log.length || ev.prev_hash !== prev) throw new Error("reference log is append-only: event does not extend the stored chain");
        await tx(db, "refEvents", "readwrite", (s) => s.add(ev));
      },
      async getRefLog(sha) {
        const log = await tx<RefEvent[]>(db, "refEvents", "readonly", (s) => s.getAll(IDBKeyRange.bound([sha, 0], [sha, Infinity])));
        if ((await verifyReferenceLog(log)) !== null) throw new Error("stored reference log failed its hash-chain check");
        return log;
      },
    },
  };
}

// ── export / import ─────────────────────────────────────────────────────────
export const LAB_EXPORT_SCHEMA = "cunstruct.lab-export.v2";
export interface LabExport { schema: typeof LAB_EXPORT_SCHEMA; drawing_sha256: string; exported_at: string; runs: FrozenRun[]; correction_log: CorrectionEvent[]; reference_log: RefEvent[] }
export function exportLab(drawingSha: string, runs: FrozenRun[], log: readonly CorrectionEvent[], refLog: readonly RefEvent[], now = new Date()): LabExport {
  return { schema: LAB_EXPORT_SCHEMA, drawing_sha256: drawingSha, exported_at: now.toISOString(), runs, correction_log: [...log], reference_log: [...refLog] };
}
/** Checks an export before anything is written: every run must match its hash, both logs must be
 *  intact chains, and everything must belong to the stated drawing. Returns the problems (empty = ok). */
export async function checkImport(x: unknown): Promise<string[]> {
  const e = x as Partial<LabExport>, out: string[] = [];
  if (!e || e.schema !== LAB_EXPORT_SCHEMA) return [`not a ${LAB_EXPORT_SCHEMA} file`];
  for (const r of e.runs ?? []) {
    if (r.input?.sha256 !== e.drawing_sha256) out.push(`run ${r.run_id} belongs to another drawing`);
    if (!(await verifyRun(r))) out.push(`run ${r.run_id} does not match its output hash`);
  }
  if ((await verifyLog(e.correction_log ?? [])) !== null) out.push("correction log hash chain is broken");
  if ((await verifyReferenceLog(e.reference_log ?? [])) !== null) out.push("reference log hash chain is broken");
  if ((e.reference_log ?? []).some((v) => v.drawing_sha256 !== e.drawing_sha256)) out.push("reference log belongs to another drawing");
  if ((e.correction_log ?? []).some((v) => v.run_id.split(":")[1] !== e.drawing_sha256!.slice(0, 12))) out.push("correction log belongs to another drawing");
  return out;
}
/** Restores a checked export. Existing data is never overwritten: runs already present are kept, and
 *  log events are appended only where they extend what is stored (identical prefixes are skipped). */
export async function importLab(store: LabStore, x: LabExport): Promise<{ runs: number; events: number; refEvents: number }> {
  const problems = await checkImport(x);
  if (problems.length) throw new Error(`import refused: ${problems.join("; ")}`);
  let runs = 0, events = 0, refEvents = 0;
  // count only what is actually added: a run already stored (same id and hash) is kept, not re-imported
  const stored = new Set((await store.getRuns(x.drawing_sha256)).map((r) => r.run_id));
  for (const r of x.runs) { await store.putRun(r); if (!stored.has(r.run_id)) { stored.add(r.run_id); runs++; } }
  const have = await store.getLog(x.drawing_sha256);
  for (const [i, ev] of x.correction_log.entries()) {
    if (i < have.length) { if (have[i].hash !== ev.hash) throw new Error("import refused: the stored correction log differs from the file's (no overwrite)"); continue; }
    await store.appendEvent(ev); events++;
  }
  const haveRef = await store.getRefLog(x.drawing_sha256);
  for (const [i, ev] of x.reference_log.entries()) {
    if (i < haveRef.length) { if (haveRef[i].hash !== ev.hash) throw new Error("import refused: the stored reference log differs from the file's (no overwrite)"); continue; }
    await store.appendRefEvent(ev); refEvents++;
  }
  return { runs, events, refEvents };
}
