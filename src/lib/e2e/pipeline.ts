// END-TO-END PIPELINE — one analysis payload through the REAL Cunstruct path:
//
//   parseAnalysisV1 → buildReviewItems → (simulated review) → buildApplyPlan
//   → applyReviewPlan (real writes, into the in-memory database)
//   → read back boq_line → sub-head grouping → buildRevisionLines
//   → the four exports, each built with the product's own functions:
//       live CSV        csvRowsFrom + pendingItemsFrom → buildBoqCsv   (OpsBoqBuilder.exportExcel)
//       live PDF        quoteSubheadsFrom + pendingItemsFrom → payload (OpsBoqBuilder.exportQuote)
//       revision CSV    the same, from the frozen rows                 (useBoqRevisions.exportRevision)
//       revision PDF    revisionQuotePayload(frozen rows)              (useBoqRevisions.exportRevision)
//     PDFs are checked as payloads and as the HTML buildDsrQuoteHtml renders;
//     printing that HTML to a PDF file is not exercised.
//
// Every step is the production function except two, both stated:
//   1. Review is SIMULATED (reviewPolicy.ts) — no person reviews anything. It
//      decides on review items as production presents them to a reviewer:
//      after save and reload (reviewStore.createAnalysisRun → loadReviewItems),
//      which keeps the AI item (as stored JSON) and review status but NOT the
//      review queue's in-memory duplicateOf flag (evaluator v2; see
//      docs/benchmarks/evaluation-baseline.md).
//   2. Sub-head grouping is a copy of OpsBoqBuilder.groupSubheads (inline in
//      the page component, src/pages/ops/OpsBoqBuilder.tsx:521, so it can't be
//      imported). If that code changes, this copy can drift; the harness
//      checks only what the export functions do with its output.
// The Supabase client must be the in-memory one (inMemorySupabase.ts) — the
// caller wires that (vi.mock in tests, a module alias in the runner).

import { parseAnalysisV1 } from "@/lib/review/analysisSchemaV1";
import { buildReviewItems, type ReviewItem } from "@/lib/review/reviewQueue";
import { applyReviewPlan, buildApplyPlan, type ApplyCandidate, type ApplyResult } from "@/lib/review/applyReview";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import { resolveDrawingSource } from "@/lib/review/drawingStorage";
import {
  buildRevisionLines, csvRowsFrom, pendingItemsFrom, quoteSubheadsFrom, revisionQuotePayload,
  type RevisionLine, type StoredRevision, type WorkingLine, type WorkingSubhead,
} from "@/lib/boqRevision";
import { buildBoqCsv, buildDsrQuoteHtml, computeCommercials, type DsrQuotePayload } from "@/lib/boqDsrDocument";
import { readTable, resetInMemoryDb, queriesIssued } from "./inMemorySupabase";
import { simulatedDecision, type SimulatedDecision, type SimulatedPolicyName } from "./reviewPolicy";

export const HARNESS_BOQ_ID = "boq-e2e";
export const HARNESS_PROJECT_ID = "project-e2e";
export const HARNESS_REVISION_ID = "rev-e2e";

export interface PersistedLine {
  id: string;
  description: string | null;
  unit: string | null;
  qty: number;
  quantity_status: string | null;
  basis: string | null;
  section: string | null;
  external_key: string | null;
  scope_id: string | null;
  /** project_scope.name for scope_id — the only place a line's floor is kept. */
  scope_name: string | null;
  source_document_id: string | null;
  source_page: string | null;
  included: boolean;
}

export interface CsvRecord {
  /** "measured" for the main table, "pending" for the pending-quantification section. */
  section: "measured" | "pending";
  subhead: string; item: string; code: string; specification: string; unit: string; qty: string;
  sourceDocument: string; sourcePage: string;
}

export type ExportPath = "live CSV" | "live PDF" | "revision CSV" | "revision PDF";

