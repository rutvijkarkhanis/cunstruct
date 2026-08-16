// BOQ scope tiers — stop generic template infrastructure leaking into a BOQ that
// is scoped to a single floor / private apartment.
//
// A template item exists in the catalogue for the WHOLE project. It must not be
// inherited into a narrower BOQ merely because its toggle defaults on. Scope has
// five tiers, broadest first:
//
//   1. site     — project/site-level infrastructure (underground sump, pressure
//                 pump, compound wall, gate, driveway)
//   2. building — building-level / common-area works (overhead water tank, lifts,
//                 common lighting)
//   3. floor    — floor-level works
//   4. unit     — apartment / private-unit works (rooms, finishes, fixtures, the
//                 per-room electrical & plumbing)
//   5. drawing  — drawing-derived requirements (always kept; the source of truth)
//
// A BOQ prepared for a given tier keeps its own tier and everything narrower, but
// withholds BROADER-scope template items (a private Floor-1 apartment BOQ does not
// automatically carry the building's sump/pump/overhead tank) UNLESS the drawing
// evaluation explicitly supports that item. Structural, finishing and drawing-
// derived lines are never touched; nothing is fabricated and no quantity is changed.

import type { Spec } from "./boqSpec";
import type { DrawingSummary } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";

export type ScopeTier = "site" | "building" | "floor" | "unit";

// Breadth ordering: a narrower BOQ (lower number) excludes broader template items.
const BREADTH: Record<ScopeTier, number> = { site: 3, building: 2, floor: 1, unit: 0 };

/** The scope tier a BOQ is prepared for, from its allocation / floor scope.
 *  A BOQ with NO allocation and NO floor scope (a plain questionnaire/archetype
 *  BOQ for a whole project) is treated as site-level, so nothing is withheld and
 *  existing behaviour is preserved. Only a drawing-derived per-floor BOQ narrows. */
export function boqScopeTier(spec: Spec): ScopeTier {
  const s = spec as Record<string, unknown>;
  const alloc = String(s._boq_allocation ?? "").trim().toLowerCase();
  const scope = String(s._floor_scope ?? "").trim().toLowerCase();
  if (!alloc && !scope) return "site";                                   // whole project — keep everything
  if (/\bcommon\b/.test(alloc) || /\bcommon\b/.test(scope)) return "building";
  if (/\bprivate\b|\bapartment\b|\bunit\b|\bflat\b/.test(scope)) return "unit";   // private-apartment floor
  if (/\bfloor\s*\d+/.test(alloc) || /\bfloor\b/.test(scope)) return "floor";
  return "unit";
}

// Broader-than-unit infrastructure template lines, matched by label. Precise
// matchers avoid catching unit-level work (e.g. "aggregate" is not a "gate").
const INFRA: { tier: ScopeTier; test: RegExp }[] = [
  { tier: "site",     test: /underground\s+water\s+sump|\bsump\b/i },
  { tier: "site",     test: /water\s+pump|pressure\s+pump|pump\s+set/i },
  { tier: "site",     test: /compound\s+wall/i },
  { tier: "site",     test: /\bMS\s+gate\b|main\s+gate/i },
  { tier: "site",     test: /driveway/i },
  { tier: "building", test: /overhead\s+water\s+(storage\s+)?tank|overhead\s+tank|\boht\b/i },
];

/** The scope tier of a generated template line, by its label. Ordinary private-unit
 *  work (structure, finishes, fixtures, per-room MEP) returns "unit" and is kept in
 *  every BOQ; only the broader-scope site/building infrastructure above is tiered up. */
export function lineScopeTier(label: string | null | undefined): ScopeTier {
  const l = label ?? "";
  for (const { tier, test } of INFRA) if (test.test(l)) return tier;
  return "unit";
}

/** Does the drawing evaluation itself itemise this infrastructure? If the drawing
 *  shows a sump / pump / overhead tank, that scope IS in the drawing and may stay. */
function drawingSupports(label: string, summary?: DrawingSummary | null): boolean {
  const items = summary?.items ?? [];
  if (!items.length) return false;
  const matcher = INFRA.find((i) => i.test.test(label));
  if (!matcher) return false;
  return items.some((it) => matcher.test.test(it.match ?? ""));
}

/** Withhold template infrastructure lines that are BROADER than this BOQ's scope
 *  (e.g. a site-level sump/pump or a building-level overhead tank in a private
 *  Floor-1 apartment BOQ), unless the drawing evaluation explicitly supports them.
 *  In-scope work, structural/finishing lines and drawing-derived lines are always
 *  kept. Pure filter — never fabricates, mutates, or reorders a quantity. */
export function withoutOutOfScopeInfra(lines: GeneratedLine[], spec: Spec): GeneratedLine[] {
  const boqTier = boqScopeTier(spec);
  if (boqTier === "site") return lines;                       // whole-project BOQ — keep everything
  const summary = (spec as Record<string, unknown>)._drawing as DrawingSummary | undefined;
  return lines.filter((l) => {
    if (l.drawing) return true;                               // drawing-derived → always kept
    const tier = lineScopeTier(l.label);
    if (BREADTH[tier] <= BREADTH[boqTier]) return true;       // same/narrower scope → in scope
    return drawingSupports(l.label ?? "", summary);           // broader infra → only if drawing supports
  });
}
