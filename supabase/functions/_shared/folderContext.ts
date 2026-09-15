// Re-exports the EXISTING, already-tested folder helpers for the ai-analysis
// edge function's preflight display — deliberately NOT a second
// implementation (same pattern as analysisValidation.ts). documentFolders.ts
// is pure (no Supabase, no DOM) and uses relative, explicit-extension
// imports internally so it resolves unmodified under Deno as well as Vite.
//
// Folder data is used HERE ONLY for a human-readable "Floor 2" style label
// on the preflight response — it is never consulted by loadEligibleFiles(),
// computePreflight(), the content hash, or the analysis_run_source claim key
// in index.ts. See folderPath() below: it is a pure display lookup with no
// bearing on identity.
export { folderBreadcrumb, type FolderNode } from "../../../src/lib/documentFolders.ts";
