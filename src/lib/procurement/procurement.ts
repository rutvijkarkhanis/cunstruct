/**
 * Procurement from the BOQ (plan B11 — OWNER-ONLY ENGINEERING PREVIEW LANE).
 *
 * Pure functions, no database, no network:
 *   1. requirementsFromBoq — certified BOQ lines × material coefficients →
 *      material requirement per material. Only lines that are certified (or
 *      verified) AND carry an established, non-zero quantity are procurable.
 *      Everything else is listed as "not procurable yet" with a reason and
 *      carries NO quantity and NO amount (never invent a quantity).
 *   2. phaseCallOffs — spreads each line's material evenly over its work
 *      package's weeks and groups the result into weekly call-offs addressed to
 *      the contractor's own dealer.
 *   3. reconcileIssues — material issued vs theoretical consumption (work done
 *      × coefficient), flagging over/under-issue beyond a tolerance.
 *
 * Coefficients carry their provenance; a requirement that uses any
 * illustrative-fixture coefficient is marked `illustrative: true` so the UI
 * can label it. This is a preview: it does not satisfy B11's commercial
 * acceptance (tests + pilot use).
 */

export type CertificationState = "certified" | "verified" | "needs_review" | "returned" | "draft";
export type ProcurementQuantityState = "established" | "confirmed_zero" | "pending";

export interface ProcurementBoqLine {
  id: string;
  dsrCode: string | null;
  description: string;
  /** Unit of the BOQ item (e.g. "cum", "kg"). */
  unit: string;
  /** Quantity in `unit`; meaningful only when quantityState is "established". */
  quantity: number | null;
  quantityState: ProcurementQuantityState;
  certification: CertificationState;
  workPackageId: string | null;
}

/** Where a coefficient came from. */
export type CoefficientSource =
  | {
      kind: "repo_seed";
      /** Dataset label as recorded in the repository seed. */
      dataset: string;
      /** Repository file holding the transcribed row. */
      file: string;
      /** 1-based line number(s) of the row(s) in that file. */
      lines: number[];
      /** The seed transcription has not been checked against the published DAR. */
      verified: false;
      note: string;
    }
  | { kind: "illustrative_fixture"; note: string };

export interface MaterialCoefficient {
  /** DSR item code the coefficient belongs to. */
  itemCode: string;
  /** Stable key used to aggregate the same material across items. */
  materialKey: string;
  material: string;
  /** Material consumed per ONE unit of the item, in `materialUnit`. */
  perItemUnit: number;
  /** The item unit the coefficient is expressed against; must equal the BOQ line's unit. */
  itemUnit: string;
  materialUnit: string;
  source: CoefficientSource;
}

export type NotProcurableReason =
  | "not_certified"
  | "quantity_pending"
  | "invalid_quantity"
  | "confirmed_zero"
  | "no_dsr_code"
  | "no_coefficients"
  | "unit_mismatch";

export interface NotProcurableLine {
  lineId: string;
  description: string;
  reasonCode: NotProcurableReason;
  reason: string;
  /** Always null: a line that is not procurable carries no requirement and no amount. */
  quantity: null;
  amount: null;
}

export interface LineMaterialNeed {
  lineId: string;
  workPackageId: string | null;
  materialKey: string;
  material: string;
  unit: string;
  quantity: number;
  source: CoefficientSource;
}

export interface MaterialRequirement {
  materialKey: string;
  material: string;
  unit: string;
  quantity: number;
  /** True when any contribution uses an illustrative-fixture coefficient. */
  illustrative: boolean;
  contributions: LineMaterialNeed[];
}

export interface RequirementsResult {
  procurableLineIds: string[];
  needs: LineMaterialNeed[];
  materials: MaterialRequirement[];
  notProcurable: NotProcurableLine[];
}

export const QTY_DECIMALS = 3;

/** Round half away from zero to `decimals` places. */
export function roundQty(x: number, decimals = QTY_DECIMALS): number {
  const f = 10 ** decimals;
  const r = Math.round(Math.abs(x) * f * (1 + Number.EPSILON * 4)) / f;
  return x < 0 ? -r : r;
}

