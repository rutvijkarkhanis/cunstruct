// SRIKAKULAM BENCHMARK — ground-truth fixture for the real Apartment at
// Srikakulam drawing set (floor plans + brickwork + door/window schedule).
//
// Every expected value here was read directly off the rendered drawing pages
// during the earlier capability audit — never inferred or assumed. Where a
// value could not be confirmed (case 10's Typical-floor schedule digits, which
// were illegible at the rendered resolution), the case is marked `graded:
// false` and excluded from every scored average rather than guessed at.
//
// This file holds ONLY the ground truth + the gap classification of each case.
// Scoring logic lives in benchmarkScorer.ts; it never mutates or infers this
// data — a benchmark that "corrects" its own ground truth to make a run look
// better is not a benchmark.

import type { AnalysisItemV1 } from "./analysisSchemaV1";

/** The four-way gap taxonomy: only "A" reflects the AI extraction actually
 *  getting something wrong. B/C are gaps in Cunstruct's schema or code that no
 *  AI extraction, however accurate, could satisfy today. D is a limit of this
 *  benchmark's own ground truth, not of Cunstruct or the AI. Never blend these. */
export type GapCategory =
  | "A_EXTRACTION_FAILURE"
  | "B_REPRESENTATION_GAP"
  | "C_CAPABILITY_GAP"
  | "D_BENCHMARK_DATA_GAP";

export interface CaseGap {
  category: GapCategory;
  note: string;
}

/** One real item the drawing set actually specifies. `id` is a stable
 *  benchmark-local identifier (not the AI's `key`) so duplicate-expectations
 *  can reference specific expected items unambiguously. */
export interface ExpectedItem {
  id: string;
  key: string;
  item: string;
  location?: string;
  quantity: number | null;
  unit?: string;
  dimension?: string;
  specification?: string;
}

export interface DuplicateExpectation {
  a: string; // ExpectedItem.id
  b: string; // ExpectedItem.id
  shouldBeDuplicate: boolean;
}

export interface BenchmarkCase {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  sourcePage: string;
  description: string;
  expectedItems: ExpectedItem[];
  /** Pairs buildReviewItems() must (or must not) flag as duplicates. Omitted
   *  when the case isn't about identity/duplicate behavior at all. */
  duplicateExpectations?: DuplicateExpectation[];
  /** Set when even a flawless AI extraction cannot be fully scored today
   *  because of a schema/code gap (B/C) or a benchmark data gap (D). Absent
   *  for a case with no known gap. */
  gap?: CaseGap;
  /** False only for a D_BENCHMARK_DATA_GAP case: ground truth itself isn't
   *  confirmed, so this case is reported but excluded from every average. */
  graded: boolean;
  notes?: string;
}

// ── Tier 1 — direct schedule read: one page, one explicit table value ───────

const TIER1: BenchmarkCase[] = [
  {
    id: "stilt-d1",
    tier: 1,
    title: "Stilt floor — Door D1 count",
    sourcePage: "p.7 (Stilt door/window schedule)",
    description: "The Stilt floor door/window schedule states one D1 door.",
    graded: true,
    expectedItems: [
      { id: "stilt-d1", key: "D1", item: "Door D1", location: "Stilt", quantity: 1 },
    ],
  },
  {
    id: "stilt-w1",
    tier: 1,
    title: "Stilt floor — Window W1",
    sourcePage: "p.7 (Stilt door/window schedule)",
    description: "One W1 window, 4'x5'3\", UPVC, on the Stilt floor.",
    graded: true,
    expectedItems: [
      {
        id: "stilt-w1", key: "W1", item: "Window W1", location: "Stilt",
        quantity: 1, dimension: "4'x5'3\"", specification: "UPVC",
      },
    ],
  },
  {
    id: "ground-w1",
    tier: 1,
    title: "Ground floor — Window W1",
    sourcePage: "p.8 (Ground door/window schedule)",
    description: "Seven W1 windows, 6'x6'9\", UPVC, on the Ground floor — same mark code as stilt-w1, different floor and different dimension.",
    graded: true,
    expectedItems: [
      {
        id: "ground-w1", key: "W1", item: "Window W1", location: "Ground",
        quantity: 7, dimension: "6'x6'9\"", specification: "UPVC",
      },
    ],
  },
  {
    id: "ground-v1",
    tier: 1,
    title: "Ground floor — Ventilator V1 count",
    sourcePage: "p.8 (Ground door/window schedule)",
    description: "Five V1 ventilators on the Ground floor.",
    graded: true,
    expectedItems: [
      { id: "ground-v1", key: "V1", item: "Ventilator V1", location: "Ground", quantity: 5 },
    ],
  },
];

