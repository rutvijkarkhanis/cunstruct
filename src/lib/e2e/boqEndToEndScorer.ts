// END-TO-END BOQ SCORER — scores one pipeline run (pipeline.ts) against an
// independently prepared reference BOQ (boqReference.ts). Pure.
//
// Groups, each with numerator and denominator, never blended:
//   scope            measured reference lines found / missed / ambiguous to pair
//   quantities       of found measured lines that reached the BOQ as MEASURED: within / outside tolerance
//   identity         item name and floor; zone/flat scope is counted but never scored
//   nonMeasurable    reference lines classified ambiguous/unmeasurable: held, or measured anyway
//   outOfScope       reference lines outside the agreed drawings, and what the system produced for them
//   falsePositives   system items whose name matches no reference line
//   unmatched        system items with a matching name that could not be paired (duplicate,
//                    elsewhere on the page, or no location to tell)
//   held             found lines that did NOT reach the BOQ as a measured quantity
//   integrity        does what was accepted survive persistence and export unchanged
// Pairing never uses quantity (see referenceMatching.ts).
// The first five need a reference. Without one the report says
// "No reference — accuracy not computed." and those groups are null — never
// zero, and never filled from any other source. Integrity and unsupported
// measurements need no reference and are always reported; they describe the
// pipeline, not BOQ accuracy.

import type { AnalysisItemV1 } from "@/lib/review/analysisSchemaV1";
import { allowedDifference, convertQuantity, statusOf, type ReferenceBoqLine, type ReferenceLineStatus, type ReferenceLoad } from "./boqReference";
import { locate, matchReference, type PairMethod, type RefOutcome, type SysOutcome } from "./referenceMatching";
import type { CsvRecord, ExportOutput, ExportPath, PersistedLine, RunOutcome } from "./pipeline";
import { POLICY_DESCRIPTIONS } from "./reviewPolicy";

export type ItemFate = "in_boq_measured" | "in_boq_pending" | "held_in_review" | "not_applied";

export interface SystemItem {
  reviewItemId: string;
  item: string;
  /** Floor as the BOQ records it (the line's scope name), or the item's own location when it never reached the BOQ. */
  floor: string | null;
  fate: ItemFate;
  /** The quantity the BOQ holds (measured lines), or the one proposed (everything else). */
  quantity: number | null;
  unit: string | null;
  lineId: string | null;
  classification: string;
  decisionRule: string;
  /** Where the floor came from: the stored BOQ line's scope, or the analysis item (never applied). */
  floorSource: "boq_line_scope" | "analysis_location";
  /** The system's own location for the item: its first evidence box. */
  evidence: { page: number; bbox: [number, number, number, number]; pageSize: { width: number; height: number } | null } | null;
}

export interface Ratio { n: number; of: number }

export interface AccuracyReport {
  /** Measured reference lines only. */
  scope: { found: number; missed: number; ambiguous: number; of: number; missedIds: string[]; ambiguousIds: string[] };
  quantities: {
    correct: number; incorrect: number; of: number;
    incorrectDetails: { referenceId: string; expected: number; unit: string; actual: number | null; actualUnit: string | null; allowed: number }[];
  };
  identity: {
    item: Ratio;
    floor: Ratio & {
      wrong: { referenceId: string; expected: string | null; actual: string | null }[];
      /** Paired items whose floor came from the stored BOQ line vs. from the (never applied) analysis item. */
      sources: { boqLineScope: number; analysisLocation: number };
    };
    scope: { scored: false; referenceLinesWithScope: number; reason: string };
  };
  nonMeasurable: {
    lines: number; identified: number; heldForReview: number; ambiguous: number; notIdentified: number;
    /** The system put a measured quantity in the BOQ for an item the reference says cannot be measured. */
    measuredAnyway: string[];
  };
  outOfScope: { lines: number; producedBySystem: string[] };
  falsePositives: { inBoq: number; heldOnly: number; ofSystemItems: number; items: { item: string; floor: string | null; fate: ItemFate }[] };
  unmatched: { duplicate: string[]; locationDisagrees: string[]; ambiguous: string[] };
  held: {
    total: number;
    inReviewOrNotApplied: number;
    pendingInBoq: number;
    noProposedQuantity: number;
    /** Proposed quantity outside tolerance — holding it kept a wrong number out of the BOQ. */
    proposedWouldBeWrong: number;
    /** Proposed quantity within tolerance — held although it was right. */
    proposedWouldBeRight: number;
  };
  pairing: { byLocation: number; byUniqueName: number; note: string };
  matches: { referenceId: string; status: ReferenceLineStatus; reviewItemId: string; method: PairMethod; fate: ItemFate; floorCorrect: boolean; quantityCorrect: boolean | null }[];
}

