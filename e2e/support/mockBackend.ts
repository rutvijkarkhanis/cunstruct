// M8 — network-boundary mocking for the real-browser Find Similar /
// Click-to-Identify specs. There is no network egress to a real Supabase
// backend available in this environment (see the M8 report), so this
// intercepts every request Supabase's own client SDK makes — auth, REST,
// storage, and the ai-analysis Edge Function — and answers them
// deterministically, mirroring EXACTLY the convention every Vitest test in
// this repo already uses at the module boundary (mocking
// "@/integrations/supabase/client", "@/lib/ai/identifyClient", etc.), just
// one layer down, at the actual HTTP boundary, since Playwright drives a
// real browser that cannot have its JS modules swapped out.
//
// Everything ABOVE this boundary is completely real: the real app bundle,
// the real React Router routing/role-gating, the real BoqReviewWorkstation
// component, the real PdfEvidenceViewer, the real pdf.js rendering a real
// PDF file's real bytes on a real <canvas>, and real DOM click events.

import type { Page, Route, Request } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRestFixtures, SINGLE_OBJECT_TABLES, DOC_A_ID, DOC_B_ID } from "../fixtures/testData";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOC_A_PDF_PATH = path.join(__dirname, "..", "fixtures", "document-a.pdf");
export const DOC_B_PDF_PATH = path.join(__dirname, "..", "fixtures", "document-b.pdf");

export const FAKE_USER_ID = "e2e-user-1";

// The fake, never-reachable Supabase project URL the dev server is booted
// with for this suite (see playwright.config.ts's webServer.env, which
// imports this same constant) — every request to it is intercepted below,
// so the suite never depends on real credentials. seedAuthSession() derives
// its localStorage key from this same value.
export const E2E_FAKE_SUPABASE_URL = "https://e2e-fixture.supabase.co";

/** The second dev server, started with the workbench preview flag on (playwright.config.ts). */
export const WORKBENCH_PREVIEW_URL = "http://localhost:8081";
/** A third dev server, flag on but configured with the PRODUCTION Supabase URL
 *  spelled with a trailing slash (e2e/workbenchGate.spec.ts): the gate must
 *  refuse it. Every request from its pages is mocked or aborted in-browser. */
export const GATE_REFUSAL_URL = "http://localhost:8082";
export const PRODUCTION_URL_WITH_SLASH = "https://dkgjsobfljqoggalivzt.supabase.co/";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
};

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  });
}

function fakeSession() {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    access_token: "e2e-fake-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSec + 3600 * 24 * 365, // far future — never triggers a refresh mid-test
    refresh_token: "e2e-fake-refresh-token",
    user: {
      id: FAKE_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "e2e@example.com",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

export type AiAction = { action: string; [key: string]: unknown };
export type AiHandler = (body: AiAction) => Promise<unknown> | unknown;

export interface MockBackendHandle {
  /** Every request body this mock's ai-analysis route has received, in order. */
  aiCalls: AiAction[];
  /** Replace the identify-action responder at any time (e.g. mid-test, to
   *  simulate a slow/delayed response for lifecycle tests). */
  setIdentifyHandler(h: AiHandler): void;
  /** Replace the find_similar-action responder at any time. */
  setFindSimilarHandler(h: AiHandler): void;
  /** applyWrites mode only (otherwise empty): the live in-memory tables. */
  tables: Record<string, Record<string, unknown>[]>;
  /** applyWrites mode only (otherwise empty): every write received, in order. */
  writes: MockWrite[];
  /** applyWrites mode only: read filters the store could not interpret and ignored. */
  ignoredReadFilters: string[];
  /** applyWrites mode only: change rows directly, as another user's save
   *  would, without going through the app. Returns the number of rows changed. */
  mutate(table: string, match: Record<string, unknown>, patch: Record<string, unknown>): number;
}

export interface MockWrite { method: string; table: string; query: string; body: unknown; status: number }

const defaultIdentifyHandler: AiHandler = () => ({
  ok: true,
  result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 0, y: 0 }, candidates: [] },
});
const defaultFindSimilarHandler: AiHandler = (body) => ({
  ok: true,
  result: { schemaVersion: "cunstruct.similar.v1", reference: (body as { reference?: unknown }).reference ?? { label: "", evidence: [] }, matches: [] },
});

