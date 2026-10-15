// REFERENCE BOQ — the format an independently prepared reference must take
// before the end-to-end harness will score anything against it.
//
// The harness never builds a reference itself. In particular it must never be
// derived from engine output, the room-observation benchmarks, or prior
// benchmark results: a reference made from what the system produces can only
// agree with it. A reference is accepted only when it names who prepared it,
// when, under which measurement conventions, states that it was prepared
// without seeing Cunstruct output, and is tied to the exact drawing file by
// SHA-256.

export const REFERENCE_BOQ_SCHEMA = "cunstruct.reference-boq.v1";

export interface QuantityTolerance {
  /** Absolute tolerance in the line's own unit. */
  abs?: number;
  /** Relative tolerance, as a fraction (0.01 = 1%). */
  rel?: number;
}

/** How the preparer classified a line. Only "measured" lines carry a quantity
 *  and are scored for quantity accuracy:
 *   measured      — a quantity measured from the drawing under the stated conventions
 *   ambiguous     — the drawing shows the item but its size is unclear (e.g. illegible)
 *   unmeasurable  — the item is on the drawing but the sheets in scope give no size
 *   out_of_scope  — needs drawings outside the agreed scope (sections, structure…)
 *  A correct system holds ambiguous/unmeasurable items for review rather than
 *  putting a measured number in the BOQ. */
export type ReferenceLineStatus = "measured" | "ambiguous" | "unmeasurable" | "out_of_scope";
export const REFERENCE_LINE_STATUSES: ReferenceLineStatus[] = ["measured", "ambiguous", "unmeasurable", "out_of_scope"];

/** Where on the drawing the preparer found the item: [x1, y1, x2, y2], top-left
 *  origin, y down, as displayed, in the units of `pageSize` (PDF points unless
 *  stated) — the same convention as evidenceCoords.ts. */
export interface ReferenceEvidence {
  page: number;
  bbox: [number, number, number, number];
  pageSize: { width: number; height: number };
}

export interface ReferenceBoqLine {
  id: string;
  /** Defaults to "measured" when absent. */
  status?: ReferenceLineStatus;
  /** The item as the preparer wrote it ("Floor area — Kitchen"). */
  item: string;
  /** Other names the PREPARER accepts for the same item. Never added after
   *  seeing system output. */
  aliases?: string[];
  unit: string;
  /** Required for "measured"; must be absent or null for every other status. */
  quantity?: number | null;
  /** Floor the line belongs to, as printed on the drawing ("First Floor"); null for whole-building items. */
  floor: string | null;
  /** Any further scope (zone, flat, block). Cunstruct has no field for it — counted, never scored. */
  scope?: string | null;
  sourcePage?: number | null;
  /** The preparer's own location of the item; lets repeated same-name items be told apart. */
  evidence?: ReferenceEvidence;
  /** How the preparer measured it (e.g. "gross, from printed room size"). */
  measurementRule: string;
  tolerance?: QuantityTolerance;
  /** Required for every status other than "measured": why it has no quantity. */
  note?: string;
}

export const statusOf = (l: Pick<ReferenceBoqLine, "status">): ReferenceLineStatus => l.status ?? "measured";

export interface ReferenceBoq {
  schema_version: typeof REFERENCE_BOQ_SCHEMA;
  project: string;
  drawing: { sha256: string; pages: number[] };
  preparedBy: string;
  preparedAt: string;
  /** Must be true: the preparer did not see Cunstruct's output. */
  preparedWithoutCunstructOutput: true;
  measurementConventions: string;
  lines: ReferenceBoqLine[];
}

export type ReferenceLoad =
  | { status: "loaded"; reference: ReferenceBoq }
  | { status: "absent"; reason: string }
  | { status: "invalid"; errors: string[] };

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const SHA256 = /^[0-9a-f]{64}$/i;

/** Validate a parsed reference against the drawing the run analysed.
 *  `null`/`undefined` input means no reference file exists. */
