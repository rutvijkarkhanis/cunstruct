// Integrated preview flow (plan v1.2 §5B, PREVIEW ONLY). One pure pipeline
// over a fixture project, joining the engines that already exist:
//
//   measurement rows (B3)  → measured quantity per line   (evaluateLine)
//   + DSR candidates (B4)  → provisional rate, or "no DSR match: market rate
//                            needed"                        (priceFirst)
//   → money-at-risk verify queue (B5)                       (rankByMoneyAtRisk)
//   → coverage findings (B6)                                (coverageGaps)
//   → sampling sign-off readiness (B7)                      (planMus, evaluateMus…)
//   → revision delta (B9) that resets only changed lines    (revisionDelta)
//
// Review state is never stored on a line. A reviewer's check (accept, correct,
// verify) and a sample finding are stamped with the line's INPUT FINGERPRINT —
// its measurement rows, rate, unit, description and drawing revision — and
// only count while the fingerprint still matches. Any change to those inputs
// therefore resets that line's verification automatically, and no other line's.
//
// Never invents a quantity: a pending or invalid measurement is a pending
// quantity with no amount, no ₹ risk and no place in a sample. No database,
// no network: callers hold the state.
import type { DsrItem } from "@/lib/dsr/catalogue";
import { evaluateLine, setRowValue, type LineResult, type MeasurementLine, type MeasurementRow, type RowField } from "@/lib/measurement/measurement";
import { buildPricingIndex, priceFirst, pricingCoverage, type LinePricing, type PricingCoverage } from "@/lib/priceFirst";
import {
  coverageGaps, coverageStatus, resolveGap,
  type CoverageGap, type CoverageInput, type CoverageLine, type CoverageStatus, type GapResolution,
} from "./coverage";
import { rankByMoneyAtRisk, type MoneyAtRiskResult } from "./moneyAtRisk";
import { revisionDelta, type DeltaRow } from "./revisionDelta";
import {
  allocateTolerable, buildPools, evaluateAttribute, evaluateMus, planAttribute, planMus, signOffBlockers, verificationKey,
  type AttributePlan, type MusEvaluation, type MusFinding, type MusItem, type MusPlan, type SamplingPools,
} from "./sampling";
import { lineAmount, type EngineLine, type QuantityState, type ReviewState } from "./types";

// ── Sign-off readiness (shared with the Sign-off sheet panel) ────────────────

export const ACCEPTED_POOL = "Accepted non-key lines";
export const VERIFIED_POOL = "Verified lines";
export const REGION_POOL = "No-detection regions";
/** Tolerable miss rate for the no-detection region sample (assumption). */
export const REGION_TOLERABLE_RATE = 0.1;

export interface SignOffReadinessInput {
  lines: EngineLine[];
  gaps: CoverageGap[];
  noDetectionRegionIds: string[];
  materiality: number;
  tolerableError: number;
  seed: number;
  /** Line id → ₹ amount the reviewer found for a sampled line. */
  findings: Record<string, number>;
  /** Region id → true when unbilled work was found there. */
  regionMisses: Record<string, boolean>;
  /** Pool name → widened sample size. */
  widened: Record<string, number>;
  /** The engineering preview never certifies (plan v1.2 §2A). */
  previewMode: boolean;
}

export interface SignOffReadiness {
  pools: SamplingPools;
  plans: { plan: MusPlan; items: MusItem[] }[];
  evals: MusEvaluation[];
  regionPlan: AttributePlan;
  regionEval: ReturnType<typeof evaluateAttribute>;
  allEvaluated: boolean;
  allWithin: boolean;
  keyUnverified: number;
  coverage: CoverageStatus;
  blockers: string[];
}

