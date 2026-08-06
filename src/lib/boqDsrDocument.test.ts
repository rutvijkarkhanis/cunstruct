import { describe, it, expect } from "vitest";
import { computeCommercials, amountInWords } from "./boqDsrDocument";

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

describe("amountInWords (Indian numbering)", () => {
  it("renders lakhs and crores", () => {
    expect(amountInWords(0)).toBe("Zero");
    expect(amountInWords(500)).toBe("Five Hundred");
    expect(amountInWords(154678)).toBe("One Lakh Fifty Four Thousand Six Hundred Seventy Eight");
    expect(amountInWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
  });
});
