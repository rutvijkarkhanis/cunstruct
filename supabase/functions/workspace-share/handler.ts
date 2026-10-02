// WORKSPACE SHARE — the actual request-handling logic for the public,
// unauthenticated share-link read path. Extracted into its own pure
// TypeScript module (no Deno/`npm:` imports) so it can be exercised directly
// under Vitest, same reasoning and same split as
// supabase/functions/ai-analysis/findSimilarHandler.ts.
//
// This makes the zero-database-write guarantee STRUCTURAL, not just
// reviewed: every function here receives a ShareReadDeps object with no
// `insert`/`update`/`upsert` slot and no raw Supabase client of any kind —
// only narrow, single-purpose READ closures the caller (index.ts) builds
// from the real admin client and injects. There is nothing in scope here a
// future change could call a write method on without first threading a
// brand-new parameter through this module's own exported function
// signatures — see shareWorkspaceHandler.test.ts for the regression test
// that makes this concrete.
//
// index.ts is a thin wrapper around this module: it hashes the incoming
// token, looks up the project_share_link row, checks isLinkActive(), and
// only then calls one of the three handlers below with deps built from the
// admin (service-role) client — the ONE write in the whole feature
// (project_share_link.last_accessed_at) happens directly in index.ts, never
// in here.
//
// Every documentId/boqId the caller supplies is re-verified against the
// token's own projectId before any data is returned
// (getDocumentForProject/getBoqForProject both take projectId and return
// null on a cross-project mismatch) — this is the check that prevents a
// guessed id from a DIFFERENT project ever being served through a link
// scoped to this one.

export interface ShareSourceDoc {
  id: string;
  name: string;
  docType: string | null;
  discipline: string | null;
  status: string;
  pageCount: number | null;
}

export interface ShareScope {
  id: string;
  name: string;
  kind: string;
  sort: number;
}

export interface ShareBoqSummary {
  id: string;
  name: string;
  scopeId: string | null;
  lineCount: number;
}

export interface ShareBoqLineRow {
  id: string;
  description: string | null;
  unit: string | null;
  qty: number;
  included: boolean;
  section: string | null;
  sort: number;
  dsrRate: number | null;
  customRate: number | null;
}

export interface CommercialSpec {
  costIndexPct?: number;
  contingencyPct?: number;
  overheadPct?: number;
  cessPct?: number;
  gstPct?: number;
}

export interface ShareReadDeps {
  getProject: (projectId: string) => Promise<{ id: string; name: string } | null>;
  listDocuments: (projectId: string) => Promise<ShareSourceDoc[]>;
  listScopes: (projectId: string) => Promise<ShareScope[]>;
  listBoqs: (projectId: string) => Promise<ShareBoqSummary[]>;
  getDocumentForProject: (projectId: string, documentId: string) => Promise<{ name: string; filePath: string | null; pageTitles: Record<string, string> | null } | null>;
  createSignedUrl: (filePath: string) => Promise<string | null>;
  getBoqForProject: (projectId: string, boqId: string) => Promise<{ id: string; name: string; spec: CommercialSpec } | null>;
  /** Takes projectId as well as boqId — NOT just for symmetry with
   *  getBoqForProject, but so the real implementation (index.ts) can
   *  independently re-verify the boq belongs to this project before
   *  touching boq_line, rather than relying solely on handleBoqLines having
   *  already checked via getBoqForProject moments earlier. Two independent
   *  checks of the same invariant, not one check two call sites trust. */
  listBoqLines: (projectId: string, boqId: string) => Promise<ShareBoqLineRow[]>;
}

export type ShareHandlerResult =
  | { status: 200; body: { ok: true } & Record<string, unknown> }
  | { status: 400 | 404; body: { ok: false; error: string } };

export async function handleBootstrap(input: { projectId: string }, deps: ShareReadDeps): Promise<ShareHandlerResult> {
  const project = await deps.getProject(input.projectId);
  if (!project) return { status: 404, body: { ok: false, error: "Project not found." } };

  const [documents, scopes, boqs] = await Promise.all([
    deps.listDocuments(input.projectId),
    deps.listScopes(input.projectId),
    deps.listBoqs(input.projectId),
  ]);

  return { status: 200, body: { ok: true, project, documents, scopes, boqs } };
}