/** Sampling plan, evaluation and every sign-off blocker for a set of lines. */
export function signOffReadiness(s: SignOffReadinessInput): SignOffReadiness {
  const pools = buildPools(s.lines, s.materiality);
  const [teAccepted, teVerified] = allocateTolerable(s.tolerableError, [pools.acceptedNonKey, pools.verified]);
  const plans = [
    { items: pools.acceptedNonKey, plan: planMus(ACCEPTED_POOL, pools.acceptedNonKey, teAccepted || s.tolerableError, s.seed, s.widened[ACCEPTED_POOL]) },
    { items: pools.verified, plan: planMus(VERIFIED_POOL, pools.verified, teVerified || s.tolerableError, s.seed + 1, s.widened[VERIFIED_POOL]) },
  ];
  const findings = Object.entries(s.findings).map(([id, found]): MusFinding => ({ id, found }));
  const evals = plans.map(({ plan }) => evaluateMus(plan, findings));
  const regionPlan = planAttribute(REGION_POOL, s.noDetectionRegionIds, REGION_TOLERABLE_RATE, s.seed + 2);
  const regionEval = evaluateAttribute(regionPlan, s.regionMisses);
  const allEvaluated = evals.every((e) => e.complete) && regionEval.complete;
  const allWithin = evals.every((e) => e.withinTolerance !== false) && regionEval.passed !== false;
  const keyUnverified = s.lines.filter((l) => pools.keyIds.includes(l.id) && l.reviewState !== "verified").length;
  const coverage = coverageStatus(s.gaps);
  const blockers = signOffBlockers({
    keyItemsUnverified: keyUnverified,
    pendingQuantities: pools.blocked.pending.length,
    linesWithoutRate: pools.blocked.noRate.length,
    coverageCleared: coverage.cleared,
    sampling: { evaluated: allEvaluated, withinTolerance: allEvaluated ? allWithin : null },
    previewMode: s.previewMode,
  });
  return { pools, plans, evals, regionPlan, regionEval, allEvaluated, allWithin, keyUnverified, coverage, blockers };
}

// ── The fixture project ──────────────────────────────────────────────────────

export interface FlowLine {
  id: string;
  description: string;
  /** A DSR code the line states, if any; never replaced by another item. */
  dsrCode?: string | null;
  /** Drawing sheet the line is measured from (display only). */
  sheet: string;
  /** IS 1200-style rows; the line's unit is the measurement unit. */
  measurement: MeasurementLine;
  /** Links to drawing legend items, regions and expected scope. */
  coverage?: Omit<CoverageLine, "id">;
}

export interface FlowProject {
  drawingRevision: string;
  lines: FlowLine[];
  /** DSR candidates the lines may be priced from. */
  dsr: DsrItem[];
  coverage: Omit<CoverageInput, "lines">;
  /** ₹: a line whose amount is ≥ this is a key item (100% review). */
  materiality: number;
  /** ₹ tolerable error for the sample. */
  tolerableError: number;
  seed: number;
}

/** A reviewer's outcome for a line. */
export type CheckOutcome = Exclude<ReviewState, "needs_review">;

export interface LineCheck { outcome: CheckOutcome; by: string; fingerprint: string }
export interface SampleCheck { found: number; fingerprint: string }

/** Everything a reviewer has done, kept apart from the project's inputs. */
export interface FlowReview {
  checks: Record<string, LineCheck>;
  gapResolutions: Record<string, GapResolution>;
  sampleFindings: Record<string, SampleCheck>;
  regionMisses: Record<string, boolean>;
  widened: Record<string, number>;
}

export const emptyReview = (): FlowReview => ({ checks: {}, gapResolutions: {}, sampleFindings: {}, regionMisses: {}, widened: {} });

// ── Pipeline ─────────────────────────────────────────────────────────────────

export interface FlowLineResult {
  id: string;
  description: string;
  sheet: string;
  measurement: LineResult;
  /** Pending covers both "not fully measured" and "measurement invalid". */
  quantityState: QuantityState;
  pricing: LinePricing;
  /** ₹ per unit; null = no DSR match (market rate needed). */
  rate: number | null;
  /** Whole ₹, or null: pending quantity, or no rate. Never 0 for a pending line. */
  amount: number | null;
  /** The line as the B5/B7/B9 engines see it, with its effective review state. */
  engine: EngineLine;
  fingerprint: string;
  /** The reviewer's check, only while it matches the current fingerprint. */
  check: LineCheck | null;
  /** True when a check was recorded but the line's inputs changed since. */
  reset: boolean;
}

export interface FlowResult {
  lines: FlowLineResult[];
  engineLines: EngineLine[];
  pricing: PricingCoverage;
  queue: MoneyAtRiskResult;
  gaps: CoverageGap[];
  signOff: SignOffReadiness;
  /** signOff.blockers plus the flow's own: unreviewed lines, invalid measurements. */
  blockers: string[];
  certifiable: boolean;
  totals: { lines: number; measured: number; pending: number; invalid: number; noMatch: number; provisionalAmount: number; reset: number };
}

const QUANTITY_STATE: Record<LineResult["status"], QuantityState> = {
  established: "established", confirmed_zero: "confirmed_zero", pending: "pending", invalid: "pending",
};

