import { describe, it, expect } from "vitest";
import { computeDimensions, OPENING_FACTOR } from "./dimensions";

describe("computeDimensions", () => {
  it("sums floor area across rooms and counts", () => {
    const d = computeDimensions([
      { room_type: "bedroom", length_ft: 10, width_ft: 12, height_ft: 10, count: 2 },
      { room_type: "living", length_ft: 15, width_ft: 20, height_ft: 10, count: 1 },
    ]);
    expect(d.floorAreaSqft).toBe(10 * 12 * 2 + 15 * 20); // 240 + 300 = 540
    expect(d.rooms).toBe(3);
  });

  it("computes wall area as perimeter × height less openings", () => {
    const d = computeDimensions([{ length_ft: 10, width_ft: 10, height_ft: 10, count: 1 }]);
    // perimeter 40 × height 10 = 400, less 15% openings = 340
    expect(d.wallAreaSqft).toBe(400 * (1 - OPENING_FACTOR));
  });

  it("counts bathrooms and electrical points (× count)", () => {
    const d = computeDimensions([
      { room_type: "bathroom", length_ft: 6, width_ft: 5, height_ft: 9, count: 2, electrical_points: 3 },
      { room_type: "kitchen", length_ft: 10, width_ft: 8, height_ft: 10, count: 1, electrical_points: 6 },
    ]);
    expect(d.bathrooms).toBe(2);
    expect(d.points).toBe(3 * 2 + 6); // 12
  });

  it("treats missing/zero count as 1", () => {
    const d = computeDimensions([{ length_ft: 10, width_ft: 10, height_ft: 10 }]);
    expect(d.floorAreaSqft).toBe(100);
    expect(d.rooms).toBe(1);
  });

  it("returns zeros for no rooms", () => {
    const d = computeDimensions([]);
    expect(d).toEqual({ floorAreaSqft: 0, wallAreaSqft: 0, rooms: 0, bathrooms: 0, points: 0 });
  });
});
