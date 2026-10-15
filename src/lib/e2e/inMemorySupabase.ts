// IN-MEMORY SUPABASE — an offline stand-in for "@/integrations/supabase/client",
// used ONLY by the end-to-end BOQ harness (tests via vi.mock, the runner via a
// module alias). It lets the REAL applyReviewPlan / addReviewItemAsLine /
// applyReviewQtyUnit run unchanged, with nothing sent over the network.
//
// It implements exactly the query shapes those functions use, and fails loudly
// (throws) on any table or operation it doesn't know, so a production change
// that adds a new query can't silently pass through as an empty result.
// Emulated database rules: boq_line's two identity unique indexes
// (20260929000000_boq_line_identity_constraint.sql) raise 23505 with the index
// name, as Postgres would. Nothing else — no RLS, triggers or other
// constraints — is emulated; that is a stated limitation of the harness.

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "is" | "not_is_null"; value: unknown };

const TABLES = ["boq", "boq_line", "boq_line_change_log", "project_scope", "project_document", "document_revision", "analysis_run_source"] as const;
type Table = (typeof TABLES)[number];

const store = new Map<Table, Row[]>();
let nextId = 1;
const queryLog: string[] = [];

export interface InMemorySeed {
  boq: { id: string; project_id: string | null }[];
  boq_line?: Row[];
  project_scope?: Row[];
  project_document?: { id: string; project_id: string; current_revision_id: string | null }[];
  document_revision?: { id: string; document_id: string }[];
  analysis_run_source?: Row[];
}

/** Start a fresh, empty database with the given seed rows. */
export function resetInMemoryDb(seed: InMemorySeed): void {
  store.clear();
  queryLog.length = 0;
  nextId = 1;
  for (const t of TABLES) store.set(t, []);
  for (const [t, rows] of Object.entries(seed)) {
    if (!TABLES.includes(t as Table)) throw new Error(`in-memory db: unknown seed table ${t}`);
    store.set(t as Table, (rows as Row[]).map((r) => ({ ...r })));
  }
}

/** A deep copy of a table's rows, for reading back what was persisted. */
export function readTable(table: Table): Row[] {
  return (store.get(table) ?? []).map((r) => ({ ...r }));
}

/** Every query issued, as "<op> <table>", in order. */
export function queriesIssued(): string[] {
  return [...queryLog];
}

function tableRows(table: string): Row[] {
  if (!TABLES.includes(table as Table)) throw new Error(`in-memory db: table "${table}" is not supported by the harness`);
  const rows = store.get(table as Table);
  if (!rows) throw new Error("in-memory db: resetInMemoryDb() was not called");
  return rows;
}

const matches = (row: Row, filters: Filter[]) => filters.every((f) =>
  f.op === "eq" ? row[f.col] === f.value
    : f.op === "is" ? (f.value === null ? row[f.col] == null : row[f.col] === f.value)
      : row[f.col] != null);

function identityConflict(rows: Row[], candidate: Row, selfId?: unknown): string | null {
  if (candidate.external_key == null) return null;
  for (const r of rows) {
    if (r.id === selfId || r.boq_id !== candidate.boq_id || r.external_key !== candidate.external_key) continue;
    if (candidate.scope_id != null && r.scope_id === candidate.scope_id) return "boq_line_identity_scoped_idx";
    if (candidate.scope_id == null && r.scope_id == null) return "boq_line_identity_unscoped_idx";
  }
  return null;
}

const conflictError = (index: string) => ({
  code: "23505", message: `duplicate key value violates unique constraint "${index}"`,
});

type Result = { data: unknown; error: unknown };

/** One chainable query: filters accumulate; a terminal (single, maybeSingle,
 *  await) runs it. */
function query(table: string, op: "select" | "insert" | "update", payload?: Row | Row[]) {
  const filters: Filter[] = [];
  let limit: number | null = null;
  let returning = false;

  const run = (): Result => {
    queryLog.push(`${op} ${table}`);
    const rows = tableRows(table);
    if (op === "select") {
      const found = rows.filter((r) => matches(r, filters));
      return { data: (limit == null ? found : found.slice(0, limit)).map((r) => ({ ...r })), error: null };
    }
    if (op === "insert") {
      const inserted: Row[] = [];
      for (const p of Array.isArray(payload) ? payload : [payload!]) {
        const row = { id: `${table}-${nextId++}`, ...p };
        if (table === "boq_line") {
          const index = identityConflict(rows, row);
          if (index) return { data: null, error: conflictError(index) };
        }
        rows.push(row);
        inserted.push({ ...row });
      }
      return { data: inserted, error: null };
    }
    // update
    const targets = rows.filter((r) => matches(r, filters));
    for (const r of targets) {
      const next = { ...r, ...(payload as Row) };
      if (table === "boq_line") {
        const index = identityConflict(rows, next, r.id);
        if (index) return { data: null, error: conflictError(index) };
      }
      Object.assign(r, payload);
    }
    return { data: returning ? targets.map((r) => ({ ...r })) : null, error: null };
  };

  const one = (required: boolean): Result => {
    const res = run();
    if (res.error) return res;
    const list = (res.data ?? []) as Row[];
    if (list.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
    if (list.length === 0) return required ? { data: null, error: { code: "PGRST116", message: "no rows returned" } } : { data: null, error: null };
    return { data: list[0], error: null };
  };

  const builder = {
    eq(col: string, value: unknown) { filters.push({ col, op: "eq", value }); return builder; },
    is(col: string, value: unknown) { filters.push({ col, op: "is", value }); return builder; },
    not(col: string, operator: string, value: unknown) {
      if (operator !== "is" || value !== null) throw new Error(`in-memory db: unsupported .not(${col}, ${operator}, ${String(value)})`);
      filters.push({ col, op: "not_is_null", value: null });
      return builder;
    },
    limit(n: number) { limit = n; return builder; },
    select() { returning = true; return builder; },
    single: async () => one(true),
    maybeSingle: async () => one(false),
    then<T>(onFulfilled: (v: Result) => T, onRejected?: (e: unknown) => T) {
      try { return Promise.resolve(onFulfilled(run())); } catch (e) { return onRejected ? Promise.resolve(onRejected(e)) : Promise.reject(e); }
    },
  };
  return builder;
}

export const HARNESS_USER_ID = "harness-simulated-user";

export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: HARNESS_USER_ID } }, error: null }) },
  from(table: string) {
    tableRows(table);
    return {
      select: () => query(table, "select"),
      insert: (payload: Row | Row[]) => query(table, "insert", payload),
      update: (payload: Row) => query(table, "update", payload),
    };
  },
};
