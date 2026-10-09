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

// Must stay byte-identical, in the same order, to CALCULATION_FORMULA_IDS in
// analysisSchemaV1.ts; see analysisSchemaV1.test.ts for the drift check —
// same hand-duplicated-enum + runtime-equality-test pattern as
// OBSERVATION_TYPE_ENUM above. measurementValidator.ts's FormulaId type is
// the actual source of truth; it is erased at runtime and cannot populate
// this enum directly.
const CALCULATION_FORMULA_ENUM = [
  "SUM_OF_SEGMENTS",
  "LENGTH_TIMES_WIDTH",
  "LENGTH_TIMES_WIDTH_TIMES_HEIGHT",
  "COUNT_TIMES_MULTIPLIER",
  "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT",
  "UNIT_CONVERSION",
];

const calculationInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    value: { type: "number" },
    unit: { type: "string" },
  },
  required: ["name", "value", "unit"],
};

// Nullable: most items have no calculation_data at all. Only the six
// code-owned formulas above are ever legal here — never an arbitrary
// model-chosen label.
const calculationDataSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    formula: { type: "string", enum: CALCULATION_FORMULA_ENUM },
    inputs: { type: "array", items: calculationInputSchema },
  },
  required: ["formula", "inputs"],
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
    calculation_data: calculationDataSchema,
    notes: { type: ["string", "null"] },
    candidates: { type: "array", items: candidateSchema },
  },
  required: [
    "key", "item", "description", "quantity", "unit", "dimension", "specification",
    "location", "source", "confidence", "status", "calculation", "calculation_data", "notes", "candidates",
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

// ── Click-to-Identify (new) — a single clicked point's identification,
// never a BOQ item and never a LOCATION observation. Reuses evidenceBoxSchema
// verbatim (same evidence/coordinate contract as every other mode — never a
// second evidence schema). Deliberately has no quantity/unit/status field at
// all: identification is not estimation.
const identifyCandidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    description: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
    evidence: { type: "array", items: evidenceBoxSchema },
  },
  required: ["label", "description", "confidence", "evidence"],
};

export const CUNSTRUCT_IDENTIFY_JSON_SCHEMA = {
  name: "cunstruct_identify_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { type: "string" },
      candidates: { type: "array", items: identifyCandidateSchema },
    },
    required: ["schema_version", "candidates"],
  },
};

// ── Find Similar (new) — given an already-confirmed identification, other
// occurrences of the same element type elsewhere in the document. Reuses
// evidenceBoxSchema verbatim. Deliberately has no quantity/unit/status
// field, same as identify: this is identification of occurrences, never
// estimation. A "match" is shaped identically to an identify "candidate" —
// one independent, confirmable finding — but the array is named `matches`
// to keep the two contracts (and their JSON) visually distinct.
const similarMatchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    description: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
    evidence: { type: "array", items: evidenceBoxSchema },
  },
  required: ["label", "description", "confidence", "evidence"],
};

export const CUNSTRUCT_FIND_SIMILAR_JSON_SCHEMA = {
  name: "cunstruct_find_similar_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { type: "string" },
      matches: { type: "array", items: similarMatchSchema },
    },
    required: ["schema_version", "matches"],
  },
};