const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/** Applies the PostgREST `eq.` and `in.(…)` filters the app sends, as the real
 *  API would — e.g. the LOCATION-status query (mode=eq.LOCATION) must not see
 *  BOQ-mode claim rows. Other operators are not interpreted, and a fixture row
 *  that lacks the filtered column is kept, as before this filter existed. */
function applyFilters(rows: unknown[], params: URLSearchParams): unknown[] {
  let out = rows;
  for (const [column, expr] of params) {
    if (NON_FILTER_PARAMS.has(column)) continue;
    let allowed: string[] | null = null;
    if (expr.startsWith("eq.")) allowed = [expr.slice(3)];
    else if (expr.startsWith("in.(") && expr.endsWith(")")) allowed = expr.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
    if (!allowed) continue;
    const ok = allowed;
    out = out.filter((r) => {
      const v = (r as Record<string, unknown>)[column];
      return v === undefined || ok.includes(String(v));
    });
  }
  return out;
}

// --- applyWrites mode ------------------------------------------------------
// An in-memory store the REST route reads from AND writes to, so a spec can
// follow an edit through to what is read back (and exported). Deterministic:
// rows keep fixture order unless `order=` is given; ids are assigned from a
// counter. It interprets only the PostgREST features the app's guarded writes
// use (eq., neq., in.(…), is.null/true/false, order, limit, on_conflict
// upserts, return=representation). A write filtered with any other operator
// is refused with 400 instead of being guessed at; a read ignores that one
// filter (as the default mode does) and records it in `ignoredReadFilters`. It models no RLS, no
// constraints, no triggers and no transactions: passing here says nothing
// about the real database.

type Row = Record<string, unknown>;
type Cond = { column: string; test: (v: unknown) => boolean };

/** PostgREST filters as predicates, plus the ones this mock can't interpret. */
function parseConds(params: URLSearchParams): { conds: Cond[]; unsupported: string[] } {
  const out: Cond[] = [];
  const unsupported: string[] = [];
  for (const [column, expr] of params) {
    if (NON_FILTER_PARAMS.has(column)) continue;
    const neg = expr.startsWith("not.");
    const e = neg ? expr.slice(4) : expr;
    let test: ((v: unknown) => boolean) | null = null;
    if (e.startsWith("eq.")) { const x = e.slice(3); test = (v) => v != null && String(v) === x; }
    else if (e.startsWith("neq.")) { const x = e.slice(4); test = (v) => v != null && String(v) !== x; }
    else if (e.startsWith("in.(") && e.endsWith(")")) {
      const xs = e.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      test = (v) => v != null && xs.includes(String(v));
    } else if (e === "is.null") test = (v) => v == null;
    else if (e === "is.true") test = (v) => v === true;
    else if (e === "is.false") test = (v) => v === false;
    if (!test) { unsupported.push(`${column}=${expr}`); continue; }
    const t = test;
    out.push({ column, test: neg ? (v) => !t(v) : t });
  }
  return { conds: out, unsupported };
}

const matches = (row: Row, conds: Cond[]) => conds.every((c) => c.test(row[c.column]));

function ordered(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((k) => { const [col, dir, nulls] = k.split("."); return { col, desc: dir === "desc", nullsFirst: nulls === "nullsfirst" }; });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col], y = b[k.col];
      if (x == null && y == null) continue;
      if (x == null) return k.nullsFirst ? -1 : 1;
      if (y == null) return k.nullsFirst ? 1 : -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}

function toTables(fixtures: Record<string, unknown>): Record<string, Row[]> {
  const t: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(fixtures)) t[k] = structuredClone(Array.isArray(v) ? v : [v]) as Row[];
  return t;
}

/**
 * Installs route interception on `page` for every Supabase-bound request
 * the app will make while rendering the BoqReviewWorkstation review route,
 * using the fixture data in testData.ts. Call this BEFORE navigating.
 */
