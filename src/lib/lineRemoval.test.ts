// Remove → undo must give back the line exactly as it was — every stored
// column, including the ones no editor shows — and re-attach the records that
// pointed at it. Runs against a small in-memory PostgREST stand-in that
// applies the real ON DELETE semantics (set null / cascade) of the schema.
import { describe, it, expect, beforeEach } from "vitest";
import type { DbResult, Query } from "@/lib/untypedDb";
import { removeLineWithSnapshot, restoreRemovedLine, LineRemovalError } from "./lineRemoval";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let missing: Set<string>;
let failSelect: Set<string>;
let denyUpdate: Set<string>;
let denyDelete: Set<string>;
let failInsert: Set<string>;

const SET_NULL: [string, string][] = [
  ["boq_audit_finding", "boq_line_id"], ["boq_line_change_log", "boq_line_id"],
  ["boq_line_rate_adoption", "boq_line_id"], ["boq_line_rate_adoption", "source_boq_line_id"],
  ["boq_line_rate_review", "preferred_boq_line_id"],
];
const CASCADE: [string, string][] = [["vendor_quotation", "boq_line_id"], ["boq_line_rate_review", "boq_line_id"], ["boq_line_dsr_mapping", "boq_line_id"]];

function client(): { from: (t: string) => Query } {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row = {};
      let lim = Infinity;
      let returning = false;
      const run = (): DbResult => {
        if (missing.has(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
        const rows = (tables[table] ??= []);
        const match = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "select") {
          if (failSelect.has(table)) return { data: null, error: { message: "permission denied" } };
          return { data: match.slice(0, lim).map((r) => ({ ...r })), error: null };
        }
        if (op === "insert") {
          if (failInsert.has(table)) return { data: null, error: { message: `insert into ${table} failed` } };
          if (rows.some((r) => r.id === payload.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          const row = { id: payload.id ?? `${table}-${rows.length + 1}`, ...payload };
          rows.push(row);
          return { data: returning ? [{ id: row.id }] : null, error: null };
        }
        if (op === "update") {
          if (denyUpdate.has(table)) return { data: [], error: null };   // RLS filters the rows out: no error, nothing updated
          match.forEach((r) => Object.assign(r, payload));
          return { data: returning ? match.map((r) => ({ id: r.id })) : null, error: null };
        }
        // delete — apply the schema's ON DELETE rules for boq_line
        if (denyDelete.has(table)) return { data: [], error: null };   // RLS: no error, nothing deleted
        const ids = new Set(match.map((r) => r.id));
        tables[table] = rows.filter((r) => !ids.has(r.id));
        if (table === "boq_line") {
          for (const [t, c] of SET_NULL) (tables[t] ?? []).forEach((r) => { if (ids.has(r[c])) r[c] = null; });
          for (const [t, c] of CASCADE) if (tables[t]) tables[t] = tables[t].filter((r) => !ids.has(r[c]));
        }
        return { data: returning ? match.map((r) => ({ id: r.id })) : null, error: null };
      };
      const q: Query = {
        select() { if (op !== "select") returning = true; return q; },
        eq(c, v) { filters.push((r) => r[c] === v); return q; },
        in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
        is(c, v) { filters.push((r) => r[c] === v); return q; },
        neq(c, v) { filters.push((r) => r[c] !== v); return q; },
        or() { return q; }, ilike() { return q; }, order() { return q; },
        limit(n) { lim = n; return q; },
        range() { return q; },
        insert(v) { op = "insert"; payload = v as Row; return q; },
        upsert(v) { op = "insert"; payload = v as Row; return q; },
        update(v) { op = "update"; payload = v as Row; return q; },
        delete() { op = "delete"; return q; },
        maybeSingle() { const r = run(); return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return q;
    },
  };
}

// Every column a boq_line can carry, hidden ones included.
const ORIGINAL: Row = {
  id: "line-1", boq_id: "boq-1", section: "Finishes", dsr_code: "11.41.2", description: "Vitrified tiles — LIFT LOBBY",
  unit: "sqm", qty: 4.23, dsr_rate: 1000, custom_rate: 950, cost: 700, included: true, source: "auto", sort: 7,
  basis: "DRAWING_DERIVED", basis_note: "2.35 × 1.80 from GF plan", external_key: "room:lift-lobby:gf",
  measurement_method: "AREA", quantity_status: "MEASURED", scope_id: "scope-gf",
  source_document_id: "doc-9", source_revision_id: "rev-2", source_page: "3",
};

beforeEach(() => {
  tables = {
    boq_line: [{ ...ORIGINAL }, { ...ORIGINAL, id: "line-2", external_key: "other" }],
    boq_audit_finding: [{ id: "f1", boq_line_id: "line-1" }, { id: "f2", boq_line_id: "line-2" }],
    boq_line_change_log: [{ id: "c1", boq_line_id: "line-1" }, { id: "c2", boq_line_id: "line-1" }],
    boq_line_rate_adoption: [{ id: "a1", boq_line_id: "line-1", source_boq_line_id: "line-2" }, { id: "a2", boq_line_id: "line-2", source_boq_line_id: "line-1" }],
  };
  missing = new Set(["vendor_quotation", "boq_line_rate_review", "boq_line_dsr_mapping"]);   // deferred tables, as in production
  failSelect = new Set();
  denyUpdate = new Set();
  denyDelete = new Set();
  failInsert = new Set();
});

describe("remove → undo", () => {
  it("restores the exact stored row — identity, source, provenance, status, basis, location and drawing reference", async () => {
    const c = client();
    const before = structuredClone(tables.boq_line.find((r) => r.id === "line-1"));
    const removed = await removeLineWithSnapshot("line-1", c);
    expect(tables.boq_line.find((r) => r.id === "line-1")).toBeUndefined();
    await restoreRemovedLine(removed, c);
    expect(tables.boq_line.find((r) => r.id === "line-1")).toEqual(before);
  });

  it("re-attaches every link the deletion cleared, and only those", async () => {
    const c = client();
    const removed = await removeLineWithSnapshot("line-1", c);
    expect(tables.boq_audit_finding.find((r) => r.id === "f1")!.boq_line_id).toBeNull();
    expect(tables.boq_line_change_log.every((r) => r.boq_line_id === null)).toBe(true);
    const { unrestoredLinks } = await restoreRemovedLine(removed, c);
    expect(unrestoredLinks).toEqual([]);
    expect(tables.boq_audit_finding).toEqual([{ id: "f1", boq_line_id: "line-1" }, { id: "f2", boq_line_id: "line-2" }]);
    expect(tables.boq_line_change_log).toEqual([{ id: "c1", boq_line_id: "line-1" }, { id: "c2", boq_line_id: "line-1" }]);
    expect(tables.boq_line_rate_adoption).toEqual([
      { id: "a1", boq_line_id: "line-1", source_boq_line_id: "line-2" },
      { id: "a2", boq_line_id: "line-2", source_boq_line_id: "line-1" },
    ]);
  });

  it("a link re-pointed elsewhere in the meantime is left alone, and reported", async () => {
    const c = client();
    const removed = await removeLineWithSnapshot("line-1", c);
    tables.boq_audit_finding.find((r) => r.id === "f1")!.boq_line_id = "line-2";
    const { unrestoredLinks } = await restoreRemovedLine(removed, c);
    expect(tables.boq_audit_finding.find((r) => r.id === "f1")!.boq_line_id).toBe("line-2");
    expect(unrestoredLinks).toEqual([{ table: "boq_audit_finding", column: "boq_line_id", expected: 1, restored: 0, error: undefined }]);
  });

  it("a relink the database silently refuses (RLS) is reported, not counted as restored", async () => {
    const c = client();
    const removed = await removeLineWithSnapshot("line-1", c);
    denyUpdate.add("boq_line_change_log");
    const { unrestoredLinks } = await restoreRemovedLine(removed, c);
    expect(unrestoredLinks.map((u) => u.table)).toEqual(["boq_line_change_log"]);
  });

  it("a row that cannot be re-inserted throws — undo is never shown as done", async () => {
    const c = client();
    const removed = await removeLineWithSnapshot("line-1", c);
    tables.boq_line.push({ ...ORIGINAL });   // id now taken
    await expect(restoreRemovedLine(removed, c)).rejects.toBeInstanceOf(LineRemovalError);
  });
});

describe("removal refuses what undo could not restore", () => {
  it("a line with records that would be deleted with it is not removed", async () => {
    missing.delete("vendor_quotation");
    tables.vendor_quotation = [{ id: "vq1", boq_line_id: "line-1" }];
    await expect(removeLineWithSnapshot("line-1", client())).rejects.toThrow(/linked vendor quotation/);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(true);
    expect(tables.vendor_quotation).toHaveLength(1);
  });

  it("a check that cannot be completed fails closed — nothing deleted", async () => {
    missing.delete("boq_line_dsr_mapping");
    failSelect.add("boq_line_dsr_mapping");
    await expect(removeLineWithSnapshot("line-1", client())).rejects.toThrow(/could not check/);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(true);
  });

  it("links that cannot be recorded block removal — nothing deleted", async () => {
    failSelect.add("boq_audit_finding");
    await expect(removeLineWithSnapshot("line-1", client())).rejects.toThrow(/could not record its links/);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(true);
  });

  it("a line that cannot be read first is not removed", async () => {
    failSelect.add("boq_line");
    await expect(removeLineWithSnapshot("line-1", client())).rejects.toThrow(/could not be read first/);
    expect(tables.boq_line).toHaveLength(2);
  });
});

describe("removal is guarded on what the person saw", () => {
  it("normal: the values shown still match — removed", async () => {
    const removed = await removeLineWithSnapshot("line-1", client(), { expected: { qty: 4.23, unit: "sqm", description: ORIGINAL.description, custom_rate: 950 } });
    expect(removed.row.id).toBe("line-1");
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(false);
  });

  it("conflict: a line changed elsewhere since it was loaded is not removed, and the change survives", async () => {
    tables.boq_line.find((r) => r.id === "line-1")!.qty = 9;
    await expect(removeLineWithSnapshot("line-1", client(), { expected: { qty: 4.23, unit: "sqm" } }))
      .rejects.toThrow(/changed elsewhere since it was loaded \(qty\)/);
    expect(tables.boq_line.find((r) => r.id === "line-1")!.qty).toBe(9);
  });

  it("a numeric column returned as a string is the same value, not a conflict", async () => {
    tables.boq_line.find((r) => r.id === "line-1")!.qty = "4.23";
    await expect(removeLineWithSnapshot("line-1", client(), { expected: { qty: 4.23 } })).resolves.toBeTruthy();
  });

  it("a delete the database silently refuses (RLS, or already gone) is reported, never shown as removed", async () => {
    denyDelete.add("boq_line");
    await expect(removeLineWithSnapshot("line-1", client())).rejects.toThrow(/the database removed nothing/);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(true);
  });
});

describe("removal history (boq_line_change_log)", () => {
  const history = { boqId: "boq-1", changedBy: "user-1" };

  it("records the removal with the whole row; undo re-attaches that record and records the restore", async () => {
    const c = client();
    const removed = await removeLineWithSnapshot("line-1", c, { history });
    expect(removed.historyRecorded).toBe(true);
    const log = tables.boq_line_change_log.find((r) => r.field === "line_removed")!;
    expect(log).toMatchObject({ boq_id: "boq-1", boq_line_id: null, changed_by: "user-1", new_value: null });
    expect(JSON.parse(log.old_value as string)).toEqual(ORIGINAL);

    const res = await restoreRemovedLine(removed, c, history);
    expect(res).toEqual({ unrestoredLinks: [], historyRecorded: true });
    expect(tables.boq_line_change_log.find((r) => r.field === "line_removed")!.boq_line_id).toBe("line-1");
    expect(tables.boq_line_change_log.find((r) => r.field === "line_restored")).toMatchObject({ boq_line_id: "line-1", changed_by: "user-1" });
  });

  it("fails closed without the history table: nothing removed, the person is told what to do instead", async () => {
    missing.add("boq_line_change_log");
    await expect(removeLineWithSnapshot("line-1", client(), { history })).rejects.toThrow(/change history is not set up.*Exclude the line/);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(true);
  });

  it("undo of a line added in this session may proceed without the table, and says it was not recorded", async () => {
    missing.add("boq_line_change_log");
    const removed = await removeLineWithSnapshot("line-1", client(), { history: { ...history, requireHistory: false } });
    expect(removed.historyRecorded).toBe(false);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(false);
  });

  it("failure: a history row that cannot be written puts the line back, with its links", async () => {
    failInsert.add("boq_line_change_log");
    const before = structuredClone(tables.boq_line.find((r) => r.id === "line-1"));
    await expect(removeLineWithSnapshot("line-1", client(), { history })).rejects.toThrow(/Line not removed: its history record couldn't be saved.*The line was put back/);
    expect(tables.boq_line.find((r) => r.id === "line-1")).toEqual(before);
    expect(tables.boq_audit_finding.find((r) => r.id === "f1")!.boq_line_id).toBe("line-1");
  });

  it("retry: after a failed history write, removing again once history works succeeds and is recorded", async () => {
    failInsert.add("boq_line_change_log");
    await expect(removeLineWithSnapshot("line-1", client(), { history })).rejects.toThrow();
    failInsert.clear();
    const removed = await removeLineWithSnapshot("line-1", client(), { history });
    expect(removed.historyRecorded).toBe(true);
    expect(tables.boq_line_change_log.filter((r) => r.field === "line_removed")).toHaveLength(1);
  });

  it("removed, unrecorded, and could not be put back: the error carries the snapshot so undo stays possible", async () => {
    // History insert fails and the compensating re-insert fails too.
    failInsert.add("boq_line_change_log");
    failInsert.add("boq_line");
    const err = await removeLineWithSnapshot("line-1", client(), { history }).catch((e) => e);
    expect(err).toBeInstanceOf(LineRemovalError);
    expect(err.message).toMatch(/The line was removed, but its history record couldn't be saved.*putting it back failed/);
    expect(err.removed.row).toEqual(ORIGINAL);
    failInsert.clear();
    await restoreRemovedLine(err.removed, client());
    expect(tables.boq_line.find((r) => r.id === "line-1")).toEqual(ORIGINAL);
  });

  it("a restore whose history row fails stays restored and says so", async () => {
    const c = client();
    const removed = await removeLineWithSnapshot("line-1", c, { history });
    failInsert.add("boq_line_change_log");
    const res = await restoreRemovedLine(removed, c, history);
    expect(res.historyRecorded).toBe(false);
    expect(res.historyError).toMatch(/insert into boq_line_change_log failed/);
    expect(tables.boq_line.some((r) => r.id === "line-1")).toBe(true);
  });
});