/** One export as the product produced it. */
export interface ExportOutput {
  path: ExportPath;
  /** CSV text, or the HTML buildDsrQuoteHtml renders for a PDF payload. */
  text: string;
  csvRecords?: CsvRecord[];
  pdfPayload?: DsrQuotePayload;
}

export interface HarnessReviewItem {
  id: string;
  /** The item as a reviewer sees it after production's save and reload. */
  review: ReviewItem;
  /** The review queue's in-memory duplicate flag, which production does not
   *  save. Kept for reporting only; the simulated reviewer never sees it. */
  queueDuplicateOf?: string;
  decision: SimulatedDecision;
}

/** What loadReviewItems reconstructs from a freshly created run: the AI item
 *  from its stored JSON and the review status — nothing else. */
const asReloaded = (r: ReviewItem): ReviewItem => ({ ai: JSON.parse(JSON.stringify(r.ai)), reviewStatus: r.reviewStatus });

export interface RunOutcome {
  documentId: string;
  policy: SimulatedPolicyName;
  parse: { ok: boolean; error?: string; warnings: string[]; items: number };
  reviewItems: HarnessReviewItem[];
  plan: ApplyCandidate[];
  applyResult: ApplyResult | null;
  persistedLines: PersistedLine[];
  changeLog: Record<string, unknown>[];
  /** boq_line id → the review item that created or last changed it (from the change log). */
  lineToReviewItem: Map<string, string>;
  /** The four exports. Empty when no line was included (the product refuses to export). */
  exports: ExportOutput[];
  queries: string[];
}

export interface RunOptions {
  analysisJson: string;
  documentId: string;
  documentName: string;
  policy: SimulatedPolicyName;
  /** Test-only fault injection: the saved lines (before export), or one export's output. */
  tamper?: {
    persistedLines?: (lines: PersistedLine[]) => PersistedLine[];
    csv?: (csv: string) => string;
    pdfPayload?: (p: DsrQuotePayload) => DsrQuotePayload;
  };
}

/** Copy of OpsBoqBuilder.groupSubheads (see the header note). */
function groupSubheads(lines: WorkingLine[]) {
  const groups = new Map<string, WorkingLine[]>();
  for (const l of lines) {
    const sec = l.section ?? "Other";
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec)!.push(l);
  }
  const chapterNo = (ls: WorkingLine[]) => {
    const coded = ls.find((l) => l.dsr_code);
    return coded ? parseInt(coded.dsr_code!.split(".")[0], 10) || 900 : 999;
  };
  return [...groups.entries()]
    .sort((a, b) => chapterNo(a[1]) - chapterNo(b[1]) || a[0].localeCompare(b[0]))
    .map(([name, ls], gi) => {
      const no = gi + 1;
      let item = 0;
      return { no, name, rows: ls.map((l) => ({ line: l, no: `${no}.${String(++item).padStart(2, "0")}` })) };
    });
}

