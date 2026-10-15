// RATE EVIDENCE — current market-rate sourcing for a BOQ line. Pure model for
// vendor_quotation / boq_line_rate_review
// (supabase/deferred-migrations/20261004000000_boq_line_rate_evidence.sql) plus
// historical rates read from the firm's other BOQs.
//
// Evidence is never pricing: nothing here reads or writes the line's
// dsr_rate/custom_rate. A "preferred candidate" is a recommendation for
// review, snapshotted so later edits to its source can't change it.
//
// Comparison rules (buildRateComparison):
//   • a rate of null is "not available"; 0 is a genuine zero;
//   • a % difference is shown only against a settled DSR reference whose unit
//     matches the line, and only for evidence in the same unit whose scope the
//     estimator has confirmed as matching (vendor spec_match = 'matches');
//   • historical rates are shown but never compared — their specification has
//     not been verified against this line;
//   • tax/freight/installation, validity, quote completeness and historical
//     provenance are surfaced as caveats, never adjusted for.

import { compareUnits, referenceLabel, type DsrMappingRow, type UnitCheck } from "@/lib/dsrMapping";

export type Inclusion = "included" | "excluded" | "not_stated";
export type QuotationStatus = "received" | "incomplete" | "unavailable";
export type SpecMatch = "matches" | "differs" | "unclear";

export interface VendorQuotation {
  id: string;
  boq_id: string;
  boq_line_id: string;
  status: QuotationStatus;
  vendor_name: string;
  vendor_contact: string | null;
  quoted_description: string | null;
  quoted_unit: string | null;
  quoted_rate: number | null;
  spec_match: SpecMatch;
  tax_treatment: Inclusion;
  tax_pct: number | null;
  freight: Inclusion;
  freight_amount: number | null;
  installation: Inclusion;
  installation_amount: number | null;
  other_charges: string | null;
  quotation_date: string | null;
  valid_until: string | null;
  quotation_ref: string | null;
  source_document_id: string | null;
  exclusions: string | null;
  conditions: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at?: string | null;
}

/** A line from another of the firm's BOQs, with the provenance the records actually hold. */
export interface HistoricalLine {
  id: string;
  boq_id: string;
  description: string | null;
  unit: string | null;
  qty: number | null;
  dsr_code: string | null;
  dsr_rate: number | null;
  custom_rate: number | null;
  boq: {
    name: string | null;
    status: string | null;
    rate_year: string | null;
    created_at: string | null;
    updated_at: string | null;
    project: { name: string | null; location: string | null } | null;
  } | null;
}

export type PreferredKind = "dsr_reference" | "vendor_quotation" | "historical_boq";

