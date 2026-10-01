// CLICK-TO-IDENTIFY PROMPT — the instruction text for a single, on-demand
// "what is at this point" request. Deliberately SEPARATE from
// analysisPrompt.ts's buildAnalysisPrompt/buildObservationPrompt (the
// existing BOQ/LOCATION extraction prompts, both of which instruct the
// model to analyse an ENTIRE drawing) — this one scopes the model to ONE
// point on ONE page, and must never be confused with, or merged into, the
// whole-document prompts. Kept as data (not buried in a component), same
// convention as analysisPrompt.ts.
//
// Relative + explicit extension (not the usual "@/..." alias) so this pure
// module can be imported unmodified from the ai-analysis Supabase Edge
// Function (Deno) as well as the browser build — same convention as
// analysisPrompt.ts.

export interface IdentifyPromptArgs {
  page: number;
  point: { x: number; y: number };
  /** Real text runs already extracted from the page's own content stream
   *  (pdfGeometry.ts), near the clicked point — never invented here. Empty
   *  when nothing nearby was extracted (e.g. a raster/scanned page). */
  nearbyText: string[];
}

export function buildIdentifyPrompt({ page, point, nearbyText }: IdentifyPromptArgs): string {
  const lines = [
    "You are looking at a construction drawing (architectural/structural/MEP). The user has clicked a single, specific point on this drawing and wants to know what is there.",
    "",
    `The click is on page ${page}, at approximately x=${Math.round(point.x)}, y=${Math.round(point.y)} in the page's own coordinate space (top-left origin, y-down, in points at the page's native scale).`,
  ];
  if (nearbyText.length > 0) {
    lines.push(
      "",
      "Text actually printed on the drawing near this point (closest first) — use it as a hint for scale, labeling, or room context, but verify visually rather than trusting it blindly:",
      ...nearbyText.map((t) => `- "${t}"`),
    );
  }
  lines.push(
    "",
    "Identify the single building element, annotation, or drawn object closest to this exact point — for example a door, window, wall, column, fixture, dimension line, or room label.",
    "Rules:",
    "- Look ONLY at what is at or immediately around the clicked point. Do not report unrelated items elsewhere on the sheet.",
    "- If you can identify it, return exactly one candidate: a short label (e.g. \"Door\", \"Window\", \"Column\"), an optional one-sentence description, a confidence from 0 to 1, and an evidence bounding box (same page-space coordinate convention as above) tightly around the identified element.",
    "- If you are genuinely unsure between two plausible answers, return both as separate candidates rather than guessing one.",
    "- If nothing identifiable is at this point (blank space, or a raster scan you cannot interpret), return an EMPTY candidates array. Never invent an answer just to have one.",
    "- Never report a quantity, a BOQ item, or a takeoff value — this is identification only, not estimation.",
  );
  return lines.join("\n");
}
