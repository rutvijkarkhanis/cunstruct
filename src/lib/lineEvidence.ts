// LINE ↔ EVIDENCE — where a BOQ line's quantity came from, using only what is
// already stored and stable:
//
//   boq_line.external_key  = the analysis item key Apply matched or created the
//                            line with (applyReview / addReviewItemAsLine);
//   analysis_review_item   = that item, per analysis run, with the AI value,
//                            the reviewer's decision and correction, its
//                            source document/page, evidence boxes and any
//                            calculation the analysis supplied.
//
// Never matched by description text. A line with no external_key, or a key no
// reviewed item carries, has no linked evidence — its basis is whatever the
// line itself records (lib/quantity), and "unknown" stays unknown.
//
// Calculation transparency comes only from what the analysis stored: the
// structured calculationData (recomputed by the existing measurementValidator)
// or the analysis's own verbatim `calculation` text. No formula is ever
// reconstructed for a quantity that does not carry one.
import type { AnalysisItemV1, EvidenceBox } from "@/lib/review/analysisSchemaV1";
import type { ReviewStatus, ReviewerValues } from "@/lib/review/reviewQueue";
import { computeCalculation, type FormulaId } from "@/lib/review/measurementValidator";
import { calculationAdvisoryText, validateItemCalculation } from "@/lib/review/calculationAdvisory";
import { db } from "@/lib/untypedDb";
import { loadReviewItems } from "@/lib/review/reviewStore";

export interface EvidenceItem {
  id: string;
  runId: string;
  ai: AnalysisItemV1;
  reviewStatus: ReviewStatus;
  reviewer?: ReviewerValues;
  reviewNote?: string;
  reviewedAt?: string;
}

export interface EvidenceLine {
  external_key?: string | null;
  qty: number | null;
  unit: string | null;
  source_document_id?: string | null;
  source_page?: string | null;
}

export interface CalculationExplanation {
  /** e.g. "Length 3.2 m × Width 4.5 m = 14.4 sqm" — only from stored structured data. */
  expression: string | null;
  /** The analysis's own words, verbatim, when it supplied them. */
  statedText: string | null;
  /** The existing advisory ("Arithmetic matches — not drawing verification.") or null. */
  advisory: string | null;
}

export interface LineEvidence {
  kind: "linked";
  reviewItemId: string;
  runId: string;
  itemKey: string;
  itemName: string;
  decision: ReviewStatus;
  /** What the analysis read. */
  extracted: { qty: number | null; unit: string | null };
  /** What the reviewer set, when they corrected it. */
  corrected: { qty: number | null | undefined; unit: string | undefined } | null;
  /** The value Apply would have written: reviewer's correction, else the extracted value. */
  reviewed: { qty: number | null; unit: string | null };
  /** True when the line no longer holds the reviewed value (edited since). */
  changedSinceReview: boolean;
  documentId: string | null;
  documentName: string | null;
  page: number | null;
  boxes: EvidenceBox[];
  pageSize: { width: number; height: number } | null;
  dimension: string | null;
  specification: string | null;
  calculation: CalculationExplanation | null;
  reviewNote: string | null;
  reviewerNotes: string | null;
  /** The line names a different source document than the review item. */
  documentMismatch: boolean;
}

export type LineEvidenceResult =
  | LineEvidence
  | { kind: "none"; reason: "no_key" | "no_reviewed_item" }
  | { kind: "ambiguous"; reviewItemIds: string[] };

const APPLICABLE: ReadonlySet<ReviewStatus> = new Set(["VERIFIED", "EDITED"]);

const FORMULA_JOIN: Partial<Record<FormulaId, string>> = {
  SUM_OF_SEGMENTS: " + ",
  LENGTH_TIMES_WIDTH: " × ",
  LENGTH_TIMES_WIDTH_TIMES_HEIGHT: " × ",
  COUNT_TIMES_MULTIPLIER: " × ",
  QUANTITY_PER_UNIT_TIMES_UNIT_COUNT: " × ",
  UNIT_CONVERSION: " → ",
};

const fmt = (n: number) => Number(n.toFixed(4)).toLocaleString("en-IN", { maximumFractionDigits: 4 });