export function validateReferenceBoq(raw: unknown, expectedDrawingSha256: string): ReferenceLoad {
  if (raw == null) return { status: "absent", reason: "No reference — accuracy not computed." };
  const errors: string[] = [];
  const r = raw as Partial<ReferenceBoq>;
  if (r.schema_version !== REFERENCE_BOQ_SCHEMA) errors.push(`schema_version must be "${REFERENCE_BOQ_SCHEMA}".`);
  if (!isStr(r.project)) errors.push("project is required.");
  if (!isStr(r.preparedBy)) errors.push("preparedBy is required.");
  if (!isStr(r.preparedAt) || Number.isNaN(Date.parse(r.preparedAt))) errors.push("preparedAt must be a date.");
  if (r.preparedWithoutCunstructOutput !== true) errors.push("preparedWithoutCunstructOutput must be true: the reference must be independent of Cunstruct's output.");
  if (!isStr(r.measurementConventions)) errors.push("measurementConventions is required.");
  if (!r.drawing || !isStr(r.drawing.sha256)) errors.push("drawing.sha256 is required.");
  else if (!SHA256.test(r.drawing.sha256)) errors.push("drawing.sha256 must be a 64-character hex SHA-256.");
  else if (r.drawing.sha256.toLowerCase() !== expectedDrawingSha256.toLowerCase()) {
    errors.push(`drawing.sha256 ${r.drawing.sha256} is not the analysed drawing (${expectedDrawingSha256}).`);
  }
  const pages = Array.isArray(r.drawing?.pages) ? r.drawing!.pages : [];
  if (pages.length === 0 || !pages.every((p) => Number.isInteger(p) && p > 0)) errors.push("drawing.pages must list the pages the reference covers.");
  if (!Array.isArray(r.lines) || r.lines.length === 0) errors.push("lines must be a non-empty array.");
  const ids = new Set<string>();
  (Array.isArray(r.lines) ? r.lines : []).forEach((l, i) => {
    const at = `lines[${i}]`;
    if (!isStr(l?.id)) errors.push(`${at}.id is required.`);
    else if (ids.has(l.id)) errors.push(`${at}.id "${l.id}" is repeated.`);
    else ids.add(l.id);
    const status = l?.status ?? "measured";
    if (!REFERENCE_LINE_STATUSES.includes(status)) errors.push(`${at}.status must be one of ${REFERENCE_LINE_STATUSES.join(", ")}.`);
    if (!isStr(l?.item)) errors.push(`${at}.item is required.`);
    if (!isStr(l?.unit)) errors.push(`${at}.unit is required.`);
    if (!REFERENCE_LINE_STATUSES.includes(status)) {
      // Unknown status: reported once above; quantity rules depend on a valid status.
    } else if (status === "measured") {
      if (!isNum(l?.quantity) || l.quantity < 0) errors.push(`${at}.quantity must be a non-negative number for a measured line.`);
    } else {
      if (l?.quantity != null) errors.push(`${at}.quantity must be absent for a ${status} line — no quantity is invented for it.`);
      if (!isStr(l?.note)) errors.push(`${at}.note must say why a ${status} line has no quantity.`);
    }
    if (l?.floor !== null && !isStr(l?.floor)) errors.push(`${at}.floor must be a floor name or null.`);
    if (!isStr(l?.measurementRule)) errors.push(`${at}.measurementRule is required.`);
    if (l?.tolerance && ![l.tolerance.abs, l.tolerance.rel].some((t) => isNum(t) && t >= 0)) errors.push(`${at}.tolerance needs abs or rel.`);
    if (l?.sourcePage != null && !pages.includes(l.sourcePage)) errors.push(`${at}.sourcePage ${l.sourcePage} is not one of the drawing's pages.`);
    const e = l?.evidence;
    if (e != null) {
      const b = e.bbox;
      if (!pages.includes(e.page)) errors.push(`${at}.evidence.page ${e.page} is not one of the drawing's pages.`);
      if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum) || !(b[2] > b[0] && b[3] > b[1])) errors.push(`${at}.evidence.bbox must be [x1, y1, x2, y2] with x2 > x1 and y2 > y1.`);
      if (!e.pageSize || !(isNum(e.pageSize.width) && e.pageSize.width > 0 && isNum(e.pageSize.height) && e.pageSize.height > 0)) errors.push(`${at}.evidence.pageSize must give a positive width and height.`);
      if (l.sourcePage != null && e.page !== l.sourcePage) errors.push(`${at}.evidence.page ${e.page} disagrees with sourcePage ${l.sourcePage}.`);
    }
  });
  return errors.length ? { status: "invalid", errors } : { status: "loaded", reference: r as ReferenceBoq };
}

