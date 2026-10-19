/**
 * Coefficients and fixtures for the B11 procurement preview.
 *
 * Coefficients come in two kinds, and every one says which:
 *   - repo_seed: copied from the DAR 2023 rows already transcribed into this
 *     repository (supabase/migrations/20260731002000_dar_coefficients.sql). The
 *     transcription has NOT been checked against the published DAR, so each is
 *     `verified: false`. No database is read: the values are copied here.
 *   - illustrative_fixture: made up for the preview because the seed holds no
 *     material rows for that item. NOT a real coefficient; labelled in the UI.
 *
 * The BOQ lines, schedule, dealer, lead time, tolerance, work done and issues
 * below are ILLUSTRATIVE FIXTURES — not from any real drawing or project.
 */
import type {
  Dealer, MaterialCoefficient, MaterialIssue, ProcurementBoqLine, WorkDone, WorkPackage,
} from "./procurement";

const DAR_FILE = "supabase/migrations/20260731002000_dar_coefficients.sql";

const darSeed = (lines: number[], note: string) =>
  ({ kind: "repo_seed", dataset: "DAR 2023 (repository seed)", file: DAR_FILE, lines, verified: false, note }) as const;

const ILLUSTRATIVE = {
  kind: "illustrative_fixture",
  note: "Illustrative fixture: the repository seed has no material rows for DSR 6.1.2 (labour only). Not a real coefficient.",
} as const;

export const PREVIEW_COEFFICIENTS: MaterialCoefficient[] = [
  // DSR 4.1.3 — PCC 1:2:4, per cum. Seed lines 253–256. A second 4.1.3 material
  // row at line 504 (12.5 mm aggregate, with brick-layer labour) looks
  // mis-attributed by the transcription and is NOT used. The vibrator row
  // (line 260) is plant hire, not a dealer material, and is not used.
  { itemCode: "4.1.3", materialKey: "aggregate-20mm", material: "Stone aggregate 20 mm", perItemUnit: 0.67, itemUnit: "cum", materialUnit: "cum", source: darSeed([253], "Per cum of PCC 1:2:4.") },
  { itemCode: "4.1.3", materialKey: "aggregate-10mm", material: "Stone aggregate 10 mm", perItemUnit: 0.22, itemUnit: "cum", materialUnit: "cum", source: darSeed([254], "Per cum of PCC 1:2:4.") },
  { itemCode: "4.1.3", materialKey: "coarse-sand", material: "Coarse sand (zone III)", perItemUnit: 0.445, itemUnit: "cum", materialUnit: "cum", source: darSeed([255], "Per cum of PCC 1:2:4.") },
  { itemCode: "4.1.3", materialKey: "cement", material: "Portland cement", perItemUnit: 0.32, itemUnit: "cum", materialUnit: "tonne", source: darSeed([256], "Per cum of PCC 1:2:4.") },
  // DSR 5.22.6 — TMT reinforcement. Seed line 970 gives 1.05 quintal of bars;
  // the DAR analyses this item per quintal of work (an assumption, not
  // verified), so the ratio is expressed here as 1.05 kg of bars per kg of the
  // DSR item (whose unit is kg). The ratio is unchanged; only the unit label.
  { itemCode: "5.22.6", materialKey: "tmt-bars", material: "TMT bars (Fe-500D)", perItemUnit: 1.05, itemUnit: "kg", materialUnit: "kg", source: darSeed([970], "1.05 quintal per quintal of work, expressed per kg; analysis basis assumed, not verified.") },
  // DSR 6.1.2 — brickwork in CM 1:6. ILLUSTRATIVE FIXTURE values.
  { itemCode: "6.1.2", materialKey: "bricks", material: "Common burnt clay bricks", perItemUnit: 500, itemUnit: "cum", materialUnit: "nos", source: ILLUSTRATIVE },
  { itemCode: "6.1.2", materialKey: "cement", material: "Portland cement", perItemUnit: 0.06, itemUnit: "cum", materialUnit: "tonne", source: ILLUSTRATIVE },
  { itemCode: "6.1.2", materialKey: "coarse-sand", material: "Coarse sand (zone III)", perItemUnit: 0.27, itemUnit: "cum", materialUnit: "cum", source: ILLUSTRATIVE },
];