export async function handleDrawingUrl(input: { projectId: string; documentId?: string }, deps: ShareReadDeps): Promise<ShareHandlerResult> {
  if (!input.documentId) return { status: 400, body: { ok: false, error: "documentId is required" } };

  const doc = await deps.getDocumentForProject(input.projectId, input.documentId);
  if (!doc) return { status: 404, body: { ok: false, error: "Document not found in this project." } };
  if (!doc.filePath) return { status: 404, body: { ok: false, error: "No drawing file is stored for this document." } };

  const fileUrl = await deps.createSignedUrl(doc.filePath);
  if (!fileUrl) return { status: 404, body: { ok: false, error: "Failed to sign the drawing file." } };

  return { status: 200, body: { ok: true, name: doc.name, pageTitles: doc.pageTitles, fileUrl } };
}

/** Rounding/waterfall math kept IDENTICAL to src/lib/boqDsrDocument.ts's own
 *  computeCommercials — reproduced here rather than imported because that
 *  file isn't a plain cross-environment module (it pulls in other browser
 *  code); both sides share the same CommercialInputs shape and defaults as
 *  WorkspaceBoqPanel.tsx's ActiveBoqCard. Keep this in lockstep with that
 *  file if its waterfall ever changes. */
function computeCommercialsLocal(works: number, spec: CommercialSpec) {
  const pct = (v: number | undefined, d: number) => v ?? d;
  const round = (n: number) => Math.round(n);
  const w = round(works);
  const costIndexAmt = round(w * (pct(spec.costIndexPct, 0) / 100));
  const worksAdjusted = w + costIndexAmt;
  const contingencyAmt = round(worksAdjusted * (pct(spec.contingencyPct, 3) / 100));
  const overheadAmt = round(worksAdjusted * (pct(spec.overheadPct, 15) / 100));
  const subTotal = worksAdjusted + contingencyAmt + overheadAmt;
  const cessAmt = round(subTotal * (pct(spec.cessPct, 1) / 100));
  const taxable = subTotal + cessAmt;
  const gstAmt = round(taxable * (pct(spec.gstPct, 18) / 100));
  const grandTotal = taxable + gstAmt;
  return { works: w, subTotal, grandTotal };
}

export async function handleBoqLines(
  input: { projectId: string; boqId?: string; showPricing: boolean },
  deps: ShareReadDeps,
): Promise<ShareHandlerResult> {
  if (!input.boqId) return { status: 400, body: { ok: false, error: "boqId is required" } };

  const boq = await deps.getBoqForProject(input.projectId, input.boqId);
  if (!boq) return { status: 404, body: { ok: false, error: "BOQ not found in this project." } };

  // Always passes input.projectId — the server-resolved project from the
  // validated share-link record (see index.ts) — never anything client-
  // supplied, and never a different value than the one getBoqForProject
  // just checked above.
  const rows = await deps.listBoqLines(input.projectId, input.boqId);
  const included = rows.filter((r) => r.included);

  // showPricing: false — these keys are genuinely absent from the response,
  // not zeroed out, so a client can't accidentally display a stale/fake "0".
  const lines = rows.map((r) => {
    const base = { id: r.id, description: r.description, unit: r.unit, qty: r.qty, included: r.included, section: r.section, sort: r.sort };
    if (!input.showPricing) return base;
    const rate = r.customRate ?? r.dsrRate;
    const amount = rate != null ? Math.round(r.qty * rate) : null;
    return { ...base, rate, amount };
  });

  if (!input.showPricing) {
    return { status: 200, body: { ok: true, boq: { id: boq.id, name: boq.name }, lines } };
  }

  const worksTotal = included.reduce((sum, r) => {
    const rate = r.customRate ?? r.dsrRate;
    return sum + (rate != null ? Math.round(r.qty * rate) : 0);
  }, 0);
  const commercials = computeCommercialsLocal(worksTotal, boq.spec ?? {});

  return { status: 200, body: { ok: true, boq: { id: boq.id, name: boq.name }, lines, commercials } };
}

/** Pure validity check for a project_share_link row — extracted so it can be
 *  unit-tested without a database. A link is active when it hasn't been
 *  revoked and either has no expiry or hasn't reached it yet. */
export function isLinkActive(link: { revoked_at: string | null; expires_at: string | null }, nowMs: number): boolean {
  if (link.revoked_at) return false;
  if (link.expires_at && new Date(link.expires_at).getTime() <= nowMs) return false;
  return true;
}