// ── Units and tolerances ────────────────────────────────────────────────────

export type UnitFamily = "area" | "length" | "volume" | "count" | "other";

const UNIT_ALIASES: Record<string, { canonical: string; family: UnitFamily }> = {
  sqm: { canonical: "sqm", family: "area" }, m2: { canonical: "sqm", family: "area" }, "m²": { canonical: "sqm", family: "area" }, "sq.m": { canonical: "sqm", family: "area" },
  sqft: { canonical: "sqft", family: "area" }, sft: { canonical: "sqft", family: "area" }, "sq.ft": { canonical: "sqft", family: "area" },
  m: { canonical: "m", family: "length" }, rm: { canonical: "m", family: "length" }, rmt: { canonical: "m", family: "length" },
  cum: { canonical: "cum", family: "volume" }, m3: { canonical: "cum", family: "volume" }, "m³": { canonical: "cum", family: "volume" },
  nos: { canonical: "nos", family: "count" }, no: { canonical: "nos", family: "count" }, each: { canonical: "nos", family: "count" }, nr: { canonical: "nos", family: "count" },
};

export function canonicalUnit(unit: string | null | undefined): { canonical: string; family: UnitFamily } | null {
  const u = (unit ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!u) return null;
  return UNIT_ALIASES[u] ?? { canonical: u, family: "other" };
}

const SQFT_PER_SQM = 1 / 0.09290304; // exact: 1 ft = 0.3048 m

/** A quantity in `fromUnit` expressed in `toUnit`, or null when the units
 *  aren't the same measure (only sqm ↔ sqft is converted). */
export function convertQuantity(q: number, fromUnit: string | null, toUnit: string): number | null {
  const a = canonicalUnit(fromUnit), b = canonicalUnit(toUnit);
  if (!a || !b) return null;
  if (a.canonical === b.canonical) return q;
  if (a.canonical === "sqm" && b.canonical === "sqft") return q * SQFT_PER_SQM;
  if (a.canonical === "sqft" && b.canonical === "sqm") return q / SQFT_PER_SQM;
  return null;
}

/** The default tolerance for a unit when the reference line sets none.
 *  Counts must be exact; areas within 1% or 0.05 m² (0.5 ft²), whichever is
 *  larger; lengths and volumes within 1%; anything else exact. */
export function defaultTolerance(unit: string): QuantityTolerance {
  const u = canonicalUnit(unit);
  if (!u || u.family === "count" || u.family === "other") return { abs: 0 };
  if (u.family === "area") return { rel: 0.01, abs: u.canonical === "sqft" ? 0.5 : 0.05 };
  return { rel: 0.01 };
}

/** Allowed absolute difference for a reference quantity. */
export function allowedDifference(line: Pick<ReferenceBoqLine, "quantity" | "unit" | "tolerance">): number {
  const t = line.tolerance ?? defaultTolerance(line.unit);
  return Math.max(t.abs ?? 0, (t.rel ?? 0) * Math.abs(line.quantity ?? 0)) + 1e-9;
}
