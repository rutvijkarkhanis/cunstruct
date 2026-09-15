// CLAIMING — the tiny pure pieces of the idempotent-claim/reclaim logic that
// can be unit-tested without a live Postgres. The actual claim (INSERT) and
// reclaim (UPDATE ... WHERE ...) statements run in index.ts against
// analysis_run_source; this file only builds the WHERE-clause fragment and
// documents the concurrency reasoning, so that reasoning has one canonical,
// tested home instead of being a comment nobody re-verifies.

/**
 * The PostgREST `.or(...)` filter fragment that makes a claim reclaimable:
 * a FAILED claim (always retryable), or a PROCESSING claim whose claimed_at
 * is older than `staleAfterMs` (presumed dead — the edge function that made
 * it crashed/timed out before resolving it to SUCCEEDED/FAILED).
 *
 * A genuinely live PROCESSING claim (claimed_at recent) matches neither
 * branch and is never touched. SUCCEEDED never appears here at all — it can
 * never be reclaimed by this filter, by construction (see requireNeverMatchesSucceeded()).
 *
 * Concurrency note: this filter is applied as the WHERE clause of a single
 * `UPDATE ... SET status='PROCESSING', claimed_at=now() ...`. Two concurrent
 * reclaim attempts for the same row still can't both win: Postgres takes a
 * row lock for the first UPDATE to reach it; the second blocks, then
 * re-evaluates this same WHERE clause against the now-committed row (whose
 * claimed_at the first UPDATE just set to "now") — so the second UPDATE's
 * `claimed_at.lt.<cutoff>` condition is false and it correctly matches zero
 * rows. No additional locking is needed beyond the UPDATE itself.
 */
export function buildStaleReclaimFilter(nowMs: number, staleAfterMs: number): string {
  const cutoffIso = new Date(nowMs - staleAfterMs).toISOString();
  return `status.eq.FAILED,and(status.eq.PROCESSING,claimed_at.lt.${cutoffIso})`;
}

/** Pure predicate mirroring the same rule computePreflight() uses to decide
 *  whether a PROCESSING claim should still be shown as "in flight" (protected)
 *  or as reclaimable/stale. Exists so the two call sites (the DB filter above,
 *  and the preflight display in preflight.ts) are provably testing the same
 *  rule rather than two hand-written copies of "10 minutes" that could drift. */
export function isStale(status: "PROCESSING" | "SUCCEEDED" | "FAILED", claimedAtMs: number, nowMs: number, staleAfterMs: number): boolean {
  return status === "PROCESSING" && nowMs - claimedAtMs >= staleAfterMs;
}
