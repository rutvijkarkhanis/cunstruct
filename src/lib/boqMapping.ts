// Drawing Requirement → Catalogue mapping layer.
//
// The drawing/evaluation is authoritative for SCOPE: whether a requirement exists,
// its allocation, quantity, unit, location and how the quantity was established
// (counted / measured / derived). The catalogue (DSR) may only contribute the
// construction item, description, rate, pricing unit and specification — it must
// NEVER create or change a quantity.
//
// Every drawing requirement resolves to exactly one of three states:
//   priced           — reliably mapped to a catalogue item AND its drawing quantity
//                       transfers unchanged (same unit dimensionality).
//   drawing_item      — the requirement (with its quantity) exists, but there is no
//                       reliable catalogue mapping / the mapping would need an
//                       unsupported unit conversion, so it stays a visible unpriced
//                       Drawing Item awaiting pricing.
//   quantity_pending  — the requirement exists but no defensible quantity (qty null).
//
// Provenance metadata is preserved per requirement (mapping_source / _confidence,
// specification_supported, quantity_provenance) so the BOQ can distinguish
// "the drawing counted WC × 5" from "priced against DSR 17.2.1" without claiming
// the architect specified the DSR configuration.

import { matchesCandidate, type DrawingItem, type DrawingSummary } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";

export type MappingState = "priced" | "drawing_item" | "quantity_pending";
export type QuantityProvenance = "counted" | "measured" | "derived" | "none";

export interface RequirementMapping {
  requirement: string;
  qty: number | null;
  unit?: string;
  allocation?: string;
  state: MappingState;
  /** Scope always comes from the drawing; the catalogue never invents scope. */
  mapping_source: "drawing";
  /** Confidence that the requirement is mapped to a catalogue (priceable) item. */
  mapping_confidence: "high" | "none";
  /** Did the DRAWING establish the catalogue item's specification? Almost always
   *  false — the drawing names the item, the DSR code supplies the spec/rate. */
  specification_supported: boolean;
  /** Where the QUANTITY came from — never a catalogue coefficient. */
  quantity_provenance: QuantityProvenance;
  /** The DSR code the requirement was priced against, when state === "priced". */
  dsr_code: string | null;
}

const provenanceOf = (it: DrawingItem): QuantityProvenance => {
  if (it.qty == null) return "none";
  const b = (it.basis ?? "").toLowerCase();
  if (b.includes("measur")) return "measured";
  if (b.includes("deriv")) return "derived";
  return "counted";
};

/** The generated line that represents a drawing requirement, if it survived into
 *  the BOQ — either an appended drawing line (same label) or a catalogue line the
 *  drawing overrode (drawing meta + a semantic match). */
export function lineForRequirement(it: DrawingItem, lines: GeneratedLine[]): GeneratedLine | undefined {
  return lines.find((l) => !!l.drawing && (l.label === it.match || matchesCandidate(it.match, { code: l.code, label: l.label })));
}

/** Classify every drawing requirement into its mapping state + provenance. */
export function classifyRequirements(summary: DrawingSummary | null | undefined, lines: GeneratedLine[]): RequirementMapping[] {
  const items = (summary?.items ?? []).filter((i) => i.match?.trim());
  return items.map((it): RequirementMapping => {
    if (it.qty == null) {
      return {
        requirement: it.match, qty: null, unit: it.unit, allocation: it.allocation,
        state: "quantity_pending", mapping_source: "drawing", mapping_confidence: "none",
        specification_supported: false, quantity_provenance: "none", dsr_code: null,
      };
    }
    const line = lineForRequirement(it, lines);
    const priced = !!line && line.code != null;    // mapped to a DSR (priceable) item
    return {
      requirement: it.match, qty: it.qty, unit: it.unit, allocation: it.allocation,
      state: priced ? "priced" : "drawing_item",
      mapping_source: "drawing",
      mapping_confidence: priced ? "high" : "none",
      specification_supported: false,              // the drawing names the item, not the DSR spec
      quantity_provenance: provenanceOf(it),
      dsr_code: priced ? (line!.code ?? null) : null,
    };
  });
}

/** Drawing scope survival invariant: every QUANTIFIED requirement in this BOQ's
 *  allocation must survive as a priced OR unpriced drawing line — never silently
 *  dropped. Returns the requirements that failed to survive (empty = invariant holds).
 *  `belongs` filters to this BOQ's allocation (out-of-allocation scope is excluded
 *  on purpose, not "missing"). */
export function findMissingDrawingScope(
  summary: DrawingSummary | null | undefined,
  lines: GeneratedLine[],
  belongs: (allocation: string | undefined) => boolean = () => true,
): string[] {
  const quantified = (summary?.items ?? []).filter(
    (i) => i.match?.trim() && i.qty != null && Number.isFinite(i.qty) && (i.qty as number) > 0 && belongs(i.allocation),
  );
  return quantified.filter((it) => !lineForRequirement(it, lines)).map((it) => it.match);
}
