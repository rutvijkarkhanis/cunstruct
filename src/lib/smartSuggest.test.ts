import { describe, it, expect } from "vitest";
import { suggestRooms, canSuggestRooms, tierWastageDelta } from "@/lib/smartSuggest";

describe("smartSuggest", () => {
  it("returns nothing when no counts are given", () => {
    expect(suggestRooms({})).toEqual([]);
    expect(canSuggestRooms({})).toBe(false);
  });

  it("builds living + kitchen + bedroom + bathroom rows from counts", () => {
    const rooms = suggestRooms({ bedrooms: 3, bathrooms: 2, kitchens: 1 });
    const types = rooms.map((r) => r.room_type);
    expect(types).toEqual(["living", "kitchen", "bedroom", "bathroom"]);
    expect(rooms.find((r) => r.room_type === "bedroom")!.count).toBe(3);
    expect(rooms.find((r) => r.room_type === "bathroom")!.count).toBe(2);
    // one hall assumed for any real home
    expect(rooms.find((r) => r.room_type === "living")!.count).toBe(1);
  });

  it("assumes a kitchen when bedrooms exist but kitchens unset", () => {
    const rooms = suggestRooms({ bedrooms: 2 });
    expect(rooms.some((r) => r.room_type === "kitchen" && r.count === 1)).toBe(true);
  });

  it("scales premium rooms larger than economy", () => {
    const eco = suggestRooms({ bedrooms: 1, quality_tier: "economy" })[0 + 2]; // bedroom row
    const prem = suggestRooms({ bedrooms: 1, quality_tier: "premium" })[0 + 2];
    expect(prem.length_ft).toBeGreaterThan(eco.length_ft);
    expect(prem.electrical_points).toBeGreaterThanOrEqual(eco.electrical_points);
  });

  it("tunes the wastage buffer by tier", () => {
    expect(tierWastageDelta("economy")).toBe(-2);
    expect(tierWastageDelta("standard")).toBe(0);
    expect(tierWastageDelta("premium")).toBe(4);
    expect(tierWastageDelta(undefined)).toBe(0);
    expect(tierWastageDelta("garbage")).toBe(0);
  });

  it("floors fractional counts and never suggests zero-count rows", () => {
    const rooms = suggestRooms({ bedrooms: 2.9 as any, bathrooms: 0, kitchens: 0 });
    expect(rooms.every((r) => r.count > 0)).toBe(true);
    expect(rooms.find((r) => r.room_type === "bedroom")!.count).toBe(2);
  });
});
