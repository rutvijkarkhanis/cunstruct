// LIVE BOQ EXPORT — the working BOQ's PDF/CSV export payloads, moved out of
// OpsBoqBuilder unchanged so the builder and the project journey's Export
// step produce exactly the same documents from the same lines.
//
// THE BOQ IS ORGANISED AROUND QUANTITY, NOT AROUND WHETHER A RATE EXISTS. Any
// included line with a defensible quantity is a first-class BOQ line — priced or
// not. A missing rate leaves Rate/Amount blank ("—"); it never hides the line.
// The priced subtotal counts only rated lines (lineAmount is 0 when unrated), so
// the abstract stays honest. Included lines with no established quantity are
// listed in the document's pending section — never as a measured 0, never
// silently dropped.
import { buildBoqCsv, computeCommercials, type DsrQuotePayload, type QuoteCommercials } from "@/lib/boqDsrDocument";
import { countedAmount, effectiveRate } from "@/lib/quantity";
import {
  buildRevisionLines, csvRowsFrom, pendingItemsFrom, quoteSubheadsFrom,
  type RevisionQuoteContext, type WorkingLine, type WorkingSubhead,
} from "@/lib/boqRevision";
import type { Spec } from "@/lib/boqSpec";
import { DRAWING_REVIEW_SECTION } from "@/lib/applyFinding";

type RatedLine = Pick<WorkingLine, "qty" | "dsr_rate" | "custom_rate" | "quantity_status">;

/** The rate in effect: the estimator's case-specific override, else the DSR
 *  reference — lib/quantity's effectiveRate, the one rule every view uses. */
export const effRate = (l: Pick<WorkingLine, "dsr_rate" | "custom_rate">) => effectiveRate(l);
/** A single line's amount in whole rupees as totals count it (0 when unrated, or
 *  when its quantity is not established — see lib/quantity countedAmount). All
 *  money aggregates are sums of THIS value so the printed figures add up exactly. */
export const lineAmount = (l: RatedLine) => countedAmount(l);
export const includedTotal = (ls: (RatedLine & { included: boolean })[]) =>
  ls.filter((l) => l.included).reduce((s, l) => s + lineAmount(l), 0);

/** The sub-head title shown in the editor and printed on exports. Apply
 *  files new review lines under an internal section (DRAWING_REVIEW_SECTION)
 *  — a storage detail that must not reach a client document. */
export const subheadName = (section: string) => (section === DRAWING_REVIEW_SECTION ? "Unassigned" : section);

export interface SubheadGroup<L> { no: number; name: string; rows: { line: L; no: string }[]; subtotal: number }

/** Group by DSR sub-head (type of work), ordered by chapter number — which is also
 *  the construction sequence. Each sub-head gets a number; items within are numbered
 *  <sub-head>.01, .02 … like a real tender BOQ. NS/uncoded lines last. */
export function groupSubheads<L extends WorkingLine>(source: L[]): SubheadGroup<L>[] {
  const groups = new Map<string, L[]>();
  for (const l of source) {
    const sec = l.section ?? "Other";
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec)!.push(l);
  }
  const chapterNo = (ls: L[]) => {
    const coded = ls.find((l) => l.dsr_code);
    return coded ? parseInt(coded.dsr_code!.split(".")[0], 10) || 900 : 999;  // uncoded/NS last
  };
  return [...groups.entries()]
    .sort((a, b) => chapterNo(a[1]) - chapterNo(b[1]) || a[0].localeCompare(b[0]))
    .map(([section, ls], gi) => {
      const no = gi + 1;
      let item = 0;
      const rows = ls.map((l) => ({ line: l, no: `${no}.${String(++item).padStart(2, "0")}` }));
      return { no, name: subheadName(section), rows, subtotal: includedTotal(ls) };
    });
}

/** Commercials (cost index, contingency, overhead, cess, GST) live in boq.spec.
 *  Defaults follow common CPWD practice. */
