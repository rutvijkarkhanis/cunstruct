// EVIDENCE DISPLAY — pure formatting helpers for the Review Workstation UX.
//
// These decide WHAT TEXT to show a reviewer for a claim's AI value and its
// evidence state — never how coordinates are resolved or transformed (that
// stays in evidenceCoords.ts). Nothing here fabricates a source name, a page,
// or a count: every string is built strictly from fields the analysis/drawing
// metadata already supplies, degrading to a plainer form when a fact isn't
// available rather than inventing one.

import type { AnalysisItemV1, ClaimType, EvidenceBox } from "./analysisSchemaV1";
import { getEvidenceForClaim } from "./evidenceCoords";

/** Human label for a claim type, for section/field headings. */
export function claimLabel(claim: ClaimType): string {
  switch (claim) {
    case "quantity": return "Quantity";
    case "dimension": return "Dimension";
    case "specification": return "Specification";
    case "location": return "Location";
    case "general": default: return "General";
  }
}

/** The AI-supplied display value for a claim — the same formatting used
 *  across the item panel and the evidence viewer, so they always agree. */
export function formatClaimValue(
  ai: Pick<AnalysisItemV1, "quantity" | "unit" | "dimension" | "specification" | "location" | "item">,
  claim: ClaimType,
): string {
  switch (claim) {
    case "quantity": return ai.quantity == null ? "—" : `${ai.quantity} ${ai.unit ?? ""}`.trim();
    case "dimension": return ai.dimension ?? "—";
    case "specification": return ai.specification ?? "—";
    case "location": return ai.location ?? "—";
    case "general": default: return ai.item;
  }
}

/**
 * Best available human label for a set of evidence regions. Prefers the
 * region's own `label` (the most specific, analysis-supplied name — e.g. a
 * schedule row's caption) over the resolved drawing's stored name. Returns
 * null when neither exists — callers fall back to filename/page rather than
 * guessing a sheet name.
 */
export function resolveEvidenceLabel(regions: EvidenceBox[], documentName: string | null | undefined): string | null {
  const withLabel = regions.find((r) => r.label);
  if (withLabel?.label) return withLabel.label;
  return documentName || null;
}

export interface EvidenceSummary {
  hasEvidence: boolean;
  /** One-line summary for the Field row / evidence banner, e.g.
   *  "Evidence · Ground Floor Door & Window Schedule · p.8". */
  text: string;
  /** Every distinct page this claim's evidence resolves to, when known. */
  pages: number[];
  /** How many separate evidence regions support this claim. */
  regionCount: number;
}

/**
 * Summarize one claim's evidence availability for display: whether it exists
 * at all, how many regions/pages it spans, and — when resolvable — a human
 * source label. Distinguishes "no evidence supplied" from "evidence supplied
 * but the drawing/document it points to can't be resolved" (`resolvedOk`
 * false) rather than letting the latter look identical to a working link.
 */
export function summarizeClaimEvidence(
  evidence: EvidenceBox[],
  claim: ClaimType,
  itemPage: number | undefined,
  documentName: string | null | undefined,
  resolvedOk: boolean,
): EvidenceSummary {
  const regions = getEvidenceForClaim(evidence, claim);
  if (regions.length === 0) {
    return { hasEvidence: false, text: "No evidence attached", pages: [], regionCount: 0 };
  }

  const pages = [...new Set(regions.map((r) => r.page ?? itemPage).filter((p): p is number => p != null))];
  const countPart = pages.length > 1
    ? `${pages.length} pages`
    : regions.length > 1
      ? `${regions.length} regions`
      : pages.length === 1
        ? `p.${pages[0]}`
        : "page unknown";

  if (!resolvedOk) {
    return { hasEvidence: true, text: `Evidence · source not linked to a drawing · ${countPart}`, pages, regionCount: regions.length };
  }

  const label = resolveEvidenceLabel(regions, documentName);
  return {
    hasEvidence: true,
    text: label ? `Evidence · ${label} · ${countPart}` : `Evidence · ${countPart}`,
    pages,
    regionCount: regions.length,
  };
}
