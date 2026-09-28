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

// ── Multi-run support ────────────────────────────────────────────────────
//
// Everything above this point is the ORIGINAL, single-array fixture and is
// unchanged (existing consumers of SRIKAKULAM_OBSERVATIONS/
// OBSERVATION_DISTINCTNESS_PAIRS keep working identically). What follows adds
// the ability to register MULTIPLE manually audited LOCATION runs — each
// document/run's expected observations and distinctness pairs stay in their
// OWN array, exactly like SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928 already
// does relative to the older W1/brickwork facts — so that scoring one run's
// actual output can never see, match against, or be penalized for a
// DIFFERENT run's expected facts. See observationBenchmarkScorer.ts's
// scoreLocationBenchmark() for how a registry of these is scored together.

/** One manually audited LOCATION production run, ready to be scored on its
 *  own via scoreObservations() (or as part of a registry via
 *  scoreLocationBenchmark()). `expectedObservations` and `distinctnessPairs`
 *  must reference only ids from THIS run — never another run's — so a
 *  missing fact from one document can never surface as a false negative
 *  against a different document's run. */
export interface LocationBenchmarkRun {
  id: string;
  title: string;
  /** Free-text identity, for humans reading a report — never parsed. */
  documentDescription: string;
  expectedObservations: ExpectedObservation[];
  distinctnessPairs: { a: string; b: string }[];
}

/** The Main Entrance cross-floor pair, scoped to the 2026-09-28 apartment run
 *  alone (both ids come only from SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928)
 *  — the same fact already present in the combined OBSERVATION_DISTINCTNESS_PAIRS
 *  above, restated here so this run can be scored in isolation without
 *  pulling in the unrelated W1 pairs (whose ids aren't in this run at all). */
const SRIKAKULAM_APARTMENT_RUN_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [
  { a: "stilt-main-entrance-obs", b: "ground-main-entrance-dim-obs" },
];

