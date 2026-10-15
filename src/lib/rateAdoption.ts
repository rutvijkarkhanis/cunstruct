// RATE ADOPTION — a reviewer explicitly adopting one evidence rate (DSR
// reference, vendor quotation or historical firm BOQ rate) as a BOQ line's
// commercial rate.
//
//   assessAdoption   pure: is this candidate adoptable at all (blockers), and
//                    which caveats must the reviewer explicitly acknowledge?
//   previewAdoption  pure: current vs proposed rate/amount. Writes nothing.
//   applyRateAdoption the ONLY write: one call to the adopt_boq_line_rate
//                    database function, which in a single transaction sets
//                    custom_rate (compare-and-swap on the previewed
//                    custom_rate/dsr_rate/unit, like the Apply boundary), logs
//                    the before/after in boq_line_change_log and inserts the
//                    provenance in boq_line_rate_adoption — all or nothing.
//
// Never written: qty, unit, description, scope, source evidence, dsr_rate.
// Never chosen automatically: there is no "best rate" logic here — the caller
// passes the one candidate the reviewer selected.

import { roundRupee } from "@/lib/boqDsrDocument";
import { compareUnits, type DsrMappingRow } from "@/lib/dsrMapping";
import type { EvidenceItem, HistoricalLine, VendorQuotation } from "@/lib/rateEvidence";
import { rpc } from "@/lib/untypedDb";

/** The commercial fields of a BOQ line as the reviewer saw them. */
export interface CommercialLine {
  id: string;
  description: string | null;
  unit: string | null;
  qty: number | null;
  custom_rate: number | null;
  dsr_rate: number | null;
}

export interface AdoptionSources {
  mapping: DsrMappingRow | null;
  quotation: VendorQuotation | null;
  historical: HistoricalLine | null;
}

export interface AdoptionAssessment {
  adoptable: boolean;
  /** Reasons adoption is refused outright. */
  blockers: string[];
  /** Caveats the reviewer must tick, one by one, before confirming. */
  acknowledgements: string[];
}

const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function assessAdoption(line: CommercialLine, item: EvidenceItem, src: AdoptionSources, today: string): AdoptionAssessment {
  const blockers: string[] = [];
  const acks: string[] = [];

  if (item.kind === "indicative") {
    blockers.push("The indicative estimate is derived from the DSR reference — select the DSR reference itself to adopt that rate.");
    return { adoptable: false, blockers, acknowledgements: [] };
  }
  if (item.rate == null || !Number.isFinite(item.rate) || item.rate < 0) blockers.push("This source has no rate to adopt.");

  const unitCheck = compareUnits(line.unit, item.unit);
  if (unitCheck === "mismatch") {
    blockers.push(`Unit "${item.unit}" is incompatible with the BOQ line's unit "${line.unit}" — rates are never converted.`);
  } else if (unitCheck === "unknown") {
    blockers.push("A unit is missing on the source or the BOQ line, so compatibility can't be verified.");
  }

  if (item.kind === "dsr_reference") {
    const m = src.mapping;
    if (!m || m.status !== "mapped") blockers.push("The DSR mapping must be confirmed (not needs-review) before its rate can be adopted.");
    acks.push(`DSR schedule rate${m?.dsr_rate_year ? ` (${m.dsr_rate_year})` : " (year not recorded)"} is a reference benchmark, not a current market quotation.`);
    acks.push("The DSR reference's tax and inclusion basis is not recorded.");
  }

  if (item.kind === "vendor_quotation") {
    const q = src.quotation;
    if (!q) blockers.push("The quotation record is no longer available.");
    else {
      if (q.status === "unavailable") blockers.push("The vendor did not provide a usable quotation.");
      if (q.status === "incomplete") blockers.push("The quotation is marked incomplete — complete it before adopting its rate.");
      if (q.spec_match === "differs") blockers.push("The quoted specification/scope differs from the BOQ line.");
      if (q.spec_match === "unclear") acks.push("The quoted specification/scope has not been confirmed to match the BOQ line.");
      if (q.valid_until && q.valid_until < today) acks.push(`The quotation's validity expired on ${q.valid_until}.`);
      if (!q.quotation_date) acks.push("The quotation date is not recorded.");
      if (q.tax_treatment === "not_stated") acks.push("The quotation does not state whether tax is included.");
      const unstated = [q.freight === "not_stated" && "freight", q.installation === "not_stated" && "installation"].filter(Boolean);
      if (unstated.length) acks.push(`The quotation does not state whether ${unstated.join(" or ")} is included.`);
      if (q.exclusions) acks.push(`Quotation exclusions: ${q.exclusions}`);
      if (q.conditions) acks.push(`Quotation conditions: ${q.conditions}`);
    }
  }

  if (item.kind === "historical_boq") {
    if (!src.historical) blockers.push("The historical BOQ line is no longer available.");
    acks.push("This is a historical rate from another BOQ, not current market pricing — no adjustment for inflation, location, taxes or specification has been made.");
    acks.push("Its specification has not been verified against this BOQ line.");
    for (const c of item.caveats) {
      if (!/^No adjustment/.test(c)) acks.push(c);
    }
  }

  if (item.rate != null && line.custom_rate != null && line.custom_rate === item.rate) {
    blockers.push("This rate is already the line's commercial rate.");
  }

  return { adoptable: blockers.length === 0, blockers, acknowledgements: blockers.length ? [] : acks };
}