/** RFC-4180-style parse of the CSV buildBoqCsv writes (quoted cells, doubled quotes). */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && csv[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const CSV_HEADER = ["Sub-head", "Item", "Code", "Specification", "Unit", "Qty", "Rate (ref)", "Your rate", "Amount", "Source Document", "Source Page", "Quantity basis", "Rate basis"];

function csvRecordsOf(csv: string): CsvRecord[] {
  const rows = parseCsv(csv);
  const headerAt = rows.findIndex((r) => r.join("|") === CSV_HEADER.join("|"));
  if (headerAt === -1) throw new Error("Exported CSV has no recognisable header row.");
  const out: CsvRecord[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    if (r.length === 1 && r[0] === "") continue; // blank separator before the pending section
    if (r.length === 1) continue;                  // the pending section's title row
    out.push({
      section: r[0] === "Pending" ? "pending" : "measured",
      subhead: r[0], item: r[1], code: r[2], specification: r[3], unit: r[4], qty: r[5], sourceDocument: r[9] ?? "", sourcePage: r[10] ?? "",
    });
  }
  return out;
}

export async function runEndToEnd(opts: RunOptions): Promise<RunOutcome> {
  // The harness project already has the floors the analysis names, as an
  // operator creates them ("+ New scope…") before Apply — Apply itself never
  // creates a project scope from item text.
  const named = parseAnalysisV1(opts.analysisJson);
  const floors = [...new Set((named.analysis?.items ?? []).map((i) => (i.location ?? "").trim()).filter(Boolean))];
  resetInMemoryDb({
    boq: [{ id: HARNESS_BOQ_ID, project_id: HARNESS_PROJECT_ID }],
    project_scope: floors.map((name, i) => ({ id: `scope-${i + 1}`, project_id: HARNESS_PROJECT_ID, name, kind: "floor" })),
    project_document: [{ id: opts.documentId, project_id: HARNESS_PROJECT_ID, current_revision_id: HARNESS_REVISION_ID }],
    document_revision: [{ id: HARNESS_REVISION_ID, document_id: opts.documentId }],
  });
  const empty = (parse: RunOutcome["parse"]): RunOutcome => ({
    documentId: opts.documentId, policy: opts.policy, parse, reviewItems: [], plan: [], applyResult: null,
    persistedLines: [], changeLog: [], lineToReviewItem: new Map(), exports: [], queries: [],
  });

  // 1. Parse, exactly as an import would.
  const parsed = parseAnalysisV1(opts.analysisJson);
  if (!parsed.ok || !parsed.analysis) return empty({ ok: false, error: parsed.error, warnings: parsed.warnings, items: 0 });
  const parse = { ok: true, warnings: parsed.warnings, items: parsed.analysis.items.length };

  // 2. Review queue (real duplicate tagging), saved and reloaded as production
  // does, then SIMULATED decisions on what a reviewer would actually see.
  const reviewItems: HarnessReviewItem[] = buildReviewItems(parsed.analysis.items).map((queued, i) => {
    const review = asReloaded(queued);
    return { id: `ri-${i + 1}`, review, queueDuplicateOf: queued.duplicateOf, decision: simulatedDecision(review, opts.policy) };
  });
  const stored: StoredReviewItem[] = reviewItems.map((r) => ({ ...r.review, id: r.id, reviewStatus: r.decision.status }));

  // 3. Apply into a new, empty BOQ: every candidate Apply can write is selected.
  const plan = buildApplyPlan(stored, []);
  const selectedIds = new Set(plan.filter((c) => c.classification === "APPLY" || c.classification === "NEW_LINE").map((c) => c.reviewItemId));
  const applyResult = await applyReviewPlan({ boqId: HARNESS_BOQ_ID, candidates: plan, selectedIds });

  // 4. Read back what was persisted.
  const scopeName = new Map(readTable("project_scope").map((s) => [s.id as string, s.name as string]));
  let persistedLines: PersistedLine[] = readTable("boq_line").map((l) => ({
    id: l.id as string, description: (l.description as string) ?? null, unit: (l.unit as string) ?? null, qty: l.qty as number,
    quantity_status: (l.quantity_status as string) ?? null, basis: (l.basis as string) ?? null, section: (l.section as string) ?? null,
    external_key: (l.external_key as string) ?? null, scope_id: (l.scope_id as string) ?? null,
    scope_name: l.scope_id ? scopeName.get(l.scope_id as string) ?? null : null,
    source_document_id: (l.source_document_id as string) ?? null, source_page: (l.source_page as string) ?? null,
    included: l.included !== false,
  }));
  const changeLog = readTable("boq_line_change_log");
  const lineToReviewItem = new Map<string, string>();
  for (const c of changeLog) lineToReviewItem.set(c.boq_line_id as string, c.review_item_id as string);
  if (opts.tamper?.persistedLines) persistedLines = opts.tamper.persistedLines(persistedLines);

  // 5. Export, through the product's own functions.
  const drawingsById = new Map([[opts.documentId, { documentId: opts.documentId, name: opts.documentName }]]);
  const working: WorkingLine[] = persistedLines.map((l) => ({
    id: l.id, section: l.section, dsr_code: null, description: l.description, unit: l.unit, qty: l.qty,
    dsr_rate: null, custom_rate: null, included: l.included, quantity_status: l.quantity_status,
    scope_id: l.scope_id, external_key: l.external_key,
  }));
  const bySource = new Map(persistedLines.map((l) => [l.id, l]));
  const subheads: WorkingSubhead[] = groupSubheads(working).map((sh) => ({
    no: sh.no, name: sh.name,
    rows: sh.rows.map(({ line, no }) => {
      const p = bySource.get(line.id)!;
      return { line, no, source: { ...resolveDrawingSource(p.source_document_id, p.source_page, drawingsById, false), sourceDocumentId: p.source_document_id } };
    }),
  }));
  const revisionLines = buildRevisionLines(subheads);
  // A frozen revision stores these rows; exports of it read only the stored copy.
  const frozenLines = JSON.parse(JSON.stringify(revisionLines)) as RevisionLine[];

  const exports: ExportOutput[] = [];
  const csvExport = (path: ExportPath, lines: RevisionLine[]) => {
    const rows = csvRowsFrom(lines), pending = pendingItemsFrom(lines);
    if (!rows.length && !pending.length) return; // the product refuses: "Nothing to export"
    let text = buildBoqCsv(rows, { boqName: "End-to-end harness", generatedOn: "harness" }, pending);
    if (path === "live CSV" && opts.tamper?.csv) text = opts.tamper.csv(text);
    exports.push({ path, text, csvRecords: csvRecordsOf(text) });
  };
  const pdfExport = (path: ExportPath, payload: DsrQuotePayload) => {
    if (!payload.subheads.length && !payload.pendingItems?.length) return; // the product refuses
    const p = path === "live PDF" && opts.tamper?.pdfPayload ? opts.tamper.pdfPayload(payload) : payload;
    exports.push({ path, pdfPayload: p, text: buildDsrQuoteHtml(p, { autoPrint: false }) });
  };
  const commercials = computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 });
  csvExport("live CSV", revisionLines);
  // OpsBoqBuilder.exportQuote composes its payload inline from these two calls.
  const liveSubheads = quoteSubheadsFrom(revisionLines);
  pdfExport("live PDF", {
    boqName: "End-to-end harness", generatedOn: "harness", subheads: liveSubheads,
    abstract: liveSubheads.map((sh) => ({ no: sh.no, name: sh.name, amount: sh.subtotal })), commercials,
    pendingItems: pendingItemsFrom(revisionLines), drawingItems: [], excludedItems: [],
  });
  csvExport("revision CSV", frozenLines);
  pdfExport("revision PDF", revisionQuotePayload(HARNESS_FROZEN_REVISION, frozenLines, false));

  return {
    documentId: opts.documentId, policy: opts.policy, parse, reviewItems, plan, applyResult,
    persistedLines, changeLog, lineToReviewItem, exports, queries: queriesIssued(),
  };
}

const HARNESS_FROZEN_REVISION: StoredRevision = {
  id: "rev-harness", boq_id: HARNESS_BOQ_ID, project_id: HARNESS_PROJECT_ID, boq_name: "End-to-end harness", project_name: null,
  revision_no: 1, label: "Rev H", boq_status_at_issue: "draft", discipline: null, rate_year: null, context: { quote: {} },
  commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 }),
  works_total: 0, grand_total: 0, line_count: 0, priced_line_count: 0, limitations: [], limitations_acknowledged: true,
  issue_note: null, issued_by: "harness", issued_at: "2026-10-13T00:00:00Z",
};
