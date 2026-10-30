// Tests pdfGeometry.ts against real pdf.js extraction of hand-built fixture
// PDFs with known ground-truth coordinates (see __fixtures__/ — built by raw
// PDF syntax, not a library, since none is installed; each fixture's exact
// content stream is reproduced in comments below so the expected values here
// are independently verifiable against the PDF spec, not just trusted).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractPageGeometry } from "./pdfGeometry";

const require = createRequire(import.meta.url);
const FIXTURES_DIR = path.resolve(process.cwd(), "src/lib/review/__fixtures__");

// pdfjs-dist 4.x is ESM-only; the legacy Node-targeted build works outside a
// real browser (the main "pdfjs-dist" entry assumes a DOM/worker environment
// production code gets via Vite — this test runs under plain Node/jsdom).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any;
beforeAll(async () => {
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
});

async function loadPage(fixtureName: string, pageIndex = 1) {
  const data = new Uint8Array(readFileSync(path.join(FIXTURES_DIR, fixtureName)));
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  return doc.getPage(pageIndex);
}

describe("extractPageGeometry — vector-geometry.pdf", () => {
  // Ground truth (see build-vector-pdf.mjs used to construct this fixture):
  // page 612x792; a stroked rect (100,600,80,40); a filled rect
  // (250,550,30,150); an open 4-point polyline; a closed filled 5-point
  // polygon; one cubic Bezier curve; 3 text labels. All coordinates are in
  // RAW PDF space (bottom-left origin, y-up) — this test asserts the
  // extracted points land in PAGE space (top-left origin, y-down), i.e.
  // y_page = 792 - y_pdf.
  it("extracts the stroked rectangle as type rectangle with Y-flipped coordinates", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    const rects = result.shapes.filter((s) => s.type === "rectangle");
    expect(rects.length).toBeGreaterThanOrEqual(1);
    const window = rects.find((r) => r.bbox[0] === 100)!;
    expect(window).toBeDefined();
    // PDF rect (100,600,80,40) -> corners (100,600) and (180,640) in PDF space
    // -> page space: (100, 792-600)=(100,192) and (180, 792-640)=(180,152).
    expect(window.bbox).toEqual([100, 152, 180, 192]);
    expect(window.source).toBe("PDF");
    expect(window.confidenceTier).toBe("deterministic");
    expect(window.page).toBe(1);
  });

  it("extracts the open polyline as type polyline (not polygon — no closePath)", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    const polylines = result.shapes.filter((s) => s.type === "polyline");
    expect(polylines.length).toBe(1);
    expect(polylines[0].points).toHaveLength(4);
    // PDF (350,700) -> page (350, 92); PDF (500,650) -> page (500, 142).
    expect(polylines[0].points[0]).toEqual([350, 92]);
    expect(polylines[0].points[3]).toEqual([500, 142]);
  });

  it("extracts the closed 5-point shape as type polygon", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    const polygons = result.shapes.filter((s) => s.type === "polygon");
    expect(polygons.length).toBe(1);
    expect(polygons[0].points).toHaveLength(5);
    expect(polygons[0].source).toBe("PDF");
  });

  it("extracts the Bezier curve as type path, never flattened into a polygon", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    const paths = result.shapes.filter((s) => s.type === "path");
    expect(paths.length).toBe(1);
    // 1 moveTo point + (3 points per curveTo) * 1 segment = 4 points.
    expect(paths[0].points).toHaveLength(4);
  });

  it("extracts exact text strings at their converted page-space positions", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    expect(result.textRuns.map((t) => t.text)).toEqual(["WINDOW W1", "COLUMN C1", "DOOR D1"]);
    const windowLabel = result.textRuns[0];
    // PDF text origin (100,650) -> page space (100, 792-650)=(100,142).
    expect(windowLabel.x).toBe(100);
    expect(windowLabel.y).toBe(142);
  });

  it("records each run's reading direction in page space", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    expect(result.textRuns.map((t) => t.direction)).toEqual([[1, 0], [1, 0], [1, 0]]);
  });

  it("reports geometryAvailable: true and the page's own scale-1 size", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    expect(result.geometryAvailable).toBe(true);
    expect(result.pageSize).toEqual({ width: 612, height: 792 });
  });

  it("never assigns a semantic type — shape objects carry no item/category field", async () => {
    const page = await loadPage("vector-geometry.pdf");
    const result = await extractPageGeometry(page, 1);
    for (const shape of result.shapes) {
      expect(shape).not.toHaveProperty("item");
      expect(shape).not.toHaveProperty("category");
      expect(shape).not.toHaveProperty("label");
      expect(["point", "line", "polyline", "polygon", "rectangle", "bbox", "path"]).toContain(shape.type);
    }
  });
});

