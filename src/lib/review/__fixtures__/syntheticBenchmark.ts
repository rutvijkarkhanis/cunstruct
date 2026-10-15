// SYNTHETIC BENCHMARK — invented ground truth for exercising the scorers and
// the review/Apply identity logic. It describes no real drawing: every mark,
// floor, quantity, size and specification here is made up. It keeps the
// situations real drawing sets produce (a mark code reused on several floors,
// a genuine same-floor repeat, totals the schema cannot represent, conflicting
// sources, an unreadable schedule, repeated room names) so the behaviour under
// test is the same; only the facts are fictional.

import type { BenchmarkCase, ExpectedObservation } from "../benchmarkTypes";

const SCHEDULE = "p.2 (synthetic door/window schedule)";

// ── Tier 1 — direct schedule read ──────────────────────────────────────────

const TIER1: BenchmarkCase[] = [
  {
    id: "stilt-d1", tier: 1, title: "Stilt floor — Door D1 count", sourcePage: SCHEDULE,
    description: "The synthetic Stilt schedule lists two D1 doors.", graded: true,
    expectedItems: [{ id: "stilt-d1", key: "D1", item: "Door D1", location: "Stilt", quantity: 2 }],
  },
  {
    id: "stilt-w1", tier: 1, title: "Stilt floor — Window W1", sourcePage: SCHEDULE,
    description: "Two W1 windows, 4'x4', aluminium, on the Stilt floor.", graded: true,
    expectedItems: [{ id: "stilt-w1", key: "W1", item: "Window W1", location: "Stilt", quantity: 2, dimension: "4'x4'", specification: "Aluminium" }],
  },
  {
    id: "ground-w1", tier: 1, title: "Ground floor — Window W1", sourcePage: SCHEDULE,
    description: "Five W1 windows, 5'x6', aluminium, on the Ground floor — same mark as stilt-w1, different floor and size.", graded: true,
    expectedItems: [{ id: "ground-w1", key: "W1", item: "Window W1", location: "Ground", quantity: 5, dimension: "5'x6'", specification: "Aluminium" }],
  },
  {
    id: "ground-v1", tier: 1, title: "Ground floor — Ventilator V1 count", sourcePage: SCHEDULE,
    description: "Three V1 ventilators on the Ground floor.", graded: true,
    expectedItems: [{ id: "ground-v1", key: "V1", item: "Ventilator V1", location: "Ground", quantity: 3 }],
  },
];

// ── Tier 2 — cross-referenced facts ────────────────────────────────────────

const TIER2: BenchmarkCase[] = [
  {
    id: "identity-w1-cross-floor", tier: 2, title: "W1 reused across Stilt, Ground and a Typical floor", sourcePage: SCHEDULE,
    description:
      "The mark W1 names a different window on each floor. The three floors must stay three items, while a genuine " +
      "same-floor repeat (the Ground row read twice) must still collapse to one.",
    graded: true,
    expectedItems: [
      { id: "stilt-w1-id", key: "W1", item: "Window W1", location: "Stilt", quantity: 2, dimension: "4'x4'", specification: "Aluminium" },
      { id: "ground-w1-id", key: "W1", item: "Window W1", location: "Ground", quantity: 5, dimension: "5'x6'", specification: "Aluminium" },
      { id: "typical-w1-id", key: "W1", item: "Window W1", location: "Typical Floor 1", quantity: null },
      // The positive control: the Ground row parsed twice must collapse.
      { id: "ground-w1-repeat", key: "W1", item: "Window W1", location: "Ground", quantity: 5, dimension: "5'x6'", specification: "Aluminium" },
    ],
    duplicateExpectations: [
      { a: "stilt-w1-id", b: "ground-w1-id", shouldBeDuplicate: false },
      { a: "stilt-w1-id", b: "typical-w1-id", shouldBeDuplicate: false },
      { a: "ground-w1-id", b: "typical-w1-id", shouldBeDuplicate: false },
      { a: "ground-w1-id", b: "ground-w1-repeat", shouldBeDuplicate: true },
    ],
  },
  {
    id: "slab-total-area", tier: 2, title: "Total slab area", sourcePage: "p.1 (synthetic area statement)",
    description: "A building-wide slab total with no floor location.", graded: true,
    gap: { category: "B_REPRESENTATION_GAP", note: "A building-wide total has no line-level home in the item schema." },
    expectedItems: [{ id: "slab-total-area", key: "SLAB-TOTAL", item: "Total slab area", quantity: 1000, unit: "sqft" }],
  },
  {
    id: "typical-flat-total-area", tier: 2, title: "Total typical flat area", sourcePage: "p.1 (synthetic area statement)",
    description: "A summed area across typical floors.", graded: true,
    gap: { category: "B_REPRESENTATION_GAP", note: "A summed total across floors has no line-level home in the item schema." },
    expectedItems: [{ id: "typical-flat-total-area", key: "TYPICAL-FLAT-TOTAL", item: "Total typical flat area", quantity: 900, unit: "sqft" }],
  },
  {
    id: "parking-counts", tier: 2, title: "Parking counts by vehicle class", sourcePage: "p.1 (synthetic parking table)",
    description: "Four-wheeler and two-wheeler spaces are counted separately.", graded: true,
    expectedItems: [
      { id: "parking-4w", key: "PARKING-4W", item: "Car parking (four-wheeler)", quantity: 3 },
      { id: "parking-2w", key: "PARKING-2W", item: "Two-wheeler parking", quantity: 4 },
    ],
  },
];

