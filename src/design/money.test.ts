import { describe, expect, it } from "vitest";
import { formatINR, formatINRCompact, formatQuantity, MISSING } from "./money";

describe("formatINR (grid)", () => {
  it("groups Indian-style: 12,34,567", () => {
    expect(formatINR(1234567)).toBe("₹12,34,567");
    expect(formatINR(48200000)).toBe("₹4,82,00,000");
    expect(formatINR(999)).toBe("₹999");
    expect(formatINR(100000)).toBe("₹1,00,000");
  });

  it("rounds to whole rupees", () => {
    expect(formatINR(1234567.4)).toBe("₹12,34,567");
    expect(formatINR(1234567.5)).toBe("₹12,34,568");
  });

  it("formats negatives with a leading minus", () => {
    expect(formatINR(-1234567)).toBe("-₹12,34,567");
    expect(formatINR(-1500)).toBe("-₹1,500");
  });

  it("shows a real zero as ₹0 and never shows -₹0", () => {
    expect(formatINR(0)).toBe("₹0");
    expect(formatINR(-0)).toBe("₹0");
    expect(formatINR(-0.4)).toBe("₹0");
  });

  it("shows missing values as an em dash, never 0", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(formatINR(v)).toBe(MISSING);
      expect(formatINR(v)).toBe("—");
    }
  });
});

describe("formatINRCompact (summaries)", () => {
  it("uses crore and lakh units", () => {
    expect(formatINRCompact(48200000)).toBe("₹4.82 Cr");
    expect(formatINRCompact(3860000)).toBe("₹38.6 L");
    expect(formatINRCompact(1234567)).toBe("₹12.3 L");
    expect(formatINRCompact(100000)).toBe("₹1.00 L");
    expect(formatINRCompact(10000000)).toBe("₹1.00 Cr");
    expect(formatINRCompact(456000000)).toBe("₹45.6 Cr");
  });

  it("keeps whole crores, Indian-grouped, at ₹100 Cr and above", () => {
    expect(formatINRCompact(1234000000)).toBe("₹123 Cr");
    expect(formatINRCompact(123456000000)).toBe("₹12,346 Cr");
  });

  it("promotes to the next unit when rounding crosses it", () => {
    expect(formatINRCompact(9996000)).toBe("₹1.00 Cr");
    expect(formatINRCompact(99960)).toBe("₹99,960");
    expect(formatINRCompact(99999.6)).toBe("₹1.00 L");
  });

  it("falls back to the full format under ₹1 L", () => {
    expect(formatINRCompact(99000)).toBe("₹99,000");
    expect(formatINRCompact(0)).toBe("₹0");
  });

  it("formats negatives", () => {
    expect(formatINRCompact(-48200000)).toBe("-₹4.82 Cr");
    expect(formatINRCompact(-3860000)).toBe("-₹38.6 L");
    expect(formatINRCompact(-5000)).toBe("-₹5,000");
  });

  it("shows missing values as an em dash, never 0", () => {
    expect(formatINRCompact(null)).toBe("—");
    expect(formatINRCompact(undefined)).toBe("—");
    expect(formatINRCompact(NaN)).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("groups Indian-style with fixed decimals for tabular alignment", () => {
    expect(formatQuantity(1234567.5)).toBe("12,34,567.50");
    expect(formatQuantity(12, 0)).toBe("12");
    expect(formatQuantity(0.125, 3)).toBe("0.125");
  });

  it("handles negatives and zero", () => {
    expect(formatQuantity(-42.1)).toBe("-42.10");
    expect(formatQuantity(0)).toBe("0.00");
    expect(formatQuantity(-0.001)).toBe("0.00");
  });

  it("shows missing values as an em dash, never 0", () => {
    expect(formatQuantity(null)).toBe("—");
    expect(formatQuantity(undefined)).toBe("—");
  });
});
