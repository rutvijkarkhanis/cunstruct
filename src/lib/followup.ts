/**
 * Follow-up cadence estimator (multi-factor).
 *
 * A follow-up is a check-in (WhatsApp/call) asking a site for a progress update.
 * On a procurement platform the cadence isn't cosmetic: fresh progress data is
 * what lets us place material orders on time and catch a slipping schedule. A
 * flat "every 5 days" is wrong for a 60-day RCC pour vs a 3-day handover, and it
 * ignores looming order deadlines, how stale our data already is, and how much
 * we can trust the current velocity.
 *
 * The estimator evaluates several independent "factors", each of which proposes
 * a cadence (in days). The tightest proposal wins — the site is only as relaxed
 * as its most urgent driver — and we report which factor drove the decision so
 * ops understands *why* a check-in is due.
 *
 * Factors:
 *   • stage-pace      routine baseline from stage duration × size, tightened by progress
 *   • transition      catch the stage hand-off before it happens (so next orders fire)
 *   • order-deadline  land a check-in before the nearest material order-by date
 *   • staleness       re-measure before our progress estimate drifts too far
 *   • data-confidence tighten while we still have too few samples to trust velocity
 *   • risk            tighten when pace has dropped or a critical alert is open
 */

export type FollowUpPriority = "overdue" | "urgent" | "soon" | "routine";
export type FollowUpConfidence = "high" | "medium" | "low";

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

  // ---- Optional richer signals (estimator degrades gracefully without them) ----
  /** Count of stage updates logged for the current stage (velocity confidence). */
  updateCount?: number | null;
  /** Nearest upcoming material order-by date across pending forecast items. */
  nextOrderByDate?: string | Date | null;
  /** Historical average velocity (pct/day) for pace-drop detection. */
  historicalVelocityPctPerDay?: number | null;
  /** An open critical alert exists for this project. */
  openCriticalAlert?: boolean | null;

  /** "Now" — injectable for tests. Defaults to current time. */
  now?: Date;
}

export interface FollowUpFactor {
  key: "stage-pace" | "transition" | "order-deadline" | "staleness" | "data-confidence" | "risk";
  /** Cadence this factor argues for, in days. */
  proposedDays: number;
  /** Human-readable one-liner. */
  label: string;
}

export interface FollowUpEstimate {
  /** Recommended days between check-ins (clamped to 1–14). */
  intervalDays: number;
  /** When the next follow-up should happen. */
  nextFollowUpDate: Date;
  /** Days from `now` until the next follow-up (negative if overdue). */
  daysUntil: number;
  /** True when the next follow-up date is already in the past. */
  overdue: boolean;
  /** Escalation level for UI. */
  priority: FollowUpPriority;
  /** How much to trust this estimate. */
  confidence: FollowUpConfidence;
  /** Key of the factor that set the cadence. */
  drivingFactor: FollowUpFactor["key"];
  /** All factors that were evaluated, tightest first. */
  factors: FollowUpFactor[];
  /** Size multiplier applied to stage duration (for display/debug). */
  sizeMultiplier: number;
  /** Estimated days remaining in the current stage. */
  stageDaysRemaining: number;
  /** Short human explanation of the cadence choice. */
  reason: string;
}

const DEFAULT_STAGE_DAYS = 14;
const REFERENCE_AREA_SQFT = 1000;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 14;

