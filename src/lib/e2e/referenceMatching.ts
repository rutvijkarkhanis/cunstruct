// REFERENCE MATCHING — which system item is which reference line. Pure.
//
// Quantity is NEVER used to pair. Two rules only:
//   location     — both sides carry a location on the same page, and they agree
//                  (one box contains the other's centre, or the centres are
//                  within PLACED_WITHIN of the page apart, in page fractions);
//   unique_name  — exactly one reference line and exactly one system item carry
//                  that name, so identity is not in question. Used only when a
//                  location is missing on either side.
// Anything else is left unpaired and reported, never guessed: repeated
// same-name items without locations are "ambiguous"; a located system item
// that sits where an already-paired reference line is, is a "duplicate"; one
// that sits nowhere a same-name reference line is, "location disagrees".
// Floor is not a pairing key: a wrong floor is an identity error to report,
// not a reason to miss the item.

export const PLACED_WITHIN = 0.05;

/** A location as page fractions (0–1), so different coordinate spaces compare. */
export interface Located {
  page: number;
  box: [number, number, number, number];
}

export interface RefCandidate { names: Set<string>; floor: string; located: Located | null }
export interface SysCandidate { name: string; floor: string; located: Located | null }

export type PairMethod = "location" | "unique_name";
export type RefOutcome = "paired" | "missed" | "ambiguous";
export type SysOutcome = "paired" | "no_reference" | "duplicate" | "location_disagrees" | "ambiguous";

export interface MatchResult {
  pairs: { ref: number; sys: number; method: PairMethod; distance: number | null }[];
  refOutcomes: RefOutcome[];
  sysOutcomes: SysOutcome[];
}

export function locate(page: number | undefined | null, bbox: number[] | undefined | null, pageSize: { width: number; height: number } | null | undefined): Located | null {
  if (page == null || !bbox || bbox.length !== 4 || !pageSize || !(pageSize.width > 0 && pageSize.height > 0)) return null;
  const [x1, y1, x2, y2] = bbox;
  if (![x1, y1, x2, y2].every(Number.isFinite) || !(x2 > x1 && y2 > y1)) return null;
  return { page, box: [x1 / pageSize.width, y1 / pageSize.height, x2 / pageSize.width, y2 / pageSize.height] };
}

const centre = (b: Located["box"]): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const contains = (b: Located["box"], [x, y]: [number, number]) => b[0] <= x && x <= b[2] && b[1] <= y && y <= b[3];

/** Distance between two locations' centres (page fractions), or null when they don't agree. */
export function placement(a: Located, b: Located): number | null {
  if (a.page !== b.page) return null;
  const ca = centre(a.box), cb = centre(b.box);
  const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  return contains(a.box, cb) || contains(b.box, ca) || d <= PLACED_WITHIN ? d : null;
}

export function matchReference(refs: RefCandidate[], systems: SysCandidate[]): MatchResult {
  const sameName = (r: RefCandidate, s: SysCandidate) => r.names.has(s.name);
  const sysFor = refs.map((r) => systems.map((s, i) => (sameName(r, s) ? i : -1)).filter((i) => i >= 0));
  const refsFor = systems.map((s) => refs.map((r, i) => (sameName(r, s) ? i : -1)).filter((i) => i >= 0));

  type Cand = { ref: number; sys: number; method: PairMethod; distance: number | null; floorOk: boolean };
  const cands: Cand[] = [];
  refs.forEach((r, ri) => sysFor[ri].forEach((si) => {
    const s = systems[si];
    const floorOk = r.floor === s.floor;
    if (r.located && s.located) {
      const d = placement(r.located, s.located);
      if (d !== null) cands.push({ ref: ri, sys: si, method: "location", distance: d, floorOk });
    } else if (sysFor[ri].length === 1 && refsFor[si].length === 1) {
      cands.push({ ref: ri, sys: si, method: "unique_name", distance: null, floorOk });
    }
  }));
  // Location before name-only; then same floor; then nearest; then document order.
  cands.sort((a, b) => (a.method === b.method ? 0 : a.method === "location" ? -1 : 1)
    || Number(b.floorOk) - Number(a.floorOk) || (a.distance ?? 0) - (b.distance ?? 0) || a.ref - b.ref || a.sys - b.sys);

  const refTaken = new Set<number>(), sysTaken = new Set<number>();
  const pairs: MatchResult["pairs"] = [];
  for (const c of cands) {
    if (refTaken.has(c.ref) || sysTaken.has(c.sys)) continue;
    refTaken.add(c.ref); sysTaken.add(c.sys);
    pairs.push({ ref: c.ref, sys: c.sys, method: c.method, distance: c.distance });
  }

  const refOutcomes: RefOutcome[] = refs.map((r, ri) => {
    if (refTaken.has(ri)) return "paired";
    // Same-name system items exist, but a missing location on either side means
    // there is no evidence to say which one (if any) is this line.
    const unlocatedRival = sysFor[ri].some((si) => !sysTaken.has(si) && (!r.located || !systems[si].located));
    return unlocatedRival ? "ambiguous" : "missed";
  });
  const sysOutcomes: SysOutcome[] = systems.map((s, si) => {
    if (sysTaken.has(si)) return "paired";
    if (refsFor[si].length === 0) return "no_reference";
    if (!s.located || refsFor[si].some((ri) => !refs[ri].located)) return "ambiguous";
    const atPairedRef = refsFor[si].some((ri) => refTaken.has(ri) && placement(refs[ri].located!, s.located!) !== null);
    return atPairedRef ? "duplicate" : "location_disagrees";
  });
  return { pairs, refOutcomes, sysOutcomes };
}
