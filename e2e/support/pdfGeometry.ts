// M8 — pure geometry helpers shared by the real-browser specs. These let a
// spec predict, from a KNOWN PDF page size (see fixtures/testData.ts) and a
// chosen on-screen click FRACTION, exactly what page-space point the app's
// own screenPointToPageSpace() should compute — and the inverse, exactly
// what on-screen rect a given page-space bbox should render at — WITHOUT
// needing to know the app's current zoom/scale at all. Both directions use
// the same linear scale-only transform PdfEvidenceViewer/evidenceCoords.ts
// use (see transformBox / screenPointToPageSpace), so the scale factor
// cancels out of every ratio used here.

export interface PxRect { x: number; y: number; width: number; height: number }

/** The page-space point a click at `fraction` of the canvas's own rendered
 *  width/height should produce, given the PDF's real (scale-1) page size. */
export function expectedPagePoint(
  fraction: { x: number; y: number },
  pageSize: { width: number; height: number },
): { x: number; y: number } {
  return { x: fraction.x * pageSize.width, y: fraction.y * pageSize.height };
}

/** The on-screen rect (relative to the canvas element's own top-left) a
 *  page-space bbox should render at, given the canvas's ACTUAL measured
 *  bounding box (read back from the live page — this function never
 *  assumes a particular scale/zoom). */
export function expectedOverlayRect(
  bbox: [number, number, number, number],
  pageSize: { width: number; height: number },
  canvasRect: { width: number; height: number },
): PxRect {
  const sx = canvasRect.width / pageSize.width;
  const sy = canvasRect.height / pageSize.height;
  const [x1, y1, x2, y2] = bbox;
  return { x: x1 * sx, y: y1 * sy, width: (x2 - x1) * sx, height: (y2 - y1) * sy };
}

/** Loose pixel-tolerance comparison — rendering involves sub-pixel rounding
 *  at several layers (pdf.js's own canvas scale, CSS transforms), so exact
 *  equality is never the right check here. */
export function approxEqual(a: number, b: number, tolerance = 4): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function rectApproxEqual(a: PxRect, b: PxRect, tolerance = 5): boolean {
  return (
    approxEqual(a.x, b.x, tolerance) &&
    approxEqual(a.y, b.y, tolerance) &&
    approxEqual(a.width, b.width, tolerance) &&
    approxEqual(a.height, b.height, tolerance)
  );
}
