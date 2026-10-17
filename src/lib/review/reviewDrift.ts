// Apply acts on review decisions loaded in the browser. Before it writes, the
// decisions are read again; if any item Apply would act on — or any item at
// all, for the "every item has a decision" gate — no longer matches what was
// loaded (another reviewer verified, flagged, corrected or re-opened it), the
// Apply is refused and the screen reloads them. Pure: compares two lists.
import type { ReviewItem } from "./reviewQueue";

type Decided = Pick<ReviewItem, "reviewStatus" | "reviewer"> & { id: string };

const same = (a: Decided, b: Decided) =>
  a.reviewStatus === b.reviewStatus && JSON.stringify(a.reviewer ?? null) === JSON.stringify(b.reviewer ?? null);

/** Ids of items whose saved decision differs from the loaded one, plus items
 *  that appeared or disappeared. Empty = safe to apply as classified. */
export function reviewDrift(loaded: Decided[], fresh: Decided[]): string[] {
  const byId = new Map(fresh.map((f) => [f.id, f]));
  const drift = loaded.filter((l) => { const f = byId.get(l.id); return !f || !same(l, f); }).map((l) => l.id);
  const loadedIds = new Set(loaded.map((l) => l.id));
  return [...drift, ...fresh.filter((f) => !loadedIds.has(f.id)).map((f) => f.id)];
}
