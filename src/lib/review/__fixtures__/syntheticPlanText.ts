// A synthetic two-page plan text layer (invented rooms, sizes and positions),
// shaped like pdfGeometry's text runs: a sheet title per page, room labels
// with their printed size just beneath, repeated labels on one floor, and
// spaces with no printed size — plus the matching reference list. It describes
// no real drawing. Test-only.

import type { DrawingTextPage, DrawingTextRun } from "../drawingInventory";
import type { ExpectedObservation } from "../benchmarkTypes";

export const SYNTHETIC_PAGE_SIZE = { width: 595, height: 842 };
const FLOORS: Record<number, string> = { 1: "First Floor", 2: "Second Floor" };
const LABEL_WIDTH = 30, TEXT_HEIGHT = 6;

/** page, printed label, reference mark, label origin, printed size (if any). */
const ROOMS: { page: number; label: string; mark: string; x: number; y: number; size?: string }[] = [
  { page: 1, label: "BEDROOM", mark: "Bedroom", x: 100, y: 100, size: `12' X 10'` },
  { page: 1, label: "STUDY", mark: "Study", x: 300, y: 100, size: `9' X 8'` },
  { page: 1, label: "W.R", mark: "W.R", x: 100, y: 300, size: `6' X 5'` },
  { page: 1, label: "W.R", mark: "W.R", x: 300, y: 300, size: `7' X 5'6"` },
  { page: 1, label: "W.R", mark: "W.R", x: 450, y: 300, size: `6' X 5'` },
  { page: 1, label: "DINING", mark: "Dining", x: 100, y: 500, size: `14' X 12'` },
  { page: 1, label: "STORE", mark: "Store", x: 300, y: 500 },
  { page: 2, label: "KITCHEN", mark: "Kitchen", x: 100, y: 100, size: `11' X 9'` },
  { page: 2, label: "LIFT", mark: "Lift", x: 300, y: 100, size: `8' X 6'` },
  { page: 2, label: "W.I.C", mark: "W.I.C", x: 100, y: 300, size: `6' X 4'` },
  { page: 2, label: "W.I.C", mark: "W.I.C", x: 300, y: 300, size: `6' X 4'` },
  { page: 2, label: "CORRIDOR", mark: "Corridor", x: 450, y: 500 },
];

const run = (text: string, x: number, y: number, width = LABEL_WIDTH, height = TEXT_HEIGHT): DrawingTextRun =>
  ({ text, origin: [x, y], direction: [1, 0], width, height });

export function syntheticPlanText(documentId: string): DrawingTextPage[] {
  const titles: Record<number, DrawingTextRun> = { 1: run("FIRST FLOOR PLAN", 150, 800, 148, 15), 2: run("SECOND FLOOR PLAN", 150, 800, 165, 15) };
  return [1, 2].map((pageNo) => ({
    documentId, page: pageNo, pageSize: SYNTHETIC_PAGE_SIZE, textLayer: "available" as const,
    runs: [titles[pageNo], ...ROOMS.filter((r) => r.page === pageNo).flatMap((r) =>
      r.size ? [run(r.label, r.x, r.y), run(r.size, r.x - 2, r.y + 8)] : [run(r.label, r.x, r.y)])],
  }));
}

/** The reference for that plan: every room with a printed size, at its label's box. */
export const SYNTHETIC_PLAN_REFERENCE: ExpectedObservation[] = ROOMS.filter((r) => r.size).map((r, i) => ({
  id: `s-${i + 1}`, observationType: "room_or_space", mark: r.mark, scopeHint: FLOORS[r.page],
  attributes: { dimension: r.size!.replace(" X ", "x") },
  sourcePage: `p.${r.page} (synthetic plan)`, expectedPage: r.page,
  expectedBox: { bbox: [r.x, r.y - TEXT_HEIGHT, r.x + LABEL_WIDTH, r.y], pageSize: SYNTHETIC_PAGE_SIZE },
}));
