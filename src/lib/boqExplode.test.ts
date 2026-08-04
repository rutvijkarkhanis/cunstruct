import { describe, it, expect } from "vitest";
import { explodeMaterials, type Coefficient } from "./boqExplode";

const c = (item_code: string, kind: string, resource: string, qty: number, unit = "", product_id: string | null = null): Coefficient =>
  ({ item_code, kind, resource, qty, unit, product_id });

function byCode(coeffs: Coefficient[]): Map<string, Coefficient[]> {
  const m = new Map<string, Coefficient[]>();
  for (const x of coeffs) { const a = m.get(x.item_code) ?? []; a.push(x); m.set(x.item_code, a); }
  return m;
}

describe("explodeMaterials", () => {
  const coeffs = byCode([
    c("4.1", "material", "Cement", 6.3, "bag", "P1"),
    c("4.1", "material", "TMT steel", 100, "kg"),
    c("4.1", "labour", "Beldar", 0.9, "day"),
    c("5.1", "material", "Cement", 1.2, "bag"),
  ]);

  it("multiplies coefficients by line quantity and aggregates by resource", () => {
    const { rows } = explodeMaterials([{ dsr_code: "4.1", qty: 10, included: true }], coeffs);
    const cement = rows.find((r) => r.resource === "Cement");
    expect(cement?.qty).toBe(63);           // 6.3 × 10
    expect(rows.find((r) => r.resource === "TMT steel")?.qty).toBe(1000);
  });

  it("merges the same resource across different DSR codes", () => {
    const { rows } = explodeMaterials(
      [{ dsr_code: "4.1", qty: 10, included: true }, { dsr_code: "5.1", qty: 5, included: true }],
      coeffs,
    );
    // 6.3×10 + 1.2×5 = 69
    expect(rows.find((r) => r.resource === "Cement")?.qty).toBe(69);
  });

  it("skips excluded lines and lines without a DSR code", () => {
    const { rows, unmatchedCodes } = explodeMaterials(
      [{ dsr_code: "4.1", qty: 10, included: false }, { dsr_code: null, qty: 5, included: true }],
      coeffs,
    );
    expect(rows).toHaveLength(0);
    expect(unmatchedCodes).toHaveLength(0);
  });

  it("reports DSR codes with no AOR data as unmatched", () => {
    const { matchedCodes, unmatchedCodes } = explodeMaterials(
      [{ dsr_code: "4.1", qty: 10, included: true }, { dsr_code: "9.9", qty: 1, included: true }],
      coeffs,
    );
    expect(matchedCodes).toBe(1);
    expect(unmatchedCodes).toEqual(["9.9"]);
  });

  it("orders materials before labour", () => {
    const { rows } = explodeMaterials([{ dsr_code: "4.1", qty: 1, included: true }], coeffs);
    expect(rows[0].kind).toBe("material");
    expect(rows[rows.length - 1].kind).toBe("labour");
  });
});
