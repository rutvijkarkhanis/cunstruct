import { describe, it, expect } from "vitest";
import { estimateFollowUp, sizeMultiplier } from "./followup";

const NOW = new Date("2026-07-16T00:00:00.000Z");
const base = {
  stageDurationDays: 30,
  areaSqft: 1000,
  floors: 1,
  progressPct: 20,
  lastUpdate: NOW,
  now: NOW,
};

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

describe("estimateFollowUp — baseline", () => {
  it("gives a longer interval for a long stage than a short one", () => {
    const long = estimateFollowUp({ ...base, stageDurationDays: 60, progressPct: 10 });
    const short = estimateFollowUp({ ...base, stageDurationDays: 3, progressPct: 10 });
    expect(long.intervalDays).toBeGreaterThan(short.intervalDays);
  });

  it("clamps the interval to the 1–14 day band", () => {
    const huge = estimateFollowUp({ ...base, stageDurationDays: 365, areaSqft: 50000, floors: 20, progressPct: 5 });
    expect(huge.intervalDays).toBeLessThanOrEqual(14);
    const tiny = estimateFollowUp({ ...base, stageDurationDays: 1, areaSqft: 100, progressPct: 95 });
    expect(tiny.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it("tightens cadence when the stage is nearly complete (transition factor)", () => {
    const early = estimateFollowUp({ ...base, stageDurationDays: 60, progressPct: 10 });
    const late = estimateFollowUp({ ...base, stageDurationDays: 60, progressPct: 95 });
    expect(late.intervalDays).toBeLessThan(early.intervalDays);
    expect(late.drivingFactor).toBe("transition");
  });
});

describe("estimateFollowUp — procurement factors", () => {
  it("order-deadline drives cadence and escalates priority when an order-by date is near", () => {
    const near = estimateFollowUp({
      ...base, stageDurationDays: 60, progressPct: 10,
      nextOrderByDate: "2026-07-19T00:00:00.000Z", // 3 days out -> urgent
    });
    expect(near.drivingFactor).toBe("order-deadline");
    expect(near.priority).toBe("urgent");
    expect(near.intervalDays).toBeLessThanOrEqual(2);

    const soonish = estimateFollowUp({
      ...base, stageDurationDays: 60, progressPct: 10,
      nextOrderByDate: "2026-07-22T00:00:00.000Z", // 6 days out -> not yet urgent
    });
    expect(soonish.drivingFactor).toBe("order-deadline");
    expect(soonish.priority).not.toBe("urgent");
  });

  it("flags an order that is already due as urgent", () => {
    const est = estimateFollowUp({
      ...base, nextOrderByDate: "2026-07-15T00:00:00.000Z", // yesterday
    });
    expect(est.drivingFactor).toBe("order-deadline");
    expect(est.priority).toBe("urgent");
  });

  it("staleness bounds interval by how fast progress drifts", () => {
    const est = estimateFollowUp({
      ...base, stageDurationDays: 90, progressPct: 10, velocityPctPerDay: 10, // 20%/10 = 2 days
    });
    expect(est.drivingFactor).toBe("staleness");
    expect(est.intervalDays).toBe(2);
  });

  it("tightens while there are too few updates (data-confidence)", () => {
    const est = estimateFollowUp({ ...base, stageDurationDays: 90, progressPct: 10, updateCount: 1 });
    expect(est.drivingFactor).toBe("data-confidence");
    expect(est.intervalDays).toBeLessThanOrEqual(3);
    expect(est.confidence).toBe("low");
  });

  it("tightens when pace drops below historical average (risk)", () => {
    const est = estimateFollowUp({
      ...base, stageDurationDays: 90, progressPct: 10,
      velocityPctPerDay: 1, historicalVelocityPctPerDay: 5, updateCount: 5,
    });
    expect(est.drivingFactor).toBe("risk");
    expect(est.priority).toBe("urgent");
  });

  it("treats an open critical alert as risk", () => {
    const est = estimateFollowUp({ ...base, stageDurationDays: 90, progressPct: 10, openCriticalAlert: true });
    expect(est.drivingFactor).toBe("risk");
  });
});

describe("estimateFollowUp — scheduling & confidence", () => {
  it("marks a follow-up overdue when the last update is old", () => {
    const est = estimateFollowUp({ ...base, lastUpdate: "2026-06-01T00:00:00.000Z" });
    expect(est.overdue).toBe(true);
    expect(est.priority).toBe("overdue");
    expect(est.daysUntil).toBeLessThan(0);
  });

  it("schedules the next follow-up from the last update date", () => {
    const est = estimateFollowUp({ ...base, stageDurationDays: 20, progressPct: 30 });
    const expected = new Date(NOW.getTime() + est.intervalDays * 86_400_000);
    expect(est.nextFollowUpDate.getTime()).toBe(expected.getTime());
    expect(est.overdue).toBe(false);
  });

  it("reports high confidence with velocity and enough samples", () => {
    const est = estimateFollowUp({ ...base, velocityPctPerDay: 2, updateCount: 5 });
    expect(est.confidence).toBe("high");
  });

  it("always exposes the stage-pace baseline among factors", () => {
    const est = estimateFollowUp({ ...base });
    expect(est.factors.some(f => f.key === "stage-pace")).toBe(true);
  });
});
