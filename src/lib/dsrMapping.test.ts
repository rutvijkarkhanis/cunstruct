import { describe, it, expect } from "vitest";
import {
  compareUnits, mappingWriteFor, normalizeUnit, referenceLabel, snapshotFromDsrItem, type DsrItemRef,
} from "./dsrMapping";

const ITEM: DsrItemRef = {
  id: "dsr-1", code: "4.1.3", description: "Providing and laying cement concrete 1:2:4", unit: "cum",
  rate: 7421.5, source: "DSR", rate_year: "2023", subhead: "4.0 CONCRETE WORK",
};

describe("snapshotFromDsrItem", () => {
  it("copies the reference item verbatim, keyed by its id", () => {
    expect(snapshotFromDsrItem(ITEM)).toEqual({
      dsr_item_id: "dsr-1", dsr_code: "4.1.3", dsr_description: "Providing and laying cement concrete 1:2:4",
      dsr_unit: "cum", dsr_rate: 7421.5, dsr_source: "DSR", dsr_rate_year: "2023",
    });
  });

  it("leaves missing rate/unit/year/description null — never invents them", () => {
    const snap = snapshotFromDsrItem({ id: "x", code: "9.1", description: null, unit: null, rate: null, source: null, rate_year: null });
    expect(snap).toMatchObject({ dsr_rate: null, dsr_unit: null, dsr_rate_year: null, dsr_description: null, dsr_source: null });
  });

  it("coerces a numeric-string rate (PostgREST numeric) and rejects non-numbers", () => {
    expect(snapshotFromDsrItem({ ...ITEM, rate: "120.5" as unknown as number }).dsr_rate).toBe(120.5);
    expect(snapshotFromDsrItem({ ...ITEM, rate: "n/a" as unknown as number }).dsr_rate).toBeNull();
  });
});

describe("unit comparison", () => {
  it("treats spelling variants of the same unit as equal", () => {
    expect(normalizeUnit(" Sq.M ")).toBe("sqm");
    expect(compareUnits("sqm", "Sq.m")).toBe("match");
  });

  it("never converts or aliases different unit spellings", () => {
    expect(compareUnits("m2", "sqm")).toBe("mismatch");
    expect(compareUnits("cum", "m3")).toBe("mismatch");
    expect(compareUnits("rmt", "sqm")).toBe("mismatch");
  });

  it("is 'unknown' when either side has no unit", () => {
    expect(compareUnits(null, "sqm")).toBe("unknown");
    expect(compareUnits("sqm", "  ")).toBe("unknown");
  });
});

describe("mappingWriteFor", () => {
  it("select: mapped with the snapshot, and inclusion reset", () => {
    expect(mappingWriteFor({ kind: "select", item: ITEM })).toMatchObject({
      status: "mapped", include_in_estimate: false, dsr_item_id: "dsr-1", dsr_rate: 7421.5,
    });
  });

  it("needs_review: keeps a tentative candidate when given, else no reference", () => {
    expect(mappingWriteFor({ kind: "needs_review", item: ITEM })).toMatchObject({ status: "needs_review", dsr_code: "4.1.3", include_in_estimate: false });
    expect(mappingWriteFor({ kind: "needs_review" })).toMatchObject({ status: "needs_review", dsr_code: null, dsr_rate: null });
  });

  it("unmatched: carries no DSR reference at all", () => {
    expect(mappingWriteFor({ kind: "unmatched" })).toMatchObject({
      status: "unmatched", include_in_estimate: false, dsr_item_id: null, dsr_code: null, dsr_rate: null,
    });
  });
});

describe("referenceLabel", () => {
  it("uses only the fields present", () => {
    expect(referenceLabel("DSR", "2023")).toBe("DSR 2023");
    expect(referenceLabel("DSR", null)).toBe("DSR");
    expect(referenceLabel(null, null)).toBeNull();
  });
});
