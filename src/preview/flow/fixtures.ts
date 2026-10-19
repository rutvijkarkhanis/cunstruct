// SYNTHETIC fixture project for the integrated preview flow (plan v1.2 §5B).
// Not from any real drawing, project or BOQ; never to be presented as measured
// or benchmark data. Dimensions are invented for the demo. Rule citations are
// placeholders and unverified.
//
// The DSR candidates are copied verbatim from the DSR 2023 seed the app ships
// with (supabase/migrations/20260731001000_dsr_seed_civil.sql; a test checks
// they still match). Their rates are provisional — the catalogue is not
// verified against CPWD (plan E3) — and every ₹ figure the flow derives from
// them is illustrative.
import type { DsrItem } from "@/lib/dsr/catalogue";
import type { MeasurementRow, RuleCitation } from "@/lib/measurement/measurement";
import type { DrawingRevision, FlowProject } from "@/lib/preview/flow";
import { DEMO_COVERAGE, DEMO_DRAWING_REVISION, DEMO_MATERIALITY, DEMO_SEED, DEMO_TOLERABLE_ERROR } from "@/preview/fixtures";

const rule: RuleCitation = { part: "[sample]", clause: "[sample]", verified: false };
const m = (value: number | null) => ({ value, unit: "m" });
const mm = (value: number | null) => ({ value, unit: "mm" });
const row = (id: string, description: string, no: number | null, L: number | null, B: { value: number | null; unit: string } | null, D: { value: number | null; unit: string } | null, regionId: string, deduction = false): MeasurementRow =>
  ({ id, description, no, L: m(L), B, D, deduction, drawingRef: { page: 1, regionId }, rule });

export const FLOW_DSR_CANDIDATES: DsrItem[] = [
  { source: "DSR", rate_year: "2023", code: "2.8.1", chapter: "2.0", subhead: "Earthwork", description: "Earth work in excavation by mechanical means (Hydraulic excavator) / manual means in foundation trenches or drains (not exceeding 1.5 m in width or 10 sqm on plan), including dressing of sides and ramming of bottoms, for all lift, including getting out the excavated soil and disposal of surplus excavated soil as directed, within a lead of 50 m. — All kinds of soil.", unit: "cum", rate: 260.3 },
  { source: "DSR", rate_year: "2023", code: "4.1.8", chapter: "4.0", subhead: "Concrete Work", description: "Providing and laying in position cement concrete of specified grade excluding the cost of centering and shuttering - All work up to plinth level : — 1:4:8 (1 Cement : 4 coarse sand (zone-III) derived from natural sources : 8 graded stone aggregate 40 mm nominal size derived from natural sources)", unit: "cum", rate: 6812 },
  { source: "DSR", rate_year: "2023", code: "6.4.2", chapter: "6.0", subhead: "Masonry", description: "Brick work with common burnt clay F.P.S. (non modular) bricks of class designation 7.5 in superstructure above plinth level up to floor V level in all shapes and sizes in : — Cement mortar 1:6 (1 cement : 6 coarse sand)", unit: "cum", rate: 9105.95 },
  { source: "DSR", rate_year: "2023", code: "11.41.2", chapter: "11.0", subhead: "Flooring", description: "Providing and laying vitrified floor tiles in different sizes (thickness to be specified by the manufacturer) with water absorption less than 0.08% and conforming to IS: 15622, of approved make, in all colours and shades, laid on 20 mm thick cement mortar 1:4 (1 cement : 4 coarse sand), jointing with grey cement slurry @ 3.3 kg/ sqm including grouting the joints with white cement and matching pigments etc., complete. — Size of Tile 600x600 mm", unit: "sqm", rate: 1553.45 },
  { source: "DSR", rate_year: "2023", code: "13.4.1", chapter: "13.0", subhead: "Finishing", description: "12 mm cement plaster of mix : — 1:4 (1 cement: 4 coarse sand)", unit: "sqm", rate: 357.35 },
];

export const FLOW_PROJECT: FlowProject = {
  drawingRevision: DEMO_DRAWING_REVISION,
  materiality: DEMO_MATERIALITY,
  tolerableError: DEMO_TOLERABLE_ERROR,
  seed: DEMO_SEED,
  dsr: FLOW_DSR_CANDIDATES,
  coverage: { legend: DEMO_COVERAGE.legend, regions: DEMO_COVERAGE.regions, expectedScope: DEMO_COVERAGE.expectedScope },
  lines: [
    {
      id: "FL-1", description: "Earth work in excavation in foundation trenches, all kinds of soil", dsrCode: "2.8.1", sheet: "A-102",
      coverage: { regionIds: ["GRID-B3"], scopeIds: ["EXC"] },
      measurement: { id: "FL-1", item: "Excavation in foundation trenches (sample)", unit: "cum", rows: [
        row("FL-1.1", "Footing trenches, grid B", 2, 12, m(0.9), m(1.2), "GRID-B3"),
      ] },
    },
    {
      id: "FL-2", description: "Cement concrete 1:4:8 up to plinth level below footings", dsrCode: "4.1.8", sheet: "S-201",
      coverage: { legendIds: ["FT"] },
      measurement: { id: "FL-2", item: "PCC 1:4:8 below footings (sample)", unit: "cum", rows: [
        row("FL-2.1", "Footing bed, grid B", 2, 12, m(0.9), mm(100), "GRID-B3"),
      ] },
    },
    {
      id: "FL-3", description: "Brick work with common burnt clay bricks in superstructure above plinth in cement mortar 1:6", dsrCode: "6.4.2", sheet: "A-103",
      coverage: { regionIds: ["STAIR"] },
      measurement: { id: "FL-3", item: "Brickwork 230 mm in superstructure (sample)", unit: "cum", rows: [
        row("FL-3.1", "Long walls", 2, 6.0, mm(230), m(3.0), "W-1"),
        row("FL-3.2", "Cross walls", 3, 4.2, mm(230), m(3.0), "W-2"),
        row("FL-3.3", "Window openings", 4, 1.2, mm(230), m(1.5), "O-1", true),
      ] },
    },
    {
      id: "FL-4", description: "12 mm cement plaster 1:4", dsrCode: "13.4.1", sheet: "A-103",
      measurement: { id: "FL-4", item: "12 mm internal plaster (sample)", unit: "sqm", rows: [
        row("FL-4.1", "Living room walls", 1, 16.4, m(3.0), null, "R-LIV"),
        row("FL-4.2", "Door opening", 1, 1.0, m(2.1), null, "D-1", true),
      ] },
    },
    {
      id: "FL-5", description: "Skirting", sheet: "A-103",
      measurement: { id: "FL-5", item: "Skirting (sample)", unit: "m", rows: [
        row("FL-5.1", "Living room perimeter", 1, 16.4, null, null, "R-LIV"),
      ] },
    },
    {
      id: "FL-6", description: "Vitrified floor tiles 600x600 mm", dsrCode: "11.41.2", sheet: "A-104",
      measurement: { id: "FL-6", item: "Vitrified floor tiling (sample)", unit: "sqm", rows: [
        row("FL-6.1", "Kitchen floor", 1, 3.0, m(2.4), null, "R-KIT"),
        row("FL-6.2", "Bedroom floor — not yet measured", 1, null, m(3.2), null, "R-BED"),
      ] },
    },
  ],
};

/** Synthetic revision C: the trench depth on A-102 changes; nothing else does. */
export const FLOW_REVISION_C: DrawingRevision = {
  id: "DEMO-REV-C",
  rows: {
    "FL-1": [row("FL-1.1", "Footing trenches, grid B", 2, 12, m(0.9), m(1.35), "GRID-B3")],
  },
};
