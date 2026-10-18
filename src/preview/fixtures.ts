// SYNTHETIC fixtures for the engineering preview. Not from any real drawing,
// project or BOQ; never to be presented as measured or benchmark data.
import type { CoverageInput } from "@/lib/preview/coverage";
import type { EngineLine } from "@/lib/preview/types";

/** Project materiality threshold for the demo (₹): lines at or above it are key items. */
export const DEMO_MATERIALITY = 100_000;
/** Tolerable error for the demo sample (₹). */
export const DEMO_TOLERABLE_ERROR = 5_000;
export const DEMO_SEED = 2026;
export const DEMO_DRAWING_REVISION = "DEMO-REV-B";
export const DEMO_REVIEWER = "Owner (demo)";

/** Demo drawing items, linked to the demo BOQ lines L-01…L-05 by id. */
export const DEMO_COVERAGE: Omit<CoverageInput, "lines"> & { lineLinks: CoverageInput["lines"] } = {
  legend: [
    { id: "FT", label: "Footing type F1 (legend)" },
    { id: "WC", label: "WC fixture symbol (legend)" },
  ],
  regions: [
    { id: "GRID-B3", label: "A-102 · Grid B3–D5", detections: 2 },
    { id: "STORE", label: "A-103 · Store room", detections: 0 },
    { id: "STAIR", label: "A-104 · Stair core", detections: 0 },
  ],
  expectedScope: [
    { id: "EXC", label: "Earthwork excavation" },
    { id: "WP", label: "Terrace waterproofing" },
  ],
  lineLinks: [
    { id: "L-01", regionIds: ["GRID-B3"], scopeIds: ["EXC"] },
    { id: "L-02", legendIds: ["FT"] },
    { id: "L-05", regionIds: ["STAIR"] },
  ],
};

/** Revision A of the demo lines; revision B is the preview's current state. */
export const DEMO_REVISION_A: EngineLine[] = [
  { id: "L-01", description: "Excavation in foundation trenches", unit: "m³", quantity: 21, quantityState: "established", rate: 420, reviewState: "verified" },
  { id: "L-02", description: "PCC below footings", unit: "m³", quantity: 6.5, quantityState: "established", rate: 6200, reviewState: "verified" },
  { id: "L-03", description: "Reinforcement steel", unit: "kg", quantity: 0, quantityState: "pending", rate: 68, reviewState: "needs_review" },
  { id: "L-04", description: "Additional formwork quantity", unit: "m²", quantity: 0, quantityState: "confirmed_zero", rate: 720, reviewState: "verified" },
  { id: "L-05", description: "Brickwork above plinth", unit: "m³", quantity: 16.8, quantityState: "established", rate: 7400, reviewState: "verified" },
];
