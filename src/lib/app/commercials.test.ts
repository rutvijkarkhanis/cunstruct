import { describe, it, expect } from "vitest";
import { commercialValue, parsePercent } from "./commercials";

describe("commercial inputs", () => {
  it("states the value in effect and whether it is the default", () => {
    expect(commercialValue({}, "_overhead_pct")).toEqual({ value: 15, isDefault: true });
    expect(commercialValue({ _overhead_pct: 10 }, "_overhead_pct")).toEqual({ value: 10, isDefault: false });
    expect(commercialValue({ _gst_pct: 0 }, "_gst_pct")).toEqual({ value: 0, isDefault: false });
  });
  it("accepts 0–100 (a trailing % allowed) and refuses anything else", () => {
    expect(parsePercent("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parsePercent(" 18 % ")).toEqual({ ok: true, value: 18 });
    expect(parsePercent("0")).toEqual({ ok: true, value: 0 });
    for (const bad of ["", "abc", "-1", "101"]) expect(parsePercent(bad).ok, bad).toBe(false);
  });
});
