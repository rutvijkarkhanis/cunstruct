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


/** A drawing marker in the shape the existing evidence viewer's marker mode accepts (structurally the
 *  same as its DrawingMarker; declared here so the lab imports nothing from the production review code). */
export interface LabMarker {
  id: string;
  reviewItemId: string;
  category: "Other";
  kind: "evidence";
  box: { bbox: [number, number, number, number]; page: number; label: string; claim: "dimension" };
  page: number;
  pageSize?: { width: number; height: number };
  label: string;
  emphasis: "primary" | "secondary" | "muted";
}
const finite = (p: readonly number[] | null | undefined) => !!p && p.every(Number.isFinite);

/** Clickable markers for one run's measurements: one muted marker (the printed text) per measurement
 *  that has a page position, and — for the selected measurement — its text, line and endpoints as
 *  highlighted markers. A measurement without coordinates gets no marker: nothing is placed by guess.
 *  Marker ids are `${measurementId}::${part}`; use `measurementIdOf` to map a click back. */
export function labMarkers(ms: readonly LabMeasurement[], selectedId: string | null, pageSizes: Record<number, { width: number; height: number } | undefined>): LabMarker[] {
  const out: LabMarker[] = [];
  for (const m of ms) {
    if (!finite(m.textAnchor)) continue;
    const sel = m.id === selectedId;
    const parts = sel ? evidenceFor(m).evidence : evidenceFor(m).evidence.slice(0, 1);
    parts.forEach((b, i) => {
      if (!b.bbox.every(Number.isFinite)) return;
      const ps = pageSizes[m.page];
      out.push({
        id: `${m.id}::${i}`, reviewItemId: m.id, category: "Other", kind: "evidence",
        box: { bbox: b.bbox, page: m.page, label: b.label ?? "", claim: "dimension" }, page: m.page, ...(ps ? { pageSize: ps } : {}),
        label: sel ? (i === 0 ? `${m.id} · ${m.text}` : (b.label ?? "")) : m.text, emphasis: sel ? "primary" : "muted",
      });
    });
  }
  return out;
}
export const measurementIdOf = (markerId: string) => markerId.split("::")[0];