describe("extractPageGeometry — raster-only.pdf (scanned page, no vector content)", () => {
  // Ground truth: a page whose content stream is only `cm` + `/Im1 Do` — a
  // single image XObject placement, no path or text operators whatsoever.
  it("reports geometryAvailable: false — never fabricates shapes from an image", async () => {
    const page = await loadPage("raster-only.pdf");
    const result = await extractPageGeometry(page, 1);
    expect(result.geometryAvailable).toBe(false);
    expect(result.shapes).toEqual([]);
    expect(result.textRuns).toEqual([]);
  });
});

describe("extractPageGeometry — rotated-90.pdf (page declares /Rotate 90)", () => {
  // Ground truth: same 612x792 page and same (100,600,80,40) rect as
  // vector-geometry.pdf's window, but with /Rotate 90. Raw content-stream
  // coordinates are IDENTICAL (rotation never touches the content stream) —
  // this test proves extractPageGeometry applies the page's own rotated
  // viewport transform (via PageViewport.convertToViewportPoint), not the
  // unrotated one, so the returned points/pageSize are already correct for
  // the AS-DISPLAYED (rotated) page.
  it("converts rectangle coordinates using the ROTATED viewport, not the raw unrotated page", async () => {
    const page = await loadPage("rotated-90.pdf");
    const result = await extractPageGeometry(page, 1);
    // Rotated page is 792 wide x 612 tall (width/height swapped vs. the
    // unrotated 612x792 MediaBox).
    expect(result.pageSize).toEqual({ width: 792, height: 612 });
    const rect = result.shapes.find((s) => s.type === "rectangle")!;
    expect(rect).toBeDefined();
    // Every coordinate must fit inside the ROTATED page's own bounds —
    // using the unrotated transform here would place the rectangle at
    // y up to 640, outside a 612-tall page, and this assertion would fail.
    for (const [, y] of rect.points) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(612);
    }
    for (const [x] of rect.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(792);
    }
  });
});

describe("extractPageGeometry — transformed-geometry.pdf (paths drawn under a `cm` transform)", () => {
  // Ground truth: 612x792 page whose content stream is
  //   q 1 0 0 1 100 200 cm 0 0 m 50 0 l S Q              line (100,200)-(150,200)
  //   q 2 0 0 2 0 0 cm 10 10 20 10 re S Q                rect (20,20)-(60,40)
  //   0 0 m 10 0 l S                                     line (0,0)-(10,0): the Q restored identity
  //   q 0 1 -1 0 300 300 cm 0 0 m 40 0 l S Q             line (300,300)-(300,340): rotated 90°
  //   q 1 0 0.5 1 0 0 cm 450 100 20 20 re S Q            skewed rect: (500,100) (520,100) (530,120) (510,120)
  //   q 1 0 0 1 10 0 cm q 1 0 0 1 0 20 cm 200 600 m 210 600 l S Q 200 650 m 210 650 l S Q
  //                                                      nested: (210,620)-(220,620), then (210,650)-(220,650)
  //   /Fm1 Do  (form /Matrix [1 0 0 1 500 500], content 0 0 m 0 30 l S)
  //                                                      line (500,500)-(500,530)
  //   BT 1 0 0 1 100 220 Tm (4000) Tj ET                 text at (100,220)
  // CAD exports draw almost everything under such transforms; before the fix
  // the raw operand coordinates were reported, so shapes and text disagreed.
  const pageY = (y: number) => 792 - y;
  const lines = async () => {
    const result = await extractPageGeometry(await loadPage("transformed-geometry.pdf"), 1);
    return { result, lines: result.shapes.filter((s) => s.type === "line").map((s) => s.points) };
  };

  it("applies the current transformation matrix to path points", async () => {
    const { lines: ls } = await lines();
    expect(ls).toContainEqual([[100, pageY(200)], [150, pageY(200)]]);
    expect(ls).toContainEqual([[300, pageY(300)], [300, pageY(340)]]);
  });

  it("restores the previous matrix at Q, including nested q/Q", async () => {
    const { lines: ls } = await lines();
    expect(ls).toContainEqual([[0, pageY(0)], [10, pageY(0)]]);
    expect(ls).toContainEqual([[210, pageY(620)], [220, pageY(620)]]);
    expect(ls).toContainEqual([[210, pageY(650)], [220, pageY(650)]]);
  });

  it("applies a form XObject's own /Matrix to the paths inside it", async () => {
    const { lines: ls } = await lines();
    expect(ls).toContainEqual([[500, pageY(500)], [500, pageY(530)]]);
  });

  it("a scaled rectangle stays a rectangle; a skewed one is reported as the polygon it really is", async () => {
    const { result } = await lines();
    expect(result.shapes.find((s) => s.type === "rectangle")!.bbox).toEqual([20, pageY(40), 60, pageY(20)]);
    const skew = result.shapes.find((s) => s.type === "polygon")!;
    expect(skew.points).toEqual([[500, pageY(100)], [520, pageY(100)], [530, pageY(120)], [510, pageY(120)]]);
  });

  it("text and the line drawn beside it land in the same page space", async () => {
    const { result } = await lines();
    const t = result.textRuns.find((r) => r.text === "4000")!;
    expect([t.x, t.y]).toEqual([100, pageY(220)]);
  });
});
