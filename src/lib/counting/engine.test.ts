// SYNTHETIC TESTS — every fixture here is hand-built (see
// __fixtures__/syntheticPlans.ts). They show that the counting rules behave
// as specified; they are not evidence of accuracy on real drawings.

import { describe, it, expect } from "vitest";
import { countInstances } from "./engine";
import { toCanonicalSheet, validateInput, pointsPerUnit } from "./normalize";
import type { CountingInput, CountingResult, CountingSheetInput } from "./contract";
import { door, doubleDoor, entry, groundFloor, line, PAGE, quarterArc, run, SCHEDULE, sheet } from "./__fixtures__/syntheticPlans";

const count = (r: CountingResult, mark: string | null, floor?: string) =>
  r.counts.find((c) => c.mark === mark && (floor === undefined || c.floor === floor));
const kinds = (r: CountingResult) => r.unresolved.map((u) => u.kind);
const base = (over: Partial<CountingInput> = {}): CountingInput => ({
  sheets: [groundFloor()],
  schedule: SCHEDULE,
  expectedSheets: [{ sheetNumber: "A-101" }],
  ...over,
});

describe("synthetic: the base plan", () => {
  const r = countInstances(base());

  it("finds three door candidates, each with its own tag", () => {
    const doors = r.instances.filter((i) => i.category === "door");
    expect(doors).toHaveLength(3);
    expect(doors.map((d) => d.proposedType).sort()).toEqual(["D1", "D1", "D2"]);
    for (const d of doors) {
      expect(d.status).toBe("confirmed");
      expect(d.interpretation.tag.status).toBe("unique");
      expect(d.interpretation.schedule.status).toBe("matched");
      expect(d.recognition.confidence).toBeNull();
      expect(d.observed.symbols[0].method).toBe("door_swing_geometry");
    }
  });

  it("multiple objects with the same tag are separate instances: D1 = 2", () => {
    expect(count(r, "D1")).toMatchObject({ status: "resolved", quantity: 2, floor: "Ground Floor" });
    expect(count(r, "D2")).toMatchObject({ status: "resolved", quantity: 1 });
  });

  it("window tags with no detected symbol stay pending — a tag alone is not a confirmed instance", () => {
    const w = count(r, "W1")!;
    expect(w.status).toBe("unresolved");
    expect(w.quantity).toBeNull();
    expect(w.candidateIds).toHaveLength(2);
    expect(r.instances.filter((i) => i.proposedType === "W1").every((i) => i.status === "pending_review" && i.interpretation.tag.status === "tag_only")).toBe(true);
    expect(kinds(r).filter((k) => k === "unmatched_tag")).toHaveLength(2);
  });

  it("observed evidence and interpretation are kept apart", () => {
    const d = r.instances.find((i) => i.proposedType === "D2")!;
    expect(d.observed.tags[0]).toMatchObject({ kind: "tag_text", text: "D2" });
    expect(d.observed.symbols[0]).toMatchObject({ kind: "symbol" });
    expect(d.interpretation.tag.tagId).toBe(d.observed.tags[0].id);
    expect(d.interpretation.tag.margin === undefined || d.interpretation.tag.margin >= 1.5).toBe(true);
  });

  it("ordinary words are not tags", () => {
    expect(r.instances.some((i) => i.observed.tags.some((t) => /KITCHEN|DOORS/.test(t.text ?? "")))).toBe(false);
  });
});

