// BOQ allocation model — WHICH BOQ is responsible for a piece of work.
//
// A project is split into several BOQs, each responsible for one allocation
// (a Common/Shared BOQ, a per-floor BOQ, a per-block BOQ, a Site BOQ…). The
// catalogue is a set of CANDIDATE items for the whole project; a candidate only
// belongs in a given BOQ when the BOQ's allocation is responsible for that scope.
// This is deliberately NOT a list of item-by-item exclusions ("sump = exclude"):
// each candidate declares the scope LAYER it belongs to, each BOQ allocation
// declares which layers it owns, and eligibility falls out of the two.
//
// Scope layers, broadest first:
//   site         — site/plot works, external, landscaping, driveway, compound wall
//   substructure — excavation, PCC, footings, foundation reinforcement, plinth
//   structure    — superstructure frame: RCC, reinforcement, shuttering, masonry, lintels
//   building     — building-shared envelope & services: external finish, terrace
//                  waterproofing, water tanks/sump/pump, mains panel, earthing
//   common       — common-area works: lift, lobby, corridor, staircase
//   unit         — private-unit works: finishes, doors/windows, sanitary, plumbing,
//                  per-room MEP, joinery, kitchen — the apartment fit-out
//
// The drawing is authoritative for WHETHER an eligible item exists, its quantity,
// location and spec — but the ALLOCATION decides whether it belongs in this BOQ.
// Drawing authority ≠ allocation authority. (Drawing items carry their own
// allocation bucket; itemBelongsToBoq in chatgptEval keeps other buckets out.)

import type { Spec } from "./boqSpec";
import type { GeneratedLine } from "./boqDsrGenerate";

export type BoqScope = "site" | "substructure" | "structure" | "building" | "common" | "unit";

export const ALL_SCOPES: BoqScope[] = ["site", "substructure", "structure", "building", "common", "unit"];

/** How a BOQ's allocation maps to the scope layers it is responsible for.
 *  - whole project (no allocation) → owns everything (a single-BOQ villa/house);
 *  - a shared/common/site/foundation BOQ → owns the shared layers it names;
 *  - a private apartment / unit BOQ → owns unit fit-out only;
 *  - a bare floor BOQ → owns that floor's structure + its unit work.
 *  The mapping is driven by the allocation descriptor, so it generalises to any
 *  project's BOQ breakdown without hardcoding item names or a fixed tree. */
export function eligibleScopes(spec: Spec): Set<BoqScope> {
  const s = spec as Record<string, unknown>;
  const alloc = String(s._boq_allocation ?? "").toLowerCase();
  const scope = String(s._floor_scope ?? "").toLowerCase();
  const text = `${alloc} ${scope}`;

  if (!alloc && !scope) return new Set(ALL_SCOPES);          // whole project — one BOQ owns everything

  // Shared / common / site / foundation BOQs own the project-wide layers they name.
  const wantsCommon = /\bcommon\b|\bshared\b/.test(text);
  const wantsSite = /\bsite\b|\blandscap|\bexternal\b/.test(text);
  const wantsFoundation = /\bfoundation\b|substructure|\bfooting|\bplinth\b|\bpiling\b/.test(text);
  if (wantsCommon || wantsSite || wantsFoundation) {
    const set = new Set<BoqScope>();
    if (wantsCommon) (["site", "substructure", "building", "common"] as BoqScope[]).forEach((x) => set.add(x));
    if (wantsSite) set.add("site");
    if (wantsFoundation) set.add("substructure");
    return set;
  }

  // Private apartment / unit BOQ → the unit fit-out only (structure & everything
  // broader belongs to the floor/building/shared BOQs).
  if (/\bprivate\b|\bapartment\b|\bunit\b|\bflat\b/.test(text)) return new Set<BoqScope>(["unit"]);
  // A bare floor BOQ owns that floor's structural frame plus its unit work.
  if (/\bfloor\b/.test(text)) return new Set<BoqScope>(["structure", "unit"]);
  // Any other named allocation → treat as a unit-level fit-out (safe narrow default).
  return new Set<BoqScope>(["unit"]);
}

/** Is a whole-project BOQ (owns every scope layer)? Used to short-circuit the
 *  filter and keep the existing single-BOQ behaviour byte-for-byte. */
export function isWholeProjectBoq(spec: Spec): boolean {
  const s = spec as Record<string, unknown>;
  return !String(s._boq_allocation ?? "").trim() && !String(s._floor_scope ?? "").trim();
}

/** A single-floor / single-unit BOQ covers ONE floor of work, so whole-building
 *  scaling (× number of floors) must collapse to one — otherwise a Floor-1 BOQ
 *  inherits the whole building's structural / envelope quantities. A whole-project
 *  or explicitly multi-floor shared BOQ keeps the real floor count. */
export function allocationFloors(spec: Spec, projectFloors: number | null): number | null {
  if (isWholeProjectBoq(spec)) return projectFloors;
  const elig = eligibleScopes(spec);
  // A per-floor/unit BOQ (owns unit and at most its own structure) is one floor.
  const perFloor = elig.has("unit") && !elig.has("substructure") && !elig.has("building") && !elig.has("common");
  return perFloor ? 1 : projectFloors;
}

/** Keep only the catalogue lines whose declared scope this BOQ's allocation owns.
 *  Drawing-derived lines are never filtered here — the drawing is authoritative
 *  within scope and is already restricted to this BOQ's bucket upstream. A line
 *  with no declared scope is treated as unit-level (kept in every non-shared BOQ).
 *  Pure filter — never fabricates, mutates or reorders a quantity. */
export function withinAllocation(lines: GeneratedLine[], spec: Spec): GeneratedLine[] {
  if (isWholeProjectBoq(spec)) return lines;                 // whole project — keep everything
  const elig = eligibleScopes(spec);
  return lines.filter((l) => {
    if (l.drawing) return true;                              // drawing-derived → always kept
    return elig.has(l.scope ?? "unit");
  });
}
