import { describe, it, expect } from "vitest";
import { computeCommercials } from "./boqDsrDocument";

describe("computeCommercials", () => {
  it("applies overhead then GST on the overhead-inclusive amount", () => {
    const c = computeCommercials(100000, 15, 18);
    expect(c.overheadAmt).toBe(15000);
    expect(c.gstAmt).toBe(20700);          // 18% of (100000 + 15000)
    expect(c.grandTotal).toBe(135700);
  });

  it("handles zero percentages", () => {
    const c = computeCommercials(50000, 0, 0);
    expect(c.grandTotal).toBe(50000);
  });
});