export type RateBasis = "custom" | "dsr" | "none";

export interface AdoptionPreview {
  currentRate: number | null;
  currentBasis: RateBasis;
  currentAmount: number | null;
  proposedRate: number;
  proposedAmount: number | null;
  delta: number | null;
  /** True when the measured quantity is absent/zero, so amounts can't be shown. */
  quantityPending: boolean;
}

export function currentRateOf(line: Pick<CommercialLine, "custom_rate" | "dsr_rate">): { rate: number | null; basis: RateBasis } {
  if (line.custom_rate != null) return { rate: line.custom_rate, basis: "custom" };
  if (line.dsr_rate != null) return { rate: line.dsr_rate, basis: "dsr" };
  return { rate: null, basis: "none" };
}

export function previewAdoption(line: CommercialLine, proposedRate: number): AdoptionPreview {
  const { rate, basis } = currentRateOf(line);
  const quantityPending = !(line.qty != null && line.qty > 0);
  const amount = (r: number | null) => (quantityPending || r == null ? null : roundRupee((line.qty as number) * r));
  const currentAmount = amount(rate);
  const proposedAmount = amount(proposedRate);
  return {
    currentRate: rate, currentBasis: basis, currentAmount, proposedRate, proposedAmount,
    delta: proposedAmount != null ? proposedAmount - (currentAmount ?? 0) : null, quantityPending,
  };
}

export const BASIS_LABEL: Record<RateBasis, string> = {
  custom: "your rate (override)", dsr: "DSR rate on the line", none: "no rate",
};

export function confirmationText(line: CommercialLine, item: EvidenceItem): string {
  const prev = currentRateOf(line);
  return `Adopt ${fmt(item.rate as number)}${item.unit ? ` / ${item.unit}` : ""} from ${item.source} as the commercial rate for `
    + `"${line.description ?? "Untitled line"}" (was ${prev.rate != null ? fmt(prev.rate) : "no rate"}, ${BASIS_LABEL[prev.basis]}).`;
}

export type AdoptionResult =
  | { status: "applied" }
  | { status: "conflict"; message: string };

/**
 * The confirmed write. Refuses (throws) unless the candidate is adoptable and
 * every acknowledgement was ticked. Returns "conflict" — with no write — when
 * the line's rate or unit changed since the preview. Any database error means
 * nothing was written (the function is one transaction).
 */
export async function applyRateAdoption(args: {
  boqId: string;
  line: CommercialLine;
  item: EvidenceItem;
  sources: AdoptionSources;
  acknowledged: string[];
  confirmedBy: string;
  today: string;
}): Promise<AdoptionResult> {
  const { line, item, sources } = args;
  const assessment = assessAdoption(line, item, sources, args.today);
  if (!assessment.adoptable) throw new Error(`Adoption blocked: ${assessment.blockers.join(" ")}`);
  const missing = assessment.acknowledgements.filter((a) => !args.acknowledged.includes(a));
  if (missing.length) throw new Error("Every caveat must be acknowledged before adopting this rate.");

  const rate = item.rate as number;
  const prev = currentRateOf(line);
  // One database call, one transaction (adopt_boq_line_rate): the guarded rate
  // change, its change-log row and this provenance record are written together
  // or not at all. The reviewer identity is taken from the session server-side.
  const { data, error } = await rpc("adopt_boq_line_rate", {
    p_line_id: line.id,
    p_rate: rate,
    p_expected: { custom_rate: line.custom_rate, dsr_rate: line.dsr_rate, unit: line.unit },
    p_record: {
      previous_rate: prev.rate, previous_basis: prev.basis,
      source_kind: item.kind,
      source_quotation_id: item.ref.quotationId ?? null,
      source_boq_line_id: item.ref.historicalLineId ?? null,
      source_dsr_item_id: item.kind === "dsr_reference" ? sources.mapping?.dsr_item_id ?? null : null,
      source_label: item.source, source_unit: item.unit, source_date: item.date,
      source_snapshot: {
        item,
        quotation: item.kind === "vendor_quotation" ? sources.quotation : null,
        historical: item.kind === "historical_boq" ? sources.historical : null,
        mapping: item.kind === "dsr_reference" ? sources.mapping : null,
      },
      line_unit: line.unit, line_qty: line.qty,
      acknowledged_caveats: assessment.acknowledgements,
      confirmation_text: confirmationText(line, item),
    },
  });
  if (error) throw new Error(`Rate adoption failed — nothing was changed: ${error.message}`);
  if (data === "conflict") {
    return { status: "conflict", message: "The line's rate or unit changed since this preview — nothing was written. Review it again." };
  }
  if (data !== "applied") throw new Error(`Rate adoption returned an unexpected result (${String(data)}) — check the line.`);
  return { status: "applied" };
}
