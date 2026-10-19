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

import { QUANTITY_STATE_LABEL, qtyPending, quantityProvenance, quantityState } from "@/lib/quantity";
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
  /** Recorded quantity basis (see lib/quantity). Optional: absent when the line
   *  was read without these columns, in which case no basis is stated. */
  basis?: string | null;
  basis_note?: string | null;
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
  /** Recorded quantity basis. Stored on frozen lines once
   *  20261007000000_boq_commercial_revision_provenance.sql is applied; absent
   *  (no key) when read from a database without those columns, and null on
   *  lines frozen before it — in both cases no basis is invented. */
  basis?: string | null;
  basis_note?: string | null;
}

/** The quantity basis label an export states for a line, or null when the line
 *  carries no basis fields at all (nothing is stated rather than guessed). */
export const basisLabelOf = (l: Pick<RevisionLine, "basis" | "basis_note">): string | null =>
  "basis" in l || "basis_note" in l ? quantityProvenance(l).label : null;

/**
 * True when a line has no established quantity — the single rule every total,
 * revision and export uses. Defined once in lib/quantity (shared with the
 * public-share edge function): pending when marked PENDING (quantity_status or
 * basis), when there is no usable number, or for a zero nobody confirmed;
 * a zero is "none required" only when explicitly MEASURED or COUNTED.
 */
export { qtyPending } from "@/lib/quantity";

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
      ...("basis" in l || "basis_note" in l ? { basis: l.basis ?? null, basis_note: l.basis_note ?? null } : {}),
    };
  }));
}

/**
 * Pending as a snapshot line states it: the shared rule (qtyPending), OR the
 * line's own frozen judgement — an included line whose stored limitations say
 * "Quantity pending". The second part keeps a saved revision's meaning when a
 * fact behind its judgement was not stored (e.g. basis PENDING frozen on a
 * database without the basis column): the line stays pending and unpriced in
 * every re-export, matching its stored amount (null) and the revision's totals.
 * For freshly built lines both parts agree, so live exports are unaffected.
 */
export const linePending = (l: Pick<RevisionLine, "qty" | "quantity_status" | "basis" | "included"> & { limitations?: string[] | null }): boolean =>
  qtyPending(l) || (l.included && (l.limitations ?? []).includes(LINE_LIMITATION.qtyPending));

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
const countedAmount = (l: RevisionLine) => (l.included && !linePending(l) ? roundRupee((l.qty ?? 0) * (l.rate ?? 0)) : 0);

/** An included line with an established quantity — a measured row in every
 *  export. Included lines that are qtyPending are listed by pendingItemsFrom
 *  instead; excluded lines appear in neither. */
const isMeasuredRow = (l: RevisionLine) => l.included && !linePending(l);

/** Why a pending line has no quantity, from its own stored values only. */
export function pendingReason(l: Pick<RevisionLine, "qty" | "unit" | "quantity_status"> & { basis?: string | null }): string {
  const isPending = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase() === "PENDING";
  const markedPending = isPending(l.quantity_status) || isPending(l.basis);
  const entered = l.qty != null && Number(l.qty) > 0 ? `${Number(l.qty)}${l.unit ? ` ${l.unit}` : ""}` : null;
  if (markedPending && entered) return `Quantity pending: still marked pending; the entered ${entered} has not been confirmed`;
  // Pending only by the line's frozen judgement (see linePending): a number
  // was stored, but it was not an established quantity when frozen.
  if (entered) return `Quantity pending: the entered ${entered} had not been confirmed when this was frozen`;
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
    .flatMap((g) => g.lines.filter((l) => l.included && linePending(l)))
    .map((l, i) => ({
      no: `P.${String(i + 1).padStart(2, "0")}`, spec: l.description ?? "", unit: l.unit ?? "", ...(l.dsr_code ? { code: l.dsr_code } : {}),
      note: pendingReason(l), sourceDocument: l.source_document_name, sourcePage: l.source_page, basis: basisLabelOf(l),
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
      sourceDocument: l.source_document_name, sourcePage: l.source_page, basis: basisLabelOf(l),
      rateBasis: l.rate_basis ?? null,
    })),
  })).filter((sh) => sh.lines.length > 0);
}

/** CSV rows: every included line with an established quantity. Pending lines
 *  go to the CSV's pending section (pendingItemsFrom), never a Qty of 0 here. */
