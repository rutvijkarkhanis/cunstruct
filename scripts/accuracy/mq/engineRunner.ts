// Runs the FROZEN measurement engine on one PDF (library; the CLI is runEngine.ts).
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "@/lib/review/pdfGeometry";
import { extractLinearDimensions, relateAcrossPages, type PageDimensions } from "@/lib/review/linearDimensions";

export async function runEngine(pdf: string, pages: number[] | "all") {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)), isEvalSupported: false, verbosity: 0 }).promise;
  const list = pages === "all" ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : pages;
  const out: PageDimensions[] = [], ms: number[] = [];
  for (const n of list) {
    const t0 = Date.now();
    out.push(extractLinearDimensions(await extractPageGeometry(await doc.getPage(n), n)));
    ms.push(Date.now() - t0);
  }
  relateAcrossPages(out);
  await doc.destroy();
  return { pages: out, ms, numPages: doc.numPages };
}