/** What went wrong in one export, against the saved lines. */
export interface ExportCheck {
  path: ExportPath;
  /** Entries the saved lines call for: measured rows and pending entries. */
  expected: { measured: number; pending: number };
  found: { measured: number; pending: number };
  /** An expected entry with no counterpart at all. */
  dropped: string[];
  /** An entry beyond what the saved lines call for (a duplicate, or one with no saved line). */
  duplicatedOrExtra: string[];
  /** A pending line shown as a measured row with Qty 0. */
  pendingAsZero: string[];
  /** The line is there, but its quantity, unit, section or source differs from what was saved. */
  valueChanged: string[];
  /** The product refused to export although included lines exist. */
  refused: boolean;
  /** PDFs only: the rendered HTML's measured-row and "pending" counts disagree with the payload. */
  renderedMismatch?: string;
}

export interface IntegrityReport {
  appliedItems: number;
  /** Accepted review items vs. the saved BOQ lines. */
  persistence: { notPersisted: string[]; persistedValueChanged: string[]; duplicateLines: string[]; sourceLost: string[] };
  /** Saved BOQ lines vs. each export, matched by attributes (never by row position). */
  exports: ExportCheck[];
  /** Total pending lines shown as Qty 0, across every export. */
  pendingExportedAsZero: number;
  violationCount: number;
  /** Accepted information the data model or export has no place for — reported, not counted as violations. */
  notCarried: { floorInExport: Ratio; reviewerCorrectionsDropped: number; note: string };
  /** What "PDF" means here. */
  pdfScope: string;
}

export interface UnsupportedReport {
  measuredLines: number;
  unsupported: { lineId: string; item: string; reasons: string[] }[];
}

export interface EndToEndReport {
  harness: {
    review: "SIMULATED";
    policy: string;
    policyRule: string;
    notes: string[];
  };
  reference: { status: ReferenceLoad["status"]; message: string; errors?: string[]; preparedBy?: string; preparedAt?: string; lines?: number };
  pipeline: {
    parsedItems: number;
    parseOk: boolean;
    decisions: Record<string, number>;
    classifications: Record<string, number>;
    persistedLines: { measured: number; pending: number };
    exportedRows: number;
    applyResult: RunOutcome["applyResult"];
  };
  accuracy: AccuracyReport | null;
  integrity: IntegrityReport;
  unsupportedMeasurements: UnsupportedReport;
  notComputable: string[];
}

export const NO_REFERENCE = "No reference — accuracy not computed.";

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

