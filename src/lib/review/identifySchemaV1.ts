// CLICK-TO-IDENTIFY — schema v1 (`cunstruct.identify.v1`).
//
// A deliberately SEPARATE, minimal contract from analysisSchemaV1.ts
// (AnalysisItemV1 — a BOQ item) and observationSchemaV1.ts (ObservationV1 —
// a whole-document LOCATION observation). This is neither: it is a single,
// on-demand answer to "what is at the point the user just clicked." See the
// Click-to-Identify investigation report for why a new contract was chosen
// over extending either existing one — in short, AnalysisItemV1 is shaped
// around quantity/unit/aiStatus (none of which apply here), and LOCATION's
// ObservationV1 is a whole-document batch extraction, not a per-click
// request/response.
//
// Reuses the EXISTING EvidenceBox type verbatim (the same page-space
// coordinate convention the rest of the app already uses — see
// evidenceCoords.ts) rather than inventing a second box shape. Follows the
// same "never fabricate" manual-parser discipline as parseAnalysisV1/
// parseObservationsV1: a malformed candidate is dropped with a warning,
// never invented; a missing confidence stays null, never guessed; an empty
// candidates array is an honest "unable to identify," not an error.
//
// Relative + explicit extension (not the usual "@/..." alias) so this pure
// module can be imported unmodified from the ai-analysis Supabase Edge
// Function (Deno requires explicit extensions and has no "@/" alias) as well
// as from the browser build — same convention as analysisSchemaV1.ts.
import { parseEvidenceBox, normalizeConfidenceNumber, type EvidenceBox } from "./analysisSchemaV1.ts";

export const IDENTIFY_SCHEMA_V1 = "cunstruct.identify.v1";

/** One candidate answer to "what is at the clicked point." Usually there is
 *  exactly one; a genuinely ambiguous click may return a short list instead
 *  of the model silently picking one. Click-to-Identify never creates or
 *  edits a BOQ line or an instance — this is identification only. */
export interface IdentificationCandidateV1 {
  /** A short, concrete label, e.g. "Door", "Window", "Column" — never a BOQ
   *  item key and never a quantity. */
  label: string;
  description?: string;
  /** 0..1, or null if the model didn't supply one (never invented). */
  confidence: number | null;
  /** Anchored near the clicked point, in the SAME page-space convention as
   *  every other evidence box in the app. Reuses EvidenceBox verbatim —
   *  never a second evidence/coordinate shape. */
  evidence: EvidenceBox[];
}

export interface IdentifyResultV1 {
  schemaVersion: string;
  /** The exact point the user clicked, in page space — carried through so
   *  the UI can draw the click marker even for a result with zero
   *  candidates. This is ALWAYS the point the client sent, never trusted
   *  from the model's own response (see parseIdentifyResultV1). */
  point: { page: number; x: number; y: number };
  /** Empty when the model could not identify anything at this point — an
   *  honest "unable to identify," never a fabricated guess. */
  candidates: IdentificationCandidateV1[];
}

export interface IdentifyParseV1 {
  ok: boolean;
  error?: string;
  result?: IdentifyResultV1;
  warnings: string[];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function parseCandidate(raw: unknown, warnings: string[], index: number): IdentificationCandidateV1 | null {
  const o = asObj(raw);
  const label = str(o.label);
  if (!label) { warnings.push(`candidate[${index}]: missing label — dropped`); return null; }
  const evidenceRaw = Array.isArray(o.evidence) ? o.evidence : [];
  const evidence = evidenceRaw.map((b) => parseEvidenceBox(b)).filter((b): b is EvidenceBox => b != null);
  const { value: confidence } = normalizeConfidenceNumber(o.confidence);
  const out: IdentificationCandidateV1 = { label, confidence, evidence };
  if (str(o.description)) out.description = str(o.description);
  return out;
}

/**
 * Parse a raw JSON string (the model's own output) into an IdentifyResultV1.
 * Never fabricates: a malformed candidate is dropped with a warning; a
 * fundamentally unparseable response returns ok:false rather than guessing a
 * result. `point` is supplied by the CALLER (the exact coordinate the client
 * sent for this request) rather than read from the model's response, so a
 * result can never be anchored to a point the model invented or altered.
 */
export function parseIdentifyResultV1(rawJson: string, point: { page: number; x: number; y: number }): IdentifyParseV1 {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: "Response was not valid JSON", warnings };
  }
  const o = asObj(data);
  if (!Array.isArray(o.candidates)) {
    return { ok: false, error: "Expected a \"candidates\" array in the response", warnings };
  }
  const schemaVersion = str(o.schema_version) || IDENTIFY_SCHEMA_V1;
  const candidates = o.candidates
    .map((c, i) => parseCandidate(c, warnings, i))
    .filter((c): c is IdentificationCandidateV1 => c != null);
  return { ok: true, result: { schemaVersion, point, candidates }, warnings };
}
