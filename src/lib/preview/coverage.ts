// Coverage sweep (B6 logic, PREVIEW ONLY). Lists what the BOQ may have missed:
//   1. legend / note items on the drawing with no BOQ line referring to them;
//   2. drawing regions with no detection and no BOQ line;
//   3. expected scope items with no BOQ line.
// Every gap must be resolved (a line now covers it) or excluded with a written
// reason before certification is allowed. The engine only compares the inputs
// it is given; it never decides that a gap is unimportant.

export type GapKind = "legend" | "region" | "scope";

export interface LegendItem { id: string; label: string }
export interface DrawingRegion { id: string; label: string; detections: number }
export interface ScopeItem { id: string; label: string }
/** A BOQ line's links to the drawing and the expected scope. */
export interface CoverageLine { id: string; legendIds?: string[]; regionIds?: string[]; scopeIds?: string[] }

export interface GapResolution {
  type: "resolved" | "excluded";
  /** Required, non-empty, for an exclusion; for "resolved", the line that now covers it. */
  reason: string;
  by: string;
  at: string;
}

export interface CoverageGap { id: string; kind: GapKind; label: string; resolution: GapResolution | null }

export interface CoverageInput {
  legend: LegendItem[];
  regions: DrawingRegion[];
  expectedScope: ScopeItem[];
  lines: CoverageLine[];
}

/** The three gap lists, in input order within each kind. Gap ids are `${kind}:${item id}`. */
export function coverageGaps(input: CoverageInput): CoverageGap[] {
  const linked = (key: "legendIds" | "regionIds" | "scopeIds") => new Set(input.lines.flatMap((l) => l[key] ?? []));
  const legendLinked = linked("legendIds");
  const regionLinked = linked("regionIds");
  const scopeLinked = linked("scopeIds");
  const gap = (kind: GapKind, id: string, label: string): CoverageGap => ({ id: `${kind}:${id}`, kind, label, resolution: null });
  return [
    ...input.legend.filter((x) => !legendLinked.has(x.id)).map((x) => gap("legend", x.id, x.label)),
    ...input.regions.filter((x) => x.detections === 0 && !regionLinked.has(x.id)).map((x) => gap("region", x.id, x.label)),
    ...input.expectedScope.filter((x) => !scopeLinked.has(x.id)).map((x) => gap("scope", x.id, x.label)),
  ];
}

/** Record a resolution. An exclusion without a reason, or a resolution without a person, is refused. */
export function resolveGap(gaps: CoverageGap[], gapId: string, resolution: GapResolution): CoverageGap[] {
  if (!gaps.some((g) => g.id === gapId)) throw new Error(`No coverage gap ${gapId}`);
  if (!resolution.by.trim()) throw new Error("A resolution must name the person who made it");
  if (!resolution.reason.trim()) throw new Error(resolution.type === "excluded" ? "An exclusion needs a written reason" : "A resolution must name the line that now covers the gap");
  return gaps.map((g) => (g.id === gapId ? { ...g, resolution } : g));
}

/** Undo a resolution: the gap is open again. */
export function reopenGap(gaps: CoverageGap[], gapId: string): CoverageGap[] {
  return gaps.map((g) => (g.id === gapId ? { ...g, resolution: null } : g));
}

export interface CoverageStatus { open: number; resolved: number; excluded: number; cleared: boolean }

/** Cleared only when every gap is resolved or excluded with a reason. */
export function coverageStatus(gaps: CoverageGap[]): CoverageStatus {
  const open = gaps.filter((g) => !g.resolution).length;
  return {
    open,
    resolved: gaps.filter((g) => g.resolution?.type === "resolved").length,
    excluded: gaps.filter((g) => g.resolution?.type === "excluded").length,
    cleared: open === 0,
  };
}
