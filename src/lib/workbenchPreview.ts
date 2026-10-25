// WORKBENCH PREVIEW GATE — decides whether the canonical estimation workbench
// (UX/UI revamp) may be shown in this build. Requirements (proposed charter
// v1.2 §8.2; Plan of Record v1.2 §1, §2 outcome A, §5B):
//   - off unless explicitly set: only VITE_CUNSTRUCT_WORKBENCH_PREVIEW === "true"
//     turns it on. Development mode never does;
//   - refuses when the build is configured against the production Supabase
//     project, by project id or by URL host;
//   - refuses unless the Supabase URL the client is built with is exactly the
//     canonical https://<project id>.supabase.co of the declared project id
//     (so a missing, malformed, differently spelled or mismatched target —
//     e.g. the production URL with a trailing slash — fails closed). A local
//     Supabase (http://127.0.0.1:54321) is therefore refused too;
//   - a presentation switch only. It is NOT an access control and NOT a
//     database-isolation boundary: row-level security permits staff writes
//     from any interface, and anyone who reaches a build that serves the
//     workbench can use it.
// There is deliberately no override here: the S3 validation override in the
// proposed charter is not authorised and not implemented.
//
// Used through WORKBENCH_PREVIEW_ENABLED by App.tsx (the preview-gated
// /app/projects/:id/workbench routes), ProjectShell, useStepLink, ProjectBoqs
// and lib/app/journey (journeyBoqFrom). PRODUCTION_PROJECT_REFS
// is checked against supabase/config.toml and the committed .env by
// workbenchPreview.test.ts.

/** The production Supabase project ref(s), as committed in supabase/config.toml and .env (public identifiers). */
export const PRODUCTION_PROJECT_REFS: readonly string[] = ["dkgjsobfljqoggalivzt"];

export type WorkbenchPreviewState =
  | { enabled: true; reason: "enabled" }
  | { enabled: false; reason: "flag-off" | "production-project" | "unverifiable-project" };

export interface WorkbenchPreviewEnv {
  VITE_CUNSTRUCT_WORKBENCH_PREVIEW?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PROJECT_ID?: string;
  DEV?: boolean;
}

function urlHost(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase() || null; } catch { return null; }
}

const canonicalUrl = (projectId: string) => "https://" + projectId + ".supabase.co";

/** Pure decision, for tests and for the runtime accessor below. `DEV` is ignored on purpose. */
export function workbenchPreviewState(env: WorkbenchPreviewEnv, productionRefs: readonly string[] = PRODUCTION_PROJECT_REFS): WorkbenchPreviewState {
  if (env.VITE_CUNSTRUCT_WORKBENCH_PREVIEW !== "true") return { enabled: false, reason: "flag-off" };
  const ref = (env.VITE_SUPABASE_PROJECT_ID ?? "").trim().toLowerCase();
  const host = urlHost(env.VITE_SUPABASE_URL);
  const refs = productionRefs.map((r) => r.toLowerCase());
  // Fail closed: a known production ref anywhere in the configuration refuses the preview.
  if (refs.some((r) => r && (ref === r || (host !== null && host.includes(r)) || (env.VITE_SUPABASE_URL ?? "").toLowerCase().includes(r)))) {
    return { enabled: false, reason: "production-project" };
  }
  // Fail closed: only the canonical URL of the declared (non-production)
  // project is verifiable — the same rule WORKBENCH_PREVIEW_ENABLED folds at build time.
  if (host === null || !env.VITE_SUPABASE_PROJECT_ID || env.VITE_SUPABASE_URL !== canonicalUrl(env.VITE_SUPABASE_PROJECT_ID)) {
    return { enabled: false, reason: "unverifiable-project" };
  }
  return { enabled: true, reason: "enabled" };
}

/** The decision for this build. Reads the same import.meta.env members the
 *  Supabase client is built with (src/integrations/supabase/client.ts), so
 *  build-time `define`s such as staging mode's (vite.config.ts) apply here too. */
export function workbenchPreview(): WorkbenchPreviewState {
  return workbenchPreviewState({
    VITE_CUNSTRUCT_WORKBENCH_PREVIEW: import.meta.env.VITE_CUNSTRUCT_WORKBENCH_PREVIEW,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PROJECT_ID: import.meta.env.VITE_SUPABASE_PROJECT_ID,
  });
}

/**
 * The build's decision as a constant. The comparisons before the call are
 * between build-time literals, so a build without the flag, with the
 * production project id, or whose Supabase URL is not exactly the canonical
 * URL of its declared project id (the production URL, a trailing slash,
 * other casing, malformed or empty) reduces this to `false` at build time and
 * drops the preview code (App.tsx imports the workbench only behind it).
 * The id literal must be PRODUCTION_PROJECT_REFS[0] (workbenchPreview.test.ts
 * checks it).
 * workbenchPreview() then repeats the full check at run time. Still a
 * presentation switch, not an access control.
 */
export const WORKBENCH_PREVIEW_ENABLED: boolean =
  import.meta.env.VITE_CUNSTRUCT_WORKBENCH_PREVIEW === "true" &&
  import.meta.env.VITE_SUPABASE_PROJECT_ID !== "dkgjsobfljqoggalivzt" &&
  import.meta.env.VITE_SUPABASE_URL === "https://" + import.meta.env.VITE_SUPABASE_PROJECT_ID + ".supabase.co" &&
  workbenchPreview().enabled;