/** Illustrative fixture BOQ: a mix of procurable and not-yet-procurable lines. */
export const PREVIEW_PROCUREMENT_LINES: ProcurementBoqLine[] = [
  { id: "PL-01", dsrCode: "4.1.3", description: "PCC 1:2:4 below footings", unit: "cum", quantity: 6.5, quantityState: "established", certification: "certified", workPackageId: "WP-1" },
  { id: "PL-02", dsrCode: "5.22.6", description: "Reinforcement — columns", unit: "kg", quantity: null, quantityState: "pending", certification: "verified", workPackageId: "WP-2" },
  { id: "PL-03", dsrCode: "6.1.2", description: "Brickwork — boundary wall", unit: "cum", quantity: 18.2, quantityState: "established", certification: "needs_review", workPackageId: "WP-2" },
  { id: "PL-04", dsrCode: "5.22.6", description: "Reinforcement — footings", unit: "kg", quantity: 420, quantityState: "established", certification: "certified", workPackageId: "WP-1" },
  { id: "PL-05", dsrCode: "6.1.2", description: "Brickwork in foundation and plinth", unit: "cum", quantity: 9.6, quantityState: "established", certification: "certified", workPackageId: "WP-2" },
  { id: "PL-06", dsrCode: "5.9.1", description: "Additional formwork to footings", unit: "sqm", quantity: 0, quantityState: "confirmed_zero", certification: "certified", workPackageId: "WP-1" },
  { id: "PL-07", dsrCode: "2.8.1", description: "Excavation in foundation trenches", unit: "cum", quantity: 24, quantityState: "established", certification: "certified", workPackageId: "WP-1" },
];

/** Illustrative fixture schedule (week numbers). */
export const PREVIEW_SCHEDULE: WorkPackage[] = [
  { id: "WP-1", name: "Foundations", startWeek: 2, endWeek: 3 },
  { id: "WP-2", name: "Plinth masonry", startWeek: 4, endWeek: 6 },
];

/** Illustrative fixture: the contractor's own dealer. Not a real business. */
export const PREVIEW_DEALER: Dealer = {
  id: "DEALER-FIXTURE",
  name: "Contractor's own dealer (fixture)",
  relationship: "contractor_own_dealer",
  illustrative: true,
};

/** Illustrative fixture lead time, in weeks. */
export const PREVIEW_LEAD_WEEKS = 1;

/** Illustrative fixture reconciliation tolerance, ± percent. Not a policy. */
export const PREVIEW_TOLERANCE_PCT = 5;

/** Illustrative fixture: work done to date (item units). */
export const PREVIEW_WORK_DONE: WorkDone[] = [
  { lineId: "PL-01", quantityDone: 6.5 },
  { lineId: "PL-04", quantityDone: 300 },
  { lineId: "PL-05", quantityDone: 4 },
  { lineId: "PL-03", quantityDone: 2 },
];

/** Illustrative fixture: material issued from site stores to date. */
export const PREVIEW_ISSUED: MaterialIssue[] = [
  { materialKey: "aggregate-20mm", unit: "cum", quantity: 4.4 },
  { materialKey: "aggregate-10mm", unit: "cum", quantity: 1.43 },
  { materialKey: "coarse-sand", unit: "cum", quantity: 4.6 },
  { materialKey: "cement", unit: "tonne", quantity: 2.3 },
  { materialKey: "tmt-bars", unit: "kg", quantity: 330 },
  { materialKey: "bricks", unit: "nos", quantity: 1700 },
];
