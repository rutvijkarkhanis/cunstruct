// RE-LINK — updateResolvedDocument writes only analysis_run.resolved_document_id.
//
// Mocks only the supabase client boundary (same pattern as
// applyReviewPlan.test.ts) so the real function body runs, proving it never
// touches ai_json, reviewer_json, or boq_line — a re-link corrects which
// document evidence resolves against; it must never be able to change what
// the analysis actually says or what's in the BOQ.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Call { table: string; op: "update"; payload: unknown; id?: string }
const calls: Call[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => ({
        eq: async (_col: string, id: string) => {
          calls.push({ table, op: "update", payload, id });
          return { error: null };
        },
      }),
    }),
  },
}));

import { updateResolvedDocument } from "./reviewStore";

beforeEach(() => { calls.length = 0; });

describe("updateResolvedDocument", () => {
  it("updates only analysis_run.resolved_document_id for the given run", async () => {
    await updateResolvedDocument("run-1", "doc-42");
    expect(calls).toEqual([{ table: "analysis_run", op: "update", payload: { resolved_document_id: "doc-42" }, id: "run-1" }]);
  });

  it("can clear the mapping back to null", async () => {
    await updateResolvedDocument("run-1", null);
    expect(calls[0].payload).toEqual({ resolved_document_id: null });
  });

  it("never writes to boq_line, ai_json, or reviewer_json", async () => {
    await updateResolvedDocument("run-1", "doc-42");
    expect(calls.every((c) => c.table === "analysis_run")).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/ai_json|reviewer_json|boq_line/);
  });

  it("throws when the update fails (e.g. RLS denies a non-staff user)", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.spyOn(supabase, "from").mockReturnValueOnce({
      update: () => ({ eq: async () => ({ error: new Error("permission denied") }) }),
    } as unknown as ReturnType<typeof supabase.from>);
    await expect(updateResolvedDocument("run-1", "doc-42")).rejects.toThrow("permission denied");
  });
});
