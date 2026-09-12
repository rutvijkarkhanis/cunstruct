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
      "dimension": "6' x 6'9\\"", "specification": "UPVC", "location": "First Floor",
      "source": {
        "document": "floor-plan.pdf", "page": 4,
        "evidence": [
          { "page": 4, "bbox": [x1,y1,x2,y2], "claim": "general" },
          { "page": 7, "bbox": [x1,y1,x2,y2], "claim": "quantity" },
          { "page": 7, "bbox": [x1,y1,x2,y2], "claim": "dimension" },
          { "page": 4, "bbox": [x1,y1,x2,y2], "claim": "location" },
          { "page": 5, "bbox": [x1,y1,x2,y2], "claim": "location" }
        ]
      },
      "confidence": 0.94, "status": "MEASURED"
    }
  ]
}`;

/** Shown alongside ANALYSIS_SCHEMA_HINT — the pattern for a quantity multiple
 *  supplied drawings disagree on, instead of silently picking one of them. */
export const CANDIDATES_SCHEMA_HINT = `{
  "item": "Total slab area", "quantity": null, "unit": "sq ft", "status": "PENDING",
  "candidates": [
    { "value": 25176, "unit": "sq ft", "basis": "Arithmetic sum of component slab areas" },
    { "value": 25101, "unit": "sq ft", "basis": "Printed total on the 2025 area statement" }
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
  "Tag each evidence region with a `claim`: `general` (item existence — the default when `claim` is omitted), `quantity`, `dimension`, `specification`, or `location`.",
  "Different claims may point to different evidence regions, and those regions may be on different pages — do not assume one region covers every claim.",
  "The same evidence region may support more than one claim (e.g. a schedule row listing quantity, dimension and specification together): add one evidence entry per claim, each with the same bbox and page.",
  "A single claim may also be supported by more than one evidence region (e.g. a quantity confirmed on both a plan and a schedule) — include every region that supports it.",
  "Evidence coordinates must be given in the page's own RENDERED coordinate space (top-left origin, as the page looks when opened normally) — never the page's raw/unrotated content-stream coordinates. This matters most for a rotated page (e.g. a landscape schedule or detail sheet inside an otherwise-portrait set).",
  "Never invent evidence coordinates for any claim. If reliable evidence cannot be established for a claim, omit that evidence entry entirely; if the underlying value itself (e.g. the quantity) cannot be reliably established, use status PENDING (and quantity null) rather than fabricating either the value or its evidence.",
  "When different supplied drawings give DIFFERENT values for what should be the same quantity, do NOT pick one and do NOT average them. Use status PENDING (quantity null) and list every value found in a `candidates` array, each with a numeric `value` and a `basis` describing which source it came from (e.g. \"Printed total on the 2025 area statement\"). Only use `candidates` for a genuine cross-drawing disagreement — never as a substitute for a normal single value.",
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
    "",
    "When sources conflict, use this pattern instead of guessing a value:",
    CANDIDATES_SCHEMA_HINT,
    opts.extra ? `\nAdditional guidance:\n${opts.extra}` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
