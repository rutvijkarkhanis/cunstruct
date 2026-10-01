// WORKSPACE STATE — the small, explicit mode model for ProjectWorkspace
// (Phase 11 Stage B). Pure functions only: no React, no router, no Supabase.
// Parses/serializes the workspace's URL query params so a workspace can be
// deep-linked into (?document=&page=&mode=&boq=) and so the active
// document/page stay independent of which contextual mode is showing —
// switching from "review" to "boq" never has to forget which drawing/page
// was open, because that state lives here, not inside either context.
//
// Deliberately NOT lifting the Review selection state machine (category/
// type/instance) up into this model — BoqReviewWorkstation keeps owning
// that entirely, exactly as approved in Phase 9/10. This model only carries
// what genuinely needs to be shared BETWEEN contexts: which document, which
// page, which mode, which BOQ.

export type WorkspaceMode = "drawing" | "review" | "boq" | "materials" | "procurement";

export const WORKSPACE_MODES: readonly WorkspaceMode[] = ["drawing", "review", "boq", "materials", "procurement"];

export function isWorkspaceMode(value: string | null | undefined): value is WorkspaceMode {
  return !!value && (WORKSPACE_MODES as readonly string[]).includes(value);
}

export interface WorkspaceQueryState {
  /** Active project_document id, or null when nothing is selected yet
   *  (e.g. a brand-new project with no documents). */
  document: string | null;
  /** 1-based page number within the active document, or null to mean
   *  "whatever the viewer's own default is" — never fabricated here. */
  page: number | null;
  mode: WorkspaceMode;
  /** Active boq id — required for "review" and meaningful for "boq"/
   *  "materials"; null when the project has no BOQ yet, or none is chosen. */
  boq: string | null;
}

const DEFAULT_STATE: WorkspaceQueryState = { document: null, page: null, mode: "drawing", boq: null };

/** Parse a URLSearchParams into a WorkspaceQueryState. Unknown/invalid
 *  values fall back to the honest default rather than guessing — an
 *  unrecognized `mode` becomes "drawing", a non-positive/non-numeric
 *  `page` becomes null. */
export function parseWorkspaceQuery(params: URLSearchParams): WorkspaceQueryState {
  const document = params.get("document")?.trim() || null;
  const boq = params.get("boq")?.trim() || null;
  const modeRaw = params.get("mode");
  const mode = isWorkspaceMode(modeRaw) ? modeRaw : DEFAULT_STATE.mode;

  const pageRaw = params.get("page");
  let page: number | null = null;
  if (pageRaw != null) {
    const n = Number(pageRaw);
    if (Number.isFinite(n) && n > 0) page = Math.floor(n);
  }

  return { document, page, mode, boq };
}

/** Build a URLSearchParams from a (possibly partial) WorkspaceQueryState,
 *  omitting defaults so the URL stays clean (no `?mode=drawing` for the
 *  common case). Pure — the caller decides how/when to push it to the
 *  address bar. */
export function buildWorkspaceQuery(state: Partial<WorkspaceQueryState>): URLSearchParams {
  const params = new URLSearchParams();
  if (state.document) params.set("document", state.document);
  if (state.page != null && state.page > 0) params.set("page", String(state.page));
  if (state.mode && state.mode !== DEFAULT_STATE.mode) params.set("mode", state.mode);
  if (state.boq) params.set("boq", state.boq);
  return params;
}

export function workspaceUrl(projectId: string, state: Partial<WorkspaceQueryState>): string {
  const qs = buildWorkspaceQuery(state).toString();
  return `/ops/projects/${projectId}/workspace${qs ? `?${qs}` : ""}`;
}
