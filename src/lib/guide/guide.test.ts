import { describe, it, expect } from "vitest";
import { guideStepStates, guideProjectOf, GUIDE_STEPS, type GuideInput } from "./guide";
import { journeyStages, type ReviewState } from "@/lib/app/journey";
import type { BoqTotals } from "@/lib/app/boqTable";

const T = (o: Partial<BoqTotals> = {}): BoqTotals => ({ pricedTotal: 0, pending: 0, unpriced: 0, complete: 0, excluded: 0, assumed: 0, basisUnknown: 0, ...o });
const run = (o: Partial<{ total: number; verified: number; edited: number; flagged: number; markedPending: number; remaining: number }>): ReviewState =>
  ({ kind: "run", runId: "run-1", summary: { total: 0, verified: 0, edited: 0, flagged: 0, markedPending: 0, remaining: 0, completionPct: 0, ...o } });
function input(o: Partial<GuideInput> & { review?: ReviewState | null }): GuideInput {
  const base = { projectId: "p1", boqId: "b1", review: null as ReviewState | null, totals: null as BoqTotals | null, lineCount: 0, drawingCount: 0, here: "/app/projects/p1/overview", ...o };
  const drawingsWithoutFile = 0;
  return { ...base, stages: journeyStages({ projectId: base.projectId, boqId: base.boqId, drawingCount: base.drawingCount, drawingsWithoutFile, review: base.boqId ? base.review : null, totals: base.totals, lineCount: base.lineCount }) };
}

describe("guideStepStates", () => {
  it("has seven steps in the journey's order", () => {
    expect(GUIDE_STEPS.map((s) => s.key)).toEqual(["overview", "drawings", "takeoff", "review", "boq", "checks", "export"]);
  });

  it("no BOQ: every BOQ step is unavailable, and the next action (a write) is creating a BOQ in the existing screen", () => {
    const s = guideStepStates(input({ boqId: null }));
    for (const k of ["takeoff", "review", "boq", "checks", "export"] as const) expect(s[k].status).toBe("unavailable");
    expect(s.drawings.status).toBe("unavailable");
    expect(s.takeoff.action).toMatchObject({ write: true, to: expect.stringMatching(/^\/ops\/projects\/p1\/boqs\/manage\?returnTo=/) });
    expect(Object.values(s).some((x) => x.status === "done")).toBe(false);
  });

  it("a BOQ with no take-off: take-off and review are unavailable and point at the review screen, never at analysis", () => {
    const s = guideStepStates(input({ review: { kind: "none" }, totals: T(), drawingCount: 1 }));
    expect(s.takeoff.status).toBe("unavailable");
    expect(s.review.status).toBe("unavailable");
    expect(s.takeoff.action?.to).toMatch(/^\/ops\/projects\/p1\/boqs\/b1\/review\?returnTo=/);
    expect(s.takeoff.action?.to).not.toMatch(/analy[sz]e/);
    expect(s.drawings.status).toBe("done");
  });

  it("items still awaiting a decision block the review; held-back items need attention; all decided is complete", () => {
    expect(guideStepStates(input({ review: run({ total: 3, verified: 1, remaining: 2 }), totals: T(), lineCount: 0 })).review.status).toBe("blocked");
    expect(guideStepStates(input({ review: run({ total: 2, verified: 1, flagged: 1 }), totals: T({ complete: 1 }), lineCount: 1 })).review.status).toBe("attention");
    const done = guideStepStates(input({ review: run({ total: 2, verified: 1, edited: 1 }), totals: T({ complete: 2 }), lineCount: 2 }));
    expect(done.review.status).toBe("done");
    expect(done.review.action).toBeNull();
  });

  it("BOQ lines without a rate are stated and need attention; the action links to the builder, it does not price", () => {
    const s = guideStepStates(input({ review: run({ total: 1, verified: 1 }), totals: T({ unpriced: 1 }), lineCount: 1, drawingCount: 1 }));
    expect(s.boq.status).toBe("attention");
    expect(s.boq.summary).toMatch(/1 line with a quantity has no rate/);
    expect(s.boq.action).toMatchObject({ label: "Enter missing rates (BOQ builder)", write: true, to: expect.stringMatching(/^\/ops\/projects\/p1\/boqs\/b1\?returnTo=/) });
    // The unpriced line is a note on the checks (Pricing phase), so they are not shown as complete.
    expect(s.checks.status).toBe("attention");
  });

  it("an empty BOQ: BOQ, checks and export are unavailable, not complete", () => {
    const s = guideStepStates(input({ review: run({ total: 1, verified: 1 }), totals: T(), lineCount: 0 }));
    expect([s.boq.status, s.checks.status, s.export.status]).toEqual(["unavailable", "unavailable", "unavailable"]);
  });

  it("guideProjectOf reads the project from journey paths only", () => {
    expect(guideProjectOf("/app/projects/abc/boq")).toBe("abc");
    expect(guideProjectOf("/app/projects")).toBeNull();
    expect(guideProjectOf("/ops/projects/abc/workspace")).toBeNull();
  });
});
