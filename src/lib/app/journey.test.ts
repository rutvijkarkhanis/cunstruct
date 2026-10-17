import { describe, it, expect } from "vitest";
import {
  BOQ_PHASES, STAGE_STEP, boqFilterPath, builderPath, journeyBoqFrom, journeyStages, manageBoqsPath, nextStage, reviewNotInBoq,
  reviewWorkstationPath, safeJourneyReturn, type JourneyInput, type ReviewState,
} from "./journey";
import type { BoqTotals } from "./boqTable";
import type { ReviewSummary } from "@/lib/review/reviewQueue";

const T = (p: Partial<BoqTotals> = {}): BoqTotals => ({ pricedTotal: 0, pending: 0, unpriced: 0, complete: 3, excluded: 0, assumed: 0, basisUnknown: 0, ...p });
const S = (p: Partial<ReviewSummary> = {}): ReviewSummary => ({ total: 4, verified: 4, edited: 0, flagged: 0, markedPending: 0, remaining: 0, completionPct: 100, ...p });
const run = (p: Partial<ReviewSummary> = {}): ReviewState => ({ kind: "run", runId: "run-1", summary: S(p) });
const input = (p: Partial<JourneyInput> = {}): JourneyInput => ({
  projectId: "p1", boqId: "b1", drawingCount: 2, drawingsWithoutFile: 0, review: run(), totals: T(), lineCount: 3, ...p,
});
const byKey = (i: JourneyInput) => Object.fromEntries(journeyStages(i).map((s) => [s.key, s]));

describe("BOQ phases", () => {
  it("only Quantity is current; later phases are named but not available", () => {
    expect(BOQ_PHASES.map((p) => [p.name, p.availability])).toEqual([
      ["Quantity BOQ", "current"], ["Specification BOQ", "planned"], ["Pricing BOQ", "planned"],
      ["Procurement BOQ", "later"], ["Execution & variations", "later"],
    ]);
    for (const p of BOQ_PHASES.filter((x) => x.availability !== "current")) expect(p.note).toMatch(/^(Not available yet|Later)\./);
  });
});

describe("journeyStages", () => {
  it("returns the five stages in journey order", () => {
    expect(journeyStages(input()).map((s) => s.key)).toEqual(["drawings", "review", "boq", "checks", "export"]);
  });

  it("drawings: none → to do; all without a file → attention; some missing files → done, and stated", () => {
    expect(byKey(input({ drawingCount: 0 })).drawings.status).toBe("todo");
    expect(byKey(input({ drawingCount: 2, drawingsWithoutFile: 2 })).drawings.status).toBe("attention");
    const d = byKey(input({ drawingCount: 3, drawingsWithoutFile: 1 })).drawings;
    expect(d.status).toBe("done");
    expect(d.detail).toEqual([{ text: "1 drawing record without a file", to: "/app/projects/p1/drawings?boq=b1" }]);
  });

  it("review: no analysis is not started — never reported as complete", () => {
    const r = byKey(input({ review: { kind: "none" } })).review;
    expect(r.status).toBe("not_started");
    expect(r.action).toEqual({ label: "Start review", to: "/app/projects/p1/review?boq=b1" });
  });

  it("review: only items still needing a decision block Apply", () => {
    const blocked = byKey(input({ review: run({ remaining: 2, verified: 1, flagged: 1 }) })).review;
    expect(blocked.status).toBe("todo");
    expect(blocked.summary).toBe("2 items of 4 still need a decision. Apply is blocked until every item has one.");
    const held = byKey(input({ review: run({ verified: 2, flagged: 1, markedPending: 1 }) })).review;
    expect(held.status).toBe("attention");
    expect(held.summary).not.toMatch(/blocked/);
    expect(held.detail).toEqual([
      { text: "1 item flagged", to: "/app/projects/p1/review?boq=b1" },
      { text: "1 item marked pending", to: "/app/projects/p1/review?boq=b1" },
    ]);
    expect(blocked.open).toEqual([{ text: "2 items still need a decision", to: "/app/projects/p1/review?boq=b1" }]);
    expect(byKey(input()).review.status).toBe("done");
  });

  it("BOQ: pending quantities need attention and open the BOQ filtered to them", () => {
    const b = byKey(input({ totals: T({ pending: 2 }) })).boq;
    expect(b.status).toBe("attention");
    expect(b.action).toEqual({ label: "Show pending lines", to: "/app/projects/p1/boq?boq=b1&status=pending" });
    expect(byKey(input({ lineCount: 0, totals: T({ complete: 0 }) })).boq.status).toBe("todo");
  });

  it("a missing rate is not a quantity gap — it is reported as Pricing, and the Quantity stages stay done", () => {
    const s = byKey(input({ totals: T({ complete: 1, unpriced: 2 }) }));
    expect(s.boq.status).toBe("done");
    expect(s.checks.status).toBe("done");
    // The rate gap links to the builder (where rates are entered), with a way back to Check & finalise.
    expect(s.checks.detail).toContainEqual({
      text: "2 lines without a rate (rates belong to the Pricing phase)",
      to: `/ops/projects/p1/boqs/b1?returnTo=${encodeURIComponent("/app/projects/p1/check?boq=b1")}`,
    });
    expect(s.export.summary).toBe("Ready to export.");
  });

  it("checks: pending quantities and review items left out are open; unknown basis and assumptions are always stated", () => {
    const c = byKey(input({ review: run({ verified: 2, flagged: 2 }), totals: T({ pending: 1, basisUnknown: 3, assumed: 1 }) })).checks;
    expect(c.status).toBe("attention");
    expect(c.summary).toBe("Still open: 1 line with a pending quantity; 2 review items not in the BOQ (not verified or corrected).");
    expect(c.detail).toEqual([
      { text: "3 quantities with no recorded basis", to: "/app/projects/p1/boq?boq=b1&q=Basis+not+recorded" },
      { text: "1 quantity based on an assumption", to: "/app/projects/p1/boq?boq=b1&q=Assumption" },
    ]);
    // Every open item links to where it is resolved.
    expect(c.open).toEqual([
      { text: "1 line with a pending quantity", to: "/app/projects/p1/boq?boq=b1&status=pending" },
      { text: "2 review items not in the BOQ (not verified or corrected)", to: "/app/projects/p1/review?boq=b1" },
    ]);
    expect(c.action).toEqual({ label: "Review checks", to: "/app/projects/p1/check?boq=b1" });
  });

  it("export is available with open checks, and says the document states them", () => {
    const e = byKey(input({ totals: T({ pending: 1 }) })).export;
    expect(e.status).toBe("attention");
    expect(e.summary).toBe("You can export now; the document states everything still open.");
    expect(byKey(input({ lineCount: 0 })).export.action).toBeNull();
  });

  it("no BOQ: every BOQ stage points at creating one; nothing is reported done", () => {
    const s = journeyStages(input({ boqId: null, review: null, totals: null, lineCount: 0 }));
    expect(s.slice(1).every((x) => x.status === "not_started")).toBe(true);
    expect(s[1].action?.label).toBe("Create a BOQ");
  });
});

