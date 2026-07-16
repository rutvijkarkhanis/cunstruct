import { describe, it, expect } from "vitest";
import { estimateFollowUp, sizeMultiplier } from "./followup";

const NOW = new Date("2026-07-16T00:00:00.000Z");

describe("sizeMultiplier", () => {
  it("is 1.0 for the reference 1000 sqft / 1 floor site", () => {
    expect(sizeMultiplier(1000, 1)).toBeCloseTo(1, 5);
  });

  it("scales area sub-linearly (4x area -> ~2x)", () => {
    expect(sizeMultiplier(4000, 1)).toBeCloseTo(2, 5);
  });

  it("adds 10% per extra floor", () => {
    expect(sizeMultiplier(1000, 3)).toBeCloseTo(1.2, 5);
  });

  it("clamps to the 0.5x–4x band and handles missing values", () => {
    expect(sizeMultiplier(null, null)).toBeCloseTo(1, 5);
    expect(sizeMultiplier(1_000_000, 50)).toBe(4);
    expect(sizeMultiplier(10, 1)).toBe(0.5);
  });
});

describe("estimateFollowUp", () => {
  it("gives a longer interval for a long stage than a short one", () => {
    const long = estimateFollowUp({ stageDurationDays: 60, areaSqft: 1000, floors: 1, progressPct: 10, now: NOW });
    const short = estimateFollowUp({ stageDurationDays: 3, areaSqft: 1000, floors: 1, progressPct: 10, now: NOW });
    expect(long.intervalDays).toBeGreaterThan(short.intervalDays);
  });

  it("clamps the interval to the 2–14 day band", () => {
    const huge = estimateFollowUp({ stageDurationDays: 365, areaSqft: 50000, floors: 20, progressPct: 5, now: NOW });
    expect(huge.intervalDays).toBeLessThanOrEqual(14);
    const tiny = estimateFollowUp({ stageDurationDays: 1, areaSqft: 100, floors: 1, progressPct: 5, now: NOW });
    expect(tiny.intervalDays).toBeGreaterThanOrEqual(2);
  });

  it("tightens cadence when the stage is nearly complete", () => {
    const early = estimateFollowUp({ stageDurationDays: 60, areaSqft: 1000, floors: 1, progressPct: 10, now: NOW });
    const late = estimateFollowUp({ stageDurationDays: 60, areaSqft: 1000, floors: 1, progressPct: 90, now: NOW });
    expect(late.intervalDays).toBeLessThan(early.intervalDays);
    expect(late.intervalDays).toBeLessThanOrEqual(3);
  });

  it("uses measured velocity to bound remaining stage time", () => {
    const est = estimateFollowUp({
      stageDurationDays: 30, areaSqft: 1000, floors: 1, progressPct: 50,
      velocityPctPerDay: 5, now: NOW, // 50% left / 5 = 10 days remaining
    });
    expect(est.stageDaysRemaining).toBeCloseTo(10, 5);
  });

  it("marks a follow-up overdue when the last update is old", () => {
    const est = estimateFollowUp({
      stageDurationDays: 14, areaSqft: 1000, floors: 1, progressPct: 20,
      lastUpdate: "2026-06-01T00:00:00.000Z", now: NOW,
    });
    expect(est.overdue).toBe(true);
    expect(est.daysUntil).toBeLessThan(0);
  });

  it("schedules the next follow-up from the last update date", () => {
    const est = estimateFollowUp({
      stageDurationDays: 20, areaSqft: 1000, floors: 1, progressPct: 30,
      lastUpdate: NOW, now: NOW,
    });
    const expected = new Date(NOW.getTime() + est.intervalDays * 86_400_000);
    expect(est.nextFollowUpDate.getTime()).toBe(expected.getTime());
    expect(est.overdue).toBe(false);
  });
});
