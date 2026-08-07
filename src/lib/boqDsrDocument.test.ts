import { describe, it, expect } from "vitest";
import { computeCommercials, amountInWords, buildBoqCsv } from "./boqDsrDocument";

describe("computeCommercials (CPWD abstract)", () => {
  it("applies cost index, contingency, overhead, cess, then GST in order", () => {
    const c = computeCommercials(100000, {
      costIndexPct: 10, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18,
    });
    expect(c.costIndexAmt).toBe(10000);       // 10% of 100000
    expect(c.worksAdjusted).toBe(110000);
    expect(c.contingencyAmt).toBeCloseTo(3300, 2);   // 3% of 110000
    expect(c.overheadAmt).toBeCloseTo(16500, 2);     // 15% of 110000
    expect(c.subTotal).toBeCloseTo(129800, 2);       // 110000 + 3300 + 16500
    expect(c.cessAmt).toBeCloseTo(1298, 2);          // 1% of 129800
    expect(c.gstAmt).toBeCloseTo(23597.64, 2);       // 18% of (129800 + 1298)
    expect(c.grandTotal).toBeCloseTo(154695.64, 2);
  });

  it("with all extras zero, reduces to works value", () => {
    const c = computeCommercials(50000, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 });
    expect(c.grandTotal).toBe(50000);
  });
});

describe("buildBoqCsv", () => {
  const meta = { boqName: "Test", project: "P1", generatedOn: "1 Jan 2026" };

  it("emits a header and a live Excel amount formula per priced row", () => {
    const csv = buildBoqCsv([
      { subhead: "4.00 RCC", itemNo: "4.01", code: "5.3", spec: "RCC M-20, cement, sand, aggregate", unit: "cum", qty: 13.4, rate: 11505 },
    ], meta);
    const lines = csv.split("\r\n");
    expect(lines[3]).toContain("Your rate");
    // first data row is spreadsheet line 5 → Amount = Qty(F) × Your rate(H)
    expect(lines[4]).toContain("=F5*H5");
    // a spec with commas is quoted
    expect(lines[4]).toContain('"RCC M-20, cement, sand, aggregate"');
  });

  it("leaves amount blank for Non-Schedule (unpriced) items", () => {
    const csv = buildBoqCsv([
      { subhead: "Electrical", itemNo: "1.01", code: null, spec: "Wiring points", unit: "point", qty: 30, rate: null },
    ], meta);
    const cols = csv.split("\r\n")[4].split(",");
    expect(cols[8]).toBe("");   // Amount column (9th) empty — no formula
  });
});

describe("amountInWords (Indian numbering)", () => {
  it("renders lakhs and crores", () => {
    expect(amountInWords(0)).toBe("Zero");
    expect(amountInWords(500)).toBe("Five Hundred");
    expect(amountInWords(154678)).toBe("One Lakh Fifty Four Thousand Six Hundred Seventy Eight");
    expect(amountInWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
  });
});
