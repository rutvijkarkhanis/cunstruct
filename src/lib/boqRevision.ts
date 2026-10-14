// COMMERCIAL BOQ REVISIONS — pure model for boq_commercial_revision(_line)
// (supabase/deferred-migrations/20261006000000_boq_commercial_revision.sql).
//
// One line model, two uses:
//   • buildRevisionLines turns the working BOQ (as OpsBoqBuilder groups and
//     numbers it) into snapshot lines — rate, basis, amount, source document,
//     adopted-rate provenance and per-line limitations;
//   • quoteSubheadsFrom / csvRowsFrom turn snapshot lines into the PDF quote
//     and CSV rows. The live export uses these SAME functions on freshly built
//     lines, and a revision export uses them on its saved lines — so a revision
//     exports exactly what the live export would have produced when it was
//     frozen, and never reads the working BOQ again.

import { roundRupee, type CsvRow, type DsrQuotePayload, type QuoteCommercials, type QuotePendingItem, type QuoteSubHead } from "@/lib/boqDsrDocument";

export type RateBasis = "custom" | "dsr" | "none";
export type RateProvenance = "adopted" | "manual_override" | "dsr_on_line" | "none";

/** The working-line fields a revision copies. */
export interface WorkingLine {
  id: string;
  section: string | null;
  dsr_code: string | null;
  description: string | null;
  unit: string | null;
  qty: number;
  dsr_rate: number | null;
  custom_rate: number | null;
  included: boolean;
  quantity_status?: string | null;
  scope_id?: string | null;
  external_key?: string | null;
}

export interface WorkingSubhead {
  no: number;
  name: string;
  rows: {
    line: WorkingLine;
    no: string;
    source: { sourceDocument: string | null; sourcePage: string | null; sourceDocumentId?: string | null };
  }[];
}

/** A boq_line_rate_adoption record (only the fields copied into a revision). */
export interface AdoptionRef {
  id: string;
  boq_line_id: string | null;
  adopted_rate: number;
  source_kind: string;
  source_label: string;
  source_unit: string | null;
  source_date: string | null;
  confirmed_by: string;
  confirmed_at: string;
}

export interface RevisionLine {
  source_line_id: string | null;
  position: number;
  subhead_no: number;
  subhead_name: string;
  item_no: string;
  section: string | null;
  dsr_code: string | null;
  description: string | null;
  unit: string | null;
  qty: number | null;
  quantity_status: string | null;
  included: boolean;
  scope_id: string | null;
  external_key: string | null;
  rate: number | null;
  rate_basis: RateBasis;
  rate_provenance: RateProvenance;
  dsr_rate: number | null;
  custom_rate: number | null;
  amount: number | null;
  source_document_id: string | null;
  source_document_name: string | null;
  source_page: string | null;
  adoption_id: string | null;
  adoption_source_kind: string | null;
  adoption_source_label: string | null;
  adoption_source_unit: string | null;
  adoption_source_date: string | null;
  adoption_confirmed_by: string | null;
  adoption_confirmed_at: string | null;
  limitations: string[];
}

/** Statuses that record a quantity a person or a measurement established. */
const ESTABLISHED_QTY_STATUSES = new Set(["MEASURED", "COUNTED"]);

/**
 * True when a line has no established quantity — the single rule every total,
 * revision and export uses:
 *   - quantity_status PENDING is pending whatever number is stored (a number
 *     typed into a pending line is not a confirmation by itself);
 *   - no usable number is pending;
 *   - a positive quantity is established;
 *   - zero is a confirmed "none required" only when explicitly MEASURED or
 *     COUNTED (e.g. a reviewer verified 0); any other zero is pending, because
 *     boq_line.qty is NOT NULL and stores 0 for "not yet measured".
 */
export const qtyPending = (l: { qty: number | null; quantity_status?: string | null }): boolean => {
  const status = String(l.quantity_status ?? "").toUpperCase();
  if (status === "PENDING") return true;
  if (l.qty == null || !Number.isFinite(l.qty)) return true;
  if (l.qty > 0) return false;
  return !(l.qty === 0 && ESTABLISHED_QTY_STATUSES.has(status));
};

export const LINE_LIMITATION = {
  excluded: "Excluded from the BOQ",
  noRate: "No rate",
  qtyPending: "Quantity pending",
  manual: "Rate entered manually — no matching adoption record",
} as const;

/**
 * Snapshot lines from the working BOQ. `adoptions` should be the BOQ's adoption
 * records; a line's latest record counts as its provenance only when its
 * adopted rate is still the line's custom_rate (otherwise the rate was edited
 * after adoption and is reported as a manual override).
 */
