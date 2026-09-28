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
//
// Audit status — reuses srikakulamBenchmark.ts's own GapCategory/CaseGap
// vocabulary rather than inventing a second one:
//   - `graded` omitted or `true`, no `gap`      -> CONFIRMED CORRECT.
//   - `graded: true`, `gap.category` set to
//     A_EXTRACTION_FAILURE                      -> CONFIRMED INCORRECT: the
//     ground truth IS known (that's what `observationType`/attributes below
//     hold), and a real production run is known to have gotten it wrong —
//     see the gap's `note` for exactly what was wrong.
//   - `graded: false` (with a D_BENCHMARK_DATA_GAP gap, by convention)
//                                                -> NOT YET AUDITED: excluded
//     from every scored average by observationBenchmarkScorer.ts, exactly
//     like srikakulamBenchmark.ts's own ungraded cases. Not used by any
//     entry below yet — the 9-observation production run that prompted this
//     fixture was manually audited in full, so nothing here needs it today.
//     It exists so a FUTURE entry can be added honestly, before its own
//     audit is complete, without silently counting as either correct or
//     incorrect in the meantime.

import type { ObservationType } from "./observationSchemaV1";
import type { CaseGap } from "./srikakulamBenchmark";

export interface ExpectedObservation {
  id: string;
  observationType: ObservationType;
  mark?: string;
  scopeHint?: string;
  attributes?: { dimension?: string; specification?: string; material?: string };
  sourcePage: string;
  notes?: string;
  /** Omitted (or `true`) means this entry's ground truth has been manually
   *  confirmed — see the file header's audit-status convention. `false`
   *  means NOT YET AUDITED: excluded from every scored average. */
  graded?: boolean;
  /** Set only when this entry documents a KNOWN discrepancy between this
   *  confirmed ground truth and a real production run's actual output (an
   *  A_EXTRACTION_FAILURE), or when `graded` is `false` (a
   *  D_BENCHMARK_DATA_GAP — ground truth itself not yet confirmed). Absent
   *  for a plain confirmed-correct entry. */
  gap?: CaseGap;
}

