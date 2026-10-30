// Runs the existing drawing-text measurement pipeline (main, unchanged) on a
// PDF in Node: pdf.js text layer -> drawingInventory -> roomDimensionReconciliation
// -> measuredQuantities. Used by the accuracy harness; no network, no Supabase.
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "@/lib/review/pdfGeometry";
import { buildDrawingInventory, textPageFromPdfExtraction, type DrawingTextPage } from "@/lib/review/drawingInventory";
import { reconcileRoomDimensions } from "@/lib/review/roomDimensionReconciliation";
import { measuredQuantitiesFor } from "@/lib/review/measuredQuantities";

export async function loadTextPages(path: string, documentId: string, pages?: number[]): Promise<DrawingTextPage[]> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  const out: DrawingTextPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (pages && !pages.includes(n)) continue;
    const page = await doc.getPage(n);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ex = await extractPageGeometry(page as any, n);
    out.push(textPageFromPdfExtraction(documentId, ex));
  }
  return out;
}

export function runPipeline(pages: DrawingTextPage[]) {
  const inventory = buildDrawingInventory(pages);
  const recon = reconcileRoomDimensions(inventory);
  const quantities = measuredQuantitiesFor(recon.rooms);
  return { inventory, recon, quantities };
}
