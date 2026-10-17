// A BOQ line write that carries provenance is saved whole or not at all. These
// tests pin the removal of the old "retry without the optional columns"
// fallback: on a missing-column error the write is attempted exactly once,
// nothing stripped is ever sent, and the caller gets an actionable error.
import { describe, it, expect, beforeEach, vi } from "vitest";

interface Call { op: "insert" | "update"; payload: Record<string, unknown> }
const calls: Call[] = [];
let nextError: { code?: string; message: string } | null = null;

function result() {
  return nextError ? { data: null, error: nextError } : { data: [{ id: "new-1" }], error: null };
}
function chain(payloadCall: Call) {
  calls.push(payloadCall);
  const q: Record<string, unknown> = {};
  const self = () => q;
  q.eq = self; q.is = self; q.in = self;
  q.select = () => ({
    single: async () => (nextError ? { data: null, error: nextError } : { data: { id: "new-1" }, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
    eq: self,
  });
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return q;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => chain({ op: "insert", payload }),
      update: (payload: Record<string, unknown>) => chain({ op: "update", payload }),
    }),
  },
}));

import { addFindingAsLine, applyReviewQtyUnit, markLinePending } from "./applyFinding";
import { ProvenanceColumnsMissingError, throwLineSaveError } from "./provenanceSave";

const MISSING = { code: "PGRST204", message: "Could not find the 'quantity_status' column of 'boq_line' in the schema cache" };

beforeEach(() => { calls.length = 0; nextError = null; });

describe("throwLineSaveError", () => {
  it("turns a missing-column error into an actionable one that says nothing was saved", () => {
    expect(() => throwLineSaveError(MISSING)).toThrow(ProvenanceColumnsMissingError);
    expect(() => throwLineSaveError(MISSING)).toThrow(/Nothing was saved.*Apply the pending database migrations/);
  });
  it("recognises the Postgres wording too", () => {
    expect(() => throwLineSaveError({ code: "42703", message: 'column "basis_note" of relation "boq_line" does not exist' })).toThrow(ProvenanceColumnsMissingError);
  });
  it("a missing function or table is reported as itself, not as missing columns", () => {
    for (const e of [
      { code: "42883", message: "function public.is_staff(uuid) does not exist" },
      { code: "42P01", message: 'relation "public.boq_line_change_log" does not exist' },
      { code: "PGRST202", message: "Could not find the function public.foo in the schema cache" },
    ]) {
      try { throwLineSaveError(e); expect.unreachable(); } catch (err) { expect(err).toBe(e); }
    }
  });
  it("rethrows any other error unchanged — a foreign-key name containing a column name is not 'missing column'", () => {
    const fk = { code: "23503", message: 'violates foreign key constraint "boq_line_source_document_id_fkey"' };
    try { throwLineSaveError(fk); expect.unreachable(); } catch (e) { expect(e).toBe(fk); }
  });
});

describe("applyFinding writes never strip provenance", () => {
  it("insert: one attempt with every provenance column; a missing column fails clearly", async () => {
    nextError = MISSING;
    await expect(addFindingAsLine({ boqId: "b1", description: "WC", unit: "nos", externalKey: "k1" }))
      .rejects.toBeInstanceOf(ProvenanceColumnsMissingError);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({ basis: "PENDING", quantity_status: "PENDING", external_key: "k1" });
  });
  it("unguarded update: one attempt, never retried without the pending marker", async () => {
    nextError = MISSING;
    await expect(markLinePending("l1")).rejects.toBeInstanceOf(ProvenanceColumnsMissingError);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ qty: 0, basis: "PENDING", quantity_status: "PENDING" });
  });
  it("guarded (compare-and-swap) update: one attempt, never retried without basis/status/source", async () => {
    nextError = MISSING;
    await expect(applyReviewQtyUnit("l1", { qty: 4, basis: null, quantity_status: "MEASURED", source_document_id: "d1", source_page: "2" }, { qty: 0 }))
      .rejects.toBeInstanceOf(ProvenanceColumnsMissingError);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({ quantity_status: "MEASURED", source_document_id: "d1", source_page: "2" });
  });
  it("a successful write is unchanged", async () => {
    await expect(addFindingAsLine({ boqId: "b1", description: "WC" })).resolves.toBe("new-1");
    expect(calls).toHaveLength(1);
  });
});

describe("no stripping retry survives in any boq_line writer", () => {
  it("the eval-JSON import paths and applyFinding contain no column-stripping destructure", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["src/lib/applyFinding.ts", "src/pages/ops/ProjectBoqs.tsx", "src/pages/ops/OpsBoqBuilder.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/\{\s*basis,\s*basis_note,[^}]*\.\.\.\w+\s*\}/);
      expect(src, f).not.toMatch(/const stripped\b/);
    }
  });
});