/**
 * What a check of this line depended on. Built on sampling.verificationKey
 * (quantity, state, unit, rate, description, drawing revision) plus the
 * measurement rows themselves, so a row edit resets the check even when the
 * total happens not to move.
 */
export function lineFingerprint(engine: EngineLine, rows: MeasurementRow[], drawingRevision: string): string {
  return JSON.stringify([verificationKey(engine, drawingRevision), rows]);
}

export interface RunOptions { previewMode?: boolean }

export function runFlow(project: FlowProject, review: FlowReview, opts: RunOptions = {}): FlowResult {
  const previewMode = opts.previewMode ?? true;
  const measured = project.lines.map((l) => evaluateLine(l.measurement));
  const pricing = priceFirst(
    project.lines.map((l, i) => {
      const m = measured[i];
      const established = m.status === "established" || m.status === "confirmed_zero";
      return {
        id: l.id, description: l.description, unit: l.measurement.unit, dsr_code: l.dsrCode ?? null,
        qty: established ? m.total : null, quantity_status: established ? "MEASURED" : "PENDING",
      };
    }),
    buildPricingIndex(project.dsr),
  );

  const lines = project.lines.map((l, i): FlowLineResult => {
    const m = measured[i];
    const p = pricing[i];
    const quantityState = QUANTITY_STATE[m.status];
    const rate = p.kind === "provisional_dsr" ? p.rate : null;
    const base: EngineLine = {
      id: l.id, description: l.description, unit: l.measurement.unit,
      quantity: m.total ?? 0, quantityState, rate, reviewState: "needs_review",
    };
    const fingerprint = lineFingerprint(base, l.measurement.rows, project.drawingRevision);
    const recorded = review.checks[l.id];
    // A pending quantity cannot stay accepted: there is nothing to accept.
    const check = recorded && recorded.fingerprint === fingerprint && quantityState !== "pending" ? recorded : null;
    const engine: EngineLine = { ...base, reviewState: check?.outcome ?? "needs_review" };
    return {
      id: l.id, description: l.description, sheet: l.sheet, measurement: m, quantityState, pricing: p, rate,
      amount: lineAmount(engine), engine, fingerprint, check, reset: !!recorded && !check,
    };
  });
  const engineLines = lines.map((l) => l.engine);

  const gaps = coverageGaps({ ...project.coverage, lines: project.lines.map((l) => ({ id: l.id, ...l.coverage })) })
    .map((g) => ({ ...g, resolution: review.gapResolutions[g.id] ?? null }));

  const fpById = new Map(lines.map((l) => [l.id, l.fingerprint]));
  const findings = Object.fromEntries(
    Object.entries(review.sampleFindings).filter(([id, f]) => fpById.get(id) === f.fingerprint).map(([id, f]) => [id, f.found]),
  );
  const signOff = signOffReadiness({
    lines: engineLines, gaps,
    noDetectionRegionIds: project.coverage.regions.filter((r) => r.detections === 0).map((r) => r.id),
    materiality: project.materiality, tolerableError: project.tolerableError, seed: project.seed,
    findings, regionMisses: review.regionMisses, widened: review.widened, previewMode,
  });

  const invalid = lines.filter((l) => l.measurement.status === "invalid").length;
  const unreviewed = lines.filter((l) => l.quantityState !== "pending" && l.engine.reviewState === "needs_review").length;
  const blockers = [
    ...signOff.blockers,
    ...(invalid ? [`${invalid} line(s) with a measurement error: total withheld`] : []),
    ...(unreviewed ? [`${unreviewed} line(s) not yet reviewed`] : []),
  ];
  const pc = pricingCoverage(pricing);
  return {
    lines, engineLines, pricing: pc,
    queue: rankByMoneyAtRisk(engineLines, project.materiality),
    gaps, signOff, blockers, certifiable: blockers.length === 0,
    totals: {
      lines: lines.length,
      measured: lines.filter((l) => l.quantityState !== "pending").length,
      pending: lines.filter((l) => l.quantityState === "pending").length,
      invalid,
      noMatch: pc.noMatch,
      provisionalAmount: lines.reduce((s, l) => s + (l.amount ?? 0), 0),
      reset: lines.filter((l) => l.reset).length,
    },
  };
}

// ── Actions (pure: each returns new state) ───────────────────────────────────

/** Edit one measurement value. The line's fingerprint changes, so its check resets. */
export function editMeasurement(project: FlowProject, lineId: string, rowId: string, field: RowField, value: number | null): FlowProject {
  if (!project.lines.some((l) => l.id === lineId)) throw new Error(`No line ${lineId}`);
  return { ...project, lines: project.lines.map((l) => (l.id === lineId ? { ...l, measurement: setRowValue(l.measurement, rowId, field, value) } : l)) };
}