export async function installMockBackend(
  page: Page,
  options: {
    fixtures?: (f: ReturnType<typeof buildRestFixtures>) => Record<string, unknown>;
    /** Off by default (every existing spec): writes are answered but not
     *  applied, and boq/projects are always single objects. On: an in-memory
     *  store applies writes, reads see them, and a single object is returned
     *  only when the request asks for one (Accept: vnd.pgrst.object+json). */
    applyWrites?: boolean;
  } = {},
): Promise<MockBackendHandle> {
  const base = buildRestFixtures();
  const fixtures = (options.fixtures ? options.fixtures(base) : base) as Record<string, unknown>;
  const aiCalls: AiAction[] = [];
  let identifyHandler = defaultIdentifyHandler;
  let findSimilarHandler = defaultFindSimilarHandler;

  // --- Auth ---------------------------------------------------------------
  await page.route("**/auth/v1/**", async (route: Route, request: Request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url());
    if (url.pathname.endsWith("/token")) return fulfillJson(route, fakeSession());
    if (url.pathname.endsWith("/user")) return fulfillJson(route, fakeSession().user);
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, headers: CORS_HEADERS });
    // Any other auth-adjacent call (settings probe, etc.) — a harmless empty
    // success rather than letting an unmatched request hang the test.
    return fulfillJson(route, {});
  });

  // --- REST (PostgREST) ----------------------------------------------------
  const tables: Record<string, Row[]> = options.applyWrites ? toTables(fixtures) : {};
  const writes: MockWrite[] = [];
  const ignoredReadFilters: string[] = [];
  let nextId = 1;
  await page.route("**/rest/v1/**", async (route: Route, request: Request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    if (options.applyWrites && !new URL(request.url()).pathname.includes("/rest/v1/rpc/")) {
      return answerFromStore(route, request);
    }
    const url = new URL(request.url());
    const match = url.pathname.match(/\/rest\/v1\/([^/]+)/);
    const table = match?.[1];
    const data = table ? fixtures[table] : undefined;
    if (data === undefined) return fulfillJson(route, []);
    const rows = applyFilters(Array.isArray(data) ? data : [data], url.searchParams);
    const wantsSingle = SINGLE_OBJECT_TABLES.has(table!) || (request.headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
    if (wantsSingle) return fulfillJson(route, rows[0] ?? null);
    return fulfillJson(route, rows);
  });

  async function answerFromStore(route: Route, request: Request) {
    const url = new URL(request.url());
    const table = url.pathname.match(/\/rest\/v1\/([^/]+)/)![1];
    const method = request.method();
    const headers = request.headers();
    const single = (headers["accept"] ?? "").includes("vnd.pgrst.object+json");
    const representation = (headers["prefer"] ?? "").includes("return=representation");
    const { conds, unsupported } = parseConds(url.searchParams);
    const reply = (rows: Row[], status = 200) => {
      if (single) return rows.length === 1 ? fulfillJson(route, rows[0], status) : fulfillJson(route, { code: "PGRST116", message: `${rows.length} rows` }, 406);
      return fulfillJson(route, rows, status);
    };
    const log = (status: number, body: unknown) => writes.push({ method, table, query: url.search, body, status });

    if (method === "GET" || method === "HEAD") {
      for (const f of unsupported) ignoredReadFilters.push(`${table}?${f}`);
      const limit = url.searchParams.get("limit");
      let rows = ordered((tables[table] ?? []).filter((r) => matches(r, conds)), url.searchParams.get("order"));
      if (limit != null) rows = rows.slice(0, Number(limit));
      return reply(rows);
    }
    // Writes: a filter this mock can't interpret is refused, never guessed at.
    if (unsupported.length) { log(400, null); return fulfillJson(route, { message: "mock: unsupported filter on a write" }, 400); }
    const body = request.postDataJSON() as Row | Row[] | null;
    const rows = (tables[table] ??= []);
    if (method === "PATCH") {
      const hit = rows.filter((r) => matches(r, conds));
      for (const r of hit) Object.assign(r, body);
      log(200, body);
      return representation ? reply(hit.map((r) => ({ ...r }))) : route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    if (method === "POST") {
      const conflictCols = url.searchParams.get("on_conflict")?.split(",");
      const merge = (headers["prefer"] ?? "").includes("resolution=merge-duplicates");
      const out: Row[] = [];
      for (const b of (Array.isArray(body) ? body : [body ?? {}])) {
        const existing = conflictCols && rows.find((r) => conflictCols.every((c) => String(r[c]) === String(b[c])));
        if (existing && merge) { Object.assign(existing, b); out.push({ ...existing }); continue; }
        if (existing) { log(409, body); return fulfillJson(route, { code: "23505", message: "mock: duplicate key" }, 409); }
        const row: Row = { id: `${table}-mock-${nextId++}`, created_at: "2026-10-22T00:00:00Z", ...b };
        rows.push(row);
        out.push({ ...row });
      }
      log(201, body);
      return representation ? reply(out, 201) : route.fulfill({ status: 201, headers: CORS_HEADERS });
    }
    if (method === "DELETE") {
      const gone = rows.filter((r) => matches(r, conds));
      tables[table] = rows.filter((r) => !gone.includes(r));
      log(200, null);
      return representation ? reply(gone) : route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    log(405, body);
    return fulfillJson(route, { message: `mock: ${method} not supported` }, 405);
  }

  // --- Storage: create signed URL (POST) + fetch the signed URL (GET) ------
  await page.route("**/storage/v1/object/sign/**", async (route: Route, request: Request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url());
    if (request.method() === "POST") {
      // storage-js concatenates `this.url + signedURL` itself — returning a
      // path relative to /storage/v1 here reproduces exactly what the real
      // endpoint returns, so the SDK's own string-concat logic is exercised
      // unmodified.
      const idx = url.pathname.indexOf("/object/sign/");
      const suffix = url.pathname.slice(idx);
      return fulfillJson(route, { signedURL: `${suffix}?token=e2e-fake-token` });
    }
    // GET — the browser (pdf.js, via an XHR range request) fetching the
    // "signed" URL. Serve the REAL local fixture PDF's REAL bytes — pdf.js
    // genuinely parses and renders whichever one this is.
    const isDocB = url.pathname.includes(DOC_B_ID);
    return route.fulfill({ path: isDocB ? DOC_B_PDF_PATH : DOC_A_PDF_PATH, headers: { ...CORS_HEADERS, "accept-ranges": "bytes" } });
  });

  // --- Edge Function: ai-analysis (identify / find_similar) ---------------
  await page.route("**/functions/v1/ai-analysis", async (route: Route, request: Request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    const body = request.postDataJSON() as AiAction;
    aiCalls.push(body);
    const result = body.action === "identify"
      ? await identifyHandler(body)
      : body.action === "find_similar"
        ? await findSimilarHandler(body)
        : { ok: false, error: `Unhandled mocked action: ${body.action}` };
    return fulfillJson(route, result);
  });

  return {
    aiCalls,
    setIdentifyHandler: (h) => { identifyHandler = h; },
    setFindSimilarHandler: (h) => { findSimilarHandler = h; },
    tables,
    writes,
    ignoredReadFilters,
    mutate: (table, match, patch) => {
      if (!options.applyWrites) throw new Error("mutate() needs installMockBackend(page, { applyWrites: true })");
      const hit = (tables[table] ?? []).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v));
      for (const r of hit) Object.assign(r, patch);
      return hit.length;
    },
  };
}

/** Seeds a plausible-looking Supabase v2 session into localStorage before
 *  the app's first script runs, so the initial supabase.auth.getSession()
 *  resolves to an already-authenticated state without even needing the
 *  intercepted /auth/v1/token round trip (that interception stays in place
 *  purely as a safety net for any refresh attempt). The storage key format
 *  (`sb-<project-ref>-auth-token`) matches @supabase/supabase-js's own
 *  default, derived from VITE_SUPABASE_URL's hostname. */
export async function seedAuthSession(page: Page, supabaseUrl: string) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const key = `sb-${projectRef}-auth-token`;
  const session = fakeSession();
  await page.addInitScript(([k, v]) => {
    window.localStorage.setItem(k, v);
  }, [key, JSON.stringify(session)] as const);
}