/** "Floor area — KITCHEN (First Floor)" → "floor area kitchen". Case, punctuation and a trailing parenthetical are ignored. */
export function normalizeItemName(s: string | null | undefined): string {
  return (s ?? "").replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const normFloor = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function effectiveQuantity(ai: AnalysisItemV1, reviewerQty: number | null | undefined, hasReviewerQty: boolean): number | null {
  return hasReviewerQty ? reviewerQty ?? null : ai.quantity;
}

/** What became of every review item, with the values the BOQ (or the review) holds for it. */
export function systemItemsOf(run: RunOutcome): SystemItem[] {
  const lineByReviewItem = new Map<string, string>();
  for (const [lineId, ri] of run.lineToReviewItem) lineByReviewItem.set(ri, lineId);
  const lines = new Map(run.persistedLines.map((l) => [l.id, l]));
  const planBy = new Map(run.plan.map((c) => [c.reviewItemId, c]));
  return run.reviewItems.map((r) => {
    const lineId = lineByReviewItem.get(r.id) ?? null;
    const line = lineId ? lines.get(lineId) : undefined;
    const ai = r.review.ai;
    const reviewer = r.review.reviewer;
    const proposed = effectiveQuantity(ai, reviewer?.quantity, !!reviewer && "quantity" in reviewer);
    const classification = planBy.get(r.id)?.classification ?? "UNKNOWN";
    const fate: ItemFate = line
      ? (isPendingLine(line) ? "in_boq_pending" : "in_boq_measured")
      : classification === "NOT_ELIGIBLE" ? "held_in_review" : "not_applied";
    const box = ai.source?.evidence?.[0];
    const page = box?.page ?? ai.source?.page;
    return {
      reviewItemId: r.id, item: ai.item, classification, decisionRule: r.decision.rule, lineId,
      floor: line ? line.scope_name : ai.location ?? null,
      floorSource: line ? "boq_line_scope" : "analysis_location",
      fate,
      quantity: fate === "in_boq_measured" ? line!.qty : proposed,
      unit: line ? line.unit : ai.unit ?? null,
      evidence: box && page != null ? { page, bbox: box.bbox as [number, number, number, number], pageSize: ai.source?.pageSize ?? null } : null,
    };
  });
}

export interface ScoreOptions {
  /** The drawing's page sizes in PDF points, from the drawing itself. Used to place a
   *  system evidence box that declares no pageSize (the canonical convention,
   *  evidenceCoords.ts). Without it such a box has no usable location. */
  drawingPageSizes?: Record<number, { width: number; height: number }>;
}

function scoreAccuracy(reference: ReferenceBoqLine[], items: SystemItem[], opts: ScoreOptions): AccuracyReport {
  const match = matchReference(
    reference.map((r) => ({
      names: new Set([r.item, ...(r.aliases ?? [])].map(normalizeItemName)),
      floor: normFloor(r.floor),
      located: r.evidence ? locate(r.evidence.page, r.evidence.bbox, r.evidence.pageSize) : null,
    })),
    items.map((s) => ({
      name: normalizeItemName(s.item),
      floor: normFloor(s.floor),
      located: s.evidence ? locate(s.evidence.page, s.evidence.bbox, s.evidence.pageSize ?? opts.drawingPageSizes?.[s.evidence.page]) : null,
    })),
  );
  const sysOf = new Map(match.pairs.map((p) => [p.ref, p]));
  const idsWhere = (status: (st: ReferenceLineStatus) => boolean, outcome: RefOutcome) =>
    reference.filter((r, ri) => status(statusOf(r)) && match.refOutcomes[ri] === outcome).map((r) => r.id);
  const isMeasured = (st: ReferenceLineStatus) => st === "measured";
  const isNonMeasurable = (st: ReferenceLineStatus) => st === "ambiguous" || st === "unmeasurable";

  const matches: AccuracyReport["matches"] = [];
  const quantities: AccuracyReport["quantities"] = { correct: 0, incorrect: 0, of: 0, incorrectDetails: [] };
  const held: AccuracyReport["held"] = { total: 0, inReviewOrNotApplied: 0, pendingInBoq: 0, noProposedQuantity: 0, proposedWouldBeWrong: 0, proposedWouldBeRight: 0 };
  const floorWrong: AccuracyReport["identity"]["floor"]["wrong"] = [];
  const floorSources = { boqLineScope: 0, analysisLocation: 0 };
  const nonMeasurable: AccuracyReport["nonMeasurable"] = {
    lines: reference.filter((r) => isNonMeasurable(statusOf(r))).length, identified: 0, heldForReview: 0,
    ambiguous: idsWhere(isNonMeasurable, "ambiguous").length, notIdentified: idsWhere(isNonMeasurable, "missed").length, measuredAnyway: [],
  };
  const outOfScope: AccuracyReport["outOfScope"] = { lines: reference.filter((r) => statusOf(r) === "out_of_scope").length, producedBySystem: [] };

  for (const p of match.pairs) {
    const r = reference[p.ref], s = items[p.sys], status = statusOf(r);
    const floorCorrect = normFloor(r.floor) === normFloor(s.floor);
    let quantityCorrect: boolean | null = null;
    if (status === "measured") {
      if (s.floorSource === "boq_line_scope") floorSources.boqLineScope++; else floorSources.analysisLocation++;
      if (!floorCorrect) floorWrong.push({ referenceId: r.id, expected: r.floor, actual: s.floor });
      const refQty = r.quantity as number;
      const within = s.quantity == null ? null : (() => {
        const q = convertQuantity(s.quantity!, s.unit, r.unit);
        return q != null && Math.abs(q - refQty) <= allowedDifference(r);
      })();
      if (s.fate === "in_boq_measured") {
        quantities.of++;
        quantityCorrect = within === true;
        if (quantityCorrect) quantities.correct++;
        else {
          quantities.incorrect++;
          quantities.incorrectDetails.push({ referenceId: r.id, expected: refQty, unit: r.unit, actual: s.quantity, actualUnit: s.unit, allowed: allowedDifference(r) });
        }
      } else {
        held.total++;
        if (s.fate === "in_boq_pending") held.pendingInBoq++; else held.inReviewOrNotApplied++;
        if (within === null) held.noProposedQuantity++;
        else if (within) held.proposedWouldBeRight++;
        else held.proposedWouldBeWrong++;
      }
    } else if (isNonMeasurable(status)) {
      nonMeasurable.identified++;
      if (s.fate === "in_boq_measured") nonMeasurable.measuredAnyway.push(r.id);
      else nonMeasurable.heldForReview++;
    } else {
      outOfScope.producedBySystem.push(r.id);
    }
    matches.push({ referenceId: r.id, status, reviewItemId: s.reviewItemId, method: p.method, fate: s.fate, floorCorrect, quantityCorrect });
  }

  const measuredRefs = reference.filter((r) => isMeasured(statusOf(r)));
  const found = measuredRefs.filter((r) => sysOf.has(reference.indexOf(r))).length;
  const sysWith = (o: SysOutcome) => items.filter((_, si) => match.sysOutcomes[si] === o);
  const noRef = sysWith("no_reference");
  const inBoq = noRef.filter((s) => s.fate === "in_boq_measured" || s.fate === "in_boq_pending");
  const label = (s: SystemItem) => `${s.item}${s.floor ? ` [${s.floor}]` : ""}`;
  return {
    scope: {
      found, of: measuredRefs.length,
      missed: idsWhere(isMeasured, "missed").length, ambiguous: idsWhere(isMeasured, "ambiguous").length,
      missedIds: idsWhere(isMeasured, "missed"), ambiguousIds: idsWhere(isMeasured, "ambiguous"),
    },
    quantities,
    identity: {
      item: { n: found, of: measuredRefs.length },
      floor: { n: found - floorWrong.length, of: found, wrong: floorWrong, sources: floorSources },
      scope: {
        scored: false,
        referenceLinesWithScope: reference.filter((r) => r.scope != null && String(r.scope).trim() !== "").length,
        reason: "Not scored: a BOQ line has a single scope_id, which Apply uses for the floor; there is no independent zone/flat field on the system side to compare a reference scope with.",
      },
    },
    nonMeasurable,
    outOfScope,
    falsePositives: { inBoq: inBoq.length, heldOnly: noRef.length - inBoq.length, ofSystemItems: items.length, items: noRef.map((s) => ({ item: s.item, floor: s.floor, fate: s.fate })) },
    unmatched: { duplicate: sysWith("duplicate").map(label), locationDisagrees: sysWith("location_disagrees").map(label), ambiguous: sysWith("ambiguous").map(label) },
    held,
    pairing: {
      byLocation: match.pairs.filter((p) => p.method === "location").length,
      byUniqueName: match.pairs.filter((p) => p.method === "unique_name").length,
      note: "Pairs are made only by agreeing locations, or by a name that occurs exactly once on each side. Quantity is never used to pair; repeated same-name items without locations are reported as ambiguous, not credited.",
    },
    matches,
  };
}

// ── Export integrity ────────────────────────────────────────────────────────
// Expected entries are derived ONLY from the saved boq_line rows read back
// from the database — never from the revision lines the exports were built
// from — so a line lost, duplicated or changed anywhere between storage and
// the document is caught. Pending (the documented rule, stated here on its
// own): quantity_status PENDING; or no usable number; or zero that is not an
// explicitly MEASURED/COUNTED zero.

type Entry = { section: "measured" | "pending"; description: string; unit: string; qty: string; sourceDocument: string; sourcePage: string };
const entryKey = (e: Entry) => [e.section, e.description, e.unit, e.qty, e.sourceDocument, e.sourcePage].join("¦");
const isPendingLine = (l: PersistedLine) => {
  const status = String(l.quantity_status ?? "").toUpperCase();
  if (status === "PENDING" || typeof l.qty !== "number" || !Number.isFinite(l.qty)) return true;
  return l.qty > 0 ? false : !(l.qty === 0 && (status === "MEASURED" || status === "COUNTED"));
};

function expectedEntries(lines: PersistedLine[], documentName: string): Entry[] {
  return lines.filter((l) => l.included).map((l) => {
    const pending = isPendingLine(l);
    return {
      section: pending ? "pending" : "measured", description: l.description ?? "", unit: l.unit ?? "",
      qty: pending ? "" : String(l.qty),
      sourceDocument: l.source_document_id ? documentName : "", sourcePage: l.source_document_id ? l.source_page ?? "" : "",
    };
  });
}

/** The CSV's pending rows read "<description> — Quantity pending: <reason>". */
const PENDING_SUFFIX = / — Quantity pending: .*$/s;

function foundEntries(out: ExportOutput): Entry[] {
  if (out.csvRecords) {
    return out.csvRecords.map((r: CsvRecord) => ({
      section: r.section,
      description: r.section === "pending" ? r.specification.replace(PENDING_SUFFIX, "") : r.specification,
      unit: r.unit, qty: r.qty, sourceDocument: r.sourceDocument, sourcePage: r.sourcePage,
    }));
  }
  const p = out.pdfPayload!;
  return [
    ...p.subheads.flatMap((sh) => sh.lines.map((l) => ({
      section: "measured" as const, description: l.spec, unit: l.unit, qty: String(l.qty), sourceDocument: l.sourceDocument ?? "", sourcePage: l.sourcePage ?? "",
    }))),
    ...(p.pendingItems ?? []).map((x) => ({
      section: "pending" as const, description: x.spec, unit: x.unit, qty: "", sourceDocument: x.sourceDocument ?? "", sourcePage: x.sourcePage ?? "",
    })),
  ];
}

function checkExport(path: ExportPath, expected: Entry[], out: ExportOutput | undefined): ExportCheck {
  const count = (es: Entry[], s: Entry["section"]) => es.filter((e) => e.section === s).length;
  const check: ExportCheck = {
    path, expected: { measured: count(expected, "measured"), pending: count(expected, "pending") }, found: { measured: 0, pending: 0 },
    dropped: [], duplicatedOrExtra: [], pendingAsZero: [], valueChanged: [], refused: !out && expected.length > 0,
  };
  if (!out) {
    check.dropped = expected.map((e) => e.description);
    return check;
  }
  const found = foundEntries(out);
  check.found = { measured: count(found, "measured"), pending: count(found, "pending") };
  // Multiset difference: what is expected but missing, and what is surplus.
  const surplus = new Map<string, Entry[]>();
  for (const f of found) surplus.set(entryKey(f), [...(surplus.get(entryKey(f)) ?? []), f]);
  const missing: Entry[] = [];
  for (const e of expected) {
    const bucket = surplus.get(entryKey(e));
    if (bucket?.length) bucket.pop(); else missing.push(e);
  }
  const leftover = [...surplus.values()].flat();
  // Explain each missing entry by the leftover entry that took its place, if any.
  for (const e of missing) {
    const i = leftover.findIndex((f) => f.description === e.description);
    if (i === -1) { check.dropped.push(e.description); continue; }
    const [f] = leftover.splice(i, 1);
    if (e.section === "pending" && f.section === "measured" && Number(f.qty) === 0) check.pendingAsZero.push(e.description);
    else check.valueChanged.push(`${e.description}: expected ${e.section} ${e.qty} ${e.unit} [${e.sourceDocument} ${e.sourcePage}], found ${f.section} ${f.qty} ${f.unit} [${f.sourceDocument} ${f.sourcePage}]`);
  }
  check.duplicatedOrExtra = leftover.map((f) => f.description);
  if (out.pdfPayload) {
    // The rendered HTML must show exactly the payload's rows: one amount cell per
    // measured row, one "pending" cell per pending entry.
    const amountCells = (out.text.match(/<td class="num amt">/g) ?? []).length;
    const pendingCells = (out.text.match(/<td class="num pend">pending<\/td>/g) ?? []).length;
    if (amountCells !== check.found.measured || pendingCells !== check.found.pending) {
      check.renderedMismatch = `HTML shows ${amountCells} measured / ${pendingCells} pending rows; payload has ${check.found.measured} / ${check.found.pending}`;
    }
  }
  return check;
}

function scoreIntegrity(run: RunOutcome, documentName: string): IntegrityReport {
  const persistence: IntegrityReport["persistence"] = { notPersisted: [], persistedValueChanged: [], duplicateLines: [], sourceLost: [] };
  const conflicted = new Set(run.applyResult?.conflictedReviewItemIds ?? []);
  const applied = run.plan.filter((c) => (c.classification === "APPLY" || c.classification === "NEW_LINE") && !conflicted.has(c.reviewItemId));
  const lineByReviewItem = new Map<string, string>();
  for (const [lineId, ri] of run.lineToReviewItem) lineByReviewItem.set(ri, lineId);
  const lines = new Map(run.persistedLines.map((l) => [l.id, l]));
  const review = new Map(run.reviewItems.map((r) => [r.id, r.review]));

  for (const c of applied) {
    const lineId = lineByReviewItem.get(c.reviewItemId);
    const line = lineId ? lines.get(lineId) : undefined;
    if (!line) { persistence.notPersisted.push(c.reviewItemId); continue; }
    const ai = review.get(c.reviewItemId)!.ai;
    const pending = ai.quantity == null;
    const expectQty = pending ? 0 : ai.quantity;
    if (line.qty !== expectQty || (line.unit ?? null) !== (ai.unit ?? null) || String(line.quantity_status) !== (pending ? "PENDING" : "MEASURED")) {
      persistence.persistedValueChanged.push(c.reviewItemId);
    }
    if (ai.source?.documentId && line.source_document_id !== ai.source.documentId) persistence.sourceLost.push(c.reviewItemId);
  }
  const identities = tally(run.persistedLines.filter((l) => l.external_key).map((l) => `${l.external_key}¦${l.scope_id ?? ""}`));
  for (const [k, n] of Object.entries(identities)) if (n > 1) persistence.duplicateLines.push(k);

  const expected = expectedEntries(run.persistedLines, documentName);
  const paths: ExportPath[] = ["live CSV", "live PDF", "revision CSV", "revision PDF"];
  const exports = paths.map((path) => checkExport(path, expected, run.exports.find((e) => e.path === path)));
  const exportViolations = exports.reduce((s, x) => s + x.dropped.length + x.duplicatedOrExtra.length + x.pendingAsZero.length + x.valueChanged.length + (x.renderedMismatch ? 1 : 0) + (x.refused ? 1 : 0), 0);
  const withFloor = run.persistedLines.filter((l) => l.included && l.scope_name).length;
  return {
    appliedItems: applied.length,
    persistence,
    exports,
    pendingExportedAsZero: exports.reduce((s, x) => s + x.pendingAsZero.length, 0),
    violationCount: Object.values(persistence).reduce((s, xs) => s + xs.length, 0) + exportViolations,
    notCarried: {
      floorInExport: { n: 0, of: withFloor },
      reviewerCorrectionsDropped: run.plan.reduce((s, c) => s + c.unsupportedChanges.length, 0),
      note: "Neither the CSV nor the PDF has a floor/location column, so a line's floor (its scope) never reaches an export. Reviewer corrections to dimension, specification or location have no boq_line column and are never written.",
    },
    pdfScope: "PDF exports are checked as the payload the product builds and as the HTML buildDsrQuoteHtml renders from it. Printing that HTML to a PDF file (the browser's print dialog) is not exercised.",
  };
}

function scoreUnsupported(run: RunOutcome, items: SystemItem[]): UnsupportedReport {
  const review = new Map(run.reviewItems.map((r) => [r.id, r.review.ai]));
  const measured = items.filter((s) => s.fate === "in_boq_measured");
  const unsupported = measured.flatMap((s) => {
    const ai = review.get(s.reviewItemId)!;
    const reasons: string[] = [];
    if (!ai.source?.evidence?.length) reasons.push("no evidence box");
    if (ai.aiStatus === "INFERRED") reasons.push("quantity is INFERRED");
    if (!(typeof s.quantity === "number" && s.quantity > 0)) reasons.push("no positive quantity");
    const inputs = ai.calculationData?.inputs ?? [];
    if (inputs.some((i) => !i.unit || i.unit === "unresolved")) reasons.push("a calculation input has no established unit");
    return reasons.length ? [{ lineId: s.lineId!, item: s.item, reasons }] : [];
  });
  return { measuredLines: measured.length, unsupported };
}

export function scoreEndToEnd(run: RunOutcome, reference: ReferenceLoad, documentName: string, opts: ScoreOptions = {}): EndToEndReport {
  const items = systemItemsOf(run);
  const notComputable: string[] = [];
  let referenceInfo: EndToEndReport["reference"];
  let accuracy: AccuracyReport | null = null;
  if (reference.status === "loaded") {
    const r = reference.reference;
    referenceInfo = { status: "loaded", message: `Reference "${r.project}" by ${r.preparedBy}, ${r.preparedAt}.`, preparedBy: r.preparedBy, preparedAt: r.preparedAt, lines: r.lines.length };
    accuracy = scoreAccuracy(r.lines, items, opts);
  } else {
    referenceInfo = reference.status === "absent"
      ? { status: "absent", message: NO_REFERENCE }
      : { status: "invalid", message: `Reference rejected — ${NO_REFERENCE}`, errors: reference.errors };
    notComputable.push("scope, quantities, identity, false positives and held items: no accepted reference BOQ");
  }
  if (!run.parse.ok) notComputable.push(`the analysis payload did not parse: ${run.parse.error ?? "unknown error"}`);
  const persisted = run.persistedLines;
  return {
    harness: {
      review: "SIMULATED",
      policy: run.policy,
      policyRule: POLICY_DESCRIPTIONS[run.policy],
      notes: [
        "No human reviewed any item. Review decisions come from the simulated policy above.",
        "Apply ran the production code against an in-memory database (unique identity indexes emulated; RLS, triggers and other constraints are not).",
        "Sub-head grouping for export is a copy of OpsBoqBuilder.groupSubheads, which is not importable.",
        "Integrity and unsupported-measurement results describe the pipeline, not BOQ accuracy.",
      ],
    },
    reference: referenceInfo,
    pipeline: {
      parsedItems: run.parse.items,
      parseOk: run.parse.ok,
      decisions: tally(run.reviewItems.map((r) => r.decision.status)),
      classifications: tally(run.plan.map((c) => c.classification)),
      persistedLines: {
        measured: persisted.filter((l) => String(l.quantity_status).toUpperCase() !== "PENDING").length,
        pending: persisted.filter((l) => String(l.quantity_status).toUpperCase() === "PENDING").length,
      },
      exportedRows: run.exports.find((e) => e.path === "live CSV")?.csvRecords?.length ?? 0,
      applyResult: run.applyResult,
    },
    accuracy,
    integrity: scoreIntegrity(run, documentName),
    unsupportedMeasurements: scoreUnsupported(run, items),
    notComputable,
  };
}
