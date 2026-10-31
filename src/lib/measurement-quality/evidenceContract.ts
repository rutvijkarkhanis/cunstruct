/**
 * Versioned measurement-evidence contract (`cunstruct.measurement-evidence.v1`) and the adapter
 * boundary toward the existing review workflow.
 *
 * NOT CONNECTED to the product: nothing in the app imports this module, and it changes none of the
 * existing contracts (analysisSchemaV1, toAnalysisPayload, apply-review, pricing, exports). See
 * docs/measurement-quality/ADAPTER-BOUNDARY.md.
 *
 * Rules enforced here:
 *  - evidence is kept stage by stage; it is never collapsed into a single number or confidence;
 *  - the printed text is preserved verbatim next to the normalized value;
 *  - an engine decision is never a verification: only independent reviewer records can make a
 *    measurement "independently-verified", and only that makes it eligible downstream;
 *  - an ambiguous association is never applied unless the reviewer named the element;
 *  - the adapter emits a review-workflow candidate with quantity null (a dimension is not a BOQ
 *    quantity) and no rate, price or amount: it cannot create a priced BOQ record.
 */
import { z } from "zod";
import type { LinearDimension } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";

export const MEASUREMENT_EVIDENCE_SCHEMA = "cunstruct.measurement-evidence.v1";

const pt = z.tuple([z.number(), z.number()]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const Terminator = z.object({ kind: z.string(), at_pt: pt, along: z.number(), shapes: z.array(z.number()), evidence: z.string(), chosen: z.boolean() });
const EndAssociation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grid"), labels: z.array(z.string()).min(1), evidence: z.string() }),
  z.object({ kind: z.literal("edge"), via: z.enum(["through", "extension"]), shape: z.number(), evidence: z.string() }),
  z.object({ kind: z.literal("ambiguous"), candidates: z.array(z.string()), reason: z.string() }),
  z.object({ kind: z.literal("none"), reason: z.string() }),
]);

export const ReviewerRecord = z.object({
  reviewer_id: z.string().min(1),
  /** true only for a reviewer who did not develop or tune the engine and reviewed blind */
  independent: z.boolean(),
  blind: z.boolean(),
  verdict: z.enum(["correct", "incorrect", "ambiguous", "cannot-determine"]),
  at: z.string().min(10),
  /** Reviewer-supplied corrections; when present they, not the engine, are what is verified. */
  corrected_value: z.number().nullable().default(null),
  corrected_endpoints: z.tuple([pt, pt]).nullable().default(null),
  resolved_element: z.object({ kind: z.enum(["grid-to-grid", "grid-to-edge", "edge-to-edge", "other"]), end1: z.string().min(1), end2: z.string().min(1) }).nullable().default(null),
  source: z.string().min(1).describe("the response file / adjudication record this came from"),
});
export type ReviewerRecord = z.infer<typeof ReviewerRecord>;

export const ReviewState = z.enum(["unreviewed", "developer-reviewed", "needs-adjudication", "independently-verified", "independently-rejected"]);

