// applyAdoptedRate — rate adoption's write through applyFinding's existing
// compare-and-swap. Simulates boq_line rows so the guard's filters really
// decide whether a row matches.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as { patch: Record<string, unknown>; filters: [string, string, unknown][] }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const filters: [string, string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
          is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
          select: () => {
            db.updates.push({ patch, filters });
            const hit = db.rows.filter((r) => filters.every(([op, c, v]) => (op === "is" ? r[c] == null : r[c] === v)));
            hit.forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          },
        };
        return q;
      },
    }),
  },
}));

import { applyAdoptedRate } from "./applyFinding";

beforeEach(() => {
  db.rows = [{ id: "line-1", qty: 40, unit: "sqm", description: "Tiles", custom_rate: null, dsr_rate: 1000 }];
  db.updates = [];
});

describe("applyAdoptedRate", () => {
  it("writes ONLY custom_rate, guarded on the previewed custom_rate/dsr_rate/unit (null via .is)", async () => {
    await expect(applyAdoptedRate("line-1", 1150, { custom_rate: null, dsr_rate: 1000, unit: "sqm" })).resolves.toBe(true);
    expect(db.updates[0].patch).toEqual({ custom_rate: 1150 });
    expect(db.updates[0].filters).toEqual(expect.arrayContaining([
      ["eq", "id", "line-1"], ["eq", "unit", "sqm"], ["is", "custom_rate", null], ["eq", "dsr_rate", 1000],
    ]));
    expect(db.rows[0]).toMatchObject({ custom_rate: 1150, qty: 40, unit: "sqm", description: "Tiles", dsr_rate: 1000 });
  });

  it.each([
    ["custom_rate edited elsewhere", { custom_rate: 900 }],
    ["unit changed since the preview", { unit: "cum" }],
    ["dsr_rate changed since the preview", { dsr_rate: 1100 }],
  ])("returns false and changes nothing when the %s", async (_n, drift) => {
    Object.assign(db.rows[0], drift);
    const before = { ...db.rows[0] };
    await expect(applyAdoptedRate("line-1", 1150, { custom_rate: null, dsr_rate: 1000, unit: "sqm" })).resolves.toBe(false);
    expect(db.rows[0]).toEqual(before);
  });
});