describe("synthetic: duplicate detections of one object", () => {
  it("a door swing drawn twice is one instance, and the merge is reported", () => {
    const s = groundFloor();
    s.shapes = [...s.shapes, ...door(100, 100)];
    const r = countInstances(base({ sheets: [s] }));
    expect(r.instances.filter((i) => i.category === "door")).toHaveLength(3);
    const merged = r.instances.find((i) => i.interpretation.duplicateGroup)!;
    expect(merged.interpretation.duplicateGroup!.memberIds.length).toBe(4); // two arcs + two leaves
    expect(kinds(r)).toContain("duplicate_detection");
    expect(count(r, "D1")!.quantity).toBe(2);
  });

  it("a geometric swing and a supplied detection of the same door are merged, with both methods kept", () => {
    const s = groundFloor("doc-ground", { symbols: [{ id: "loc-1", category: "door", bbox: [99, 74, 126, 101], method: "location_observation" }] });
    const r = countInstances(base({ sheets: [s] }));
    const d = r.instances.find((i) => i.recognition.methods.includes("location_observation"))!;
    expect(d.recognition.methods).toEqual(expect.arrayContaining(["door_swing_geometry", "location_observation", "plan_tag"]));
    expect(count(r, "D1")!.quantity).toBe(2);
  });

  it("an over-printed tag is read once, not as a second instance", () => {
    const s = groundFloor();
    s.runs.push(run("D2", 710.2, 60.1));
    const r = countInstances(base({ sheets: [s] }));
    expect(count(r, "D2")!.quantity).toBe(1);
    expect(r.sheets[0].notes.join(" ")).toMatch(/Over-printed/);
  });

  it("a double door (two leaves meeting) is one candidate, sent to review", () => {
    const s = sheet({ documentId: "doc-dd", title: "GROUND FLOOR PLAN", runs: [run("D3", 115, 60)], shapes: doubleDoor(100, 100) });
    const r = countInstances({ sheets: [s], schedule: [entry("D3", { category: "door" })] });
    const doors = r.instances.filter((i) => i.category === "door");
    expect(doors).toHaveLength(1);
    expect(doors[0].recognition.methods).toContain("double_swing_geometry");
    expect(doors[0].status).toBe("pending_review");
    expect(count(r, "D3")!.quantity).toBeNull();
  });
});

describe("synthetic: missing, unreadable and ambiguous tags", () => {
  it("an untagged door is surfaced, and it holds back every door count on that sheet", () => {
    const s = groundFloor();
    s.shapes.push(...door(1000, 300));
    const r = countInstances(base({ sheets: [s] }));
    expect(kinds(r)).toContain("untagged_candidate");
    expect(count(r, null)).toMatchObject({ status: "unresolved", quantity: null });
    expect(count(r, "D1")).toMatchObject({ status: "unresolved", quantity: null, confirmedCount: 2 });
    expect(count(r, "D1")!.reasons.join(" ")).toMatch(/untagged door candidate/);
  });

  it("an unreadable tag next to a door makes that door ambiguous, never a guessed mark", () => {
    const s = groundFloor();
    s.runs = s.runs.map((x) => (x.text === "D2" ? run("D?", 710, 60) : x));
    const r = countInstances(base({ sheets: [s] }));
    const d = r.instances.find((i) => i.observed.tags.some((t) => t.text === "D?"))!;
    expect(d.status).toBe("ambiguous");
    expect(d.proposedType).toBeNull();
    expect(count(r, "D2")).toBeUndefined();
    expect(kinds(r)).toContain("schedule_entry_without_instance");
  });

  it("a tag that names two marks (W1/W2) is not split into either", () => {
    const s = groundFloor();
    s.runs.push(run("W1/W2", 800, 500));
    const r = countInstances(base({ sheets: [s] }));
    expect(kinds(r)).toContain("unreadable_tag");
    expect(count(r, "W1")!.candidateIds).toHaveLength(2);
  });

  it("a tag midway between two doors belongs to neither", () => {
    const s = sheet({
      documentId: "doc-amb", title: "GROUND FLOOR PLAN",
      runs: [run("D1", 146, 60)],
      shapes: [...door(100, 100), ...door(170, 100)],
    });
    const r = countInstances({ sheets: [s], schedule: SCHEDULE });
    expect(r.instances.filter((i) => i.interpretation.tag.status === "unique")).toHaveLength(0);
    expect(kinds(r)).toContain("ambiguous_tag");
    expect(r.counts.every((c) => c.quantity === null)).toBe(true);
  });

  it("two different tags equally near one door are a contradiction", () => {
    const s = sheet({
      documentId: "doc-con", title: "GROUND FLOOR PLAN",
      runs: [run("D1", 104, 66), run("D2", 104, 112)],
      shapes: door(100, 100),
    });
    const r = countInstances({ sheets: [s], schedule: SCHEDULE });
    expect(r.instances[0].status).toBe("conflicting");
    expect(kinds(r)).toContain("contradictory_association");
  });

  it("OCR-read tags never confirm on their own", () => {
    const r = countInstances(base({ sheets: [groundFloor("doc-ground", { textSource: "ocr" })] }));
    expect(r.instances.every((i) => i.status !== "confirmed")).toBe(true);
    expect(r.instances[0].reasons.join(" ")).toMatch(/OCR/);
  });
});