export function csvRowsFrom(lines: RevisionLine[]): CsvRow[] {
  return groupBySubhead(lines).flatMap((g) => g.lines.filter(isMeasuredRow).map((l) => ({
    subhead: `${g.no}.00 ${g.name}`, itemNo: l.item_no, code: l.dsr_code, spec: l.description ?? "",
    unit: l.unit ?? "", qty: l.qty as number, rate: l.rate,
    sourceDocument: l.source_document_name, sourcePage: l.source_page, basis: basisLabelOf(l),
    rateBasis: l.rate_basis ?? null,
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

export type RevisionLineChange = { field: "description" | "code" | "qty" | "unit" | "rate" | "included" | "quantity status" | "quantity basis" | "source"; from: string; to: string };

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

/** Text as compared: trimmed, and blank is the same as absent. */
const text = (v: string | null | undefined) => (v == null ? null : String(v).trim() || null);
const num = (v: number | string | null | undefined) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The drawing name resolveDrawingSource reports for a source it could not load. */
const UNRESOLVED_SOURCE_NAME = "Source document unavailable";
/** A page is only known when the drawing itself was resolved: while drawings
 *  load, or when one is unavailable, the snapshot carries no page (null), which
 *  says nothing about the line's page. */
const pageKnown = (l: RevisionLine) =>
  !!l.source_document_id && !!text(l.source_document_name) && text(l.source_document_name) !== UNRESOLVED_SOURCE_NAME;

/** Quantity state as each side's documents state it (see linePending). */
const stateOf = (l: RevisionLine) => {
  const st = quantityState({ qty: num(l.qty), quantity_status: l.quantity_status, basis: l.basis });
  return st !== "pending" && linePending(l) ? "pending" : st;
};
/** The quantity a line shows: a pending line with no number (null or the 0
 *  boq_line stores for "not yet measured") shows none, whichever was stored. */
const shownQty = (l: RevisionLine) => {
  const q = num(l.qty);
  return stateOf(l) === "pending" && (q == null || q === 0) ? null : q;
};

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
    cmp("description", text(s.description), text(w.description));
    cmp("code", text(s.dsr_code), text(w.dsr_code));
    cmp("qty", shownQty(s), shownQty(w));
    cmp("unit", text(s.unit), text(w.unit));
    cmp("rate", num(s.rate), num(w.rate));
    cmp("included", s.included, w.included);
    // Status and source are part of what a quantity means: a line that went
    // from pending to measured, or now cites a different drawing, has changed
    // even when the number is the same. Each side's state is what its own
    // documents state (basis when stored, and a frozen line's own judgement).
    cmp("quantity status", QUANTITY_STATE_LABEL[stateOf(s)], QUANTITY_STATE_LABEL[stateOf(w)]);
    // Basis, only when the frozen line recorded one (basis or note) and the
    // working line was read with the basis columns: revisions frozen before the
    // basis column existed read back with neither, and no change is invented.
    const recorded = (l: RevisionLine) => text(l.basis) != null || text(l.basis_note) != null;
    if (recorded(s) && ("basis" in w || "basis_note" in w)) {
      const pv = (l: RevisionLine) => quantityProvenance(l);
      const [a, b] = [pv(s), pv(w)];
      const codeOf = (p: typeof a) => (p.code ?? "").toUpperCase();
      if (a.label !== b.label || codeOf(a) !== codeOf(b)) {
        const label = (p: typeof a) => (a.label === b.label && p.code ? `${p.label} (${p.code})` : p.label);
        changes.push({ field: "quantity basis", from: label(a), to: label(b) });
      }
    }
    // Same drawing = same document id, and the same page when both pages are
    // known (a renamed drawing, or one still loading, is not a changed source);
    // shown by name.
    const srcText = (l: RevisionLine) => (l.source_document_id ? `${l.source_document_name ?? "Source document"}${l.source_page ? `, p.${l.source_page}` : ""}` : "—");
    const sameDoc = (s.source_document_id ?? null) === (w.source_document_id ?? null);
    const samePage = !sameDoc || !pageKnown(s) || !pageKnown(w) || text(s.source_page) === text(w.source_page);
    if (!sameDoc || !samePage) changes.push({ field: "source", from: srcText(s), to: srcText(w) });
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
