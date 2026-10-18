// SYNTHETIC measurement lines for the owner-only engineering preview.
// Not from any real drawing or project. Rule citations are placeholders and
// unverified: they illustrate where a citation goes, not what IS 1200 says.
import type { MeasurementLine, RuleCitation } from "@/lib/measurement/measurement";

const sampleRule: RuleCitation = { part: "[sample]", clause: "[sample]", verified: false };
const m = (value: number | null) => ({ value, unit: "m" });
const mm = (value: number | null) => ({ value, unit: "mm" });

export const SAMPLE_MEASUREMENT_LINES: MeasurementLine[] = [
  {
    id: "ML-1",
    item: "Brickwork 230 mm in superstructure (sample)",
    unit: "cum",
    rows: [
      { id: "ML-1.1", description: "Long walls", no: 2, L: m(6.0), B: mm(230), D: m(3.0), deduction: false, drawingRef: { page: 1, regionId: "W-1" }, rule: sampleRule },
      { id: "ML-1.2", description: "Cross walls", no: 3, L: m(4.2), B: mm(230), D: m(3.0), deduction: false, drawingRef: { page: 1, regionId: "W-2" }, rule: sampleRule },
      { id: "ML-1.3", description: "Window openings", no: 4, L: m(1.2), B: mm(230), D: m(1.5), deduction: true, drawingRef: { page: 1, regionId: "O-1" }, rule: sampleRule },
    ],
  },
  {
    id: "ML-2",
    item: "12 mm internal plaster (sample)",
    unit: "sqm",
    rows: [
      { id: "ML-2.1", description: "Living room walls", no: 1, L: m(16.4), B: m(3.0), D: null, deduction: false, drawingRef: { page: 1, regionId: "R-LIV" }, rule: sampleRule },
      { id: "ML-2.2", description: "Door opening", no: 1, L: m(1.0), B: m(2.1), D: null, deduction: true, drawingRef: { page: 1, regionId: "D-1" }, rule: null },
    ],
  },
  {
    id: "ML-3",
    item: "Skirting (sample)",
    unit: "m",
    rows: [
      { id: "ML-3.1", description: "Living room perimeter", no: 1, L: m(16.4), B: null, D: null, deduction: false, drawingRef: { page: 1, regionId: "R-LIV" }, rule: sampleRule },
      { id: "ML-3.2", description: "Bedroom perimeter — not yet measured", no: 1, L: m(null), B: null, D: null, deduction: false, drawingRef: { page: 1, regionId: "R-BED" }, rule: sampleRule },
    ],
  },
  {
    id: "ML-4",
    item: "Floor tiling (sample)",
    unit: "sqm",
    rows: [
      { id: "ML-4.1", description: "Kitchen floor (a depth was entered by mistake)", no: 1, L: m(3.0), B: m(2.4), D: m(0.02), deduction: false, drawingRef: null, rule: sampleRule },
    ],
  },
];
