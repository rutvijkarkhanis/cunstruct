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
}

const defaultIdentifyHandler: AiHandler = () => ({
  ok: true,
  result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 0, y: 0 }, candidates: [] },
});
const defaultFindSimilarHandler: AiHandler = (body) => ({
  ok: true,
  result: { schemaVersion: "cunstruct.similar.v1", reference: (body as { reference?: unknown }).reference ?? { label: "", evidence: [] }, matches: [] },
});

/**
 * Installs route interception on `page` for every Supabase-bound request
 * the app will make while rendering the BoqReviewWorkstation review route,
 * using the fixture data in testData.ts. Call this BEFORE navigating.
 */
export async function installMockBackend(page: Page): Promise<MockBackendHandle> {
  const fixtures = buildRestFixtures() as Record<string, unknown>;
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
  await page.route("**/rest/v1/**", async (route: Route, request: Request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url());
    const match = url.pathname.match(/\/rest\/v1\/([^/]+)/);
    const table = match?.[1];
    const data = table ? fixtures[table] : undefined;
    if (data === undefined) return fulfillJson(route, []);
    const wantsSingle = SINGLE_OBJECT_TABLES.has(table!) || (request.headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
    if (wantsSingle) return fulfillJson(route, Array.isArray(data) ? data[0] ?? null : data);
    return fulfillJson(route, Array.isArray(data) ? data : [data]);
  });

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
