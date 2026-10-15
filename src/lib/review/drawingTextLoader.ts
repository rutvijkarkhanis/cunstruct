// Browser-side loading of a document's drawing text for the coverage engine:
// current revision → signed URL → pdf.js → pdfGeometry.extractPageGeometry
// for every page. Read-only. Same document → current_revision_id →
// document_revision path as locationObservations.ts, and the same pdf.js
// worker setup as PdfEvidenceViewer.tsx.

import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min?url";
import { db } from "@/lib/untypedDb";
import { extractPageGeometry } from "./pdfGeometry";
import { signedDrawingUrl } from "./drawingStorage";
import { textPageFromPdfExtraction, type DrawingTextPage } from "./drawingInventory";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function loadDocumentDrawingText(documentId: string): Promise<DrawingTextPage[]> {
  const first = <T,>(data: unknown) => (Array.isArray(data) ? (data[0] as T | undefined) : undefined);
  const docRes = await db.from("project_document").select("current_revision_id").eq("id", documentId).limit(1);
  if (docRes.error) throw new Error(docRes.error.message);
  const revisionId = first<{ current_revision_id?: string | null }>(docRes.data)?.current_revision_id;
  if (!revisionId) throw new Error("This document has no current revision.");
  const revRes = await db.from("document_revision").select("file_path").eq("id", revisionId).limit(1);
  if (revRes.error) throw new Error(revRes.error.message);
  const filePath = first<{ file_path?: string | null }>(revRes.data)?.file_path;
  if (!filePath) throw new Error("This document's current revision has no stored drawing file.");
  const url = await signedDrawingUrl(filePath);
  if (!url) throw new Error("Could not open the drawing. It may be missing or you may not have access.");

  const pdf = await pdfjsLib.getDocument(url).promise;
  try {
    const pages: DrawingTextPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      pages.push(textPageFromPdfExtraction(documentId, await extractPageGeometry(await pdf.getPage(n), n)));
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}
