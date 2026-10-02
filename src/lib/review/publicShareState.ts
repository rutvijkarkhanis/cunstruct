// PUBLIC SHARE STATE — the small, explicit URL state model for
// PublicWorkspaceShare (the anonymous, read-only share-link page). Same
// parse/build shape as workspaceState.ts's WorkspaceQueryState, but with NO
// `mode` field at all: the public view shows Sources + Canvas + BOQ together
// in one fixed layout — there is nothing to switch between (no documents/
// review/materials/procurement contexts exist on this page), so there's
// nothing for a `mode` param to select.
//
// Pure functions only: no React, no router, no Supabase.

export interface PublicShareQueryState {
  /** Active document id from the bootstrap payload, or null when nothing is
   *  selected yet. */
  document: string | null;
  /** 1-based page number within the active document, or null to mean
   *  "whatever the viewer's own default is" — never fabricated here. */
  page: number | null;
  /** Active BOQ id, or null when the project has no BOQ yet or none is chosen. */
  boq: string | null;
}

const DEFAULT_STATE: PublicShareQueryState = { document: null, page: null, boq: null };

/** Parse a URLSearchParams into a PublicShareQueryState. Unknown/invalid
 *  values fall back to the honest default rather than guessing — a
 *  non-positive/non-numeric `page` becomes null. */
export function parsePublicShareQuery(params: URLSearchParams): PublicShareQueryState {
  const document = params.get("document")?.trim() || null;
  const boq = params.get("boq")?.trim() || null;

  const pageRaw = params.get("page");
  let page: number | null = null;
  if (pageRaw != null) {
    const n = Number(pageRaw);
    if (Number.isFinite(n) && n > 0) page = Math.floor(n);
  }

  return { document, page, boq };
}

/** Build a URLSearchParams from a (possibly partial) PublicShareQueryState,
 *  omitting defaults so the URL stays clean. Pure — the caller decides
 *  how/when to push it to the address bar. */
export function buildPublicShareQuery(state: Partial<PublicShareQueryState>): URLSearchParams {
  const params = new URLSearchParams();
  if (state.document) params.set("document", state.document);
  if (state.page != null && state.page > 0) params.set("page", String(state.page));
  if (state.boq) params.set("boq", state.boq);
  return params;
}

export function publicShareUrl(token: string, state: Partial<PublicShareQueryState>): string {
  const qs = buildPublicShareQuery(state).toString();
  return `/share/${token}${qs ? `?${qs}` : ""}`;
}

export const DEFAULT_PUBLIC_SHARE_STATE = DEFAULT_STATE;