// ── Tier 2 — derived / cross-referenced: 2+ facts, or arithmetic ────────────

const TIER2: BenchmarkCase[] = [
  {
    id: "identity-w1-cross-floor",
    tier: 2,
    title: "W1 reused across Stilt, Ground, and a Typical floor",
    sourcePage: "p.7, p.8, p.9",
    description:
      "The mark code W1 is reused for a physically different window on each floor. This is the flagship identity-correctness case: these three items — plus a genuine same-floor repeat — must be scoped correctly. The Typical-floor W1 count itself is not legible at the rendered resolution (see case typical-floor-schedule-digits); this case tests IDENTITY, not that count, so its quantity is left PENDING rather than guessed.",
    graded: true,
    expectedItems: [
      { id: "stilt-w1-id", key: "W1", item: "Window W1", location: "Stilt", quantity: 1, dimension: "4'x5'3\"", specification: "UPVC" },
      { id: "ground-w1-id", key: "W1", item: "Window W1", location: "Ground", quantity: 7, dimension: "6'x6'9\"", specification: "UPVC" },
      { id: "typical-w1-id", key: "W1", item: "Window W1", location: "Typical Floor 1", quantity: null },
      // A genuine same-floor repeat of the AI parsing the Ground row twice —
      // the positive control: this ONE pair must still collapse to a duplicate.
      { id: "ground-w1-repeat", key: "W1", item: "Window W1", location: "Ground", quantity: 7, dimension: "6'x6'9\"", specification: "UPVC" },
    ],
    duplicateExpectations: [
      { a: "stilt-w1-id", b: "ground-w1-id", shouldBeDuplicate: false },
      { a: "stilt-w1-id", b: "typical-w1-id", shouldBeDuplicate: false },
      { a: "ground-w1-id", b: "typical-w1-id", shouldBeDuplicate: false },
      { a: "ground-w1-id", b: "ground-w1-repeat", shouldBeDuplicate: true },
    ],
  },
  {
    id: "slab-total-area",
    tier: 2,
    title: "Total slab area (per-floor × floor count)",
    sourcePage: "p.1 (Area Statement)",
    description: "4,188 sqft/slab × 6 slabs = 25,128 sqft (arithmetic independently verified).",
    graded: true,
    gap: {
      category: "B_REPRESENTATION_GAP",
      note:
        "AnalysisItemV1 has no `method: QuantityMethod` field even though the AREA/DERIVED enum already exists in quantityMethod.ts — a correct extraction can only note the arithmetic in the free-text `calculation` field, not declare structurally that this is a derived-area total. Quantity correctness is still fully gradable; methodology structuring is not.",
    },
    expectedItems: [
      { id: "slab-total-area", key: "SLAB-TOTAL", item: "Total slab area", quantity: 25128, unit: "sqft" },
    ],
  },
  {
    id: "typical-flat-total-area",
    tier: 2,
    title: "Total typical-flat area (sum × flat count)",
    sourcePage: "p.1 (Area Statement)",
    description: "(3,960 + 990) sqft × 5 flats = 24,750 sqft (arithmetic independently verified).",
    graded: true,
    gap: {
      category: "B_REPRESENTATION_GAP",
      note: "Same representation gap as slab-total-area — no structural method/derivation field.",
    },
    expectedItems: [
      { id: "typical-flat-total-area", key: "TYPICAL-FLAT-TOTAL", item: "Total typical flat area", quantity: 24750, unit: "sqft" },
    ],
  },
  {
    id: "parking-counts",
    tier: 2,
    title: "Parking — two distinct vehicle classes on one drawing",
    sourcePage: "p.1 (Area Statement / site plan)",
    description: "8 four-wheeler + 10 two-wheeler parking spaces — two counts on the same drawing region that must stay two separate items, not one combined total.",
    graded: true,
    expectedItems: [
      { id: "parking-4w", key: "PARKING-4W", item: "Car parking (four-wheeler)", quantity: 8 },
      { id: "parking-2w", key: "PARKING-2W", item: "Two-wheeler parking", quantity: 10 },
    ],
    duplicateExpectations: [
      { a: "parking-4w", b: "parking-2w", shouldBeDuplicate: false },
    ],
  },
];

// ── Tier 3 — cross-page conflict / capability-limited / confirmed data gap ──