export function buildRevisionLines(subheads: WorkingSubhead[], adoptions: AdoptionRef[] = []): RevisionLine[] {
  const latest = new Map<string, AdoptionRef>();
  for (const a of [...adoptions].sort((x, y) => y.confirmed_at.localeCompare(x.confirmed_at))) {
    if (a.boq_line_id && !latest.has(a.boq_line_id)) latest.set(a.boq_line_id, a);
  }
  let position = 0;
  return subheads.flatMap((sh) => sh.rows.map(({ line: l, no, source }) => {
    const basis: RateBasis = l.custom_rate != null ? "custom" : l.dsr_rate != null ? "dsr" : "none";
    const rate = l.custom_rate ?? l.dsr_rate;
    const adoption = basis === "custom" ? latest.get(l.id) : undefined;
    const adopted = adoption && adoption.adopted_rate === l.custom_rate ? adoption : null;
    const provenance: RateProvenance =
      basis === "custom" ? (adopted ? "adopted" : "manual_override") : basis === "dsr" ? "dsr_on_line" : "none";
    const priced = l.included && rate != null && !qtyPending(l);
    const limitations: string[] = [];
    if (!l.included) limitations.push(LINE_LIMITATION.excluded);
    else {
      if (rate == null) limitations.push(LINE_LIMITATION.noRate);
      if (qtyPending(l)) limitations.push(LINE_LIMITATION.qtyPending);
    }
    if (provenance === "manual_override") limitations.push(LINE_LIMITATION.manual);
    return {
      source_line_id: l.id, position: ++position, subhead_no: sh.no, subhead_name: sh.name, item_no: no,
      section: l.section, dsr_code: l.dsr_code, description: l.description, unit: l.unit, qty: l.qty,
      quantity_status: l.quantity_status ?? null, included: l.included, scope_id: l.scope_id ?? null,
      external_key: l.external_key ?? null, rate, rate_basis: basis, rate_provenance: provenance,
      dsr_rate: l.dsr_rate, custom_rate: l.custom_rate,
      amount: priced ? roundRupee(l.qty * (rate as number)) : null,
      source_document_id: source.sourceDocumentId ?? null, source_document_name: source.sourceDocument,
      source_page: source.sourcePage,
      adoption_id: adopted?.id ?? null, adoption_source_kind: adopted?.source_kind ?? null,
      adoption_source_label: adopted?.source_label ?? null, adoption_source_unit: adopted?.source_unit ?? null,
      adoption_source_date: adopted?.source_date ?? null, adoption_confirmed_by: adopted?.confirmed_by ?? null,
      adoption_confirmed_at: adopted?.confirmed_at ?? null, limitations,
    };
  }));
}

/** Group snapshot lines back into ordered sub-heads. */
function groupBySubhead(lines: RevisionLine[]) {
  const groups = new Map<number, { no: number; name: string; lines: RevisionLine[] }>();
  for (const l of [...lines].sort((a, b) => a.position - b.position)) {
    if (!groups.has(l.subhead_no)) groups.set(l.subhead_no, { no: l.subhead_no, name: l.subhead_name, lines: [] });
    groups.get(l.subhead_no)!.lines.push(l);
  }
  return [...groups.values()];
}

/** Line amount as the commercial totals count it (0 when unrated or quantity-pending) — same as OpsBoqBuilder's lineAmount. */
const countedAmount = (l: RevisionLine) => (l.included && !qtyPending(l) ? roundRupee((l.qty ?? 0) * (l.rate ?? 0)) : 0);

/** An included line with an established quantity — a measured row in every
 *  export. Included lines that are qtyPending are listed by pendingItemsFrom
 *  instead; excluded lines appear in neither. */
const isMeasuredRow = (l: RevisionLine) => l.included && !qtyPending(l);

/** Why a pending line has no quantity, from its own stored values only. */
export function pendingReason(l: Pick<RevisionLine, "qty" | "unit" | "quantity_status">): string {
  const markedPending = String(l.quantity_status ?? "").toUpperCase() === "PENDING";
  if (markedPending && l.qty != null && l.qty > 0) {
    return `Quantity pending: still marked pending; the entered ${l.qty}${l.unit ? ` ${l.unit}` : ""} has not been confirmed`;
  }
  return markedPending ? "Quantity pending: not yet measured" : "Quantity pending: no quantity recorded";
}

/**
 * The included lines that have no established quantity (qtyPending), in BOQ
 * order — for the existing "pending quantification" sections of the CSV
 * (buildBoqCsv's `pending`) and the PDF (`pendingItems`). Never given a
 * quantity: the documents show these with a blank / "pending" Qty.
 */
