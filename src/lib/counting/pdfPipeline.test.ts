// SYNTHETIC PDF, REAL EXTRACTION — a hand-written vector PDF (two swing
// doors drawn as Bezier arcs + leaf lines, their tags, a window tag and a
// sheet title) read by the real pdf.js path (pdfGeometry.extractPageGeometry)
// and counted. Shows the adapter, the y-flip and page rotation work end to
// end; it is still a synthetic drawing, not evidence about real ones.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { extractPageGeometry } from "../review/pdfGeometry";
import { sheetFromPdfExtraction } from "./normalize";
import { countInstances } from "./engine";
import { SCHEDULE } from "./__fixtures__/syntheticPlans";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any;
beforeAll(async () => {
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
});

const K = 0.5523;
/** A door in raw PDF space (y up): hinge (x, y), leaf radius r, leaf drawn
 *  straight up (open), arc down-right to the closed position. */
const door = (x: number, y: number, r: number) =>
  `${x} ${y} m ${x} ${y + r} l S\n${x} ${y + r} m ${x + K * r} ${y + r} ${x + r} ${y + K * r} ${x + r} ${y} c S\n`;
const text = (s: string, x: number, y: number, size = 8) => `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET\n`;

function buildPdf(content: string, rotate = 0): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Rotate ${rotate} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const PLAN = [
  "1 w 0 0 0 RG\n",
  door(100, 400, 30), door(300, 400, 30),
  text("D1", 102, 440), text("D2", 302, 440),
  text("W1", 500, 300),
  text("GROUND FLOOR PLAN", 350, 40, 14),
].join("");

async function countPdf(rotate: number) {
  const doc = await pdfjsLib.getDocument({ data: buildPdf(PLAN, rotate), isEvalSupported: false }).promise;
  const extraction = await extractPageGeometry(await doc.getPage(1), 1);
  return { extraction, result: countInstances({ sheets: [sheetFromPdfExtraction("pdf-doc", extraction, { sheetNumber: "A-101" })], schedule: SCHEDULE, expectedSheets: [{ sheetNumber: "A-101" }] }) };
}

describe("synthetic PDF through real pdf.js extraction", () => {
  it("finds both doors from the vectors and ties each to its tag", async () => {
    const { extraction, result } = await countPdf(0);
    expect(extraction.shapes.some((s) => s.type === "path")).toBe(true);
    expect(result.sheets[0]).toMatchObject({ view: "plan", floor: "Ground Floor" });
    expect(result.counts.find((c) => c.mark === "D1")).toMatchObject({ status: "resolved", quantity: 1 });
    expect(result.counts.find((c) => c.mark === "D2")).toMatchObject({ status: "resolved", quantity: 1 });
    expect(result.counts.find((c) => c.mark === "W1")).toMatchObject({ status: "unresolved", quantity: null });
  });

  it("gives the same counts on a page rotated 90°", async () => {
    const plain = (await countPdf(0)).result;
    const { extraction, result } = await countPdf(90);
    expect(extraction.pageSize).toEqual({ width: 595, height: 842 });
    expect(result.counts.map((c) => [c.mark, c.quantity, c.status])).toEqual(plain.counts.map((c) => [c.mark, c.quantity, c.status]));
  });
});