const PROCURABLE_STATES: ReadonlySet<CertificationState> = new Set(["certified", "verified"]);

const REASON_TEXT: Record<NotProcurableReason, string> = {
  not_certified: "Line is not certified yet; nothing is ordered against an unreviewed quantity.",
  quantity_pending: "Quantity is pending; no requirement or amount can be derived.",
  invalid_quantity: "Quantity is missing or not a positive number although marked established.",
  confirmed_zero: "Quantity is a confirmed zero; there is nothing to procure.",
  no_dsr_code: "No DSR item code, so no coefficients can be looked up.",
  no_coefficients: "No material coefficients are held for this item code.",
  unit_mismatch: "The BOQ unit differs from the unit the coefficients are expressed in; not converted silently.",
};

function exclude(line: ProcurementBoqLine, reasonCode: NotProcurableReason): NotProcurableLine {
  return { lineId: line.id, description: line.description, reasonCode, reason: REASON_TEXT[reasonCode], quantity: null, amount: null };
}

/** Certified BOQ lines × coefficients → material requirement per material. */
export function requirementsFromBoq(lines: ProcurementBoqLine[], coefficients: MaterialCoefficient[]): RequirementsResult {
  const byCode = new Map<string, MaterialCoefficient[]>();
  for (const c of coefficients) byCode.set(c.itemCode, [...(byCode.get(c.itemCode) ?? []), c]);

  const notProcurable: NotProcurableLine[] = [];
  const needs: LineMaterialNeed[] = [];
  const procurableLineIds: string[] = [];

  for (const line of lines) {
    if (!PROCURABLE_STATES.has(line.certification)) { notProcurable.push(exclude(line, "not_certified")); continue; }
    if (line.quantityState === "pending") { notProcurable.push(exclude(line, "quantity_pending")); continue; }
    if (line.quantityState === "confirmed_zero") { notProcurable.push(exclude(line, "confirmed_zero")); continue; }
    if (line.quantity == null || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      notProcurable.push(exclude(line, "invalid_quantity"));
      continue;
    }
    if (!line.dsrCode) { notProcurable.push(exclude(line, "no_dsr_code")); continue; }
    const coeffs = byCode.get(line.dsrCode) ?? [];
    if (coeffs.length === 0) { notProcurable.push(exclude(line, "no_coefficients")); continue; }
    if (coeffs.some((c) => c.itemUnit !== line.unit)) { notProcurable.push(exclude(line, "unit_mismatch")); continue; }

    procurableLineIds.push(line.id);
    for (const c of coeffs) {
      needs.push({
        lineId: line.id,
        workPackageId: line.workPackageId,
        materialKey: c.materialKey,
        material: c.material,
        unit: c.materialUnit,
        quantity: roundQty(line.quantity * c.perItemUnit),
        source: c.source,
      });
    }
  }

  const agg = new Map<string, MaterialRequirement>();
  for (const n of needs) {
    const key = `${n.materialKey}|${n.unit}`;
    const row = agg.get(key);
    if (row) {
      row.quantity += n.quantity;
      row.illustrative ||= n.source.kind === "illustrative_fixture";
      row.contributions.push(n);
    } else {
      agg.set(key, {
        materialKey: n.materialKey,
        material: n.material,
        unit: n.unit,
        quantity: n.quantity,
        illustrative: n.source.kind === "illustrative_fixture",
        contributions: [n],
      });
    }
  }
  const materials = [...agg.values()]
    .map((m) => ({ ...m, quantity: roundQty(m.quantity) }))
    .sort((a, b) => a.materialKey.localeCompare(b.materialKey) || a.unit.localeCompare(b.unit));

  return { procurableLineIds, needs, materials, notProcurable };
}

// ── Time-phasing into call-offs ─────────────────────────────────────────────

export interface WorkPackage {
  id: string;
  name: string;
  /** Inclusive start and end week numbers (week 1 = first week of the schedule). */
  startWeek: number;
  endWeek: number;
}