export function pendingItemsFrom(lines: RevisionLine[]): QuotePendingItem[] {
  return groupBySubhead(lines)
    .flatMap((g) => g.lines.filter((l) => l.included && qtyPending(l)))
    .map((l, i) => ({
      no: `P.${String(i + 1).padStart(2, "0")}`, spec: l.description ?? "", unit: l.unit ?? "",
      note: pendingReason(l), sourceDocument: l.source_document_name, sourcePage: l.source_page,
    }));
}

/**
 * PDF quote sub-heads: every included line with an established quantity,
 * priced or not (a missing rate stays blank, never hidden); pending lines are
 * listed by pendingItemsFrom, never here. Sub-heads with no such line are
 * dropped. Subtotal = sum of included lines' counted amounts.
 */
export function quoteSubheadsFrom(lines: RevisionLine[]): QuoteSubHead[] {
  return groupBySubhead(lines).map((g) => ({
    no: g.no, name: g.name,
    subtotal: g.lines.reduce((s, l) => s + countedAmount(l), 0),
    lines: g.lines.filter(isMeasuredRow).map((l) => ({
      no: l.item_no, code: l.dsr_code, spec: l.description ?? "", qty: l.qty as number, unit: l.unit ?? "",
      rate: l.rate, amount: l.rate != null ? roundRupee((l.qty as number) * l.rate) : null,
      sourceDocument: l.source_document_name, sourcePage: l.source_page,
    })),
  })).filter((sh) => sh.lines.length > 0);
}

/** CSV rows: every included line with an established quantity. Pending lines
 *  go to the CSV's pending section (pendingItemsFrom), never a Qty of 0 here. */
export function csvRowsFrom(lines: RevisionLine[]): CsvRow[] {
  return groupBySubhead(lines).flatMap((g) => g.lines.filter(isMeasuredRow).map((l) => ({
    subhead: `${g.no}.00 ${g.name}`, itemNo: l.item_no, code: l.dsr_code, spec: l.description ?? "",
    unit: l.unit ?? "", qty: l.qty as number, rate: l.rate,
    sourceDocument: l.source_document_name, sourcePage: l.source_page,
  })));
}

export interface RevisionLimitation { code: string; message: string; count: number }

/** Revision-level limitations the issuer must acknowledge before freezing. */
export function assessRevisionLimitations(lines: RevisionLine[], ctx: { boqStatus: string | null; adoptionRecordsAvailable: boolean }): RevisionLimitation[] {
  const out: RevisionLimitation[] = [];
  const included = lines.filter((l) => l.included);
  const add = (code: string, count: number, message: string) => { if (count > 0) out.push({ code, count, message }); };
  if (ctx.boqStatus !== "finalized" && ctx.boqStatus !== "sent") {
    add("boq_status", 1, `The BOQ's status is "${ctx.boqStatus ?? "unknown"}", not finalized — this revision freezes a working draft. Mark the BOQ finalized first if it is ready.`);
  }
  add("no_rate", included.filter((l) => l.rate == null).length, "included line(s) have no rate and are unpriced");
  add("qty_pending", included.filter((l) => qtyPending(l)).length, "included line(s) have no measured quantity yet");
  add("manual_rate", lines.filter((l) => l.rate_provenance === "manual_override").length, "line(s) use a manually entered rate with no matching adoption record");
  add("dsr_on_line", included.filter((l) => l.rate_provenance === "dsr_on_line").length, "included line(s) are priced at the DSR rate on the line, not an adopted rate");
  add("excluded", lines.filter((l) => !l.included).length, "line(s) are excluded from the BOQ and not priced");
  if (!ctx.adoptionRecordsAvailable) {
    add("adoption_unavailable", 1, "Rate adoption records are unavailable, so no adopted-rate provenance can be included.");
  }
  return out;
}

export const limitationText = (l: RevisionLimitation) =>
  l.code === "boq_status" || l.code === "adoption_unavailable" ? l.message : `${l.count} ${l.message}`;

/** Quote settings/context copied into a revision so its PDF needs nothing live. */
export interface RevisionQuoteContext {
  projectName?: string | null;
  clientName?: string | null;
  location?: string | null;
  builtUpSqft?: number | null;
  floors?: number | null;
  projectType?: string | null;
  flatsPerFloor?: number | null;
  firmName?: string | null;
  firmTagline?: string | null;
  rateYear?: string | null;
}