const lineOf = (result: FlowResult, lineId: string) => {
  const l = result.lines.find((x) => x.id === lineId);
  if (!l) throw new Error(`No line ${lineId}`);
  return l;
};

/** Record a reviewer's check against the line's current inputs. A pending quantity cannot be checked. */
export function recordCheck(review: FlowReview, result: FlowResult, lineId: string, outcome: CheckOutcome, by: string): FlowReview {
  const l = lineOf(result, lineId);
  if (l.quantityState === "pending") throw new Error(`${lineId} has no established quantity: measure it before review`);
  if (!by.trim()) throw new Error("A check must name the reviewer");
  return { ...review, checks: { ...review.checks, [lineId]: { outcome, by, fingerprint: l.fingerprint } } };
}

/** Record the ₹ amount a reviewer found for a sampled line, against its current inputs. */
export function recordSampleFinding(review: FlowReview, result: FlowResult, lineId: string, found: number): FlowReview {
  const l = lineOf(result, lineId);
  if (!result.signOff.plans.some(({ plan }) => plan.selected.some((s) => s.id === lineId))) throw new Error(`${lineId} is not in the sample`);
  if (!Number.isFinite(found) || found < 0) throw new Error("A finding must be a ₹ amount");
  return { ...review, sampleFindings: { ...review.sampleFindings, [lineId]: { found, fingerprint: l.fingerprint } } };
}

/** Resolve or exclude a coverage gap (validated by coverage.resolveGap). */
export function resolveFlowGap(review: FlowReview, result: FlowResult, gapId: string, resolution: GapResolution): FlowReview {
  resolveGap(result.gaps, gapId, resolution);
  return { ...review, gapResolutions: { ...review.gapResolutions, [gapId]: resolution } };
}

export function reopenFlowGap(review: FlowReview, gapId: string): FlowReview {
  const gapResolutions = { ...review.gapResolutions };
  delete gapResolutions[gapId];
  return { ...review, gapResolutions };
}

/** A new drawing revision: replacement measurement rows for the lines it changes. */
export interface DrawingRevision { id: string; rows: Record<string, MeasurementRow[]> }

export interface RevisionOutcome {
  project: FlowProject;
  review: FlowReview;
  /** B9 delta of the engine lines, before → after. */
  delta: DeltaRow[];
  /** Lines whose inputs changed: their checks and sample findings reset. */
  changed: string[];
}

/**
 * Apply a drawing revision. The revision id is part of every fingerprint, so
 * on its own it would reset every line; instead, a line whose inputs are
 * otherwise unchanged has its check and sample finding carried to the new
 * revision, and only changed lines reset (B9).
 */
export function applyRevision(project: FlowProject, review: FlowReview, revision: DrawingRevision): RevisionOutcome {
  for (const id of Object.keys(revision.rows)) if (!project.lines.some((l) => l.id === id)) throw new Error(`Revision ${revision.id} names unknown line ${id}`);
  const before = runFlow(project, review);
  const next: FlowProject = {
    ...project,
    drawingRevision: revision.id,
    lines: project.lines.map((l) => (revision.rows[l.id] ? { ...l, measurement: { ...l.measurement, rows: revision.rows[l.id] } } : l)),
  };
  // Fingerprints of the new inputs under the OLD revision id: equal ⇔ nothing but the revision changed.
  const sameRev = runFlow({ ...next, drawingRevision: project.drawingRevision }, emptyReview());
  const after = runFlow(next, emptyReview());
  const changed: string[] = [];
  const checks: FlowReview["checks"] = { ...review.checks };
  const sampleFindings: FlowReview["sampleFindings"] = { ...review.sampleFindings };
  before.lines.forEach((b, i) => {
    if (sameRev.lines[i].fingerprint !== b.fingerprint) { changed.push(b.id); return; }
    const fp = after.lines[i].fingerprint;
    if (b.check) checks[b.id] = { ...b.check, fingerprint: fp };
    const f = review.sampleFindings[b.id];
    if (f && f.fingerprint === b.fingerprint) sampleFindings[b.id] = { ...f, fingerprint: fp };
  });
  const nextReview = { ...review, checks, sampleFindings };
  return { project: next, review: nextReview, delta: revisionDelta(before.engineLines, runFlow(next, nextReview).engineLines), changed };
}
