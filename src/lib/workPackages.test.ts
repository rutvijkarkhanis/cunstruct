import { describe, it, expect } from "vitest";
import { buildWorkPackages, buildWorkPackageCsv, NO_LOCATION, NO_TRADE, type WorkPackageLineInput } from "./workPackages";
import { buildBoqCsv, incompleteScopeNotice } from "./boqDsrDocument";
import { BOQ_DRAFT_DISCLAIMER } from "./boqDraftDisclaimer";

const line = (o: Partial<WorkPackageLineInput> & { id: string }): WorkPackageLineInput => ({
  section: "Masonry", dsr_code: null, description: "Brickwork", unit: "cum", qty: 10,
  quantity_status: null, included: true, scope_id: null, sort: 0, ...o,
});
const SCOPES = new Map([["s-ground", "Ground Floor"], ["s-first", "First Floor"]]);

describe("buildWorkPackages — trade, then location, from the same lines", () => {
  const lines = [
    line({ id: "a", section: "Masonry", scope_id: "s-ground", qty: 12, sort: 1 }),
    line({ id: "b", section: "Concrete", scope_id: "s-first", description: "RCC slab", qty: 8, sort: 2 }),
    line({ id: "c", section: "Masonry", scope_id: "s-first", qty: 9, sort: 3 }),
    line({ id: "d", section: null, scope_id: null, description: "Unsectioned item", qty: 1, sort: 4 }),
    line({ id: "e", section: "Masonry", scope_id: "s-ground", qty: 0, quantity_status: "PENDING", description: "Parapet", sort: 5 }),
    line({ id: "f", section: "Masonry", scope_id: "s-ground", included: false, sort: 6 }),
    line({ id: "g", section: "Concrete", scope_id: "s-gone", description: "Lintel", qty: 2, sort: 7 }),
  ];
  const set = buildWorkPackages(lines, SCOPES);

  it("orders trades by name with the unassigned trade last, and numbers packages in that order", () => {
    expect(set.packages.map((p) => [p.no, p.trade])).toEqual([[1, "Concrete"], [2, "Masonry"], [3, NO_TRADE]]);
  });

  it("groups each trade by location name, 'No location' last; an unknown scope is labelled, never merged or dropped", () => {
    const concrete = set.packages[0].locations.map((l) => l.location);
    expect(concrete).toEqual(["First Floor", "Unknown location (s-gone)"]);
    expect(set.packages[1].locations.map((l) => l.location)).toEqual(["First Floor", "Ground Floor"]);
    expect(set.packages[2].locations.map((l) => l.location)).toEqual([NO_LOCATION]);
  });

  it("carries quantities unchanged; a pending quantity is null and marked pending, never 0", () => {
    const ground = set.packages[1].locations.find((l) => l.location === "Ground Floor")!;
    expect(ground.rows.map((r) => [r.lineId, r.qty, r.status])).toEqual([["a", 12, "measured"], ["e", null, "pending"]]);
    expect(set.packages[1]).toMatchObject({ measuredCount: 2, pendingCount: 1 });
  });

  it("leaves excluded lines out of every package but counts them", () => {
    expect(set.packages.flatMap((p) => p.locations.flatMap((l) => l.rows.map((r) => r.lineId)))).not.toContain("f");
    expect(set.excludedCount).toBe(1);
  });

  it("every included line appears exactly once", () => {
    const ids = set.packages.flatMap((p) => p.locations.flatMap((l) => l.rows.map((r) => r.lineId))).sort();
    expect(ids).toEqual(["a", "b", "c", "d", "e", "g"]);
  });
});

describe("buildWorkPackages — a line's origin is never presented as its trade", () => {
  it("lines added from drawing review, and blank 'Other' lines, are unassigned, not a trade", () => {
    const set = buildWorkPackages([
      line({ id: "a", section: "Drawing review — added", scope_id: "s-ground" }),
      line({ id: "b", section: "Other", scope_id: "s-ground" }),
      line({ id: "c", section: "Earth Work", scope_id: "s-ground" }),
    ], SCOPES);
    expect(set.packages.map((p) => [p.trade, p.locations.flatMap((l) => l.rows.map((r) => r.lineId))])).toEqual([
      ["Earth Work", ["c"]], [NO_TRADE, ["a", "b"]],
    ]);
  });
});

describe("buildWorkPackageCsv — quantities only, scope disclosed", () => {
  const set = buildWorkPackages([
    line({ id: "a", section: "Masonry", scope_id: "s-ground", qty: 12, dsr_code: "6.1" }),
    line({ id: "e", section: "Masonry", scope_id: "s-ground", qty: 0, quantity_status: "PENDING", description: "Parapet" }),
    line({ id: "f", included: false }),
  ], SCOPES, (id) => (id === "a" ? { sourceDocument: "plans.pdf", sourcePage: "3" } : { sourceDocument: null, sourcePage: "9" }));
  const rows = buildWorkPackageCsv(set, { boqName: "Tower A", project: "Sample", generatedOn: "1 Oct 2026", unresolvedReviewCount: 4 }).split("\r\n");

  it("states draft status, incomplete scope and excluded lines before the table", () => {
    expect(rows[2]).toContain(BOQ_DRAFT_DISCLAIMER);
    expect(rows[3]).toBe(incompleteScopeNotice(4));
    expect(rows[4]).toBe("1 excluded line not shown.");
  });

  it("has no rate or amount column", () => {
    const header = rows.find((r) => r.startsWith("Package,"))!;
    expect(header).toBe("Package,Trade,Location,Item,Code,Description,Unit,Qty,Status,Source Document,Source Page");
    expect(header).not.toMatch(/rate|amount/i);
  });

  it("writes a pending line with a blank quantity, and a page only alongside its document", () => {
    expect(rows).toContain("1,Masonry,Ground Floor,1.01,6.1,Brickwork,cum,12,Measured,plans.pdf,3");
    expect(rows).toContain("1,Masonry,Ground Floor,1.02,,Parapet,cum,,Pending — quantity not confirmed,,");
  });

  it("omits the notice when nothing is unresolved", () => {
    const clean = buildWorkPackageCsv(set, { boqName: "Tower A", generatedOn: "1 Oct 2026", unresolvedReviewCount: 0 });
    expect(clean).not.toContain("Incomplete scope");
  });
});

describe("BOQ CSV carries the draft disclaimer and incomplete-scope notice", () => {
  const row = { subhead: "1 Masonry", itemNo: "1.01", code: null, spec: "Brickwork", unit: "cum", qty: 10, rate: 100, sourceDocument: null, sourcePage: null };
  it("puts the disclaimer and scope notice before the header and shifts the Amount formula safely", () => {
    const rows = buildBoqCsv([row], { boqName: "B", generatedOn: "d", unresolvedReviewCount: 2 }).split("\r\n");
    expect(rows[2]).toContain(BOQ_DRAFT_DISCLAIMER);
    expect(rows[3]).toBe(incompleteScopeNotice(2));
    expect(rows[4].startsWith("Sub-head,")).toBe(true);
    expect(rows[5]).toContain("=F6*H6");
  });
  it("keeps the draft disclaimer when nothing is unresolved", () => {
    const rows = buildBoqCsv([row], { boqName: "B", generatedOn: "d" }).split("\r\n");
    expect(rows[2]).toContain(BOQ_DRAFT_DISCLAIMER);
    expect(rows[3]).toBe("");
  });
  it("uses singular wording for one item", () => {
    expect(incompleteScopeNotice(1)).toBe("Incomplete scope. 1 drawing-review item is still pending or flagged and is not included in this BOQ.");
  });
});
