/**
 * Follow-up cadence estimator.
 *
 * Decides when Cunstruct should next check in with a site (WhatsApp/call) to
 * request a progress update. A naive fixed interval (e.g. "every 5 days") is
 * wrong for a 60-day RCC stage vs a 3-day Handover, and ignores how big the
 * site is or how far into the current stage it already is.
 *
 * The interval is derived from three signals:
 *   1. Estimated time for the current stage (stage_master.typical_duration_days)
 *   2. Project size (built-up area + floors) — larger sites move slower per stage
 *   3. Progress within the current stage — we tighten cadence near a transition
 *      so the next stage's materials can be ordered in time. Measured velocity,
 *      when available, overrides the size-based duration estimate.
 */

export interface FollowUpInput {
  /** stage_master.typical_duration_days for the current stage (days). */
  stageDurationDays: number | null | undefined;
  /** Built-up area in sq ft. */
  areaSqft: number | null | undefined;
  /** Number of floors. */
  floors: number | null | undefined;
  /** Progress within the current stage, 0–100. */
  progressPct: number | null | undefined;
  /** Measured velocity in percentage-points per day, if known. */
  velocityPctPerDay?: number | null;
  /** Timestamp of the most recent stage update (ISO string or Date). */
  lastUpdate?: string | Date | null;
  /** "Now" — injectable for tests. Defaults to current time. */
  now?: Date;
}

export interface FollowUpEstimate {
  /** Recommended days between check-ins. */
  intervalDays: number;
  /** When the next follow-up should happen. */
  nextFollowUpDate: Date;
  /** Days from `now` until the next follow-up (negative if overdue). */
  daysUntil: number;
  /** True when the next follow-up date is already in the past. */
  overdue: boolean;
  /** Size multiplier applied to the stage duration (for display/debug). */
  sizeMultiplier: number;
  /** Estimated days remaining in the current stage. */
  stageDaysRemaining: number;
  /** Short human explanation of the cadence choice. */
  reason: string;
}

const DEFAULT_STAGE_DAYS = 14;
const REFERENCE_AREA_SQFT = 1000;
const MIN_INTERVAL_DAYS = 2;
const MAX_INTERVAL_DAYS = 14;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/**
 * Larger sites take proportionally longer per stage. Area scales sub-linearly
 * (√) so a 4× bigger site is ~2× slower, not 4×; each extra floor adds 10%.
 * Clamped to a sane 0.5×–4× band.
 */
export function sizeMultiplier(areaSqft: number | null | undefined, floors: number | null | undefined): number {
  const area = areaSqft && areaSqft > 0 ? areaSqft : REFERENCE_AREA_SQFT;
  const fl = floors && floors > 0 ? floors : 1;
  const areaFactor = Math.sqrt(area / REFERENCE_AREA_SQFT);
  const floorFactor = 1 + 0.1 * (fl - 1);
  return clamp(areaFactor * floorFactor, 0.5, 4);
}

export function estimateFollowUp(input: FollowUpInput): FollowUpEstimate {
  const now = input.now ?? new Date();
  const progress = clamp(Number(input.progressPct ?? 0), 0, 100);
  const mult = sizeMultiplier(input.areaSqft, input.floors);

  const baseStageDays = (input.stageDurationDays && input.stageDurationDays > 0)
    ? input.stageDurationDays
    : DEFAULT_STAGE_DAYS;
  const adjustedStageDays = baseStageDays * mult;

  // Days left in the current stage: prefer measured velocity, else size-adjusted estimate.
  const remainingPct = 100 - progress;
  let stageDaysRemaining: number;
  if (input.velocityPctPerDay && input.velocityPctPerDay > 0) {
    stageDaysRemaining = remainingPct / input.velocityPctPerDay;
  } else {
    stageDaysRemaining = adjustedStageDays * (remainingPct / 100);
  }

  // Aim for ~5 check-ins across a full stage, but never let a check-in land after
  // more than ~60% of the remaining stage time (so we catch the transition early).
  let interval = Math.min(adjustedStageDays / 5, Math.max(stageDaysRemaining * 0.6, 1));

  // Tighten as the stage nears completion — the next stage's orders depend on it.
  let transitionNote = "";
  if (progress >= 85) {
    interval = Math.min(interval, 3);
    transitionNote = " Tightened — stage nearly complete.";
  } else if (progress >= 60) {
    interval = Math.min(interval, adjustedStageDays / 8);
    transitionNote = " Slightly tighter as the stage progresses.";
  }

  const intervalDays = clamp(Math.round(interval), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);

  const last = input.lastUpdate ? new Date(input.lastUpdate) : now;
  const nextFollowUpDate = addDays(last, intervalDays);
  const daysUntil = Math.round((nextFollowUpDate.getTime() - now.getTime()) / 86_400_000);
  const overdue = nextFollowUpDate.getTime() <= now.getTime();

  const velocityNote = input.velocityPctPerDay && input.velocityPctPerDay > 0
    ? "measured pace"
    : "typical stage duration";
  const reason =
    `Every ~${intervalDays}d — based on ${velocityNote} ` +
    `(${Math.round(adjustedStageDays)}d adjusted stage, ${mult.toFixed(1)}× size) ` +
    `with ${Math.round(stageDaysRemaining)}d left in stage.${transitionNote}`.trim();

  return {
    intervalDays,
    nextFollowUpDate,
    daysUntil,
    overdue,
    sizeMultiplier: mult,
    stageDaysRemaining,
    reason,
  };
}
