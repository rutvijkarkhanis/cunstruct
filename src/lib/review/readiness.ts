// READINESS — Phase A. Pure aggregation of already-computed
// ReconciliationStatus values (instanceReconciliation.ts) into GREEN/AMBER/
// RED rollups, at a single BOQ/run's item level and across a whole
// project's multiple BOQs/disciplines.
//
// No I/O, no Supabase, no new table — "readiness" is derived entirely from
// data the existing analysis pipeline already produces (reviewQueue.ts's
// criticalReasons, typeInstances.ts's physical/schedule signals), reduced to
// a status per item by reconcileInstances(), then rolled up here. The
// caller is responsible for fetching items and computing each one's status;
// this file only does the arithmetic, so it stays trivially testable and
// can never itself diverge from what reconcileInstances() actually decided.

import type { ReconciliationStatus } from "./instanceReconciliation";

export interface ReadinessCounts {
  green: number;
  amber: number;
  red: number;
  total: number;
  /** green / total as a whole-number percentage, 0 when total is 0 (never
   *  divides by zero, never reports 100% readiness for an empty set). */
  readyPct: number;
}

/** Roll a flat list of item-level statuses into GREEN/AMBER/RED counts —
 *  the one level this module needs for "how ready is this BOQ/run." */
export function aggregateReadiness(statuses: ReconciliationStatus[]): ReadinessCounts {
  let green = 0, amber = 0, red = 0;
  for (const s of statuses) {
    if (s === "GREEN") green++;
    else if (s === "AMBER") amber++;
    else red++;
  }
  const total = statuses.length;
  return { green, amber, red, total, readyPct: total === 0 ? 0 : Math.round((green / total) * 100) };
}

/** One BOQ's (or analysis run's) item statuses, tagged with enough identity
 *  for a project-level breakdown to label each row — e.g. the "BOQ by
 *  Discipline" readiness table. */
export interface BoqReadinessGroup {
  boqId: string;
  boqName: string;
  discipline: string;
  statuses: ReconciliationStatus[];
}

export interface ProjectReadiness {
  /** Every group's statuses combined — the project-wide total. */
  overall: ReadinessCounts;
  /** One row per BOQ, in the same order the groups were given. */
  byBoq: { boqId: string; boqName: string; discipline: string; counts: ReadinessCounts }[];
}

/** Project-level readiness across however many BOQs/disciplines the project
 *  actually has (never assumes exactly one) — the per-BOQ breakdown plus one
 *  combined overall total, both derived from the SAME per-item statuses so
 *  they can never disagree with each other. */
export function aggregateProjectReadiness(groups: BoqReadinessGroup[]): ProjectReadiness {
  return {
    overall: aggregateReadiness(groups.flatMap((g) => g.statuses)),
    byBoq: groups.map((g) => ({ boqId: g.boqId, boqName: g.boqName, discipline: g.discipline, counts: aggregateReadiness(g.statuses) })),
  };
}
