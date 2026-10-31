// Turns a lab measurement into evidence boxes the existing PdfEvidenceViewer can place (page points).
import type { AnalysisSource } from "@/lib/review/analysisSchemaV1";
import type { LabMeasurement } from "./core";

/** Engine evidence for one measurement, as boxes the existing evidence viewer can place (page points). */
export function evidenceFor(m: LabMeasurement, pageSize?: { width: number; height: number }): AnalysisSource {
  const box = (x0: number, y0: number, x1: number, y1: number, label: string) => ({ bbox: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] as [number, number, number, number], page: m.page, label, claim: "dimension" as const });
  const ev = [box(m.textAnchor[0] - 14, m.textAnchor[1] - 9, m.textAnchor[0] + 14, m.textAnchor[1] + 3, `printed "${m.text}"`)];
  if (m.line) ev.push(box(m.line.a[0] - 1.5, m.line.a[1] - 1.5, m.line.b[0] + 1.5, m.line.b[1] + 1.5, "engine dimension line"));
  if (m.span) for (const [i, p] of [m.span.start, m.span.end].entries()) ev.push(box(p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3, `engine endpoint ${i + 1}`));
  return { page: m.page, evidence: ev, ...(pageSize ? { pageSize } : {}) };
}

