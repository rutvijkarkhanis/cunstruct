// mostRecentlyAnalyzedBoqId — the query ProjectWorkspace's mobile "Review &
// Identify" CTA and WorkspaceContext's desktop "Review" button both use
// (via useMostRecentlyAnalyzedBoqId) to pick which BOQ to open, instead of
// assuming the most recently CREATED BOQ (boqs[0]) is the one with drawing
// analysis to review. This is a real Postgres filter/order/limit query
// (not a client-side fallback), so this test drives a fake query builder
// that actually HONORS .eq/.gt/.not/.order/.limit, rather than one that
// always hands back everything it was given — otherwise this test could
// pass even if the real column names or the ordering direction were wrong.
import { describe, it, expect, vi } from "vitest";

interface AnalysisRunRow { boq_id: string | null; created_at: string; item_count: number; project_id: string | null }

const { rowsRef } = vi.hoisted(() => ({ rowsRef: { current: [] as AnalysisRunRow[] } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "analysis_run") throw new Error(`mostRecentlyAnalyzedBoqId queried unexpected table "${table}"`);
      let rows = rowsRef.current;
      const builder = {
        select: () => builder,
        eq: (col: keyof AnalysisRunRow, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder; },
        gt: (col: keyof AnalysisRunRow, val: number) => { rows = rows.filter((r) => (r[col] as number) > val); return builder; },
        not: (col: keyof AnalysisRunRow, _op: string, val: unknown) => { rows = rows.filter((r) => r[col] !== val); return builder; },
        order: (col: keyof AnalysisRunRow, { ascending }: { ascending: boolean }) => {
          rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * String(a[col]).localeCompare(String(b[col])));
          return builder;
        },
        limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
      };
      return builder;
    },
  },
}));

// Import after the mock is set up (vi.mock is hoisted above this anyway,
// but keep the two together for clarity).
import { mostRecentlyAnalyzedBoqId } from "./reviewStore";

describe("mostRecentlyAnalyzedBoqId", () => {
  it("returns null when the project has no analysis_run at all", async () => {
    rowsRef.current = [];
    expect(await mostRecentlyAnalyzedBoqId("proj-1")).toBeNull();
  });

  it("returns null when a run exists but produced zero items (item_count = 0 is not analysis)", async () => {
    rowsRef.current = [{ boq_id: "boq-empty", created_at: "2026-01-01T00:00:00Z", item_count: 0, project_id: "proj-1" }];
    expect(await mostRecentlyAnalyzedBoqId("proj-1")).toBeNull();
  });

  it("picks the boq_id of the most recently created analysis_run among several analyzed BOQs — the documented deterministic rule", async () => {
    rowsRef.current = [
      { boq_id: "boq-old", created_at: "2026-01-01T00:00:00Z", item_count: 5, project_id: "proj-1" },
      { boq_id: "boq-newest", created_at: "2026-03-01T00:00:00Z", item_count: 9, project_id: "proj-1" },
      { boq_id: "boq-mid", created_at: "2026-02-01T00:00:00Z", item_count: 3, project_id: "proj-1" },
    ];
    expect(await mostRecentlyAnalyzedBoqId("proj-1")).toBe("boq-newest");
  });

  it("ignores a newer but unanalyzed run on a DIFFERENT boq within the same project", async () => {
    rowsRef.current = [
      { boq_id: "boq-analyzed", created_at: "2026-01-01T00:00:00Z", item_count: 12, project_id: "proj-1" },
      // A later run exists, but item_count 0 — must not win just for being newest.
      { boq_id: "boq-unanalyzed", created_at: "2026-05-01T00:00:00Z", item_count: 0, project_id: "proj-1" },
    ];
    expect(await mostRecentlyAnalyzedBoqId("proj-1")).toBe("boq-analyzed");
  });

  it("never returns a run belonging to a different project", async () => {
    rowsRef.current = [
      { boq_id: "boq-other-project", created_at: "2026-05-01T00:00:00Z", item_count: 10, project_id: "proj-2" },
    ];
    expect(await mostRecentlyAnalyzedBoqId("proj-1")).toBeNull();
  });

  it("never returns a run with a null boq_id", async () => {
    rowsRef.current = [
      { boq_id: null, created_at: "2026-05-01T00:00:00Z", item_count: 10, project_id: "proj-1" },
    ];
    expect(await mostRecentlyAnalyzedBoqId("proj-1")).toBeNull();
  });
});