export interface RateReview {
  id: string;
  boq_line_id: string;
  notes: string | null;
  preferred_kind: PreferredKind | null;
  preferred_quotation_id: string | null;
  preferred_boq_line_id: string | null;
  preferred_rate: number | null;
  preferred_unit: string | null;
  preferred_source_label: string | null;
  preferred_rate_date: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export type EvidenceKind = PreferredKind | "indicative";

export interface EvidenceItem {
  key: string;
  kind: EvidenceKind;
  /** Where the rate comes from, in words. */
  source: string;
  /** Free-form detail (quoted spec, historical description …). */
  detail: string | null;
  date: string | null;
  dateLabel: string;
  unit: string | null;
  rate: number | null;
  unitCheck: UnitCheck;
  /** % vs the DSR reference; null whenever the comparison would mislead. */
  pctVsReference: number | null;
  notComparedReason: string | null;
  caveats: string[];
  /** Ids needed to record this item as the preferred candidate. */
  ref: { quotationId?: string; historicalLineId?: string };
  preferable: boolean;
}

const hasRate = (r: number | null | undefined): r is number => r != null && Number.isFinite(r);

export function historicalRateOf(h: HistoricalLine): { rate: number | null; basis: "firm_rate" | "dsr_carried" | "none" } {
  if (hasRate(h.custom_rate)) return { rate: h.custom_rate, basis: "firm_rate" };
  if (hasRate(h.dsr_rate)) return { rate: h.dsr_rate, basis: "dsr_carried" };
  return { rate: null, basis: "none" };
}

const BOQ_STATUS_CAVEAT: Record<string, string> = {
  draft: "From a draft BOQ — never sent or finalized",
  sent: "BOQ was sent to a client; whether it was executed isn't recorded",
  finalized: "BOQ was finalized; whether it was executed isn't recorded",
};

const INCLUSION_LABEL: Record<Inclusion, string> = { included: "included", excluded: "excluded", not_stated: "not stated" };

export const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

export interface ComparisonInput {
  line: { id: string; unit: string | null; qty: number | null };
  mapping: DsrMappingRow | null;
  /** Indicative amount for the line, when the estimate priced it. */
  indicativeAmount: number | null;
  quotations: VendorQuotation[];
  historical: HistoricalLine[];
  /** YYYY-MM-DD, injected so validity checks are testable. */
  today: string;
}

export interface RateComparison {
  items: EvidenceItem[];
  /** Why no % comparison is possible at all, if so. */
  referenceIssue: string | null;
}

export function buildRateComparison(input: ComparisonInput): RateComparison {
  const { line, mapping, quotations, historical, today } = input;
  const items: EvidenceItem[] = [];

  // ── DSR reference (the mapping snapshot) ──────────────────────────────
  let reference: number | null = null;
  let referenceIssue: string | null = null;
  if (!mapping || mapping.status === "unmatched") {
    referenceIssue = mapping ? "Line is marked as a custom item with no DSR equivalent" : "Line is not mapped to a DSR item";
  } else {
    const unitCheck = compareUnits(line.unit, mapping.dsr_unit);
    const caveats = ["DSR reference basis for taxes/inclusions is not recorded"];
    if (mapping.status === "needs_review") {
      referenceIssue = "DSR mapping still needs review";
      caveats.push("Mapping needs review — tentative candidate only");
    } else if (!hasRate(mapping.dsr_rate) || mapping.dsr_rate <= 0) {
      referenceIssue = "DSR reference has no rate";
    } else if (unitCheck !== "match") {
      referenceIssue = `DSR reference unit (${mapping.dsr_unit ?? "none"}) doesn't match the measured unit (${line.unit ?? "none"})`;
    } else {
      reference = mapping.dsr_rate;
    }
    if (mapping.dsr_code) {
      items.push({
        key: "dsr", kind: "dsr_reference",
        source: [`DSR ${mapping.dsr_code}`, referenceLabel(mapping.dsr_source, mapping.dsr_rate_year)].filter(Boolean).join(" · "),
        detail: mapping.dsr_description, date: null,
        dateLabel: mapping.dsr_rate_year ? `Schedule year ${mapping.dsr_rate_year}` : "Schedule year not recorded",
        unit: mapping.dsr_unit, rate: mapping.dsr_rate, unitCheck,
        pctVsReference: null, notComparedReason: reference != null ? "Comparison baseline" : referenceIssue, caveats, ref: {},
        preferable: mapping.status === "mapped" && hasRate(mapping.dsr_rate),
      });
    }
  }

  // ── Indicative (an amount, not a separate rate) ───────────────────────
  if (input.indicativeAmount != null && mapping?.dsr_code) {
    items.push({
      key: "indicative", kind: "indicative", source: "Indicative estimate (measured qty × DSR reference)",
      detail: null, date: null, dateLabel: "Derived from the DSR reference",
      unit: line.unit, rate: mapping.dsr_rate, unitCheck: "match", pctVsReference: null,
      notComparedReason: "Same rate as the DSR reference",
      caveats: [`Indicative amount ₹${Math.round(input.indicativeAmount).toLocaleString("en-IN")} — not final pricing`],
      ref: {}, preferable: false,
    });
  }

  const pct = (rate: number) => Math.round(((rate - reference!) / reference!) * 1000) / 10;

  // ── Vendor quotations ─────────────────────────────────────────────────
  for (const q of quotations) {
    const unitCheck = compareUnits(line.unit, q.quoted_unit);
    const caveats: string[] = [
      `Tax ${INCLUSION_LABEL[q.tax_treatment]}${q.tax_pct != null ? ` (${q.tax_pct}%)` : ""}`,
      `Freight ${INCLUSION_LABEL[q.freight]}${q.freight_amount != null ? ` (₹${q.freight_amount.toLocaleString("en-IN")})` : ""}`,
      `Installation ${INCLUSION_LABEL[q.installation]}${q.installation_amount != null ? ` (₹${q.installation_amount.toLocaleString("en-IN")})` : ""}`,
    ];
    if (q.status === "incomplete") caveats.push("Quotation incomplete");
    if (q.status === "unavailable") caveats.push("Vendor did not provide a usable quotation");
    if (q.valid_until && q.valid_until < today) caveats.push(`Validity expired ${q.valid_until}`);
    if (!q.quotation_date) caveats.push("Quotation date not recorded");
    if (q.other_charges) caveats.push(`Other charges: ${q.other_charges}`);
    if (q.exclusions) caveats.push(`Exclusions: ${q.exclusions}`);
    if (q.conditions) caveats.push(`Conditions: ${q.conditions}`);

    let reason: string | null = null;
    if (q.status === "unavailable" || !hasRate(q.quoted_rate)) reason = "No rate quoted";
    else if (unitCheck === "mismatch") reason = `Unit differs (${q.quoted_unit} vs ${line.unit})`;
    else if (unitCheck === "unknown") reason = "Unit missing";
    else if (q.spec_match === "differs") reason = "Specification/scope differs from the BOQ line";
    else if (q.spec_match === "unclear") reason = "Specification match not confirmed";
    else if (reference == null) reason = referenceIssue ?? "No comparable DSR reference";

    items.push({
      key: `q:${q.id}`, kind: "vendor_quotation",
      source: `Quotation — ${q.vendor_name}${q.quotation_ref ? ` (${q.quotation_ref})` : ""}`,
      detail: q.quoted_description,
      date: q.quotation_date,
      dateLabel: q.quotation_date ? `Quoted ${q.quotation_date}${q.valid_until ? ` · valid to ${q.valid_until}` : ""}` : "Date not recorded",
      unit: q.quoted_unit, rate: q.status === "unavailable" ? null : q.quoted_rate, unitCheck,
      pctVsReference: reason == null ? pct(q.quoted_rate as number) : null,
      notComparedReason: reason, caveats, ref: { quotationId: q.id },
      preferable: q.status !== "unavailable" && hasRate(q.quoted_rate),
    });
  }

  // ── Historical firm BOQ rates ─────────────────────────────────────────
  for (const h of historical) {
    if (h.id === line.id) continue;
    const { rate, basis } = historicalRateOf(h);
    const unitCheck = compareUnits(line.unit, h.unit);
    const b = h.boq;
    const caveats: string[] = [];
    if (basis === "dsr_carried") caveats.push("DSR rate carried in that BOQ — not the firm's own rate");
    if (b?.status) caveats.push(BOQ_STATUS_CAVEAT[b.status] ?? `BOQ status: ${b.status}`);
    else caveats.push("BOQ status not recorded");
    if (b?.rate_year) caveats.push(`Rate year ${b.rate_year}`);
    caveats.push("No adjustment for inflation, location, taxes or specification");
    const project = b?.project?.name ? `${b.project.name}${b.project.location ? `, ${b.project.location}` : ""}` : "Project not recorded";
    const updated = dayOf(b?.updated_at) ?? dayOf(b?.created_at);
    items.push({
      key: `h:${h.id}`, kind: "historical_boq",
      source: `Firm BOQ — ${b?.name ?? "Unnamed BOQ"} · ${project}`,
      detail: h.description, date: updated,
      dateLabel: updated ? `BOQ last updated ${updated}` : "Date not recorded",
      unit: h.unit, rate, unitCheck, pctVsReference: null,
      notComparedReason: rate == null ? "No rate in that BOQ line" : "Historical — specification not verified against this line",
      caveats, ref: { historicalLineId: h.id },
      preferable: rate != null,
    });
  }

  return { items, referenceIssue };
}

/** The review row's preferred-candidate columns for an evidence item (snapshot). */
export function preferredFromEvidence(item: EvidenceItem) {
  if (!item.preferable || item.kind === "indicative") throw new Error("This evidence can't be a preferred candidate");
  return {
    preferred_kind: item.kind as PreferredKind,
    preferred_quotation_id: item.ref.quotationId ?? null,
    preferred_boq_line_id: item.ref.historicalLineId ?? null,
    preferred_rate: item.rate,
    preferred_unit: item.unit,
    preferred_source_label: item.source,
    preferred_rate_date: item.date,
  };
}

export const NO_PREFERENCE = {
  preferred_kind: null, preferred_quotation_id: null, preferred_boq_line_id: null,
  preferred_rate: null, preferred_unit: null, preferred_source_label: null, preferred_rate_date: null,
} as const;

/** Whether an evidence item is the one recorded as preferred. */
export function isPreferred(item: EvidenceItem, review: RateReview | null): boolean {
  if (!review?.preferred_kind || review.preferred_kind !== item.kind) return false;
  if (item.kind === "vendor_quotation") return review.preferred_quotation_id === item.ref.quotationId;
  if (item.kind === "historical_boq") return review.preferred_boq_line_id === item.ref.historicalLineId;
  return true;
}

// ── Quotation form ─────────────────────────────────────────────────────

export interface QuotationForm {
  status: QuotationStatus;
  vendor_name: string;
  vendor_contact: string;
  quoted_description: string;
  quoted_unit: string;
  quoted_rate: string;
  spec_match: SpecMatch;
  tax_treatment: Inclusion;
  tax_pct: string;
  freight: Inclusion;
  freight_amount: string;
  installation: Inclusion;
  installation_amount: string;
  other_charges: string;
  quotation_date: string;
  valid_until: string;
  quotation_ref: string;
  source_document_id: string;
  exclusions: string;
  conditions: string;
  notes: string;
}

export const EMPTY_QUOTATION_FORM: QuotationForm = {
  status: "received", vendor_name: "", vendor_contact: "", quoted_description: "", quoted_unit: "",
  quoted_rate: "", spec_match: "unclear", tax_treatment: "not_stated", tax_pct: "", freight: "not_stated",
  freight_amount: "", installation: "not_stated", installation_amount: "", other_charges: "",
  quotation_date: "", valid_until: "", quotation_ref: "", source_document_id: "", exclusions: "",
  conditions: "", notes: "",
};

export function formFromQuotation(q: VendorQuotation): QuotationForm {
  const s = (v: string | number | null) => (v == null ? "" : String(v));
  return {
    status: q.status, vendor_name: q.vendor_name, vendor_contact: s(q.vendor_contact),
    quoted_description: s(q.quoted_description), quoted_unit: s(q.quoted_unit), quoted_rate: s(q.quoted_rate),
    spec_match: q.spec_match, tax_treatment: q.tax_treatment, tax_pct: s(q.tax_pct), freight: q.freight,
    freight_amount: s(q.freight_amount), installation: q.installation, installation_amount: s(q.installation_amount),
    other_charges: s(q.other_charges), quotation_date: s(q.quotation_date), valid_until: s(q.valid_until),
    quotation_ref: s(q.quotation_ref), source_document_id: s(q.source_document_id), exclusions: s(q.exclusions),
    conditions: s(q.conditions), notes: s(q.notes),
  };
}

export type QuotationWrite = Omit<VendorQuotation, "id" | "boq_id" | "boq_line_id" | "recorded_by" | "created_at">;

/**
 * Validates the form. Blank fields become null — never a default value. A
 * "received" quote needs a rate and unit (otherwise record it as incomplete);
 * an "unavailable" one may not carry a rate.
 */
export function parseQuotationForm(f: QuotationForm): { ok: true; value: QuotationWrite } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const text = (v: string) => v.trim() || null;
  const num = (v: string, label: string) => {
    const t = v.trim().replace(/,/g, "");
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) { errors.push(`${label} must be a number`); return null; }
    if (n < 0) { errors.push(`${label} can't be negative`); return null; }
    return n;
  };
  const vendor = text(f.vendor_name);
  if (!vendor) errors.push("Vendor name is required");
  const rate = num(f.quoted_rate, "Quoted rate");
  const unit = text(f.quoted_unit);
  if (f.status === "received" && rate == null) errors.push("A received quotation needs a rate — record it as incomplete if the rate is missing");
  if (f.status === "received" && !unit) errors.push("A received quotation needs a unit — record it as incomplete if the unit is missing");
  if (f.status === "unavailable" && rate != null) errors.push("An unavailable quotation can't carry a rate");
  const date = text(f.quotation_date), valid = text(f.valid_until);
  if (date && valid && valid < date) errors.push("Validity date is before the quotation date");
  const value: QuotationWrite = {
    status: f.status, vendor_name: vendor ?? "", vendor_contact: text(f.vendor_contact),
    quoted_description: text(f.quoted_description), quoted_unit: unit, quoted_rate: rate,
    spec_match: f.spec_match, tax_treatment: f.tax_treatment, tax_pct: num(f.tax_pct, "Tax %"),
    freight: f.freight, freight_amount: num(f.freight_amount, "Freight amount"),
    installation: f.installation, installation_amount: num(f.installation_amount, "Installation amount"),
    other_charges: text(f.other_charges), quotation_date: date, valid_until: valid,
    quotation_ref: text(f.quotation_ref), source_document_id: text(f.source_document_id),
    exclusions: text(f.exclusions), conditions: text(f.conditions), notes: text(f.notes),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