describe("synthetic: schedule ↔ plan", () => {
  it("a schedule entry with no plan instance is reported, never counted as 0", () => {
    const r = countInstances(base({ schedule: [...SCHEDULE, entry("D7", { category: "door" })] }));
    expect(kinds(r)).toContain("schedule_entry_without_instance");
    expect(count(r, "D7")).toBeUndefined();
    expect(r.markTotals.find((m) => m.mark === "D7")).toMatchObject({ drawingTotal: null, comparison: "not_comparable" });
  });

  it("a plan instance with no schedule entry stays pending", () => {
    const s = groundFloor();
    s.runs = s.runs.map((x) => (x.text === "D2" ? run("D9", 710, 60) : x));
    const r = countInstances(base({ sheets: [s] }));
    expect(r.instances.find((i) => i.proposedType === "D9")!.status).toBe("pending_review");
    expect(kinds(r)).toContain("instance_without_schedule_entry");
    expect(count(r, "D9")!.quantity).toBeNull();
  });

  it("no schedule supplied at all: nothing is confirmed", () => {
    const r = countInstances(base({ schedule: [] }));
    expect(r.instances.every((i) => i.status !== "confirmed")).toBe(true);
    expect(r.instances[0].interpretation.schedule.status).toBe("no_schedule_supplied");
  });

  it("schedule entries that disagree on a size make the mark conflicting", () => {
    const r = countInstances(base({ schedule: [...SCHEDULE, entry("D1", { id: "sched:D1:b", dimension: "1000 x 2100", category: "door" })] }));
    expect(kinds(r)).toContain("conflicting_schedule_entries");
    expect(r.instances.filter((i) => i.proposedType === "D1").every((i) => i.status === "conflicting")).toBe(true);
    expect(count(r, "D1")!.quantity).toBeNull();
  });

  it("a schedule that lists the mark as another category is a conflict, not a match", () => {
    const sched = SCHEDULE.map((e) => (e.mark === "D2" ? { ...e, category: "window" as const, description: "WINDOW" } : e));
    const r = countInstances(base({ schedule: sched }));
    expect(r.instances.find((i) => i.proposedType === "D2")!.interpretation.schedule.status).toBe("category_mismatch");
  });

  it("a printed schedule quantity that disagrees with a complete drawing count blocks both", () => {
    const sched = SCHEDULE.map((e) => (e.mark === "D1" ? { ...e, scheduledQuantity: 5, unit: "nos" } : e));
    const r = countInstances(base({ schedule: sched }));
    expect(r.drawingSet.complete).toBe(true);
    expect(r.markTotals.find((m) => m.mark === "D1")).toMatchObject({ comparison: "disagree", scheduledQuantity: 5, drawingTotal: null });
    expect(count(r, "D1")).toMatchObject({ status: "unresolved", quantity: null });
    expect(kinds(r)).toContain("schedule_count_conflict");
  });

  it("agreement is reported but does not change anything else", () => {
    const sched = SCHEDULE.map((e) => (e.mark === "D1" ? { ...e, scheduledQuantity: 2, unit: "nos" } : e));
    const agree = countInstances(base({ schedule: sched }));
    const plain = countInstances(base());
    expect(agree.markTotals.find((m) => m.mark === "D1")!.comparison).toBe("agree");
    expect(agree.counts).toEqual(plain.counts);
  });

  it("a schedule quantity is never compared with an incomplete set", () => {
    const sched = SCHEDULE.map((e) => (e.mark === "D1" ? { ...e, scheduledQuantity: 5 } : e));
    const r = countInstances(base({ schedule: sched, expectedSheets: [{ sheetNumber: "A-101" }, { sheetNumber: "A-102", title: "FIRST FLOOR PLAN" }] }));
    expect(r.markTotals.find((m) => m.mark === "D1")!.comparison).toBe("not_comparable");
    expect(count(r, "D1")!.quantity).toBe(2); // the floor count itself stands
  });

  it("schedule rows printed on the plan sheet are not counted as plan tags", () => {
    const s = groundFloor();
    s.runs.push(run("DOOR & WINDOW SCHEDULE", 900, 480), run("D1", 900, 500), run("MAIN DOOR", 940, 500), run("900 x 2100", 1020, 500));
    const r = countInstances(base({ sheets: [s] }));
    expect(count(r, "D1")!.candidateIds).toHaveLength(2);
    expect(r.sheets[0].notes.join(" ")).toMatch(/inside a schedule/);
  });

  it("tags inside a schedule entry's own evidence box are excluded too", () => {
    const s = groundFloor();
    s.runs.push(run("D2", 950, 600));
    const sched = SCHEDULE.map((e) => (e.mark === "D2" ? { ...e, source: { documentId: "doc-ground", page: 1, evidence: [{ bbox: [940, 590, 1100, 610] as [number, number, number, number] }] } } : e));
    const r = countInstances(base({ sheets: [s], schedule: sched }));
    expect(count(r, "D2")!.quantity).toBe(1);
  });
});

