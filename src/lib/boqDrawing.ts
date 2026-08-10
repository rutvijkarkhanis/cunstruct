// Drawing-specific input: a summary of measurements/counts the operator has
// read off the project drawings. It is treated as high-confidence, project-
// specific input that OVERRIDES the generic archetype/area heuristics — but it
// feeds the SAME DSR/AOR engine (quantity basis changes, the commercial engine
// does not). Every quantity carries a basis so the final BOQ can explain where
// each number came from.
//
// This is not a drawing-processing system: the operator supplies the summary
// (typed, or later pasted from an analysed drawing). We never invent a number
// that isn't in the summary; anything the summary doesn't cover falls back to
// the existing engine and is marked as an assumption.

import type { GeneratedLine } from "./boqDsrGenerate";

/** Where a quantity came from — most trustworthy first. */
export type QtyBasis = "DRAWING_INPUT" | "DRAWING_DERIVED" | "DSR_AOR" | "HEURISTIC";

/** One measured/counted override the operator entered from a drawing. */
export interface DrawingItem {
  /** Exact DSR code, or a case-insensitive substring of the item description. */
  match: string;
  /** The measured or counted quantity, in the item's own unit. */
  qty: number;
  /** true = calculated from drawing measurements; false = explicitly counted/stated. */
  derived?: boolean;
  /** Operator note, e.g. "8×6A + 2×16A sockets across living + 2 beds". */
  note?: string;
}

/** The drawing summary, stored on boq.spec._drawing (jsonb — no migration). */
export interface DrawingSummary {
  items?: DrawingItem[];
}

export const BASIS_META: Record<QtyBasis, { label: string; short: string; tone: "measured" | "estimated" }> = {
  DRAWING_INPUT:   { label: "From drawing — measured / counted",       short: "drawing", tone: "measured" },
  DRAWING_DERIVED: { label: "From drawing — derived from measurements", short: "drawing", tone: "measured" },
  DSR_AOR:         { label: "DSR / AOR methodology",                    short: "DSR/AOR", tone: "estimated" },
  HEURISTIC:       { label: "Estimated from built-up area (assumption)", short: "est.",   tone: "estimated" },
};

/**
 * The basis a freshly generated quantity has before any drawing override:
 * - measured room dimensions present  → DRAWING_DERIVED (driven by the drawing)
 * - a scheduled (coded) item          → DSR_AOR (coefficient-derived)
 * - anything else                     → HEURISTIC (archetype/area assumption)
 */
export function defaultBasis(line: GeneratedLine, hasRooms: boolean): QtyBasis {
  if (hasRooms) return "DRAWING_DERIVED";
  return line.code ? "DSR_AOR" : "HEURISTIC";
}

const matchesLine = (it: DrawingItem, l: GeneratedLine): boolean => {
  const key = it.match.trim().toLowerCase();
  if (!key) return false;
  if (l.code && l.code.toLowerCase() === key) return true;
  return (l.label ?? "").toLowerCase().includes(key);
};

/**
 * Apply the operator's drawing summary to already-generated lines: wherever a
 * summary item matches a line, use its quantity directly and stamp the basis.
 * Lines the summary doesn't touch keep their (already-stamped) fallback basis.
 * We only override what the summary explicitly provides — never invent counts.
 */
export function applyDrawing(lines: GeneratedLine[], summary?: DrawingSummary | null): GeneratedLine[] {
  const items = summary?.items?.filter((i) => i.match?.trim() && Number.isFinite(i.qty) && i.qty > 0);
  if (!items?.length) return lines;
  return lines.map((l) => {
    const hit = items.find((it) => matchesLine(it, l));
    if (!hit) return l;
    return { ...l, qty: hit.qty, basis: hit.derived ? "DRAWING_DERIVED" : "DRAWING_INPUT", note: hit.note?.trim() || undefined };
  });
}

/** How many summary items didn't match any generated line (so didn't apply). */
export function unmatchedItems(lines: GeneratedLine[], summary?: DrawingSummary | null): DrawingItem[] {
  const items = summary?.items?.filter((i) => i.match?.trim() && Number.isFinite(i.qty) && i.qty > 0) ?? [];
  return items.filter((it) => !lines.some((l) => matchesLine(it, l)));
}
