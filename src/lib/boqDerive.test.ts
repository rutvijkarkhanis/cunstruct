import { describe, it, expect } from "vitest";
import {
  parseFeet, parseDimensionPair, deriveArea, feetToText, isAreaRequirement, deriveAreaQuantities,
} from "./boqDerive";
import type { DrawingItem } from "./boqDrawing";

describe("parseFeet", () => {
  it("parses feet-and-inches in the shapes drawings use", () => {
    expect(parseFeet("10'-8\"")).toBeCloseTo(10 + 8 / 12, 5);
    expect(parseFeet("10' 8\"")).toBeCloseTo(10 + 8 / 12, 5);
    expect(parseFeet("10'8\"")).toBeCloseTo(10 + 8 / 12, 5);
    expect(parseFeet("16'6\"")).toBeCloseTo(16.5, 5);
    expect(parseFeet("12'-0\"")).toBe(12);
  });
  it("parses feet-only and inch-only and bare numbers", () => {
    expect(parseFeet("10'")).toBe(10);
    expect(parseFeet("10.5'")).toBe(10.5);
    expect(parseFeet("10 ft")).toBe(10);
    expect(parseFeet("8\"")).toBeCloseTo(8 / 12, 5);
    expect(parseFeet("13")).toBe(13);
    expect(parseFeet(12)).toBe(12);
  });
  it("accepts curly primes/quotes from phone exports", () => {
    expect(parseFeet("10′-8″")).toBeCloseTo(10 + 8 / 12, 5);   // 10′-8″
  });
  it("returns null for anything without a usable number", () => {
    expect(parseFeet("")).toBeNull();
    expect(parseFeet("tbd")).toBeNull();
    expect(parseFeet(null)).toBeNull();
    expect(parseFeet(0)).toBeNull();
  });
});

describe("parseDimensionPair", () => {
  it("splits an L x W string on x / × / *", () => {
    expect(parseDimensionPair("10'-8\" x 12'-4\"")).toEqual({ a: 10 + 8 / 12, b: 12 + 4 / 12 });
    expect(parseDimensionPair("16'6\" × 13'3\"")).toEqual({ a: 16.5, b: 13.25 });   // ×
  });
  it("returns null when a side is missing or unreadable", () => {
    expect(parseDimensionPair("10'-8\"")).toBeNull();
    expect(parseDimensionPair("10'-8\" x tbd")).toBeNull();
    expect(parseDimensionPair("")).toBeNull();
  });
});

describe("feetToText", () => {
  it("renders decimal feet back to feet-inches", () => {
    expect(feetToText(12)).toBe("12'");
    expect(feetToText(10 + 8 / 12)).toBe("10'-8\"");
    expect(feetToText(16.5)).toBe("16'-6\"");
  });
});

describe("deriveArea", () => {
  it("multiplies an explicit L x W to sqft with a calculation trail", () => {
    const r = deriveArea("12'-0\" x 10'-6\"");
    expect(r).not.toBeNull();
    expect(r!.qty).toBe(126);
    expect(r!.unit).toBe("sqft");
    expect(r!.calculation).toBe("12' × 10'-6\" = 126 sqft");
  });
  it("returns null for a non-dimension string (never guesses)", () => {
    expect(deriveArea("large room")).toBeNull();
  });
});

describe("isAreaRequirement", () => {
  it("recognises area-based work", () => {
    expect(isAreaRequirement("Kitchen flooring")).toBe(true);
    expect(isAreaRequirement("False ceiling")).toBe(true);
    expect(isAreaRequirement("Internal wall plaster")).toBe(true);
    expect(isAreaRequirement("Skirting")).toBe(true);
  });
  it("rejects count/point look-alikes", () => {
    expect(isAreaRequirement("Floor trap")).toBe(false);
    expect(isAreaRequirement("Ceiling lamp point")).toBe(false);
    expect(isAreaRequirement("WC")).toBe(false);
    expect(isAreaRequirement("Floor point")).toBe(false);
  });
});

describe("deriveAreaQuantities", () => {
  const measurements = [
    { name: "Room dimension", value: "10'-8\" x 12'-4\"", location: "Master Bedroom" },
  ];

  it("upgrades a pending area requirement to a derived quantity when a room dimension matches", () => {
    const items: DrawingItem[] = [
      { match: "Master Bedroom flooring", qty: null, pending: true, note: "Master Bedroom" },
    ];
    const [out] = deriveAreaQuantities(items, measurements);
    expect(out.qty).toBeCloseTo((10 + 8 / 12) * (12 + 4 / 12), 1);   // ≈ 131.56
    expect(out.unit).toBe("sqft");
    expect(out.measurement_method).toBe("derived");
    expect(out.basis).toBe("Derived");
    expect(out.pending).toBe(false);
    expect(out.calculation).toContain("10'-8\" × 12'-4\"");
  });

  it("never overwrites an existing counted quantity", () => {
    const items: DrawingItem[] = [
      { match: "Master Bedroom flooring", qty: 100, basis: "Counted", note: "Master Bedroom" },
    ];
    const [out] = deriveAreaQuantities(items, measurements);
    expect(out.qty).toBe(100);
    expect(out.measurement_method).toBeUndefined();
  });

  it("leaves a non-area requirement untouched", () => {
    const items: DrawingItem[] = [{ match: "WC", qty: null, pending: true, note: "Master Bedroom" }];
    const [out] = deriveAreaQuantities(items, measurements);
    expect(out.qty).toBeNull();
  });

  it("stays pending when two room dimensions could apply (ambiguous → never guess)", () => {
    const ambiguous = [
      { name: "Room dimension", value: "10' x 10'", location: "Master Bedroom" },
      { name: "Room dimension", value: "12' x 12'", location: "Master Bedroom" },
    ];
    const items: DrawingItem[] = [{ match: "flooring", qty: null, pending: true, note: "Master Bedroom" }];
    const [out] = deriveAreaQuantities(items, ambiguous);
    expect(out.qty).toBeNull();
  });

  it("stays pending when no dimension resolves to the requirement's space", () => {
    const items: DrawingItem[] = [{ match: "Kitchen flooring", qty: null, pending: true, note: "Kitchen" }];
    const [out] = deriveAreaQuantities(items, measurements);
    expect(out.qty).toBeNull();
  });
});