// ── Cross-floor identity: the same real facts as srikakulamBenchmark.ts's
// "identity-w1-cross-floor" case, re-expressed as observations. The mark W1
// is reused for a physically different window on each floor — each must
// surface as its own observation, never collapsed into another floor's. ────
const W1_AND_BRICKWORK_OBSERVATIONS: ExpectedObservation[] = [
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

// ── Real production LOCATION run (2026-09-28, after PR #126) — the first
// successful end-to-end LOCATION extraction for this exact document (project
// 5749f58f-9b30-4545-8d1a-70e6a935d574, document
// cbcfd9c1-3d40-40b6-9761-6cc5e313d541, content_hash
// 49456bc5ada38355bb4c2814bda4bafbbcaeb1d494ce113d4921c05872c910e1). The run
// persisted 9 observations, ALL manually audited against the drawing
// (per-entry verdicts below) — never assumed correct just because they were
// extracted. This is NOT a coverage-complete ground truth for the whole
// document: only these 9 facts have been checked so far (see the file
// header's "not yet audited" state for how a future, still-unchecked fact
// would be added without pretending it's already confirmed either way).
//
// Exported separately from the W1/brickwork identity cases above (and also
// folded into SRIKAKULAM_OBSERVATIONS for "everything currently known about
// this drawing set") so a real run's output can be scored against EXACTLY
// what that run was expected to cover, without an unrelated fact from a
// different part of the document (e.g. a door/window schedule mark this run
// never claimed to have looked at) counting as a false "miss". ─────────────
export const SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928: ExpectedObservation[] = [
  {
    id: "ground-living-obs",
    observationType: "room_or_space",
    mark: "Living",
    scopeHint: "Ground Floor",
    attributes: { dimension: "24'2\"x21'4\"" },
    sourcePage: "p.2 (Ground Floor)",
    notes: "Manually audited against the drawing: correct.",
  },
  {
    id: "ground-dining-obs",
    observationType: "room_or_space",
    mark: "Dining",
    scopeHint: "Ground Floor",
    attributes: { dimension: "29'10\"x15'8\"" },
    sourcePage: "p.2 (Ground Floor)",
    notes: "Manually audited against the drawing: correct.",
  },
  {
    id: "ground-lift-obs",
    observationType: "equipment",
    mark: "Lift",
    scopeHint: "Ground Floor",
    attributes: { dimension: "7'x6'6\"" },
    sourcePage: "p.2 (Ground Floor)",
    notes: "Manually audited against the drawing: correct.",
  },
  {
    id: "stilt-main-entrance-obs",
    observationType: "opening",
    mark: "Main Entrance",
    scopeHint: "Stilt Floor",
    attributes: { dimension: "15'2\" wide" },
    sourcePage: "p.1 (Stilt Floor)",
    notes: "Manually audited against the drawing: correct.",
  },
  {
    id: "stilt-maid-room-1-obs",
    // CORRECTED expected type — production's actual run reported "fixture"
    // for this same mark/scope/dimension (see the gap note below). The
    // underlying fact (a maid's room of this size, on this floor) is itself
    // confirmed correct; only the classification is wrong.
    observationType: "room_or_space",
    mark: "Maid Room-1",
    scopeHint: "Stilt Floor",
    attributes: { dimension: "5'6\"x6'3\"" },
    sourcePage: "p.1 (Stilt Floor)",
    notes: "Manually audited: the underlying fact (existence + dimension) is correct. Classification is not — see gap.",
    graded: true,
    gap: {
      category: "A_EXTRACTION_FAILURE",
      note: "Production's real LOCATION run (2026-09-28) classified this observation as \"fixture\"; manual audit confirms it should be \"room_or_space\". Not yet fixed — this entry exists to track and score the known discrepancy, per explicit instruction not to change extraction behavior yet.",
    },
  },
  {
    id: "stilt-security-gate-obs",
    observationType: "other_construction_fact",
    mark: "Security Gate",
    scopeHint: "Stilt Floor",
    attributes: { dimension: "10' wide" },
    sourcePage: "p.1 (Stilt Floor)",
    notes: "Manually audited: substantively supported by the drawing.",
  },
  {
    id: "ground-main-entrance-dim-obs",
    // Same mark ("Main Entrance") as stilt-main-entrance-obs, reused across
    // floors for a physically different fact — the same cross-floor-identity
    // pattern as the W1 cases above (see OBSERVATION_DISTINCTNESS_PAIRS).
    observationType: "dimension_annotation",
    mark: "Main Entrance",
    scopeHint: "Ground Floor",
    attributes: { dimension: "6'6\" wide" },
    sourcePage: "p.2 (Ground Floor)",
    notes: "Manually audited against the drawing: correct. Distinct fact from stilt-main-entrance-obs — same mark, different floor, never to be collapsed into one observation.",
  },
  {
    id: "stilt-car-parking-obs",
    observationType: "structural_element",
    mark: "Car Parking",
    scopeHint: "Stilt Floor",
    attributes: { dimension: "19'4\"x37'" },
    sourcePage: "p.1 (Stilt Floor)",
    notes: "Manually audited: substantively supported by the drawing.",
  },
  {
    id: "ground-gym-obs",
    observationType: "room_or_space",
    mark: "Gym",
    scopeHint: "Ground Floor",
    attributes: { dimension: "15'3\"x12'8\"" },
    sourcePage: "p.2 (Ground Floor)",
    notes: "Manually audited against the drawing: correct.",
  },
];

/** Everything currently known about this drawing set, across every audited
 *  run — the W1/brickwork identity facts plus the 2026-09-28 apartment run.
 *  Existing callers that want "the whole ground truth" keep using this; a
 *  caller scoring one specific run's output should use that run's own export
 *  above instead (see its doc comment for why). */
export const SRIKAKULAM_OBSERVATIONS: ExpectedObservation[] = [
  ...W1_AND_BRICKWORK_OBSERVATIONS,
  ...SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928,
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
  { a: "stilt-main-entrance-obs", b: "ground-main-entrance-dim-obs" },
];