export interface StoredRevision {
  id: string;
  boq_id: string | null;
  project_id: string | null;
  boq_name: string;
  project_name: string | null;
  revision_no: number;
  label: string;
  boq_status_at_issue: string | null;
  discipline: string | null;
  rate_year: string | null;
  context: { quote?: RevisionQuoteContext } & Record<string, unknown>;
  commercials: QuoteCommercials;
  works_total: number;
  grand_total: number;
  line_count: number;
  priced_line_count: number;
  limitations: RevisionLimitation[];
  limitations_acknowledged: boolean;
  issue_note: string | null;
  issued_by: string;
  issued_at: string;
}

const issuedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** The PDF payload for a SAVED revision — built only from the revision's own rows. */
export function revisionQuotePayload(rev: StoredRevision, lines: RevisionLine[], blankRates: boolean): DsrQuotePayload {
  const q = rev.context.quote ?? {};
  const subheads = quoteSubheadsFrom(lines);
  return {
    boqName: `${rev.boq_name} — ${rev.label}`,
    projectName: q.projectName ?? rev.project_name, clientName: q.clientName, location: q.location,
    builtUpSqft: q.builtUpSqft, floors: q.floors, projectType: q.projectType, flatsPerFloor: q.flatsPerFloor,
    firmName: q.firmName, firmTagline: q.firmTagline, rateYear: q.rateYear ?? null,
    generatedOn: `${issuedOn(rev.issued_at)} (${rev.label}, frozen)`,
    blankRates, subheads,
    abstract: subheads.map((sh) => ({ no: sh.no, name: sh.name, amount: sh.subtotal })),
    commercials: rev.commercials,
    pendingItems: pendingItemsFrom(lines), drawingItems: [], excludedItems: [],
  };
}

export const revisionFileStem = (rev: Pick<StoredRevision, "boq_name" | "label">) =>
  `${rev.boq_name.replace(/[^\w]+/g, "_")}_${rev.label.replace(/\s+/g, "")}`;

// ── Comparing a saved revision with the working BOQ ──────────────────────
// Read-only: explains how the working BOQ has moved since a revision was
// frozen. The revision itself is never re-derived from the working BOQ.

export type RevisionLineChange = { field: "description" | "qty" | "unit" | "rate" | "included"; from: string; to: string };

export interface RevisionDiff {
  /** Per saved line (by position): "removed" when its working line no longer exists. */
  lines: Map<number, { status: "unchanged" | "changed" | "removed"; changes: RevisionLineChange[] }>;
  changed: number;
  removed: number;
  /** Working lines that did not exist when the revision was frozen. */
  added: { id: string | null; description: string | null }[];
}

const show = (v: string | number | boolean | null | undefined) =>
  v == null || v === "" ? "—" : typeof v === "boolean" ? (v ? "included" : "excluded") : String(v);

export function diffRevisionAgainstWorking(saved: RevisionLine[], working: RevisionLine[]): RevisionDiff {
  const byId = new Map(working.filter((w) => w.source_line_id).map((w) => [w.source_line_id as string, w]));
  const lines: RevisionDiff["lines"] = new Map();
  let changed = 0, removed = 0;
  for (const s of saved) {
    const w = s.source_line_id ? byId.get(s.source_line_id) : undefined;
    if (!w) { lines.set(s.position, { status: "removed", changes: [] }); removed++; continue; }
    const changes: RevisionLineChange[] = [];
    const cmp = (field: RevisionLineChange["field"], a: string | number | boolean | null, b: string | number | boolean | null) => {
      if ((a ?? null) !== (b ?? null)) changes.push({ field, from: show(a), to: show(b) });
    };
    cmp("description", s.description, w.description);
    cmp("qty", s.qty == null ? null : Number(s.qty), w.qty);
    cmp("unit", s.unit, w.unit);
    cmp("rate", s.rate == null ? null : Number(s.rate), w.rate);
    cmp("included", s.included, w.included);
    if (changes.length) changed++;
    lines.set(s.position, { status: changes.length ? "changed" : "unchanged", changes });
  }
  const savedIds = new Set(saved.map((s) => s.source_line_id).filter(Boolean));
  const added = working.filter((w) => !w.source_line_id || !savedIds.has(w.source_line_id))
    .map((w) => ({ id: w.source_line_id, description: w.description }));
  return { lines, changed, removed, added };
}

export const PROVENANCE_LABEL: Record<RateProvenance, string> = {
  adopted: "Adopted",
  manual_override: "Manual rate",
  dsr_on_line: "DSR rate on line",
  none: "No rate",
};

/** Identity of a revision snapshot's content — what would actually be frozen. */
export const snapshotSignature = (s: { lines: RevisionLine[]; header: { works_total: number; grand_total: number; context: unknown } }) =>
  JSON.stringify({ lines: s.lines, works: s.header.works_total, grand: s.header.grand_total, context: s.header.context });