// ── Tier 3 — conflicts, unreadable data, repeated names ────────────────────

const TIER3: BenchmarkCase[] = [
  {
    id: "ground-floor-area-conflict", tier: 3, title: "Ground floor area — two sources disagree", sourcePage: "p.1, p.3 (synthetic)",
    description: "Two sheets state different Ground floor areas; both are reported, neither is chosen.", graded: true,
    gap: { category: "C_CAPABILITY_GAP", note: "No cross-sheet conflict detection exists; both figures are expected as separate items." },
    expectedItems: [
      { id: "ground-brickwork-area", key: "GROUND-AREA-BRICKWORK", item: "Ground floor area (brickwork dwg)", location: "Ground", quantity: 1200, unit: "sqft" },
      { id: "ground-statement-area", key: "GROUND-AREA-STATEMENT", item: "Ground floor area (Area Statement)", location: "Ground", quantity: 1250, unit: "sqft" },
    ],
  },
  {
    id: "typical-floor-schedule-digits", tier: 3, title: "Typical floor schedule — unreadable digits", sourcePage: "p.4 (synthetic)",
    description: "The schedule's digits are treated as unreadable, so no ground truth is asserted.", graded: false,
    gap: { category: "D_BENCHMARK_DATA_GAP", note: "Ground truth not confirmed; reported, never scored." },
    expectedItems: [],
  },
  {
    id: "ground-floor-room-scope", tier: 3, title: "Ground floor rooms, including four guest bedrooms", sourcePage: "p.3 (synthetic plan)",
    description: "Eight named rooms, four of them separate Guest Bedrooms that must stay four items.", graded: true,
    expectedItems: [
      { id: "gb1", key: "GB1", item: "Guest Bedroom 1", location: "Ground", quantity: null },
      { id: "gb2", key: "GB2", item: "Guest Bedroom 2", location: "Ground", quantity: null },
      { id: "gb3", key: "GB3", item: "Guest Bedroom 3", location: "Ground", quantity: null },
      { id: "gb4", key: "GB4", item: "Guest Bedroom 4", location: "Ground", quantity: null },
      { id: "dining", key: "DINING", item: "Dining", location: "Ground", quantity: null },
      { id: "living", key: "LIVING", item: "Living", location: "Ground", quantity: null },
      { id: "study", key: "STUDY", item: "Study", location: "Ground", quantity: null },
      { id: "store", key: "STORE", item: "Store", location: "Ground", quantity: null },
    ],
    duplicateExpectations: [
      { a: "gb1", b: "gb2", shouldBeDuplicate: false },
      { a: "gb1", b: "gb3", shouldBeDuplicate: false },
      { a: "gb1", b: "gb4", shouldBeDuplicate: false },
    ],
  },
];

export const SYNTHETIC_BENCHMARK: BenchmarkCase[] = [...TIER1, ...TIER2, ...TIER3];

// ── LOCATION-mode observations (synthetic) ──────────────────────────────────
// The same invented W1 facts as observations, plus a cross-floor Main Entrance
// pair, for the observation scorer.

export const SYNTHETIC_OBSERVATIONS: ExpectedObservation[] = [
  { id: "stilt-w1-obs", observationType: "schedule_entry", mark: "W1", scopeHint: "Stilt", attributes: { dimension: "4'x4'", specification: "Aluminium" }, sourcePage: "p.2 (synthetic schedule)", expectedPage: 2 },
  { id: "ground-w1-obs", observationType: "schedule_entry", mark: "W1", scopeHint: "Ground", attributes: { dimension: "5'x6'", specification: "Aluminium" }, sourcePage: "p.2 (synthetic schedule)", expectedPage: 2 },
  { id: "stilt-main-entrance-obs", observationType: "opening", mark: "Main Entrance", scopeHint: "Stilt Floor", attributes: { dimension: "12' wide" }, sourcePage: "p.1 (synthetic plan)", expectedPage: 1 },
  { id: "ground-main-entrance-obs", observationType: "opening", mark: "Main Entrance", scopeHint: "Ground Floor", attributes: { dimension: "5' wide" }, sourcePage: "p.3 (synthetic plan)", expectedPage: 3 },
  { id: "ground-living-obs", observationType: "room_or_space", mark: "Living", scopeHint: "Ground Floor", attributes: { dimension: "20'x16'" }, sourcePage: "p.3 (synthetic plan)", expectedPage: 3 },
];

export const SYNTHETIC_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [
  { a: "stilt-w1-obs", b: "ground-w1-obs" },
  { a: "stilt-main-entrance-obs", b: "ground-main-entrance-obs" },
];