const TIER3: BenchmarkCase[] = [
  {
    id: "ground-floor-area-conflict",
    tier: 3,
    title: "Ground floor area — two different stated numbers",
    sourcePage: "p.5 (brickwork: \"FLAT AREA 3868 SQFT\") vs p.1 (Area Statement: 4,188 sqft/slab)",
    description:
      "The Ground-floor brickwork drawing states 3,868 sqft for the same floor the Area Statement gives as 4,188 sqft/slab. A correct system response is to surface this as a genuine drawing conflict, not silently pick one number.",
    graded: true,
    gap: {
      category: "C_CAPABILITY_GAP",
      note:
        "There is no ClaimType or field anywhere in analysisSchemaV1.ts for \"these two sources disagree.\" Whichever number the AI reports, the reviewer sees no structural signal that a second, different number exists elsewhere in the set. Conflict detection is therefore never scored pass/fail for this case — it is always reported as not representable, regardless of AI output.",
    },
    expectedItems: [
      { id: "ground-brickwork-area", key: "GROUND-AREA-BRICKWORK", item: "Ground floor area (brickwork dwg)", location: "Ground", quantity: 3868, unit: "sqft" },
      { id: "ground-statement-area", key: "GROUND-AREA-STATEMENT", item: "Ground floor area (Area Statement)", location: "Ground", quantity: 4188, unit: "sqft" },
    ],
  },
  {
    id: "typical-floor-schedule-digits",
    tier: 3,
    title: "Typical floor door/window schedule — digit-level counts",
    sourcePage: "p.9 (Typical floor schedule)",
    description:
      "Several digits on the rendered Typical-floor schedule were not legible enough to confirm a ground truth during the capability audit. This case is intentionally left ungraded rather than scored against a guessed value.",
    graded: false,
    gap: {
      category: "D_BENCHMARK_DATA_GAP",
      note: "Ground truth itself is unconfirmed — a limitation of this benchmark's source material, not of Cunstruct or the AI. Never scored, never averaged in.",
    },
    expectedItems: [],
  },
  {
    id: "ground-floor-room-scope",
    tier: 3,
    title: "Ground floor room list — scope recall + near-duplicate rooms",
    sourcePage: "p.5 (Ground floor brickwork)",
    description:
      "Nine named rooms, including four separate Guest Bedrooms. Tests whether all rooms are found (scope recall) and whether the four Guest Bedrooms are kept as four distinct items rather than collapsed into one \"Guest Bedroom ×4\" row. Room-level dimensions were not legible enough to record as ground truth, so only presence/identity is graded here — not size.",
    graded: true,
    expectedItems: [
      { id: "gb1", key: "GB1", item: "Guest Bedroom 1", location: "Ground", quantity: null },
      { id: "gb2", key: "GB2", item: "Guest Bedroom 2", location: "Ground", quantity: null },
      { id: "gb3", key: "GB3", item: "Guest Bedroom 3", location: "Ground", quantity: null },
      { id: "gb4", key: "GB4", item: "Guest Bedroom 4", location: "Ground", quantity: null },
      { id: "dining", key: "DINING", item: "Dining", location: "Ground", quantity: null },
      { id: "living", key: "LIVING", item: "Living", location: "Ground", quantity: null },
      { id: "gym", key: "GYM", item: "Gym", location: "Ground", quantity: null },
      { id: "green-pocket", key: "GREEN-POCKET", item: "Green Pocket", location: "Ground", quantity: null },
      { id: "kids-play", key: "KIDS-PLAY", item: "Kids Play Area", location: "Ground", quantity: null },
    ],
    duplicateExpectations: [
      { a: "gb1", b: "gb2", shouldBeDuplicate: false },
      { a: "gb1", b: "gb3", shouldBeDuplicate: false },
      { a: "gb1", b: "gb4", shouldBeDuplicate: false },
    ],
  },
];

export const SRIKAKULAM_BENCHMARK: BenchmarkCase[] = [...TIER1, ...TIER2, ...TIER3];

/** Build the AnalysisItemV1[] a flawless AI extraction would produce for one
 *  case — i.e. the case's ground truth, faithfully carried into the schema.
 *  This is NOT AI output; it exists only to (a) prove the scorer reports a
 *  perfect score on a perfect run, and (b) exercise the real reviewQueue.ts
 *  logic against realistic, schema-shaped data. */
export function perfectRunFor(c: BenchmarkCase): AnalysisItemV1[] {
  return c.expectedItems.map((e) => ({
    key: e.key,
    item: e.item,
    location: e.location,
    quantity: e.quantity,
    unit: e.unit,
    dimension: e.dimension,
    specification: e.specification,
    confidence: 0.95,
    aiStatus: e.quantity == null ? "PENDING" : "MEASURED",
  }));
}
