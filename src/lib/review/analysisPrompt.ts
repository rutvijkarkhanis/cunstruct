// ANALYSIS EXTRACTION PROMPT — configurable, provider-agnostic.
//
// The instruction a future server-side AI adapter would send with the drawings.
// Kept as data (not buried in a component) so it can be edited/versioned without
// touching UI. No provider is targeted and nothing here calls a model.

export interface AnalysisPromptOptions {
  projectType?: string;
  /** Extra project-specific guidance appended verbatim. */
  extra?: string;
}

export const ANALYSIS_SCHEMA_HINT = `{
  "schema_version": "cunstruct.analysis.v1",
  "items": [
    {
      "item": "W1", "quantity": 3, "unit": "nos",
      "dimension": "6' x 6'9\\"", "specification": "...", "location": "First Floor",
      "source": { "document": "floor-plan.pdf", "page": 4, "evidence": [ { "bbox": [x1,y1,x2,y2] } ] },
      "confidence": 0.94, "status": "MEASURED"
    }
  ]
}`;

const BASE_RULES = [
  "Analyse ALL supplied drawings.",
  "Do NOT invent quantities.",
  "Do NOT assume an item exists merely because it is common construction practice.",
  "Reconcile plans, elevations, schedules, sections and details.",
  "Prefer explicit drawing information over inference.",
  "Return status PENDING (and quantity null) where a quantity cannot be reliably established.",
  "Preserve measurement units.",
  "Include the source document and page for each item.",
  "Include evidence coordinates (bbox) whenever the drawing supports them; omit them rather than fabricating.",
  "Return VALID Cunstruct analysis JSON only — no prose, no markdown, no code fences.",
];

/** Build the extraction prompt. Deterministic; a pure string builder. */
export function buildAnalysisPrompt(opts: AnalysisPromptOptions = {}): string {
  const lines = [
    "You are a construction quantity surveyor extracting a BOQ analysis from drawings.",
    opts.projectType ? `Project type: ${opts.projectType}.` : "",
    "",
    "Rules:",
    ...BASE_RULES.map((r) => `- ${r}`),
    "",
    "Return exactly this shape (values illustrative):",
    ANALYSIS_SCHEMA_HINT,
    opts.extra ? `\nAdditional guidance:\n${opts.extra}` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