/** A readable expression from the analysis's structured calculation — or null. */
export function explainCalculation(ai: AnalysisItemV1): CalculationExplanation | null {
  const stated = ai.calculation?.trim() || null;
  const data = ai.calculationData;
  let expression: string | null = null;
  if (data && data.inputs.length) {
    const join = FORMULA_JOIN[data.formula];
    const result = computeCalculation({ formula: data.formula, inputs: data.inputs });
    if (join && result.recomputed && result.resultValue != null) {
      const terms = data.inputs.map((i) => `${i.name} ${fmt(i.value)} ${i.unit}`.trim());
      expression = `${terms.join(join)} = ${fmt(result.resultValue)} ${result.resultUnit ?? ""}`.trim();
    }
  }
  const advisory = calculationAdvisoryText(validateItemCalculation(ai));
  if (!expression && !stated && !advisory) return null;
  return { expression, statedText: stated, advisory };
}

/**
 * The reviewed analysis item this line came from, by its stable key. Items
 * are given newest run first; the newest run holding a VERIFIED/EDITED item
 * with the key wins (that is the one a later Apply would have written).
 * Several such items in that run (the same mark on different floors) is
 * reported as ambiguous rather than guessed.
 */
export function evidenceForLine(line: EvidenceLine, itemsNewestFirst: EvidenceItem[]): LineEvidenceResult {
  const key = line.external_key?.trim();
  if (!key) return { kind: "none", reason: "no_key" };
  const matches = itemsNewestFirst.filter((it) => it.ai.key === key && APPLICABLE.has(it.reviewStatus));
  if (!matches.length) return { kind: "none", reason: "no_reviewed_item" };
  const run = matches[0].runId;
  const inRun = matches.filter((m) => m.runId === run);
  let pick = inRun[0];
  if (inRun.length > 1) {
    const byDoc = line.source_document_id ? inRun.filter((m) => m.ai.source?.documentId === line.source_document_id) : [];
    if (byDoc.length !== 1) return { kind: "ambiguous", reviewItemIds: inRun.map((m) => m.id) };
    pick = byDoc[0];
  }
  const ai = pick.ai;
  const rev = pick.reviewer;
  const corrected = pick.reviewStatus === "EDITED" && rev && ("quantity" in rev || "unit" in rev)
    ? { qty: rev.quantity, unit: rev.unit } : null;
  const reviewedQty = rev && "quantity" in rev ? rev.quantity ?? null : ai.quantity;
  const reviewedUnit = rev && "unit" in rev ? rev.unit ?? null : ai.unit ?? null;
  const lineQty = line.qty == null ? null : Number(line.qty);
  const changed = reviewedQty == null
    ? lineQty != null && lineQty !== 0
    : lineQty !== reviewedQty || (reviewedUnit ?? "").trim().toLowerCase() !== (line.unit ?? "").trim().toLowerCase();
  const docId = ai.source?.documentId ?? null;
  return {
    kind: "linked",
    reviewItemId: pick.id, runId: pick.runId, itemKey: ai.key, itemName: ai.item,
    decision: pick.reviewStatus,
    extracted: { qty: ai.quantity, unit: ai.unit ?? null },
    corrected,
    reviewed: { qty: reviewedQty, unit: reviewedUnit },
    changedSinceReview: changed,
    documentId: docId,
    documentName: ai.source?.document ?? null,
    page: ai.source?.page ?? null,
    boxes: ai.source?.evidence ?? [],
    pageSize: ai.source?.pageSize ?? null,
    dimension: (rev && "dimension" in rev ? rev.dimension : ai.dimension) ?? null,
    specification: (rev && "specification" in rev ? rev.specification : ai.specification) ?? null,
    calculation: explainCalculation(ai),
    reviewNote: pick.reviewNote?.trim() || null,
    reviewerNotes: rev?.notes?.trim() || null,
    documentMismatch: !!line.source_document_id && !!docId && line.source_document_id !== docId,
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** Every analysis run's review items for a BOQ, newest run first. A failed
 *  read throws (never shown as "no evidence"). */
export async function loadBoqEvidenceItems(boqId: string): Promise<EvidenceItem[]> {
  const { data, error } = await db.from("analysis_run").select("id, created_at").eq("boq_id", boqId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const out: EvidenceItem[] = [];
  for (const run of (data ?? []) as { id: string }[]) {
    for (const it of await loadReviewItems(run.id)) out.push({ ...it, runId: run.id });
  }
  return out;
}
export const boqEvidenceKey = (boqId: string | null) => ["boq-evidence-items", boqId] as const;
