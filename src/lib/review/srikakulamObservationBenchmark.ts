// SRIKAKULAM OBSERVATION BENCHMARK — LOCATION-mode ground truth for the real
// Srikakulam drawing set, independent of srikakulamBenchmark.ts's BOQ-item
// ground truth.
//
// Every entry restates an ALREADY-VERIFIED fact from that same audit (see
// srikakulamBenchmark.ts's own docstring: values were read directly off the
// rendered drawing pages) — never a new fact, and never one derived by a
// mechanical rule from the item benchmark's data. In particular,
// `observationType` is chosen deliberately by the benchmark author from the
// case's own description (e.g. "read off a door/window schedule" ->
// "schedule_entry"), NOT inferred from the mark's letter prefix — a
// mark-prefix heuristic was deliberately rejected as the benchmark's
// mechanism (see the Phase 4 design review).
//
// Scoring logic lives in observationBenchmarkScorer.ts; it never mutates or
// infers this data.

import type { ObservationType } from "./observationSchemaV1";

export interface ExpectedObservation {
  id: string;
  observationType: ObservationType;
  mark?: string;
  scopeHint?: string;
  attributes?: { dimension?: string; specification?: string; material?: string };
  sourcePage: string;
  notes?: string;
}

// ── Cross-floor identity: the same real facts as srikakulamBenchmark.ts's
// "identity-w1-cross-floor" case, re-expressed as observations. The mark W1
// is reused for a physically different window on each floor — each must
// surface as its own observation, never collapsed into another floor's. ────
export const SRIKAKULAM_OBSERVATIONS: ExpectedObservation[] = [
  {
    id: "stilt-w1-obs",
    observationType: "schedule_entry",
    mark: "W1",
    scopeHint: "Stilt",
    attributes: { dimension: "4'x5'3\"", specification: "UPVC" },
    sourcePage: "p.7 (Stilt door/window schedule)",
    notes: "One W1 row on the Stilt floor's own door/window schedule — a schedule-sourced fact, not a plan marker.",
  },
  {
    id: "ground-w1-obs",
    observationType: "schedule_entry",
    mark: "W1",
    scopeHint: "Ground",
    attributes: { dimension: "6'x6'9\"", specification: "UPVC" },
    sourcePage: "p.8 (Ground door/window schedule)",
    notes: "The Ground floor's W1 schedule row — same mark code as Stilt, different floor, different dimension. This is the exact fact that must never be conflated with stilt-w1-obs.",
  },
  {
    id: "typical-w1-obs",
    observationType: "schedule_entry",
    mark: "W1",
    scopeHint: "Typical Floor 1",
    // No dimension/specification asserted — the Typical-floor schedule's
    // digits were not legible at the rendered resolution during the audit
    // (same D_BENCHMARK_DATA_GAP as srikakulamBenchmark.ts's
    // "typical-floor-schedule-digits" case) — never guessed here either.
    sourcePage: "p.9 (Typical floor schedule)",
    notes: "Identity-only: this case exists to prove Typical W1 is recognized as its own distinct observation, not that its attributes are fully legible.",
  },
  {
    id: "ground-brickwork-area-obs",
    observationType: "dimension_annotation",
    scopeHint: "Ground",
    attributes: { dimension: "3868 sqft" },
    sourcePage: "p.5 (Ground floor brickwork: \"FLAT AREA 3868 SQFT\")",
    notes: "A printed area annotation on the Ground floor brickwork drawing — dimension/specification context tied to a schedule/annotation source, distinct from the schedule-entry cases above.",
  },
];

/** Pairs that must resolve to DIFFERENT observations when a real/simulated
 *  LOCATION run is scored — mirrors srikakulamBenchmark.ts's
 *  duplicateExpectations shape, but for cross-floor observation identity
 *  rather than BOQ-item duplicate detection (LOCATION mode has no dedup
 *  step of its own; this instead documents what a correct scorer's
 *  one-observation-matched-at-most-once discipline must produce). */
export const OBSERVATION_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [
  { a: "stilt-w1-obs", b: "ground-w1-obs" },
  { a: "stilt-w1-obs", b: "typical-w1-obs" },
  { a: "ground-w1-obs", b: "typical-w1-obs" },
];
