// MEASURED QUANTITIES — floor areas computed only from reconciled,
// sufficiently evidenced room dimensions, with full provenance.
//
// Input: spaces from roomDimensionReconciliation.ts. Output: one record per
// space, either
//   ready   — dimension matched with high confidence, both lengths carry
//             printed units the validator supports; area recomputed by
//             measurementValidator.computeCalculation (LENGTH_TIMES_WIDTH);
//   pending — anything less, with the reason. quantity is null, never 0.
//
// These are DRAFTS for the existing review workflow, not BOQ lines:
// toAnalysisPayload() emits ordinary `cunstruct.analysis.v1` items (status
// MEASURED / PENDING, source evidence, calculation_data), which go through
// the same import → review → explicit Apply path as any other analysis. This
// module never writes anything and never touches rates, descriptions or
// existing BOQ quantities. Pure and deterministic.

import { computeCalculation, type CalculationInput } from "./measurementValidator";
import { labelKey, type Box, type DimensionPair, type Length, type UnitBasis } from "./drawingInventory";
import type { ReconciledRoom } from "./roomDimensionReconciliation";

export type AreaUnit = "sqm" | "sqft";
const SQM_PER_SQFT = 0.09290304; // exact: 0.3048² m² per ft²

export interface QuantityProvenance {
  documentId: string;
  page: number;
  floor: string | null;
  source: "drawing_text";
  label: { candidateId: string; text: string; box: Box };
  dimension: { candidateId: string; text: string; box: Box } | null;
  reconciliation: { status: ReconciledRoom["status"]; confidence?: "high" | "medium"; reason: string };
}

export interface MeasuredQuantity {
  key: string;
  description: string;
  status: "ready" | "pending";
  pendingReason?: string;
  /** Rounded per `rounding`. null whenever status is pending — never 0. */
  quantity: number | null;
  unit: AreaUnit;
  unroundedQuantity: number | null;
  calculation: {
    formula: "LENGTH_TIMES_WIDTH";
    inputs: CalculationInput[];
    method: string;
    conversion: string;
    rounding: string;
    deductions: string;
  };
  provenance: QuantityProvenance;
  reviewStatus: "unreviewed";
}

const VALIDATOR_UNITS = new Set(["in", "m", "mm"]);
const DEDUCTIONS = "None applied: gross floor area from the room's printed size; openings, columns and wall thickness are not deducted.";

function unitProblem(lengths: Length[], basis?: UnitBasis): string | null {
  if (lengths.some((l) => l.unit === null)) {
    return `Units not established: ${basis?.kind === "unresolved" ? basis.reason : "no unit for this size."}`;
  }
  const unstated = lengths.find((l) => l.unitStated === false);
  if (unstated) return `No unit is printed for "${unstated.text}"; it is not assumed.`;
  const unsupported = lengths.find((l) => !VALIDATOR_UNITS.has(l.unit!));
  if (unsupported) return `Unit "${unsupported.unit}" is not supported for area calculation.`;
  return null;
}

// A room side outside this range is not a plausible room: the printed unit is
// almost certainly wrong (e.g. "7000M X 7000M" on a sheet whose note says all
// dimensions are in millimetres). It is a review trigger, never a rejection of
// a real small or large space: the size stays visible and pending with the
// reason, and nothing is substituted for it.
const ROOM_SIDE_M = { min: 0.3, max: 150 };
const METRES: Record<string, number> = { in: 0.0254, mm: 0.001, m: 1, cm: 0.01 };
const fmtM = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Why a printed size can't be a room's size, with what the page's own unit
 *  note would make of it; null when it is plausible. */
function implausibleSize(dim: DimensionPair, text: string): string | null {
  const sides = [dim.first, dim.second].map((l) => l.value * METRES[l.unit!]);
  if (sides.every((m) => m >= ROOM_SIDE_M.min && m <= ROOM_SIDE_M.max)) return null;
  const read = `"${text}" reads as ${sides.map(fmtM).join(" m × ")} m, which is not a plausible room size`;
  const note = dim.pageNote;
  if (note && note.unit in METRES && [dim.first, dim.second].some((l) => l.unit !== note.unit)) {
    const alt = [dim.first, dim.second].map((l) => l.value * METRES[note.unit]);
    if (alt.every((m) => m >= ROOM_SIDE_M.min && m <= ROOM_SIDE_M.max)) {
      return `${read}. This page's note ("${note.text}") states ${note.unit}, which would give ${alt.map(fmtM).join(" m × ")} m (${fmtM(alt[0] * alt[1])} m²). The printed unit contradicts the note: confirm the unit before this area is used.`;
    }
  }
  return `${read}. Check the printed unit before this area is used.`;
}

const roundHalfUp = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round((v + Number.EPSILON) * f) / f;
};