export const MeasurementEvidenceV1 = z.object({
  schema: z.literal(MEASUREMENT_EVIDENCE_SCHEMA),
  evidence_id: z.string().min(1),
  source: z.object({ document_id: z.string().nullable(), file_name: z.string(), file_sha256: sha256, page: z.number().int().positive(), view: z.string().nullable(), page_size_pt: pt.nullable() }),
  printed: z.object({ text: z.string().min(1), text_anchor_pt: pt, text_height_pt: z.number().positive() }),
  normalized: z.object({ value: z.number(), unit: z.string().nullable(), unit_basis: z.enum(["printed", "page-note", "none"]) }),
  line: z.object({ a: pt, b: pt, joined_across_text: z.boolean(), decision: z.enum(["found", "chosen-by-endpoints", "ambiguous", "not-found"]) }).nullable(),
  endpoints: z.object({ decision: z.string(), reason: z.string(), start: pt.nullable(), end: pt.nullable(), length_pt: z.number().nullable(), text_position: z.number().nullable() }).nullable(),
  terminators: z.array(Terminator),
  association: z.object({ decision: z.enum(["associated", "ambiguous", "unassociated", "not-attempted"]), measures: z.enum(["grid-to-grid", "grid-to-edge", "edge-to-edge"]).nullable(), reason: z.string(), ends: z.array(EndAssociation) }),
  scale: z.object({ decision: z.string(), region: z.string().nullable(), value_per_point: z.number().nullable(), based_on: z.number().nullable(), measured: z.number().nullable(), deviation: z.number().nullable(), tolerance: z.number().nullable() }),
  conflicts: z.object({ cross_view: z.object({ grids: z.string(), values: z.array(z.number()), ids: z.array(z.string()), conflict: z.boolean() }).nullable(), chain: z.object({ ids: z.array(z.string()), sum: z.number(), agrees: z.boolean() }).nullable(), possible_repeat_of: z.string().nullable() }),
  decisions: z.object({ text: z.string(), parse: z.string(), unit: z.string(), line: z.string(), endpoints: z.string(), association: z.string(), scale: z.string(), overall: z.enum(["acceptable", "hold", "reject"]) }),
  reasons: z.array(z.string()),
  engine: z.object({ name: z.literal("linearDimensions"), candidate_fingerprint: sha256, core_fingerprint: sha256.nullable(), engine_record_id: z.string() }),
  review: z.object({ state: ReviewState, records: z.array(ReviewerRecord) }),
}).superRefine((e, ctx) => {
  const st = e.review.state, recs = e.review.records;
  const indep = recs.filter((r) => r.independent && r.blind);
  // "independently-verified" needs ≥1 independent blind "correct" and no independent dissent
  if (st === "independently-verified") {
    if (!indep.some((r) => r.verdict === "correct")) ctx.addIssue({ code: "custom", path: ["review", "state"], message: "independently-verified needs an independent, blind reviewer record with verdict 'correct'" });
    if (indep.some((r) => r.verdict !== "correct")) ctx.addIssue({ code: "custom", path: ["review", "state"], message: "independent reviewers disagree: the state must be needs-adjudication" });
  }
  if (st === "developer-reviewed" && !recs.length) ctx.addIssue({ code: "custom", path: ["review", "records"], message: "developer-reviewed needs a record" });
  if (st === "unreviewed" && recs.length) ctx.addIssue({ code: "custom", path: ["review", "state"], message: "records exist: the state cannot be unreviewed" });
  if (e.printed.text.replace(/[\s,]/g, "") === "") ctx.addIssue({ code: "custom", path: ["printed", "text"], message: "printed text must be preserved" });
});
export type MeasurementEvidenceV1 = z.infer<typeof MeasurementEvidenceV1>;

/** Engine record → evidence (unreviewed). Coordinates and text are copied, never recomputed. */
export function evidenceFromEngine(d: LinearDimension, ctx: { file_name: string; file_sha256: string; document_id?: string | null; view?: string | null; page_size_pt?: [number, number] | null; candidate_fingerprint: string; core_fingerprint?: string | null }): MeasurementEvidenceV1 {
  const l = d.line;
  const u = l ? (() => { const L = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]); return [(l.b[0] - l.a[0]) / L, (l.b[1] - l.a[1]) / L]; })() : null;
  const chosen = new Set(d.endpoints?.ends?.map((t) => t.at) ?? []);
  const terms = l && u && d.endpoints ? [...d.endpoints.left, ...d.endpoints.right].map((t) => ({ kind: t.kind, at_pt: [l.a[0] + u[0] * t.at, l.a[1] + u[1] * t.at] as [number, number], along: t.at, shapes: t.shapes, evidence: t.evidence, chosen: chosen.has(t.at) })) : [];
  return MeasurementEvidenceV1.parse({
    schema: MEASUREMENT_EVIDENCE_SCHEMA,
    evidence_id: `${ctx.file_sha256.slice(0, 12)}:${d.id}`,
    source: { document_id: ctx.document_id ?? null, file_name: ctx.file_name, file_sha256: ctx.file_sha256, page: d.page, view: ctx.view ?? null, page_size_pt: ctx.page_size_pt ?? null },
    printed: { text: d.text, text_anchor_pt: d.textAnchor, text_height_pt: d.textHeight },
    normalized: { value: d.parsed.value, unit: d.unit, unit_basis: d.unitBasis },
    line: l ? { a: l.a, b: l.b, joined_across_text: Boolean(l.joinedAcrossText), decision: d.decisions.line } : null,
    endpoints: d.endpoints ? { decision: d.endpoints.decision, reason: d.endpoints.reason, start: d.endpoints.start, end: d.endpoints.end, length_pt: d.endpoints.length, text_position: d.endpoints.textPosition ?? null } : null,
    terminators: terms,
    association: d.association ? { decision: d.association.decision, measures: d.association.measures, reason: d.association.reason, ends: d.association.ends } : { decision: "not-attempted", measures: null, reason: "not attempted", ends: [] },
    scale: { decision: d.decisions.scale, region: d.scaleCheck?.region ?? null, value_per_point: d.scaleCheck?.valuePerPoint ?? null, based_on: d.scaleCheck?.basedOn ?? null, measured: d.scaleCheck?.measured ?? null, deviation: d.scaleCheck?.deviation ?? null, tolerance: d.scaleCheck?.tolerance ?? null },
    conflicts: { cross_view: d.crossView ?? null, chain: d.covers ?? null, possible_repeat_of: d.possibleRepeatOf ?? null },
    decisions: d.decisions, reasons: d.reasons,
    engine: { name: "linearDimensions", candidate_fingerprint: ctx.candidate_fingerprint, core_fingerprint: ctx.core_fingerprint ?? null, engine_record_id: d.id },
    review: { state: "unreviewed", records: [] },
  });
}