describe("synthetic: repeated floors and sheets", () => {
  const first = groundFloor("doc-first", { sheetNumber: "A-102" });
  first.runs[0] = run("FIRST FLOOR PLAN", 500, 800, { h: 12 });

  it("two floors with the same layout are counted separately and the similarity is noted", () => {
    const r = countInstances(base({ sheets: [groundFloor(), first], expectedSheets: [{ sheetNumber: "A-101" }, { sheetNumber: "A-102" }] }));
    expect(count(r, "D1", "Ground Floor")!.quantity).toBe(2);
    expect(count(r, "D1", "First Floor")!.quantity).toBe(2);
    expect(r.sheets.every((s) => s.notes.some((n) => /Same opening layout/.test(n)))).toBe(true);
  });

  it("the same plan supplied twice is counted once", () => {
    const r = countInstances(base({ sheets: [groundFloor("doc-a"), groundFloor("doc-b")] }));
    expect(kinds(r)).toContain("duplicate_sheet");
    expect(count(r, "D1")!.quantity).toBe(2);
    expect(r.instances.filter((i) => i.status === "rejected").every((i) => i.interpretation.duplicateOf === "doc-a#p1")).toBe(true);
  });

  it("two different plans for one floor are a conflict with both values kept", () => {
    const other = groundFloor("doc-b");
    other.shapes.push(...door(1000, 300));
    other.runs.push(run("D1", 1010, 260));
    const r = countInstances(base({ sheets: [groundFloor("doc-a"), other] }));
    expect(kinds(r)).toContain("conflicting_sheets");
    const c = count(r, "D1")!;
    expect(c.quantity).toBeNull();
    expect(c.conflictingValues).toEqual([{ value: 2, basis: "candidates on doc-a#p1" }, { value: 3, basis: "candidates on doc-b#p1" }]);
  });

  it("a typical-floor plan is never multiplied", () => {
    const typ = groundFloor("doc-typ");
    typ.runs[0] = run("TYPICAL FLOOR PLAN (1ST TO 4TH)", 500, 800, { h: 12 });
    const r = countInstances(base({ sheets: [typ] }));
    expect(kinds(r)).toContain("typical_floor_multiplier");
    expect(count(r, "D1")).toMatchObject({ quantity: null, confirmedCount: 2 });
  });

  it("a plan with no floor title cannot be confirmed", () => {
    const s = groundFloor();
    s.runs[0] = run("PLAN", 500, 800, { h: 12 });
    const r = countInstances(base({ sheets: [s] }));
    expect(kinds(r)).toContain("floor_unidentified");
    expect(r.instances.every((i) => i.status !== "confirmed")).toBe(true);
  });
});