export function measuredQuantitiesFor(
  rooms: ReconciledRoom[],
  opts: { unit?: AreaUnit; decimals?: number } = {},
): MeasuredQuantity[] {
  const unit = opts.unit ?? "sqm";
  const decimals = opts.decimals ?? 2;
  return rooms.map((room) => {
    const [cx, cy] = [(room.box[0] + room.box[2]) / 2, (room.box[1] + room.box[3]) / 2];
    const key = `${room.documentId}:p${room.page}:${labelKey(room.label)}@${Math.round(cx)},${Math.round(cy)}`;
    const where = room.floor ?? `page ${room.page}`;
    const provenance: QuantityProvenance = {
      documentId: room.documentId, page: room.page, floor: room.floor, source: "drawing_text",
      label: { candidateId: room.candidateId, text: room.label, box: room.box },
      dimension: room.dimension ? { candidateId: room.dimension.candidateId, text: room.dimension.text, box: room.dimension.box } : null,
      reconciliation: { status: room.status, confidence: room.confidence, reason: room.reason },
    };
    const lengths = room.dimension ? [room.dimension.dimension.first, room.dimension.dimension.second] : [];
    const inputs: CalculationInput[] = lengths.map((l, i) => ({
      name: i === 0 ? "length" : "width", value: l.value, unit: l.unit ?? "unresolved",
      evidence: [{ bbox: room.dimension!.box, page: room.page }],
    }));
    const base = {
      key, description: `Floor area — ${room.label} (${where})`, unit,
      calculation: {
        formula: "LENGTH_TIMES_WIDTH" as const, inputs,
        method: room.dimension ? `${room.dimension.text} as printed beneath "${room.label}": length × width.` : "No printed room size to multiply.",
        conversion: unit === "sqm" ? "Lengths converted to metres (1 in = 0.0254 m) before multiplying." : "Computed in m², then converted at 1 ft² = 0.09290304 m² (exact).",
        rounding: `Rounded half-up to ${decimals} decimal places; the unrounded value is kept.`,
        deductions: DEDUCTIONS,
      },
      provenance, reviewStatus: "unreviewed" as const,
    };
    const pending = (reason: string): MeasuredQuantity => ({ ...base, status: "pending", pendingReason: reason, quantity: null, unroundedQuantity: null });

    if (room.status !== "dimensioned") return pending(room.reason);
    if (room.derivedSheet) {
      return pending(`This page is a ${room.derivedSheet.discipline.toLowerCase()} drawing ("${room.derivedSheet.text}") that repeats the floor plan's rooms. Floor area is measured from the architectural plan, so it is not counted again here.`);
    }
    if (room.confidence !== "high") return pending(`The dimension match is only ${room.confidence ?? "low"} confidence; confirm it first.`);
    const problem = unitProblem(lengths, room.dimension!.dimension.unitBasis);
    if (problem) return pending(problem);
    const implausible = implausibleSize(room.dimension!.dimension, room.dimension!.text);
    if (implausible) return pending(implausible);
    const result = computeCalculation({ formula: "LENGTH_TIMES_WIDTH", inputs });
    if (!result.recomputed || result.resultValue == null) return pending(result.reason ?? "The area could not be computed from these inputs.");
    const unrounded = unit === "sqm" ? result.resultValue : result.resultValue / SQM_PER_SQFT;
    return { ...base, status: "ready", quantity: roundHalfUp(unrounded, decimals), unroundedQuantity: unrounded };
  });
}

/** Ordinary `cunstruct.analysis.v1` JSON for the existing review import:
 *  provenance travels as the item's source evidence, calculation_data and notes. */
export function toAnalysisPayload(quantities: MeasuredQuantity[]): { schema_version: string; items: Record<string, unknown>[] } {
  return {
    schema_version: "cunstruct.analysis.v1",
    items: quantities.map((q) => {
      const p = q.provenance;
      const evidence = [{ bbox: p.label.box, page: p.page, claim: "location", label: p.label.text }];
      if (p.dimension) evidence.push({ bbox: p.dimension.box, page: p.page, claim: "dimension", label: p.dimension.text });
      return {
        key: q.key,
        item: q.description,
        description: q.description,
        quantity: q.quantity,
        unit: q.unit,
        dimension: p.dimension?.text ?? null,
        location: p.floor ?? `Page ${p.page}`,
        source: { document_id: p.documentId, page: p.page, evidence },
        confidence: null,
        status: q.status === "ready" ? "MEASURED" : "PENDING",
        calculation: q.status === "ready" ? `${q.calculation.method} ${q.calculation.conversion} ${q.calculation.rounding} ${q.calculation.deductions}` : null,
        calculation_data: q.status === "ready" ? { formula: q.calculation.formula, inputs: q.calculation.inputs.map(({ name, value, unit }) => ({ name, value, unit })) } : null,
        notes: q.status === "ready"
          ? `From drawing text: "${p.label.text}" with "${p.dimension!.text}" (${p.reconciliation.reason}) Unrounded ${q.unroundedQuantity} ${q.unit}.`
          : `Pending: ${q.pendingReason}`,
        candidates: [],
      };
    }),
  };
}
