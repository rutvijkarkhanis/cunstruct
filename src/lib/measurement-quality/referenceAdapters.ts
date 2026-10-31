/**
 * Adapters from existing reference formats to the ledger's ReferenceDimension. Adapters only
 * restate what a reference file says; they never add an association, unit or status it lacks.
 */
import type { Point } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";
import type { ReferenceDimension } from "./ledger";

/** The Gold Set format (W976646): linear dimensions are already ReferenceDimension records. */
export function fromGoldSet(gold: { items: { kind: string }[] }): ReferenceDimension[] {
  return gold.items.filter((i): i is ReferenceDimension => i.kind === "linear_dimension");
}

/** The 1de95f6 R0 format (acc/gold/C-0n-dims-R0.json): one page per file; each dimension gives its
 *  axis, the line position across it, the span along it and the text anchor. It states no unit
 *  (those sheets print none) and no measured element, so association cannot be scored against it. */
export interface R0Case {
  case: string;
  page: number;
  split: string;
  grade: string;
  dimensions: { gid: string; value: number; axis: "h" | "v"; across: number; span: [number, number]; anchor: Point; repeatOf?: string }[];
  amendments?: { gids?: string; gid?: string; field: string; from: unknown; to: unknown; reason: string }[];
}
export function fromR0(c: R0Case, file: { name: string; sha256: string }, view = `p${c.page}`): ReferenceDimension[] {
  return c.dimensions.map((d) => {
    const ends: [Point, Point] = d.axis === "h" ? [[d.span[0], d.across], [d.span[1], d.across]] : [[d.across, d.span[0]], [d.across, d.span[1]]];
    return {
      gold_id: `${c.case}-${d.gid}`, source_id: d.gid, kind: "linear_dimension", file: file.name, sha256: file.sha256,
      page: c.page, view, view_scale: "unknown", printed_text: String(d.value), value: d.value, unit: null,
      orientation: d.axis === "h" ? "horizontal" : "vertical", text_center_pt: d.anchor, endpoints_pt: ends,
      associated_element: "", reference_status: "OK", verification: c.grade,
      ...(d.repeatOf ? { association_basis: `repeat of ${d.repeatOf}` } : {}),
      amendments: (c.amendments ?? []).filter((a) => covers(a.gids ?? a.gid ?? "", d.gid)).map((a) => ({ date: "", field: a.field, from: a.from, to: a.to, why: a.reason })),
    };
  });
}

/** "G16-G22" or "G7" covers gid? */
function covers(spec: string, gid: string): boolean {
  const n = (s: string) => Number(s.replace(/\D/g, ""));
  const [a, b] = spec.split("-");
  return b ? n(gid) >= n(a) && n(gid) <= n(b) : a === gid;
}
