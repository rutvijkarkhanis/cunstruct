import { describe, it, expect } from "vitest";
import { clearReceipt, loadReceipt, parseReceipt, receiptStorageKey, saveReceipt, type ApplyReceipt } from "./applyReceipt";

const receipt: ApplyReceipt = {
  boqId: "b1", runId: "run1", appliedAt: "2026-10-15T10:00:00.000Z", appliedCount: 3, unresolvedCount: 1,
  correctedCount: 1, reviewedCount: 5, verifiedCount: 3, unauditedCount: 0, conflictedCount: 0,
  revisionChanged: [], justAppliedLineIds: ["l1"],
};
const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("applyReceipt", () => {
  it("round-trips per BOQ", () => {
    const s = memStore();
    saveReceipt(receipt, s);
    expect(s.m.has(receiptStorageKey("b1"))).toBe(true);
    expect(loadReceipt("b1", s)).toEqual(receipt);
    expect(loadReceipt("b2", s)).toBeNull();
    clearReceipt("b1", s);
    expect(loadReceipt("b1", s)).toBeNull();
  });
  it("ignores malformed or mismatched data", () => {
    expect(parseReceipt("not json", "b1")).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...receipt, boqId: "other" }), "b1")).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...receipt, appliedCount: "3" }), "b1")).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...receipt, appliedAt: "yesterday" }), "b1")).toBeNull();
  });
  it("never throws when storage is unavailable or full", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => saveReceipt(receipt, broken)).not.toThrow();
    expect(loadReceipt("b1", broken)).toBeNull();
    expect(() => clearReceipt("b1", broken)).not.toThrow();
    expect(loadReceipt("b1", null)).toBeNull();
  });
});