describe("synthetic: the same object in plans, elevations and details", () => {
  const elevation = sheet({ documentId: "doc-elev", title: "FRONT ELEVATION", runs: [run("D1", 200, 300), run("W1", 400, 300)], shapes: door(300, 300) });
  const detail = sheet({ documentId: "doc-det", title: "DOOR DETAIL", runs: [run("D1", 200, 300)] });

  it("elevation and detail tags are references, never added to the count", () => {
    const r = countInstances(base({ sheets: [groundFloor(), elevation, detail] }));
    expect(count(r, "D1")!.quantity).toBe(2);
    expect(r.references.map((x) => x.mark).sort()).toEqual(["D1", "D1", "W1"]);
    const d1 = r.instances.find((i) => i.proposedType === "D1")!;
    expect(d1.interpretation.crossViewReferenceIds).toHaveLength(2);
    expect(r.instances.every((i) => i.sheetKey === "doc-ground#p1")).toBe(true);
  });

  it("a mark seen only on an elevation is reported as having no plan occurrence", () => {
    const e = sheet({ documentId: "doc-elev", title: "REAR ELEVATION", runs: [run("W5", 200, 300)] });
    const r = countInstances(base({ sheets: [groundFloor(), e] }));
    expect(r.unresolved.find((u) => u.kind === "plan_absent")!.mark).toBe("W5");
    expect(count(r, "W5")).toBeUndefined();
  });

  it("a sheet mixing a plan and a detail confirms nothing", () => {
    const s = groundFloor();
    s.runs.push(run("DOOR DETAIL", 900, 600, { h: 10 }));
    const r = countInstances(base({ sheets: [s] }));
    expect(r.sheets[0].view).toBe("mixed");
    expect(kinds(r)).toContain("mixed_view_sheet");
    expect(r.counts.every((c) => c.quantity === null)).toBe(true);
  });
});

describe("synthetic: overlapping symbols and nearby text", () => {
  it("a door's own tag wins over a neighbouring door when it is clearly nearer", () => {
    const s = sheet({
      documentId: "doc-near", title: "GROUND FLOOR PLAN",
      runs: [run("D1", 102, 66), run("D2", 162, 66)],
      shapes: [...door(100, 100), ...door(160, 100)],
    });
    const r = countInstances({ sheets: [s], schedule: SCHEDULE });
    expect(r.instances.map((i) => [i.proposedType, i.status])).toEqual([["D1", "confirmed"], ["D2", "confirmed"]]);
  });

  it("a window tag beside a door is not attached to it (category must agree)", () => {
    const s = sheet({ documentId: "doc-cat", title: "GROUND FLOOR PLAN", runs: [run("W1", 104, 66)], shapes: door(100, 100) });
    const r = countInstances({ sheets: [s], schedule: SCHEDULE });
    expect(r.instances.find((i) => i.category === "door")!.proposedType).toBeNull();
    expect(r.instances.find((i) => i.category === "window")!.interpretation.tag.status).toBe("tag_only");
  });

  it("an arc with no leaf line is not a door; a 180° arc is not a door swing", () => {
    const s = sheet({
      documentId: "doc-arc", title: "GROUND FLOOR PLAN", runs: [],
      shapes: [quarterArc(100, 100, 25, 270), quarterArc(300, 100, 25, 180, 180), line([300, 100], [275, 100])],
    });
    const r = countInstances({ sheets: [s], schedule: SCHEDULE });
    expect(r.instances).toHaveLength(0);
    expect(r.sheets[0].notes.join(" ")).toMatch(/no leaf line/);
  });

  it("with a known scale, a leaf too narrow for a door is sent to review", () => {
    const unitsPerMm = 72 / 25.4 / 100; // 1:100 in points
    const s = groundFloor("doc-ground", { unitsPerMm });
    const r = countInstances(base({ sheets: [s] }));
    // r = 25 pt at 1:100 ≈ 882 mm: plausible, unchanged.
    expect(count(r, "D1")!.quantity).toBe(2);
    const tiny = groundFloor("doc-ground", { unitsPerMm: unitsPerMm * 3 }); // same drawing read at 1:33 → 294 mm leaves
    const t = countInstances(base({ sheets: [tiny] }));
    expect(t.instances.filter((i) => i.category === "door").every((i) => i.status === "pending_review")).toBe(true);
    expect(t.instances[0].reasons.join(" ")).toMatch(/cupboard/);
  });
});