export function commercialsFor(worksTotal: number, sp: Spec): QuoteCommercials {
  const pct = (k: string, d: number) => Number(sp[k] ?? d);
  return computeCommercials(worksTotal, {
    costIndexPct: pct("_cost_index_pct", 0),
    contingencyPct: pct("_contingency_pct", 3),
    overheadPct: pct("_overhead_pct", 15),
    cessPct: pct("_cess_pct", 1),
    gstPct: pct("_gst_pct", 18),
  });
}

export interface ExportProject {
  name?: string | null; client_name?: string | null; location?: string | null;
  area_sqft?: number | null; floors?: number | null; project_type?: string | null;
}

/** Pricing basis. Private projects are the default: rates are the operator's own
 *  (entered per line / quoted separately) — so the document must NOT claim a
 *  Delhi-Schedule-of-Rates basis. Only when the operator has explicitly selected
 *  DSR pricing (spec._pricing_basis === "dsr") do we stamp "Basis: DSR <year>". */
export function quoteContextFor(project: ExportProject | null | undefined, sp: Spec): RevisionQuoteContext {
  const useDsrBasis = String(sp._pricing_basis ?? "").toLowerCase() === "dsr";
  return {
    projectName: project?.name, clientName: project?.client_name, location: project?.location,
    builtUpSqft: project?.area_sqft, floors: project?.floors, projectType: project?.project_type,
    flatsPerFloor: Number(sp._flats_per_floor ?? sp.flats_per_floor) || null,
    firmName: String(sp._firm_name ?? "").trim() || null,
    firmTagline: String(sp._firm_tagline ?? "").trim() || null,
    rateYear: useDsrBasis ? "2023" : null,
  };
}

/** The working BOQ as numbered sub-heads with resolved drawing sources — the
 *  single input to the live exports AND to a frozen commercial revision. */
export function workingSubheadsFrom<L extends WorkingLine & { source_document_id?: string | null }>(
  groups: SubheadGroup<L>[],
  resolveSource: (l: L) => { sourceDocument: string | null; sourcePage: string | null },
): WorkingSubhead[] {
  return groups.map((sh) => ({
    no: sh.no, name: sh.name,
    rows: sh.rows.map(({ line, no }) => ({
      line, no, source: { ...resolveSource(line), sourceDocumentId: line.source_document_id ?? null },
    })),
  }));
}

/** The live PDF payload, or null when there is nothing to export (every line
 *  excluded). A pending-only BOQ still exports. */
export function liveQuotePayload(a: {
  boqName: string; context: RevisionQuoteContext; generatedOn: string; blankRates: boolean;
  subheads: WorkingSubhead[]; commercials: QuoteCommercials; unresolvedReviewCount: number | null | undefined;
}): DsrQuotePayload | null {
  const revisionLines = buildRevisionLines(a.subheads);
  const subheads = quoteSubheadsFrom(revisionLines);
  const pendingItems = pendingItemsFrom(revisionLines);
  if (!subheads.length && !pendingItems.length) return null;
  return {
    boqName: a.boqName,
    ...a.context,
    generatedOn: a.generatedOn, blankRates: a.blankRates,
    subheads,
    abstract: subheads.map((sh) => ({ no: sh.no, name: sh.name, amount: sh.subtotal })),
    commercials: a.commercials,
    pendingItems,
    drawingItems: [],
    excludedItems: [],
    unresolvedReviewCount: a.unresolvedReviewCount,
  };
}

/** The live CSV, or null when there is nothing to export. */
export function liveCsv(a: {
  boqName: string; projectName: string | null | undefined; generatedOn: string;
  subheads: WorkingSubhead[]; unresolvedReviewCount: number | null | undefined;
}): string | null {
  const revisionLines = buildRevisionLines(a.subheads);
  const rows = csvRowsFrom(revisionLines);
  const pending = pendingItemsFrom(revisionLines);
  if (!rows.length && !pending.length) return null;
  return buildBoqCsv(rows, { boqName: a.boqName, project: a.projectName, generatedOn: a.generatedOn, unresolvedReviewCount: a.unresolvedReviewCount }, pending);
}

export const liveFileStem = (boqName: string) => boqName.replace(/[^\w]+/g, "_");
export const exportDate = () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
