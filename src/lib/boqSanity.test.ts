import { describe, it, expect } from "vitest";
import { sanityForCode, countFlagged } from "./boqSanity";

describe("sanityForCode", () => {
  it("flags implausibly low steel (the old-coefficient bug)", () => {
    // 892 kg on 1200 sqft = 0.74 kg/sqft — well below the 2–6 band
    const r = sanityForCode("5.22.6", 892, 1200);
    expect(r.level).toBe("low");
    expect(r.message).toContain("low");
  });

  it("passes steel that is in band", () => {
    // 4200 kg / 1200 sqft = 3.5 kg/sqft — the calibrated output
    expect(sanityForCode("5.22.6", 4200, 1200).level).toBe("ok");
  });

  it("returns none for unbanded codes or missing area", () => {
    expect(sanityForCode("99.9", 100, 1200).level).toBe("none");
    expect(sanityForCode("5.3", 10, 0).level).toBe("none");
    expect(sanityForCode(null, 10, 1200).level).toBe("none");
  });

  it("counts only flagged, included lines", () => {
    const lines = [
      { dsr_code: "5.22.6", qty: 892, included: true },   // low → flagged
      { dsr_code: "5.3", qty: 60, included: true },        // 0.05 cum/sqft → ok
      { dsr_code: "5.22.6", qty: 100, included: false },   // excluded
    ];
    expect(countFlagged(lines, 1200)).toBe(1);
  });
});