// Rotate every coordinate of a sheet 90° clockwise: (x, y) → (H - y, x).
function rotateSheet(s: CountingSheetInput): CountingSheetInput {
  const H = s.pageSize.height;
  const p = ([x, y]: [number, number]): [number, number] => [H - y, x];
  return {
    ...s,
    pageSize: { width: s.pageSize.height, height: s.pageSize.width },
    runs: s.runs.map((r) => ({ ...r, origin: p(r.origin), direction: [-r.direction[1], r.direction[0]] as [number, number] })),
    shapes: s.shapes.map((g) => {
      const points = g.points.map(p);
      const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
      return { ...g, points, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] };
    }),
  };
}

describe("synthetic: rotated text and drawing orientation", () => {
  it("the same plan rotated 90° (text running vertically) gives the same counts", () => {
    const plain = countInstances(base());
    const rotated = countInstances(base({ sheets: [rotateSheet(groundFloor())] }));
    expect(rotated.counts.map((c) => [c.mark, c.quantity, c.status])).toEqual(plain.counts.map((c) => [c.mark, c.quantity, c.status]));
  });
});

describe("synthetic: coordinate transformations and unit conversion", () => {
  it("points per unit", () => {
    expect(pointsPerUnit({ units: "pt", yAxis: "down" })).toBe(1);
    expect(pointsPerUnit({ units: "in", yAxis: "down" })).toBe(72);
    expect(pointsPerUnit({ units: "mm", yAxis: "up" })).toBeCloseTo(72 / 25.4, 12);
    expect(pointsPerUnit({ units: "px", dpi: 300, yAxis: "down" })).toBeCloseTo(0.24, 12);
    expect(() => pointsPerUnit({ units: "px", yAxis: "down" })).toThrow(/dpi/);
  });

  // Express the canonical fixture in another space, convert back, compare.
  function inSpace(s: CountingSheetInput, k: number, flip: boolean): CountingSheetInput {
    const H = s.pageSize.height;
    const p = ([x, y]: [number, number]): [number, number] => [x / k, (flip ? H - y : y) / k];
    return {
      ...s,
      pageSize: { width: s.pageSize.width / k, height: H / k },
      runs: s.runs.map((r) => ({ ...r, origin: p(r.origin), width: r.width / k, height: r.height / k, direction: flip ? [r.direction[0], -r.direction[1]] as [number, number] : r.direction })),
      shapes: s.shapes.map((g) => ({ ...g, points: g.points.map(p), bbox: [0, 0, 0, 0] as [number, number, number, number] })),
    };
  }

  it("a DXF-style sheet (mm, y up) converts to the same result", () => {
    const k = 72 / 25.4;
    const dxf = toCanonicalSheet(inSpace(groundFloor(), k, true), { units: "mm", yAxis: "up" });
    const r = countInstances(base({ sheets: [dxf] }));
    expect(r.counts.map((c) => [c.mark, c.quantity])).toEqual(countInstances(base()).counts.map((c) => [c.mark, c.quantity]));
    expect(dxf.pageSize.width).toBeCloseTo(PAGE.width, 6);
  });

  it("an OCR-pixel sheet (300 dpi, y down) converts to the same result", () => {
    const px = toCanonicalSheet(inSpace(groundFloor(), 0.24, false), { units: "px", dpi: 300, yAxis: "down" });
    const r = countInstances(base({ sheets: [px] }));
    expect(r.counts.map((c) => [c.mark, c.quantity])).toEqual(countInstances(base()).counts.map((c) => [c.mark, c.quantity]));
  });
});

