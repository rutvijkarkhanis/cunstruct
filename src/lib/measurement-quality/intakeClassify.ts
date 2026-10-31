/** Intake classification rules (pure). Structure only: a class says what the PDF contains, not that
 *  the engine handles it correctly. Used by scripts/accuracy/mq/intakeLib.ts. */
export interface PageEvidence { text_runs: number; vector_segments: number; images: { page_cover: number }[] }
export type PageClass = "native-vector" | "mixed" | "raster-only" | "insufficient-evidence";
export type DocClass = PageClass | "out-of-domain";

/** Page class from evidence: a page-covering raster with little vector or text is raster-only; a
 *  substantial raster beside substantial vectors is mixed; text plus many vector segments is native-vector. */
export function classifyPage(p: PageEvidence): PageClass {
  const cover = p.images.reduce((s, i) => s + i.page_cover, 0);
  const vec = p.vector_segments >= 500, txt = p.text_runs >= 10;
  if (cover >= 0.5 && !vec) return "raster-only";
  if (cover >= 0.1 && vec) return "mixed";
  if (vec && txt) return "native-vector";
  if (cover >= 0.1) return "raster-only";
  return "insufficient-evidence";
}

export function classifyDocument(pages: PageClass[], outOfDomain: boolean): { class: DocClass; reasons: string[] } {
  const n = (c: PageClass) => pages.filter((x) => x === c).length;
  const reasons = [`page classes: ${(["native-vector", "mixed", "raster-only", "insufficient-evidence"] as const).map((c) => `${c} ${n(c)}`).join(", ")}`];
  if (outOfDomain) return { class: "out-of-domain", reasons: [...reasons, "declared out of domain by its dataset manifest (the diagnostic does not decide domain)"] };
  if (!pages.length) return { class: "insufficient-evidence", reasons };
  if (n("native-vector") === pages.length) return { class: "native-vector", reasons };
  if (n("raster-only") === pages.length) return { class: "raster-only", reasons };
  if (n("native-vector") + n("mixed") > 0 && n("raster-only") + n("mixed") > 0) return { class: "mixed", reasons };
  if (n("native-vector") > 0) return { class: "native-vector", reasons: [...reasons, "some pages carry too little evidence to classify"] };
  return { class: "insufficient-evidence", reasons };
}

