// Quantity provenance / evidence gate.
//
// The catalogue (DSR + NS + MEP) supplies the ITEM, its construction description
// and its RATE — but it must NEVER invent a QUANTITY. A quantity is legitimate
// only when it is backed by evidence:
//   - the drawing counted or measured it (a drawing requirement), or
//   - it is derived from an entered measurement (room dimensions), or
//   - it is an explicit questionnaire input (the non-drawing flow).
//
// A catalogue coefficient ("grills = (rooms+baths)·25 kg", "CPVC = baths·12 + …")
// or an area/room-count heuristic is NOT quantity evidence — it is a fabricated
// number. So in a DRAWING-DRIVEN BOQ those lines are withheld: the drawing's own
// requirements (priced, or pending with qty null) are the source of truth for what
// gets a number. A pure questionnaire/archetype BOQ is unchanged — there the
// questionnaire IS the explicit input, so its quantities stand.
//
// This is a provenance rule keyed on where the quantity came from (line.basis /
// line.drawing), NOT a list of item-specific exclusions, so it holds for any
// project, discipline or allocation.

import type { Spec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

/** Is this generated line's QUANTITY backed by evidence (drawing count/measurement,
 *  or a derivation from entered measurements) rather than a catalogue coefficient
 *  or area/room-count heuristic? */
export function hasQuantityEvidence(line: GeneratedLine): boolean {
  if (line.drawing) return true;                       // counted / measured on the drawing
  // DRAWING_INPUT: straight from the drawing. DRAWING_DERIVED: derived from entered
  // room measurements. DSR_AOR / HEURISTIC: catalogue coefficient / area estimate.
  return line.basis === "DRAWING_INPUT" || line.basis === "DRAWING_DERIVED";
}

/** In a drawing-driven BOQ, keep only quantity-evidenced lines; withhold catalogue-
 *  fabricated quantities (the item/rate exist in the catalogue, but no drawing
 *  quantity supports them). A non-drawing (questionnaire/archetype) BOQ is returned
 *  unchanged — its quantities are explicit operator inputs. Pending drawing items
 *  (qty null) are not lines here; they live in spec._drawing and render separately,
 *  so this never drops pending scope. Pure filter — no quantity is created or changed. */
export function withQuantityEvidence(lines: GeneratedLine[], spec: Spec): GeneratedLine[] {
  if ((spec as Record<string, unknown>)._source !== "chatgpt") return lines;
  return lines.filter(hasQuantityEvidence);
}
