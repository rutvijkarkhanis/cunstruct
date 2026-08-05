// BOQ generation from the questionnaire — now driven by the curated DSR catalog
// (boqDsrCatalog.ts), which names EXACT verified DSR codes. This replaced the old
// fuzzy keyword matching that grabbed bridge piers and raised-access-floor systems
// off any description containing "floor" or "cement".

import { DSR_CATALOG, buildContext } from "./boqDsrCatalog";
import type { Spec } from "./boqSpec";

export interface GeneratedLine {
  section: string;
  code: string;    // exact DSR code — resolved against dsr_item, never fuzzy-matched
  qty: number;     // in the DSR code's own unit
  label: string;
  unit: string;
}

export interface ProjectBasics {
  area_sqft: number | null;
  floors: number | null;
}

/**
 * Turn a saved questionnaire (boq.spec) + project basics into concrete BOQ lines:
 * one per applicable catalog item, gated by the spec, with a unit-correct quantity
 * and an exact DSR code. The builder resolves each code against dsr_item for its
 * live description, unit and rate.
 */
export function generateLines(spec: Spec, project: ProjectBasics): GeneratedLine[] {
  const ctx = buildContext(spec, { area_sqft: project.area_sqft, floors: project.floors });
  const out: GeneratedLine[] = [];
  for (const item of DSR_CATALOG) {
    if (item.when && !item.when(spec)) continue;
    const qty = Math.round(item.qty(ctx, spec) * 100) / 100;
    if (qty <= 0) continue;
    const code = typeof item.code === "function" ? item.code(spec) : item.code;
    out.push({ section: item.section, code, qty, label: item.label, unit: item.unit });
  }
  return out;
}
