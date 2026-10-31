/**
 * Classifies why the frozen engine did not accept a measurement, from what the engine recorded.
 * Every blocking condition becomes one category; the PRIMARY reason is the blocker at the earliest
 * pipeline stage (line → endpoints → association → scale → cross-checks), the rest are SECONDARY.
 * Categories are named after recorded engine reasons, not hypothetical failure modes; anything
 * unrecognised is reported as "unclassified" with the raw text, never guessed.
 */
import type { LinearDimension } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";

export const FAILURE_CATEGORIES = {
  "no-dimension-line": "No drawn line parallel to the text beside it",
  "multiple-plausible-lines": "Several lines equally close; terminators do not single one out",
  "no-terminators": "No terminator on either side of the text",
  "text-not-between-terminators": "Text not between its nearest terminators (the pair may belong to another dimension)",
  "one-sided-endpoint": "Terminator on one side only",
  "ambiguous-endpoint-pair": "Two different terminators too close to tell apart on one side",
  "extension-lines-both-directions": "Extension lines leave an end in both directions and reach different elements",
  "grid-near-miss": "Tick close to, but not on, a grid line",
  "face-beside-grid": "Tick on a drawn face beside a grid line",
  "grid-face-coincidence": "Grid end on a line a face also follows, other end a face",
  "extension-without-element": "Extension line leads to no identifiable element",
  "end-not-tied": "An end has no grid line, edge or extension line on its axis",
  "association-ambiguous-other": "Association ambiguous for a reason not listed above",
  "scale-conflict": "Printed value disagrees with the drawn length at the region's scale",
  "scale-unavailable-no-group": "No agreeing group of nearby dimensions to calibrate a scale",
  "scale-unavailable-region-overlap": "Lies where regions of different scales meet",
  "cross-view-conflict": "Same grids dimensioned with different values on another view",
  "chain-total-disagrees": "Overall dimension disagrees with the sum of its chain",
  "unit-unknown": "No unit established",
  unclassified: "Recorded reason not recognised by this classifier",
} as const;
export type FailureCategory = keyof typeof FAILURE_CATEGORIES;

export interface FailureClass {
  primary: FailureCategory;
  secondary: FailureCategory[];
  /** primary + secondary, in stage order */
  blockers: FailureCategory[];
  /** true: the primary is the only blocker and every later stage was evaluated and passed;
   *  false: other blockers exist; null: later stages were never attempted, so it is unknown. */
  soleBlocker: boolean | null;
  stage: "line" | "endpoints" | "association" | "scale" | "cross-check" | "unit" | "unknown";
  evidence: string[];
}

const STAGE: Record<FailureCategory, FailureClass["stage"]> = {
  "no-dimension-line": "line", "multiple-plausible-lines": "line",
  "no-terminators": "endpoints", "text-not-between-terminators": "endpoints", "one-sided-endpoint": "endpoints", "ambiguous-endpoint-pair": "endpoints",
  "extension-lines-both-directions": "association", "grid-near-miss": "association", "face-beside-grid": "association", "grid-face-coincidence": "association",
  "extension-without-element": "association", "end-not-tied": "association", "association-ambiguous-other": "association",
  "scale-conflict": "scale", "scale-unavailable-no-group": "scale", "scale-unavailable-region-overlap": "scale",
  "cross-view-conflict": "cross-check", "chain-total-disagrees": "cross-check", "unit-unknown": "unit", unclassified: "unknown",
};

/** Per-end association reasons → category (matched on the engine's own wording). */
function endCategory(reason: string): FailureCategory {
  if (/Extension lines leave this end in both directions/.test(reason)) return "extension-lines-both-directions";
  if (/off grid .*'s line|off grid \S+ line/.test(reason)) return "grid-near-miss";
  if (/tick sits on a drawn face .* beside grid/.test(reason)) return "face-beside-grid";
  if (/grid line that a drawn face also follows/.test(reason)) return "grid-face-coincidence";
  if (/extension line leaves this end but does not lead/i.test(reason)) return "extension-without-element";
  if (/No grid line, edge or extension line on this end's axis/.test(reason)) return "end-not-tied";
  return "association-ambiguous-other";
}

type Dim = Pick<LinearDimension, "decisions" | "reasons" | "endpoints" | "association" | "crossView" | "covers" | "unit">;

export function classifyFailure(d: Dim): FailureClass | null {
  if (d.decisions.overall === "acceptable") return null;
  const g = d.decisions, out: FailureCategory[] = [], evidence: string[] = [];
  const has = (re: RegExp) => d.reasons.find((r) => re.test(r));
  const push = (c: FailureCategory, ev?: string | null) => { if (!out.includes(c)) out.push(c); if (ev) evidence.push(ev); };

  if (g.line === "not-found") push("no-dimension-line", has(/No drawn line/));
  else if (g.line === "ambiguous") push("multiple-plausible-lines", has(/lines sit equally close/));

  if (g.endpoints === "unresolved") {
    const r = d.endpoints?.reason ?? "";
    push(/not between its nearest terminators/.test(r) ? "text-not-between-terminators" : /No terminator/.test(r) ? "no-terminators" : "unclassified", r);
  } else if (g.endpoints === "one-sided") push("one-sided-endpoint", d.endpoints?.reason);
  else if (g.endpoints === "ambiguous") push("ambiguous-endpoint-pair", d.endpoints?.reason);

  if (g.association === "ambiguous" || g.association === "unassociated") {
    for (const e of d.association?.ends ?? []) {
      if (e.kind === "ambiguous" || e.kind === "none") push(endCategory(e.reason), e.reason);
    }
    if (d.association && !d.association.ends.some((e) => e.kind === "ambiguous" || e.kind === "none")) push("association-ambiguous-other", d.association.reason);
  }

  if (g.scale === "conflicting") push("scale-conflict", has(/does not match the drawn length/));
  else if (g.scale === "unavailable") push(has(/regions of different scales meet/) ? "scale-unavailable-region-overlap" : "scale-unavailable-no-group", has(/agreeing group|different scales meet/));

  if (d.crossView?.conflict) push("cross-view-conflict", has(/on different views/));
  if (d.covers && !d.covers.agrees) push("chain-total-disagrees", null);
  if (g.unit === "none" || !d.unit) push("unit-unknown", null);

  if (!out.length) push("unclassified", d.reasons.join(" | ") || "(no reason recorded)");
  const order = Object.keys(STAGE) as FailureCategory[];
  const blockers = [...out].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const notAttempted = g.endpoints === "not-attempted" || g.association === "not-attempted" || g.scale === "not-attempted";
  const soleBlocker = blockers.length > 1 ? false : notAttempted ? null : true;
  return { primary: blockers[0], secondary: blockers.slice(1), blockers, soleBlocker, stage: STAGE[blockers[0]], evidence };
}
