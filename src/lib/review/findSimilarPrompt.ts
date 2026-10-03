// FIND SIMILAR PROMPT — the instruction text for an on-demand "where else
// does this occur" request. Deliberately the INVERSE of identifyPrompt.ts's
// buildIdentifyPrompt, which explicitly scopes the model to one point and
// instructs it to "look ONLY at what is at or immediately around the
// clicked point... Do not report unrelated items elsewhere on the sheet."
// This prompt does the opposite on purpose: it hands the model an
// already-confirmed reference element and asks it to scan the ENTIRE
// document for other occurrences. Never merged with, or confused for,
// identifyPrompt.ts/analysisPrompt.ts/observationPrompt.ts — each targets a
// different question. Kept as data (not buried in a component), same
// convention as the other prompt builders.
//
// Relative + explicit extension (not the usual "@/..." alias) so this pure
// module can be imported unmodified from the ai-analysis Supabase Edge
// Function (Deno) as well as the browser build — same convention as
// identifyPrompt.ts.
import type { SimilarReferenceV1 } from "./findSimilarSchemaV1.ts";

export interface FindSimilarPromptArgs {
  reference: SimilarReferenceV1;
}

export function buildFindSimilarPrompt({ reference }: FindSimilarPromptArgs): string {
  const lines = [
    "You are looking at a construction drawing (architectural/structural/MEP), which may span multiple pages/sheets.",
    "",
    `The user has already identified and confirmed one specific element as a reference: a "${reference.label}"${reference.description ? ` — ${reference.description}` : ""}.`,
  ];
  if (reference.evidence.length > 0) {
    lines.push(
      "Its approximate location(s) on the drawing (page-space, top-left origin, y-down, in points at the page's native scale):",
      ...reference.evidence.map((b) => `- page ${b.page ?? "?"}, bbox [${b.bbox.join(", ")}]`),
    );
  }
  lines.push(
    "",
    "Search the ENTIRE document — every page, not just the page the reference is on — for OTHER occurrences of the same real-world element type/category as this reference.",
    "Rules:",
    "- Do NOT include the reference element itself as a match.",
    "- Return every plausible occurrence as its own SEPARATE match. Never collapse two or more real, distinct occurrences into a single match, even if they are close together, identical in appearance, or on the same page.",
    "- Include uncertain or partial matches rather than silently dropping them — express uncertainty with a lower confidence value and a brief note in the description, not by omitting the match.",
    "- Each match needs a short label, an optional one-sentence description, a confidence from 0 to 1, and an evidence bounding box (same page-space coordinate convention as above, with its own page number) tightly around the matched element.",
    "- Never invent or guess a location. If you cannot find any credible occurrence elsewhere in the document, return an EMPTY matches array — this is a normal, honest outcome, not an error.",
    "- Where possible, distinguish an element that is merely visually similar but semantically different from the reference (e.g. a different kind of fixture, opening, or component that happens to look alike) from a genuine match of the same type — prefer a lower confidence and an explanatory description over a false positive.",
    "- Never report a quantity, a BOQ item, or a takeoff value, and never imply or infer a count of anything — this is identification of individual occurrences only, not estimation.",
  );
  return lines.join("\n");
}
