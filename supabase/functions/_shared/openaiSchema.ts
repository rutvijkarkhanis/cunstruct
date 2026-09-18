// The JSON Schema OpenAI's Structured Outputs (strict mode) is constrained
// to when generating a Cunstruct analysis. Deliberately mirrors
// analysisSchemaV1.ts's AnalysisItemV1 shape (see analysisValidation.ts) —
// this is what the MODEL is asked to produce; parseAnalysisV1() is what
// actually validates/normalizes the response afterward. The two are kept
// separate on purpose: a schema-conformant response can still fail
// parseAnalysisV1's semantic checks (e.g. an evidence bbox out of range),
// and parseAnalysisV1 is the one source of truth for what's accepted.
//
// OpenAI's strict mode requires every property listed in "required" (use a
// union with null for anything optional) and "additionalProperties": false
// on every object.

const evidenceBoxSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
    page: { type: ["number", "null"] },
    label: { type: ["string", "null"] },
    claim: { type: ["string", "null"], enum: ["general", "quantity", "dimension", "specification", "location", null] },
  },
  required: ["bbox", "page", "label", "claim"],
};

const sourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_id: { type: ["string", "null"] },
    document: { type: ["string", "null"] },
    page: { type: ["number", "null"] },
    evidence: { type: "array", items: evidenceBoxSchema },
  },
  required: ["document_id", "document", "page", "evidence"],
};

const candidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "number" },
    unit: { type: ["string", "null"] },
    basis: { type: "string" },
    source: sourceSchema,
  },
  required: ["value", "unit", "basis", "source"],
};

const itemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    item: { type: "string" },
    description: { type: ["string", "null"] },
    quantity: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    dimension: { type: ["string", "null"] },
    specification: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    source: sourceSchema,
    confidence: { type: ["number", "null"] },
    status: { type: "string", enum: ["MEASURED", "INFERRED", "PENDING"] },
    calculation: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    candidates: { type: "array", items: candidateSchema },
  },
  required: [
    "key", "item", "description", "quantity", "unit", "dimension", "specification",
    "location", "source", "confidence", "status", "calculation", "notes", "candidates",
  ],
};

export const CUNSTRUCT_ANALYSIS_JSON_SCHEMA = {
  name: "cunstruct_analysis_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { type: "string" },
      items: { type: "array", items: itemSchema },
    },
    required: ["schema_version", "items"],
  },
};

// ── LOCATION mode (Phase 4) — observations, not BOQ items ────────────────────
// Reuses evidenceBoxSchema/sourceSchema verbatim (same evidence/coordinate
// contract as items — never a second evidence schema). observation_type is a
// closed enum here: this is the actual mechanism that keeps the model from
// reporting arbitrary/OCR-shaped text — it structurally cannot emit a value
// outside this list. Must stay byte-identical to OBSERVATION_TYPES in
// observationSchemaV1.ts; see observationValidation.test.ts for the drift check.
const OBSERVATION_TYPE_ENUM = [
  "opening", "wall_or_partition", "room_or_space", "structural_element", "fixture", "equipment",
  "dimension_annotation", "level_annotation", "schedule_entry", "plan_symbol", "finish_or_material",
  "other_construction_fact",
];

const observationAttributesSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dimension: { type: ["string", "null"] },
    specification: { type: ["string", "null"] },
    material: { type: ["string", "null"] },
  },
  // Deliberately no "quantity_hint" or any other field — LOCATION mode never
  // asserts a quantity. See the Phase 4 design review.
  required: ["dimension", "specification", "material"],
};

const observationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    observation_type: { type: "string", enum: OBSERVATION_TYPE_ENUM },
    mark: { type: ["string", "null"] },
    scope_hint: { type: ["string", "null"] },
    location_text: { type: ["string", "null"] },
    attributes: observationAttributesSchema,
    evidence_completeness: { type: "string", enum: ["FULL", "PARTIAL", "LIMITED"] },
    source: sourceSchema,
  },
  required: [
    "observation_type", "mark", "scope_hint", "location_text", "attributes", "evidence_completeness", "source",
  ],
};

export const CUNSTRUCT_OBSERVATION_JSON_SCHEMA = {
  name: "cunstruct_observation_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { type: "string" },
      observations: { type: "array", items: observationSchema },
    },
    required: ["schema_version", "observations"],
  },
};
