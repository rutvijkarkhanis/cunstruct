// A new BOQ line from drawing review carries the description the analysis
// extracted for the tagged element ("D3 — <schedule text>"), not the bare tag,
// and count units are written in one spelling. Both are checked through the
// pure classifier and through the REAL applyReviewPlan against the in-memory
// database; the DSR effect is checked against the real DSR 2023 seed.
//
// The schedule texts below are test inputs standing in for what an analysis
// extracts from a door / finish schedule — they are not taken from any real
// drawing set, and no quantity here is meant as one.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));
import { readTable, resetInMemoryDb } from "@/lib/e2e/inMemorySupabase";
import { applyReviewPlan, buildApplyPlan, canonicalApplyUnit, classifyReviewItem, newLineDescription, type BoqLineForApply } from "./applyReview";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";
import { seedCatalogue } from "@/lib/dsr/seedFixture";
import { buildDsrIndex, matchLine } from "@/lib/dsr/match";

const item = (ai: Partial<AnalysisItemV1> & { key: string }, extra: Partial<StoredReviewItem> = {}): StoredReviewItem => ({
  id: `ri-${ai.key}`, reviewStatus: "VERIFIED",
  ai: { item: ai.key, quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", ...ai } as AnalysisItemV1,
  ...extra,
});
const line = (o: Partial<BoqLineForApply>): BoqLineForApply => ({
  id: "line-1", external_key: "D3", qty: 2, unit: "nos", quantity_status: "COUNTED", scope_name: null, ...o,
});

const DOOR_TEXT = "Flush door shutter, 35 mm thick, solid core";

describe("a new line's description", () => {
  it("a tagged item with an extracted description: '<tag> — <description>'", () => {
    const c = classifyReviewItem(item({ key: "D3", description: DOOR_TEXT }), []);
    expect(c.classification).toBe("NEW_LINE");
    expect(c.newLine?.description).toBe(`D3 — ${DOOR_TEXT}`);
  });

  it("no description but an extracted specification: the specification, verbatim", () => {
    expect(newLineDescription(item({ key: "CR-01", item: "Floor finish CR-01", specification: "Vitrified tile flooring 600x600 mm" })))
      .toBe("Floor finish CR-01 — Vitrified tile flooring 600x600 mm");
  });

  it("no extracted text at all: the tag alone, exactly as before — nothing invented", () => {
    const c = classifyReviewItem(item({ key: "D3" }), []);
    expect(c.newLine?.description).toBe("D3");
    expect(newLineDescription(item({ key: "W2", description: "  ", specification: "" }))).toBe("W2");
  });

  it("text that only repeats the name adds nothing", () => {
    expect(newLineDescription(item({ key: "D3", item: "Door D3", description: "door d3" }))).toBe("Door D3");
  });

  it("a specification the reviewer corrected is not written; the correction stays disclosed and the name is used", () => {
    const it_ = item({ key: "W2", specification: "UPVC" }, { reviewStatus: "EDITED", reviewer: { specification: "Aluminium" } });
    const c = classifyReviewItem(it_, []);
    expect(c.newLine?.description).toBe("W2");
    expect(c.unsupportedChanges).toEqual([{ field: "specification", from: "UPVC", to: "Aluminium" }]);
  });

  it("an existing (matched) line's description is never touched — only qty/unit are proposed", () => {
    const c = classifyReviewItem(item({ key: "D3", description: DOOR_TEXT, quantity: 3 }), [line({})]);
    expect(c.classification).toBe("APPLY");
    expect(c.newLine).toBeUndefined();
    expect(c.changes).toEqual([{ field: "qty", from: "2", to: "3" }]);
  });
});

describe("count units are written in one spelling", () => {
  it("nr / no / No. / nos / each all become 'nos'; other units are left exactly as given", () => {
    for (const u of ["nr", "Nr.", "no", "No.", "NOS", "nos", "each", "Number"]) expect(canonicalApplyUnit(u)).toBe("nos");
    for (const u of ["set", "pair", "sqm", "m", "cum", "kg", "pcs"]) expect(canonicalApplyUnit(u)).toBe(u);
    expect(canonicalApplyUnit("  ")).toBeNull();
    expect(canonicalApplyUnit(null)).toBeNull();
  });

  it("new lines from one review get the same count unit whichever spelling the analysis used", () => {
    const plan = buildApplyPlan([item({ key: "D3", unit: "nr" }), item({ key: "W2", unit: "No." }), item({ key: "D1", unit: "nos" })], []);
    expect(plan.map((c) => c.newLine?.unit)).toEqual(["nos", "nos", "nos"]);
    expect(plan.map((c) => c.changes.find((f) => f.field === "unit")?.to)).toEqual(["nos", "nos", "nos"]);
  });

  it("an existing line's own count spelling is not a change ('nr' line, 'nos' item → no unit write)", () => {
    expect(classifyReviewItem(item({ key: "D3", unit: "nos" }), [line({ unit: "nr" })]).classification).toBe("NO_CHANGE");
    expect(classifyReviewItem(item({ key: "D3", unit: "nr" }), [line({ unit: "nos" })]).classification).toBe("NO_CHANGE");
  });

  it("a real unit change on an existing line is written in the canonical spelling", () => {
    const c = classifyReviewItem(item({ key: "D3", unit: "nr" }), [line({ unit: "sqm" })]);
    expect(c.changes).toEqual([{ field: "unit", from: "sqm", to: "nos" }]);
  });
});

describe("through the real applyReviewPlan", () => {
  beforeEach(() => resetInMemoryDb({ boq: [{ id: "boq-1", project_id: null }], boq_line: [] }));

  it("writes '<tag> — <description>' and 'nos' to the new boq_line; quantity unchanged", async () => {
    const items = [item({ key: "D3", description: DOOR_TEXT, unit: "nr", quantity: 5 }), item({ key: "W2", unit: "no" })];
    const plan = buildApplyPlan(items, []);
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(items.map((i) => i.id)) });
    expect(res.appliedCount).toBe(2);
    const rows = readTable("boq_line");
    expect(rows.find((l) => l.external_key === "D3")).toMatchObject({ description: `D3 — ${DOOR_TEXT}`, unit: "nos", qty: 5 });
    expect(rows.find((l) => l.external_key === "W2")).toMatchObject({ description: "W2", unit: "nos", qty: 2 });
  });
});

describe("DSR 2023 check on the written description (real seed)", () => {
  const ix = buildDsrIndex(seedCatalogue(), "DSR", "2023");
  const check = (it_: StoredReviewItem) => {
    const nl = classifyReviewItem(it_, []).newLine!;
    return matchLine({ description: nl.description, unit: nl.unit }, ix);
  };

  it("bare tag: no match; tag + extracted door description: a possible match on a door-shutter item", () => {
    expect(check(item({ key: "D3", unit: "sqm" })).verdict).toBe("none");
    const r = check(item({ key: "D3", unit: "sqm", description: DOOR_TEXT }));
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].item.description.toLowerCase()).toContain("door shutter");
  });

  it("bare finish name: no match; with the extracted tile specification: a possible vitrified-tile item", () => {
    expect(check(item({ key: "CR-01", item: "Floor finish CR-01", unit: "sqm" })).verdict).toBe("none");
    const r = check(item({ key: "CR-01", item: "Floor finish CR-01", unit: "sqm", specification: "Vitrified tile flooring 600x600 mm" }));
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].item.description.toLowerCase()).toContain("vitrified");
  });
});
