// FIND SIMILAR — schema v1 (`cunstruct.similar.v1`).
//
// A deliberately SEPARATE, minimal contract from analysisSchemaV1.ts
// (AnalysisItemV1 — a BOQ item), observationSchemaV1.ts (ObservationV1 — a
// whole-document LOCATION batch observation), and identifySchemaV1.ts
// (IdentificationCandidateV1 — one answer to "what is at this one point").
// Find Similar answers a different question: "given this ALREADY-CONFIRMED
// identification, where ELSE in the document does the same kind of element
// occur?" — semantic/visual AI similarity, never geometric/shape matching
// (see the Find Similar Phase 1 investigation report).
//
// `SimilarMatchV1` is deliberately shaped identically to
// `IdentificationCandidateV1` (label, description?, confidence, evidence) —
// each match is independently displayable/confirmable with no cross-match
// state, same "never fabricate" discipline as every other manual parser
// here. Confirmed/rejected state is NOT part of this contract — it stays
// client-side React state only (see the Find Similar investigation report,
// decision 5: fully ephemeral).
//
// Reuses the EXISTING EvidenceBox type verbatim — a match's evidence can
// carry its own `page`, so one response can legitimately report matches
// spanning every page of the document in a single round trip.
//
// Relative + explicit extension (not the usual "@/..." alias) so this pure
// module can be imported unmodified from the ai-analysis Supabase Edge
// Function (Deno requires explicit extensions and has no "@/" alias) as well
// as from the browser build — same convention as identifySchemaV1.ts.
import { parseEvidenceBox, normalizeConfidenceNumber, type EvidenceBox } from "./analysisSchemaV1.ts";

export const SIMILAR_SCHEMA_V1 = "cunstruct.similar.v1";

/** The confirmed identification Find Similar is searching for more
 *  occurrences of. Always supplied by the CALLER (the already-confirmed
 *  `IdentificationCandidateV1`), never re-derived from the model's own
 *  response — same discipline as `IdentifyResultV1.point`. */
export interface SimilarReferenceV1 {
  label: string;
  description?: string;
  evidence: EvidenceBox[];
}

/** One independent match. Find Similar never collapses multiple real
 *  occurrences into one match, and never fabricates a location — an
 *  uncertain or partial occurrence is returned with a lower `confidence`,
 *  not omitted. Find Similar never creates or edits a BOQ line, a type, or
 *  an instance — this is identification of OTHER occurrences only. */
export interface SimilarMatchV1 {
  /** A short, concrete label for what was found, e.g. "Door" — never a BOQ
   *  item key and never a quantity. */
  label: string;
  description?: string;
  /** 0..1, or null if the model didn't supply one (never invented). Purely
   *  informational — never itself used as the matching signal. */
  confidence: number | null;
  /** Anchored to the matched location, in the same page-space convention as
   *  every other evidence box in the app. Each box carries its OWN `page`
   *  (EvidenceBox.page), so matches can span the whole document. */
  evidence: EvidenceBox[];
}

export interface FindSimilarResultV1 {
  schemaVersion: string;
  reference: SimilarReferenceV1;
  /** Empty when nothing credible was found elsewhere in the document — an
   *  honest "no similar occurrences," never a fabricated guess. */
  matches: SimilarMatchV1[];
}

export interface FindSimilarParseV1 {
  ok: boolean;
  error?: string;
  result?: FindSimilarResultV1;
  warnings: string[];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function parseMatch(raw: unknown, warnings: string[], index: number): SimilarMatchV1 | null {
  const o = asObj(raw);
  const label = str(o.label);
  if (!label) { warnings.push(`match[${index}]: missing label — dropped`); return null; }
  const evidenceRaw = Array.isArray(o.evidence) ? o.evidence : [];
  const evidence = evidenceRaw.map((b) => parseEvidenceBox(b)).filter((b): b is EvidenceBox => b != null);
  const { value: confidence } = normalizeConfidenceNumber(o.confidence);
  const out: SimilarMatchV1 = { label, confidence, evidence };
  if (str(o.description)) out.description = str(o.description);
  return out;
}

/**
 * Parse a raw JSON string (the model's own output) into a
 * FindSimilarResultV1. Never fabricates: a malformed match is dropped with a
 * warning; a fundamentally unparseable response returns ok:false rather than
 * guessing a result. `reference` is supplied by the CALLER (the already-
 * confirmed identification the search was run for) rather than read from
 * the model's response, so a result can never be anchored to a reference the
 * model invented or altered.
 */
export function parseFindSimilarResultV1(rawJson: string, reference: SimilarReferenceV1): FindSimilarParseV1 {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: "Response was not valid JSON", warnings };
  }
  const o = asObj(data);
  if (!Array.isArray(o.matches)) {
    return { ok: false, error: "Expected a \"matches\" array in the response", warnings };
  }
  const schemaVersion = str(o.schema_version) || SIMILAR_SCHEMA_V1;
  const matches = o.matches
    .map((m, i) => parseMatch(m, warnings, i))
    .filter((m): m is SimilarMatchV1 => m != null);
  return { ok: true, result: { schemaVersion, reference, matches }, warnings };
}