export interface Dealer {
  id: string;
  name: string;
  /** B11: call-offs go to the contractor's OWN dealer (or a linked supplier). */
  relationship: "contractor_own_dealer" | "linked_supplier";
  illustrative: boolean;
}

export interface CallOffItem {
  materialKey: string;
  material: string;
  unit: string;
  quantity: number;
  lineIds: string[];
  illustrative: boolean;
}

export interface CallOff {
  id: string;
  /** Week the material is needed on site (work week). */
  needWeek: number;
  /** Week the call-off must be placed with the dealer (needWeek − lead time). */
  placeByWeek: number;
  dealer: Dealer;
  items: CallOffItem[];
}

export interface UnscheduledNeed {
  lineId: string;
  reason: "no_work_package" | "unknown_work_package" | "invalid_schedule";
}

export interface PhasingResult {
  callOffs: CallOff[];
  unscheduled: UnscheduledNeed[];
}

/**
 * Spread each line's material need evenly over its work package's weeks
 * (rounded to QTY_DECIMALS; the last week takes the remainder so each line's
 * phased total equals its requirement exactly), then group into one call-off
 * per need week, addressed to the given dealer.
 */
export function phaseCallOffs(
  needs: LineMaterialNeed[],
  schedule: WorkPackage[],
  dealer: Dealer,
  leadWeeks: number,
): PhasingResult {
  const wpById = new Map(schedule.map((w) => [w.id, w]));
  const unscheduled = new Map<string, UnscheduledNeed>();
  // needWeek → (materialKey|unit) → item
  const weeks = new Map<number, Map<string, CallOffItem>>();

  for (const n of needs) {
    if (!n.workPackageId) { unscheduled.set(n.lineId, { lineId: n.lineId, reason: "no_work_package" }); continue; }
    const wp = wpById.get(n.workPackageId);
    if (!wp) { unscheduled.set(n.lineId, { lineId: n.lineId, reason: "unknown_work_package" }); continue; }
    if (!Number.isInteger(wp.startWeek) || !Number.isInteger(wp.endWeek) || wp.endWeek < wp.startWeek) {
      unscheduled.set(n.lineId, { lineId: n.lineId, reason: "invalid_schedule" });
      continue;
    }
    const span = wp.endWeek - wp.startWeek + 1;
    const per = roundQty(n.quantity / span);
    let allocated = 0;
    for (let w = wp.startWeek; w <= wp.endWeek; w++) {
      const q = w === wp.endWeek ? roundQty(n.quantity - allocated) : per;
      allocated = roundQty(allocated + q);
      if (q <= 0) continue;
      const bucket = weeks.get(w) ?? new Map<string, CallOffItem>();
      weeks.set(w, bucket);
      const key = `${n.materialKey}|${n.unit}`;
      const item = bucket.get(key);
      const illustrative = n.source.kind === "illustrative_fixture";
      if (item) {
        item.quantity = roundQty(item.quantity + q);
        if (!item.lineIds.includes(n.lineId)) item.lineIds.push(n.lineId);
        item.illustrative ||= illustrative;
      } else {
        bucket.set(key, { materialKey: n.materialKey, material: n.material, unit: n.unit, quantity: q, lineIds: [n.lineId], illustrative });
      }
    }
  }

  const callOffs: CallOff[] = [...weeks.keys()]
    .sort((a, b) => a - b)
    .map((w) => ({
      id: `CO-W${w}`,
      needWeek: w,
      placeByWeek: w - leadWeeks,
      dealer,
      items: [...weeks.get(w)!.values()].sort((a, b) => a.materialKey.localeCompare(b.materialKey)),
    }));
  return { callOffs, unscheduled: [...unscheduled.values()] };
}

// ── Reconciliation: issued vs work done ─────────────────────────────────────

export interface WorkDone {
  lineId: string;
  /** Quantity of the BOQ item completed, in the line's unit. */
  quantityDone: number;
}