/** Adds reviewer records and derives the review state from them (never from the engine). */
export function withReview(e: MeasurementEvidenceV1, records: ReviewerRecord[]): MeasurementEvidenceV1 {
  const all = [...e.review.records, ...records.map((r) => ReviewerRecord.parse(r))];
  const indep = all.filter((r) => r.independent && r.blind);
  const verdicts = new Set(indep.map((r) => r.verdict));
  const state = indep.length === 0 ? (all.length ? "developer-reviewed" : "unreviewed")
    : verdicts.size > 1 ? "needs-adjudication"
    : verdicts.has("correct") ? "independently-verified" : "independently-rejected";
  return MeasurementEvidenceV1.parse({ ...e, review: { state, records: all } });
}

export interface Eligibility { eligible: boolean; reasons: string[] }
/** May this measurement enter the existing review workflow as a reviewer-verified dimension? */
export function downstreamEligibility(e: MeasurementEvidenceV1): Eligibility {
  const r: string[] = [];
  const parsed = MeasurementEvidenceV1.safeParse(e);
  if (!parsed.success) return { eligible: false, reasons: ["evidence does not satisfy the contract"] };
  if (e.review.state !== "independently-verified") r.push(`review state is ${e.review.state}; only independently-verified measurements are eligible (an engine '${e.decisions.overall}' is not a verification)`);
  const indepOk = e.review.records.filter((x) => x.independent && x.blind && x.verdict === "correct");
  if (e.association.decision !== "associated" && !indepOk.some((x) => x.resolved_element))
    r.push(`association is ${e.association.decision}: it is applied only when an independent reviewer names the measured element`);
  if (!e.normalized.unit && !indepOk.some((x) => x.corrected_value !== null)) r.push("no unit established");
  return { eligible: r.length === 0, reasons: r };
}

/**
 * Adapter output: a candidate item for the EXISTING review workflow, in the raw cunstruct.analysis.v1
 * item shape (the shape toAnalysisPayload emits). Quantity is always null and status PENDING: a
 * dimension is evidence for a quantity, not a BOQ quantity, so a person must still review and
 * compute it there. No rate, price or amount field exists in the output. Throws when not eligible.
 */
export function toReviewWorkflowCandidate(e: MeasurementEvidenceV1, key: string) {
  const el = downstreamEligibility(e);
  if (!el.eligible) throw new Error(`not eligible: ${el.reasons.join("; ")}`);
  const rec = e.review.records.filter((x) => x.independent && x.blind && x.verdict === "correct");
  const value = rec.find((x) => x.corrected_value !== null)?.corrected_value ?? e.normalized.value;
  const ends = rec.find((x) => x.corrected_endpoints)?.corrected_endpoints ?? (e.endpoints?.start && e.endpoints.end ? [e.endpoints.start, e.endpoints.end] : null);
  const element = rec.find((x) => x.resolved_element)?.resolved_element ?? null;
  const xs = ends ? [ends[0][0], ends[1][0], e.printed.text_anchor_pt[0]] : [e.printed.text_anchor_pt[0]];
  const ys = ends ? [ends[0][1], ends[1][1], e.printed.text_anchor_pt[1]] : [e.printed.text_anchor_pt[1]];
  return {
    key,
    item: `Dimension ${e.printed.text}${e.source.view ? ` (${e.source.view})` : ""}`,
    description: element ? `${element.kind}: ${element.end1} → ${element.end2}` : e.association.measures ?? undefined,
    quantity: null,
    unit: e.normalized.unit ?? undefined,
    dimension: `${value}${e.normalized.unit ? ` ${e.normalized.unit}` : ""} (printed "${e.printed.text}")`,
    location: e.source.view ?? `Page ${e.source.page}`,
    source: { document_id: e.source.document_id ?? undefined, page: e.source.page, evidence: [{ bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], page: e.source.page, claim: "dimension", label: e.printed.text }] },
    confidence: null,
    status: "PENDING",
    notes: `Measurement evidence ${e.evidence_id}, independently verified by ${rec.map((x) => x.reviewer_id).join(", ")}; engine ${e.engine.candidate_fingerprint.slice(0, 12)}. A dimension, not a quantity: compute and review the BOQ quantity in the Review Workstation.`,
    candidates: [],
  };
}
