// Re-exports the EXISTING, already-tested analysis parser/review-queue logic
// for use from the ai-analysis edge function — deliberately NOT a second
// implementation. Both `analysisSchemaV1.ts` and `reviewQueue.ts` are pure
// (no browser API, no Supabase import) and now use relative,
// explicit-extension imports internally (see the comments added there) so
// they resolve unmodified under Deno as well as under Vite/Vitest.
//
// generate() in index.ts feeds OpenAI's raw JSON output through
// parseAnalysisV1() — the SAME validation a human pasting JSON goes through —
// so a malformed AI response is rejected exactly like malformed pasted JSON,
// never a separate/looser check.
export { parseAnalysisV1, type AnalysisV1, type AnalysisItemV1 } from "../../../src/lib/review/analysisSchemaV1.ts";
export { buildReviewItems, type ReviewItem } from "../../../src/lib/review/reviewQueue.ts";
