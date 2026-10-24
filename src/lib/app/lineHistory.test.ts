import { describe, it, expect } from "vitest";
import { describeChange, type LineHistoryRow } from "./lineHistory";
import { parseRateEdit, rateSource, type BoqTableLine } from "./boqTable";

const row = (p: Partial<LineHistoryRow>): LineHistoryRow => ({ id: "h", field: "qty", old_value: "1", new_value: "2", changed_at: "2026-10-22T00:00:00Z", review_item_id: null, ...p });
const line = (p: Partial<BoqTableLine>): BoqTableLine => ({ id: "l", section: null, dsr_code: "1.1", description: "x", unit: "sqm", qty: 2, dsr_rate: 100, custom_rate: null, included: true, sort: 0, ...p });

describe("describeChange", () => {
  it("says what changed and why", () => {
    expect(describeChange(row({}))).toEqual({ what: "Quantity: 1 → 2", why: "Manual edit" });
    expect(describeChange(row({ review_item_id: "ri" }))).toEqual({ what: "Quantity: 1 → 2", why: "Applied from drawing review" });
    expect(describeChange(row({ field: "custom_rate", old_value: null, new_value: "1500" }))).toEqual({ what: "Own rate: none (DSR rate) → 1500", why: "Manual edit" });
    expect(describeChange(row({ field: "line_created", old_value: null, new_value: "Door" })).what).toBe("Line created: Door");
    const removed = describeChange(row({ field: "line_removed", old_value: JSON.stringify({ id: "l", qty: 2 }), new_value: null }));
    expect(removed).toEqual({ what: "Line removed (the complete line is kept in this record)", why: "Manual" });
    expect(describeChange(row({ field: "line_restored", old_value: null, new_value: null })).what).toBe("Line restored");
  });
});

describe("parseRateEdit", () => {
  it("accepts zero or more, with commas; empty clears the own rate", () => {
    expect(parseRateEdit(line({}), "1,500")).toEqual({ ok: true, rate: 1500, unchanged: false });
    expect(parseRateEdit(line({}), "0")).toEqual({ ok: true, rate: 0, unchanged: false });
    expect(parseRateEdit(line({ custom_rate: 1500 }), "")).toEqual({ ok: true, rate: null, unchanged: false });
    expect(parseRateEdit(line({}), " ")).toEqual({ ok: true, rate: null, unchanged: true });
    expect(parseRateEdit(line({ custom_rate: 1500 }), "1500")).toEqual({ ok: true, rate: 1500, unchanged: true });
  });
  it("refuses what is not a rate", () => {
    expect(parseRateEdit(line({}), "-1")).toEqual({ ok: false, error: "Rate cannot be negative." });
    expect(parseRateEdit(line({}), "abc").ok).toBe(false);
  });
  it("names where a rate comes from", () => {
    expect([rateSource(line({ custom_rate: 5 })), rateSource(line({})), rateSource(line({ dsr_rate: null }))]).toEqual(["own", "dsr", "none"]);
  });
});