// ── Real production LOCATION run #2 — "Proposed Apartment at Srikakulam —
// Second Floor Plan" (a 2-page PDF: p.1 Second Floor Plan/Brickwork Drawing,
// p.2 Door/Window Schedule). A SEPARATE real document from the 2026-09-28
// apartment run above — its own id namespace (`secondfloor-*`), its own
// distinctness pairs (none needed: nothing in this single-floor audit reuses
// a mark across scopes the way Main Entrance/W1 do in the run above), and
// deliberately NOT folded into SRIKAKULAM_OBSERVATIONS (that export is
// scoped to the original Ground/Stilt/Typical document only — see its own
// doc comment — never rewritten by this addition).
//
// Exact project/document/revision identifiers were not supplied for this
// run (unlike SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928's real UUIDs); this
// fixture identifies the document only by its title, never a fabricated id.
//
// Includes BOTH the 8 extracted-and-audited observations (one — D1 — with a
// confirmed MATERIAL-only discrepancy, never a type-level one) AND
// independently verified COVERAGE MISSES: real, clearly-labeled facts on the
// drawing this production run did not extract at all. A coverage miss is
// graded exactly like any other entry — it simply has no matching actual
// observation, so it correctly counts against scopeRecall, which is the
// entire point of recording it.
//
// Deliberately EXCLUDED, per explicit instruction not to invent ground truth
// beyond what was manually verified: "additional balconies / entrances /
// passages / corridor / security gate" and "additional door/window schedule
// entries on page 2" from the same audit. These were named only as a general
// category — no mark, no dimension, no count — so recording them as
// individual ExpectedObservation entries would require inventing exactly the
// identifying details the audit never established. They can be added the
// same way every entry below was, once individually audited.
export const SRIKAKULAM_SECOND_FLOOR_LOCATION_RUN: ExpectedObservation[] = [
  // ── Extracted and manually audited — persisted by the real production run.
  { id: "secondfloor-dining-obs", observationType: "room_or_space", mark: "Dining", scopeHint: "Second Floor", attributes: { dimension: "17'8\"x15'4\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually audited against the drawing: correct." },
  { id: "secondfloor-master-bedroom-obs", observationType: "room_or_space", mark: "Master Bedroom", scopeHint: "Second Floor", attributes: { dimension: "16'6\"x13'3\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually audited against the drawing: correct." },
  { id: "secondfloor-kitchen-obs", observationType: "room_or_space", mark: "Kitchen", scopeHint: "Second Floor", attributes: { dimension: "22'2\"x11'" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually audited against the drawing: correct." },
  { id: "secondfloor-guest-bedroom-obs", observationType: "room_or_space", mark: "Guest Bedroom", scopeHint: "Second Floor", attributes: { dimension: "18'6\"x14'" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually audited against the drawing: correct." },
  { id: "secondfloor-media-room-obs", observationType: "room_or_space", mark: "Media Room", scopeHint: "Second Floor", attributes: { dimension: "15'7\"x10'6\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually audited against the drawing: correct." },
  { id: "secondfloor-living-obs", observationType: "room_or_space", mark: "Living", scopeHint: "Second Floor", attributes: { dimension: "17'8\"x15'6\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually audited against the drawing: correct." },
  { id: "secondfloor-w1-obs", observationType: "opening", mark: "W1", scopeHint: "Second Floor", attributes: { dimension: "5'x5'3\"", specification: "UPVC" }, sourcePage: "p.2 (Door/Window Schedule)", notes: "Manually audited against the drawing: correct." },
  {
    id: "secondfloor-d1-obs",
    observationType: "opening",
    mark: "D1",
    scopeHint: "Second Floor",
    // Dimension is confirmed correct. Material is the ONLY confirmed
    // discrepancy — see gap below. The value here is the audited-correct
    // group name as verified against the schedule, never invented beyond
    // that: the schedule places D1 in the granite/marble door group, distinct
    // from MD (a different door mark, which the schedule genuinely does list
    // as Wood).
    attributes: { dimension: "3'6\"x7'9\"", material: "Granite/Marble" },
    sourcePage: "p.2 (Door/Window Schedule)",
    notes: "Manually audited: size is correct. Material is not — see gap. This is an attribute-level discrepancy only; the observation's existence, type, and scope are all correct.",
    graded: true,
    gap: {
      category: "A_EXTRACTION_FAILURE",
      note: "Production's real Second Floor LOCATION run reported material \"Wood\" for D1. The door/window schedule identifies MD (a different door mark) as Wood; D1 belongs to the granite/marble group. Not yet fixed — this entry exists to track and score the known discrepancy, per explicit instruction not to change extraction behavior yet.",
    },
  },

  // ── Coverage misses — clearly labeled, manually verified facts the real
  // production run did NOT extract at all.
  { id: "secondfloor-pooja-obs", observationType: "room_or_space", mark: "Pooja", scopeHint: "Second Floor", attributes: { dimension: "6'2\"x8'8\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-lift-obs", observationType: "equipment", mark: "Lift", scopeHint: "Second Floor", attributes: { dimension: "7'x6'6\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-utility-obs", observationType: "room_or_space", mark: "Utility", scopeHint: "Second Floor", attributes: { dimension: "11'2\"x11'6\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-wet-kitchen-obs", observationType: "room_or_space", mark: "Wet Kitchen", scopeHint: "Second Floor", attributes: { dimension: "10'6\"x8'5\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-storage-obs", observationType: "room_or_space", mark: "Storage", scopeHint: "Second Floor", attributes: { dimension: "5'2\"x6'3\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-children-bedroom-1-obs", observationType: "room_or_space", mark: "Children Bedroom-1", scopeHint: "Second Floor", attributes: { dimension: "18'6\"x11'6\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-children-bedroom-2-obs", observationType: "room_or_space", mark: "Children Bedroom-2", scopeHint: "Second Floor", attributes: { dimension: "15'3\"x12'8\"" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  { id: "secondfloor-great-room-obs", observationType: "room_or_space", mark: "Great Room", scopeHint: "Second Floor", attributes: { dimension: "25'5\"x18'" }, sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified on the drawing; NOT extracted by the production run — coverage miss." },
  // Named and confirmed present on the drawing; no dimension was recorded
  // during this audit — identity/coverage is graded, size is simply not
  // asserted (never guessed), the same convention as typical-w1-obs above.
  { id: "secondfloor-wic-obs", observationType: "room_or_space", mark: "W.I.C", scopeHint: "Second Floor", sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified as clearly labeled on the drawing; NOT extracted — coverage miss. No dimension recorded during this audit." },
  { id: "secondfloor-wr-obs", observationType: "room_or_space", mark: "W.R", scopeHint: "Second Floor", sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified as clearly labeled on the drawing; NOT extracted — coverage miss. No dimension recorded during this audit." },
  { id: "secondfloor-dress-obs", observationType: "room_or_space", mark: "Dress", scopeHint: "Second Floor", sourcePage: "p.1 (Second Floor Plan)", notes: "Manually verified as clearly labeled on the drawing; NOT extracted — coverage miss. No dimension recorded during this audit." },
];

/** No cross-scope mark reuse exists in this run's audited data (unlike the
 *  2026-09-28 run's Main Entrance/W1 cases) — nothing to check here yet. */
const SRIKAKULAM_SECOND_FLOOR_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [];

/** Registry of every manually audited LOCATION run available to score
 *  independently. Add a new run by appending a new entry here with its OWN
 *  expectedObservations/distinctnessPairs arrays (defined above, following
 *  the SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928 pattern) — never by editing
 *  an existing run's entry to fold in another document's facts. */
export const LOCATION_BENCHMARK_RUNS: LocationBenchmarkRun[] = [
  {
    id: "srikakulam-apartment-20260928",
    title: "Srikakulam Apartment (Dr.Sandeep) — 2026-09-28 production run",
    documentDescription:
      "Apartment at Srikakulam (Dr.Sandeep)-Floor plans, Brickwork Drawing & Door and Window Schedule " +
      "(project 5749f58f-9b30-4545-8d1a-70e6a935d574, document cbcfd9c1-3d40-40b6-9761-6cc5e313d541)",
    expectedObservations: SRIKAKULAM_APARTMENT_LOCATION_RUN_20260928,
    distinctnessPairs: SRIKAKULAM_APARTMENT_RUN_DISTINCTNESS_PAIRS,
  },
  {
    id: "srikakulam-second-floor",
    title: "Proposed Apartment at Srikakulam — Second Floor Plan",
    documentDescription:
      "Proposed Apartment at Srikakulam — Second Floor Plan (2-page PDF: p.1 Second Floor Plan/Brickwork " +
      "Drawing, p.2 Door/Window Schedule). Project/document/revision identifiers not supplied for this run.",
    expectedObservations: SRIKAKULAM_SECOND_FLOOR_LOCATION_RUN,
    distinctnessPairs: SRIKAKULAM_SECOND_FLOOR_DISTINCTNESS_PAIRS,
  },
];