/** How many percentage-points our progress estimate may drift before we re-measure. */
const DRIFT_THRESHOLD_PCT = 20;
/** Below this many updates, velocity is unreliable — gather data faster. */
const MIN_SAMPLES = 3;
const CONFIDENCE_TIGHT_DAYS = 3;
const RISK_TIGHT_DAYS = 2;
/** Pace below this fraction of historical average counts as a pace drop. */
const PACE_DROP_RATIO = 0.6;
/** We want a check-in landing this many days before an order-by date. */
const ORDER_LEAD_MARGIN_DAYS = 2;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 86_400_000;

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
  const velocity = input.velocityPctPerDay && input.velocityPctPerDay > 0 ? input.velocityPctPerDay : null;

  const baseStageDays = input.stageDurationDays && input.stageDurationDays > 0
    ? input.stageDurationDays
    : DEFAULT_STAGE_DAYS;
  const adjustedStageDays = baseStageDays * mult;

  // Days left in the current stage: prefer measured velocity, else size-adjusted estimate.
  const remainingPct = 100 - progress;
  const stageDaysRemaining = velocity
    ? remainingPct / velocity
    : adjustedStageDays * (remainingPct / 100);

  const factors: FollowUpFactor[] = [];

  // 1. Stage-pace baseline — aim for ~5 check-ins across a full stage.
  factors.push({
    key: "stage-pace",
    proposedDays: adjustedStageDays / 5,
    label: `Routine pace for a ${Math.round(adjustedStageDays)}-day stage`,
  });

  // 2. Transition — as the stage nears completion, catch the hand-off so the next
  //    stage's materials can be ordered in time. Check in around mid-remaining.
  if (remainingPct > 0) {
    factors.push({
      key: "transition",
      proposedDays: Math.max(stageDaysRemaining * 0.5, 1),
      label: `~${Math.round(stageDaysRemaining)}d left in stage — catch the hand-off`,
    });
  }

  // 3. Order deadline — the core procurement driver. Land a check-in comfortably
  //    before the nearest material order-by date so we can decide to place it.
  let orderDaysUntil: number | null = null;
  if (input.nextOrderByDate) {
    orderDaysUntil = daysBetween(now, new Date(input.nextOrderByDate));
    const usable = Math.max(orderDaysUntil - ORDER_LEAD_MARGIN_DAYS, 0.5);
    factors.push({
      key: "order-deadline",
      proposedDays: usable,
      label: orderDaysUntil <= 0
        ? "Material order is due now — confirm progress"
        : `Order-by in ${Math.round(orderDaysUntil)}d — verify before ordering`,
    });
  }

  // 4. Staleness — re-measure before the progress estimate drifts too far.
  if (velocity) {
    factors.push({
      key: "staleness",
      proposedDays: DRIFT_THRESHOLD_PCT / velocity,
      label: `Re-measure before progress drifts >${DRIFT_THRESHOLD_PCT}%`,
    });
  }

  // 5. Data confidence — while samples are thin, gather updates faster.
  if (input.updateCount != null && input.updateCount < MIN_SAMPLES) {
    factors.push({
      key: "data-confidence",
      proposedDays: CONFIDENCE_TIGHT_DAYS,
      label: `Only ${input.updateCount} update(s) — building a reliable pace`,
    });
  }

  // 6. Risk — pace dropped vs history, or an open critical alert.
  const paceDropped = !!(velocity && input.historicalVelocityPctPerDay
    && input.historicalVelocityPctPerDay > 0
    && velocity < input.historicalVelocityPctPerDay * PACE_DROP_RATIO);
  if (paceDropped || input.openCriticalAlert) {
    factors.push({
      key: "risk",
      proposedDays: RISK_TIGHT_DAYS,
      label: paceDropped ? "Pace is below historical average" : "Open critical alert",
    });
  }

  // Tightest factor wins.
  factors.sort((a, b) => a.proposedDays - b.proposedDays);
  const driver = factors[0];
  const intervalDays = clamp(Math.round(driver.proposedDays), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);

  const last = input.lastUpdate ? new Date(input.lastUpdate) : now;
  const nextFollowUpDate = addDays(last, intervalDays);
  const daysUntil = Math.round(daysBetween(now, nextFollowUpDate));
  const overdue = nextFollowUpDate.getTime() <= now.getTime();

  // Priority.
  let priority: FollowUpPriority;
  if (overdue) priority = "overdue";
  else if (
    daysUntil <= 1 ||
    driver.key === "risk" ||
    (orderDaysUntil != null && orderDaysUntil <= 3)
  ) priority = "urgent";
  else if (daysUntil <= 4) priority = "soon";
  else priority = "routine";

  // Confidence in the estimate.
  const samples = input.updateCount ?? 0;
  let confidence: FollowUpConfidence;
  if (velocity && samples >= 4) confidence = "high";
  else if (velocity || samples >= 2) confidence = "medium";
  else confidence = "low";

  const reason = `${driver.label}. Cadence ~${intervalDays}d `
    + `(${mult.toFixed(1)}× size, ${Math.round(adjustedStageDays)}d adjusted stage, `
    + `${velocity ? "measured pace" : "estimated pace"}).`;

  return {
    intervalDays,
    nextFollowUpDate,
    daysUntil,
    overdue,
    priority,
    confidence,
    drivingFactor: driver.key,
    factors,
    sizeMultiplier: mult,
    stageDaysRemaining,
    reason,
  };
}