export interface MaterialIssue {
  materialKey: string;
  unit: string;
  quantity: number;
}

export type ReconcileStatus = "within_tolerance" | "over_issue" | "under_issue" | "unmatched_issue";

export interface ReconcileRow {
  materialKey: string;
  material: string;
  unit: string;
  theoretical: number;
  issued: number;
  variance: number;
  /** Variance as % of theoretical; null when theoretical is zero. */
  variancePct: number | null;
  status: ReconcileStatus;
  illustrative: boolean;
}

export interface ReconcileWarning {
  lineId: string;
  code: "work_on_non_procurable_line" | "work_exceeds_certified" | "invalid_work_done";
  message: string;
}

export interface ReconcileResult {
  rows: ReconcileRow[];
  warnings: ReconcileWarning[];
}

/**
 * Theoretical consumption = Σ work done × coefficient (over procurable lines
 * only). Each material's issued quantity is compared with it; beyond
 * ±tolerancePct it is flagged as over- or under-issue. Material issued with no
 * theoretical counterpart is "unmatched_issue".
 */
export function reconcileIssues(
  lines: ProcurementBoqLine[],
  coefficients: MaterialCoefficient[],
  workDone: WorkDone[],
  issued: MaterialIssue[],
  tolerancePct: number,
): ReconcileResult {
  const { procurableLineIds } = requirementsFromBoq(lines, coefficients);
  const procurable = new Set(procurableLineIds);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const warnings: ReconcileWarning[] = [];
  const theo = new Map<string, { material: string; unit: string; qty: number; illustrative: boolean }>();

  for (const w of workDone) {
    const line = lineById.get(w.lineId);
    if (!line || !procurable.has(w.lineId)) {
      warnings.push({ lineId: w.lineId, code: "work_on_non_procurable_line", message: "Work recorded against a line that is not procurable; excluded from reconciliation." });
      continue;
    }
    if (!Number.isFinite(w.quantityDone) || w.quantityDone < 0) {
      warnings.push({ lineId: w.lineId, code: "invalid_work_done", message: "Work done is not a non-negative number; excluded." });
      continue;
    }
    if (line.quantity != null && w.quantityDone > line.quantity) {
      warnings.push({ lineId: w.lineId, code: "work_exceeds_certified", message: "Work done exceeds the certified quantity." });
    }
    for (const c of coefficients.filter((c) => c.itemCode === line.dsrCode)) {
      const key = `${c.materialKey}|${c.materialUnit}`;
      const row = theo.get(key) ?? { material: c.material, unit: c.materialUnit, qty: 0, illustrative: false };
      row.qty += w.quantityDone * c.perItemUnit;
      row.illustrative ||= c.source.kind === "illustrative_fixture";
      theo.set(key, row);
    }
  }

  const issuedByKey = new Map<string, number>();
  for (const i of issued) {
    const key = `${i.materialKey}|${i.unit}`;
    issuedByKey.set(key, (issuedByKey.get(key) ?? 0) + i.quantity);
  }

  const keys = new Set([...theo.keys(), ...issuedByKey.keys()]);
  const rows: ReconcileRow[] = [...keys].sort().map((key) => {
    const [materialKey, unit] = key.split("|");
    const t = theo.get(key);
    const theoretical = roundQty(t?.qty ?? 0);
    const iss = roundQty(issuedByKey.get(key) ?? 0);
    const variance = roundQty(iss - theoretical);
    const variancePct = theoretical > 0 ? Math.round((variance / theoretical) * 1000) / 10 : null;
    let status: ReconcileStatus;
    if (!t) status = "unmatched_issue";
    else if (theoretical === 0) status = iss > 0 ? "over_issue" : "within_tolerance";
    else if (variancePct! > tolerancePct) status = "over_issue";
    else if (variancePct! < -tolerancePct) status = "under_issue";
    else status = "within_tolerance";
    return { materialKey, material: t?.material ?? materialKey, unit, theoretical, issued: iss, variance, variancePct, status, illustrative: t?.illustrative ?? false };
  });

  return { rows, warnings };
}