describe("steps and links", () => {
  it("each stage is worked on in its own journey step", () => {
    expect(journeyStages(input()).map((s) => STAGE_STEP[s.key])).toEqual(["drawings", "review", "boq", "check", "export"]);
    expect(journeyStages(input()).map((s) => s.title)).toEqual(["Project & drawings", "Review quantities", "Build BOQ", "Check & finalise", "Export"]);
  });
  it("links that leave the journey carry a way back", () => {
    const back = "/app/projects/p1/boq?boq=b1&status=pending";
    expect(builderPath("p1", "b1", back)).toBe(`/ops/projects/p1/boqs/b1?returnTo=${encodeURIComponent(back)}`);
    expect(builderPath("p1", "b1")).toBe("/ops/projects/p1/boqs/b1");
    expect(manageBoqsPath("p1", "/app/projects/p1/overview")).toBe(`/ops/projects/p1/boqs/manage?returnTo=${encodeURIComponent("/app/projects/p1/overview")}`);
    expect(reviewWorkstationPath("p1", "b1", "/app/projects/p1/review?boq=b1")).toBe(`/ops/projects/p1/boqs/b1/review?returnTo=${encodeURIComponent("/app/projects/p1/review?boq=b1")}`);
    const noBoq = journeyStages(input({ boqId: null, review: null, totals: null, lineCount: 0 }));
    expect(noBoq[1].action?.to).toBe(manageBoqsPath("p1", "/app/projects/p1/overview"));
  });
  it("BOQ filter links keep the BOQ", () => {
    expect(boqFilterPath("p1", "b1", { status: "pending" })).toBe("/app/projects/p1/boq?boq=b1&status=pending");
    expect(boqFilterPath("p1", "b1", { q: "Assumption" })).toBe("/app/projects/p1/boq?boq=b1&q=Assumption");
  });
});

describe("nextStage", () => {
  it("is the first unfinished stage in order", () => {
    expect(nextStage(journeyStages(input({ drawingCount: 0 })))?.key).toBe("drawings");
    expect(nextStage(journeyStages(input({ review: run({ remaining: 1, verified: 3 }), totals: T({ pending: 4 }) })))?.key).toBe("review");
    expect(nextStage(journeyStages(input({ totals: T({ pending: 4 }) })))?.key).toBe("boq");
  });
  it("is Export once everything else is done", () => {
    expect(nextStage(journeyStages(input()))?.key).toBe("export");
  });
});

describe("reviewNotInBoq", () => {
  it("counts items not verified or corrected (the export's rule)", () => {
    expect(reviewNotInBoq(run({ verified: 1, edited: 1, flagged: 1, remaining: 1 }))).toBe(2);
    expect(reviewNotInBoq({ kind: "none" })).toBe(0);
  });
});

describe("return paths", () => {
  it("only honours a path inside the project journey", () => {
    expect(safeJourneyReturn("/app/projects/p1/review?boq=b1")).toBe("/app/projects/p1/review?boq=b1");
    for (const bad of [null, "", "https://evil.example/app/projects/x", "//evil.example", "/ops/boq/1", "/app/projects/p1//x", "/app/projects/p1\\x"]) {
      expect(safeJourneyReturn(bad)).toBeNull();
    }
  });
  it("maps a journey return path to that project's BOQ step for a BOQ", () => {
    expect(journeyBoqFrom("/app/projects/p1/review?boq=b1", "b1")).toBe("/app/projects/p1/boq?boq=b1");
  });
});
