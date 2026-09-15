import { describe, it, expect } from "vitest";
import { buildStaleReclaimFilter, isStale } from "../../../supabase/functions/_shared/claiming.ts";

describe("isStale — the single rule both preflight display and the DB reclaim filter share", () => {
  it("a PROCESSING claim younger than the threshold is not stale", () => {
    expect(isStale("PROCESSING", 1000, 1000 + 59_000, 60_000)).toBe(false);
  });
  it("a PROCESSING claim exactly at the threshold IS stale (>=)", () => {
    expect(isStale("PROCESSING", 1000, 1000 + 60_000, 60_000)).toBe(true);
  });
  it("a PROCESSING claim older than the threshold is stale", () => {
    expect(isStale("PROCESSING", 1000, 1000 + 120_000, 60_000)).toBe(true);
  });
  it("SUCCEEDED is never stale, no matter how old", () => {
    expect(isStale("SUCCEEDED", 0, 1_000_000_000, 60_000)).toBe(false);
  });
  it("FAILED is never 'stale' either — it's retryable via a different path (always, not time-based)", () => {
    expect(isStale("FAILED", 0, 1_000_000_000, 60_000)).toBe(false);
  });
});

describe("buildStaleReclaimFilter — the DB-side reclaim predicate", () => {
  it("always includes an unconditional FAILED branch", () => {
    expect(buildStaleReclaimFilter(1_700_000_000_000, 600_000)).toContain("status.eq.FAILED");
  });
  it("includes a PROCESSING branch gated on claimed_at before the stale cutoff", () => {
    const filter = buildStaleReclaimFilter(1_700_000_000_000, 600_000);
    expect(filter).toContain("status.eq.PROCESSING");
    expect(filter).toContain("claimed_at.lt.");
  });
  it("the cutoff timestamp is exactly now - staleAfterMs", () => {
    const now = 1_700_000_000_000;
    const staleAfterMs = 600_000;
    const filter = buildStaleReclaimFilter(now, staleAfterMs);
    const expectedCutoff = new Date(now - staleAfterMs).toISOString();
    expect(filter).toContain(expectedCutoff);
  });
  it("never mentions SUCCEEDED — a succeeded claim can never match this filter, by construction", () => {
    expect(buildStaleReclaimFilter(Date.now(), 600_000)).not.toContain("SUCCEEDED");
  });
});
