// Workbench preview paths: journey step links are mapped onto workbench
// sections (query kept); everything else, and every journey returnTo, is unchanged.
import { describe, it, expect, vi, afterEach } from "vitest";

const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/workbenchPreview", () => ({ get WORKBENCH_PREVIEW_ENABLED() { return flag.on; } }));

import { inWorkbench, isWorkbenchPath, journeyBoqFrom, journeyPath, boqFilterPath } from "./journey";

describe("workbench paths", () => {
  it("maps each journey step the workbench has onto its section, keeping the query", () => {
    for (const step of ["overview", "drawings", "review", "boq", "check", "export"]) {
      expect(inWorkbench(journeyPath("p 1", step, "b/1"))).toBe(`/app/projects/p 1/workbench/${step}?boq=b%2F1`);
    }
    expect(inWorkbench(boqFilterPath("p1", "b1", { status: "pending", q: "door" }))).toBe("/app/projects/p1/workbench/boq?boq=b1&status=pending&q=door");
  });

  it("leaves everything else unchanged", () => {
    for (const p of [
      "/app/projects/p1/workbench/boq?boq=b1", "/app/projects/p1/boqsy", "/app/projects/p1/overviewx",
      "/ops/projects/p1/boqs/b1", "/app/projects", "/app/projects/p1/boq-extra",
    ]) expect(inWorkbench(p)).toBe(p);
  });

  it("recognises only workbench paths", () => {
    expect(isWorkbenchPath("/app/projects/p1/workbench")).toBe(true);
    expect(isWorkbenchPath("/app/projects/p1/workbench/review?boq=b1")).toBe(true);
    expect(isWorkbenchPath("/app/projects/p1/workbenchx")).toBe(false);
    expect(isWorkbenchPath("/app/projects/p1/boq?q=workbench")).toBe(false);
    expect(isWorkbenchPath("/x/app/projects/p1/workbench")).toBe(false);
  });

  afterEach(() => { flag.on = false; });

  it("returns from the review screen to the workbench BOQ only when it was opened from the workbench", () => {
    flag.on = true;
    expect(journeyBoqFrom("/app/projects/p1/review?boq=b1", "b1")).toBe("/app/projects/p1/boq?boq=b1");
    expect(journeyBoqFrom("/app/projects/p1/workbench/review?boq=b1", "b1")).toBe("/app/projects/p1/workbench/boq?boq=b1");
    expect(journeyBoqFrom("/ops/x", "b1")).toBeNull();
  });

  it("is unchanged in a build without the preview", () => {
    expect(journeyBoqFrom("/app/projects/p1/workbench/review?boq=b1", "b1")).toBe("/app/projects/p1/boq?boq=b1");
    expect(journeyBoqFrom("/app/projects/p1/review?boq=b1", "b1")).toBe("/app/projects/p1/boq?boq=b1");
  });
});