describe("synthetic: missing pages and incomplete drawing sets", () => {
  it("a listed sheet that is not supplied makes the set incomplete", () => {
    const r = countInstances(base({ expectedSheets: [{ sheetNumber: "A-101" }, { sheetNumber: "A-103", title: "SECOND FLOOR PLAN" }] }));
    expect(r.drawingSet.complete).toBe(false);
    expect(r.unresolved.find((u) => u.kind === "missing_sheet")!.message).toMatch(/A-103/);
  });

  it("a raster page is unreadable, not empty", () => {
    const raster = sheet({ documentId: "doc-scan", runs: [], textLayer: "absent", sheetNumber: "A-102" });
    const r = countInstances(base({ sheets: [groundFloor(), raster], expectedSheets: [{ sheetNumber: "A-101" }, { sheetNumber: "A-102" }] }));
    expect(kinds(r)).toContain("unreadable_sheet");
    expect(r.drawingSet.complete).toBe(false);
  });

  it("with no sheet register, completeness is not claimed", () => {
    const r = countInstances(base({ expectedSheets: undefined }));
    expect(r.drawingSet.complete).toBe(false);
    expect(r.drawingSet.reasons.join(" ")).toMatch(/register/);
  });
});

describe("synthetic: stable ordering and deterministic runs", () => {
  const input = () => base({
    sheets: [groundFloor("doc-b"), sheet({ documentId: "doc-elev", title: "FRONT ELEVATION", runs: [run("D1", 200, 300)] }), groundFloor("doc-a")],
  });

  it("repeated runs give identical output", () => {
    expect(JSON.stringify(countInstances(input()))).toBe(JSON.stringify(countInstances(input())));
  });

  it("sheet order in the input does not change the output", () => {
    const a = countInstances(input());
    const b = countInstances({ ...input(), sheets: [...input().sheets].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("the input digest changes when the input does", () => {
    const a = countInstances(base());
    const s = groundFloor();
    s.runs.push(run("D2", 900, 300));
    expect(countInstances(base({ sheets: [s] })).provenance.inputDigest).not.toBe(a.provenance.inputDigest);
    expect(a.provenance.inputDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("ids are stable and unique", () => {
    const r = countInstances(input());
    const ids = [...r.instances.map((i) => i.id), ...r.unresolved.map((u) => u.id), ...r.counts.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("synthetic: invalid input and malformed geometry", () => {
  it("drops malformed elements with a reason and never throws", () => {
    const bad = groundFloor();
    bad.shapes.push({ type: "line", page: 1, points: [[NaN, 1], [2, 2]], bbox: [0, 0, 0, 0], source: "PDF", confidenceTier: "deterministic" });
    bad.shapes.push({ type: "path", page: 1, points: [], bbox: [0, 0, 0, 0], source: "PDF", confidenceTier: "deterministic" });
    bad.runs.push({ text: "D1", origin: [Infinity, 0], direction: [1, 0], width: 5, height: 6 });
    bad.symbols = [{ id: "s", category: "door", bbox: [10, 10, 5, 5], method: "manual" }];
    const r = countInstances(base({ sheets: [bad, { documentId: "x", page: 1 } as unknown as CountingSheetInput] }));
    expect(r.rejectedInputs.length).toBe(5);
    expect(kinds(r).filter((k) => k === "invalid_input")).toHaveLength(5);
    expect(count(r, "D1")!.quantity).toBe(2);
  });

  it("garbage input gives an empty, honest result", () => {
    const r = countInstances({ sheets: "nope", schedule: null } as unknown as CountingInput);
    expect(r.instances).toEqual([]);
    expect(r.drawingSet.complete).toBe(false);
    expect(r.rejectedInputs[0].where).toBe("input.sheets");
  });

  it("schedule entries without a readable mark are dropped", () => {
    const { input, rejected } = validateInput({ sheets: [], schedule: [entry("D-1"), entry("DOOR")] });
    expect(input.schedule.map((e) => e.mark)).toEqual(["D1"]);
    expect(rejected).toHaveLength(1);
  });

  it("the same sheet supplied twice is read once", () => {
    const r = countInstances(base({ sheets: [groundFloor(), groundFloor()] }));
    expect(count(r, "D1")!.quantity).toBe(2);
    expect(r.unresolved.some((u) => /more than once/.test(u.message))).toBe(true);
  });
});
