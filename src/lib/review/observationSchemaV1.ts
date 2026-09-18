// Cunstruct Observation JSON — schema v1 (`cunstruct.observation.v1`).
//
// LOCATION mode's output: construction-relevant facts extracted directly from
// the drawings, each with precise evidence — independent of any BOQ (BOQ is
// never a filter on what gets extracted; matching against a BOQ is Phase 5's
// job, not this file's). Reuses the EXISTING evidence/source machinery from
// analysisSchemaV1.ts verbatim (AnalysisSource, EvidenceBox, parseSource) —
// this is deliberately NOT a second evidence coordinate system.
//
// Same honesty discipline as parseAnalysisV1: nothing here fabricates a
// category, an attribute, or a coordinate. A malformed evidence box is
// dropped independently; an observation with no valid evidence surviving is
// kept ONLY when it honestly declares evidence_completeness "LIMITED" —
// otherwise it is dropped rather than persisted as apparently-verified
// evidence it doesn't have.

import { extractJson } from "../boqEvalJson.ts";
import { parseSource, type AnalysisSource } from "./analysisSchemaV1.ts";

// The ONLY categories LOCATION mode may report. Bounded deliberately — this
// is what keeps LOCATION from becoming a generic OCR/transcription dump.
// Both the OpenAI-facing strict schema (openaiSchema.ts) and this parser
// read from this single list, so they can never drift apart.
export const OBSERVATION_TYPES = [
  "opening",
  "wall_or_partition",
  "room_or_space",
  "structural_element",
  "fixture",
  "equipment",
  "dimension_annotation",
  "level_annotation",
  "schedule_entry",
  "plan_symbol",
  "finish_or_material",
  "other_construction_fact",
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export type EvidenceCompleteness = "FULL" | "PARTIAL" | "LIMITED";

/** Deliberately bounded — no free-form/dynamic keys, and no quantity field:
 *  LOCATION mode never asserts a resolved quantity (that stays exclusively a
 *  BOQ-mode/reviewer concern). See the Phase 4 design review for why a
 *  "quantity_hint" was considered and rejected. */
export interface ObservationAttributes {
  dimension?: string;
  specification?: string;
  material?: string;
}

export interface ObservationV1 {
  observationType: ObservationType;
  mark?: string;
  scopeHint?: string;
  locationText?: string;
  attributes: ObservationAttributes;
  evidenceCompleteness: EvidenceCompleteness;
  /** The EXACT same AnalysisSource shape items use — never undefined (an
   *  observation with no source data in the raw payload still gets an empty
   *  `{ evidence: [] }` here), so downstream document/revision resolution
   *  (Phase 4's edge-function-only Layer B) always has one consistent shape
   *  to inspect. */
  source: AnalysisSource;
}

export interface ObservationParseV1 {
  ok: boolean;
  error?: string;
  observations?: ObservationV1[];
  warnings: string[];
}

const SCHEMA_V1 = "cunstruct.observation.v1";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function isObservationType(v: string): v is ObservationType {
  return (OBSERVATION_TYPES as readonly string[]).includes(v);
}

function normalizeCompleteness(v: unknown): EvidenceCompleteness {
  const s = str(v).toUpperCase();
  if (s.includes("LIMIT")) return "LIMITED";
  if (s.includes("PARTIAL")) return "PARTIAL";
  // Missing/unrecognized -> FULL, matching the DB column's own default. A
  // garbled completeness word is not the same severity as fabricated
  // evidence, so this normalizes rather than rejects the observation.
  return "FULL";
}

/** Only dimension/specification/material survive — anything else (including
 *  a "quantity_hint"-shaped key, deliberately not supported in v1) is
 *  silently dropped, never carried through as an unbounded attribute. */
function parseAttributes(raw: unknown): ObservationAttributes {
  const o = asObj(raw);
  const out: ObservationAttributes = {};
  if (str(o.dimension)) out.dimension = str(o.dimension);
  if (str(o.specification)) out.specification = str(o.specification);
  if (str(o.material)) out.material = str(o.material);
  return out;
}

/**
 * Parse and validate a `cunstruct.observation.v1` payload. Malformed JSON or
 * a missing/empty observations array -> ok:false. Per-observation problems
 * (unrecognized type, no surviving evidence without LIMITED) drop that one
 * observation with a warning; they never fail the whole batch.
 */
export function parseObservationsV1(text: string): ObservationParseV1 {
  const warnings: string[] = [];
  if (!(text ?? "").trim()) return { ok: false, error: "No observation JSON supplied.", warnings };

  const parsed = extractJson(text);
  if (parsed === undefined) {
    return { ok: false, error: "Invalid JSON — no JSON object found.", warnings };
  }

  let arr: unknown;
  let schemaVersion = SCHEMA_V1;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else {
    const obj = asObj(parsed);
    if (str(obj.schema_version)) schemaVersion = str(obj.schema_version);
    arr = obj.observations;
  }
  void schemaVersion; // carried for parity with parseAnalysisV1; not yet surfaced separately

  if (!Array.isArray(arr)) {
    return { ok: false, error: 'JSON schema error — expected an "observations" array.', warnings };
  }
  if (arr.length === 0) {
    return { ok: false, error: 'The "observations" array is empty — nothing to persist.', warnings };
  }

  const observations: ObservationV1[] = [];
  arr.forEach((raw, idx) => {
    const o = asObj(raw);
    const label = `observation ${idx + 1}`;

    const typeStr = str(o.observation_type ?? o.observationType);
    if (!typeStr || !isObservationType(typeStr)) {
      warnings.push(`"${label}": missing or unrecognized observation_type "${typeStr}" — skipped (never invented).`);
      return;
    }

    const evidenceCompleteness = normalizeCompleteness(o.evidence_completeness ?? o.evidenceCompleteness);
    // Reuses the EXISTING parseSource (analysisSchemaV1.ts) verbatim — same
    // per-box validation, same "drop the box, warn, never fabricate" rule.
    const source = parseSource(o.source, warnings, label) ?? { evidence: [] };

    if (source.evidence.length === 0 && evidenceCompleteness !== "LIMITED") {
      warnings.push(`"${label}": no valid evidence and evidence_completeness is not LIMITED — skipped (never persisted as apparently-verified evidence it doesn't have).`);
      return;
    }

    observations.push({
      observationType: typeStr,
      mark: str(o.mark) || undefined,
      scopeHint: str(o.scope_hint ?? o.scopeHint) || undefined,
      locationText: str(o.location_text ?? o.locationText) || undefined,
      attributes: parseAttributes(o.attributes),
      evidenceCompleteness,
      source,
    });
  });

  if (observations.length === 0) {
    return { ok: false, error: "No valid observations found.", warnings };
  }

  return { ok: true, observations, warnings };
}
