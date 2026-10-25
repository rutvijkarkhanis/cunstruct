// Workbench preview gate — runtime refusal regression (LOCAL / MOCK).
//
// The :8082 dev server has the preview flag on but its Supabase URL is the
// production project's with a trailing slash (playwright.config.ts). The
// build-time constant cannot be folded in a dev server, so this exercises the
// runtime gate (workbenchPreview()): the workbench routes must stay unmounted
// and none of their code may load. The production-build counterpart, where
// this configuration folds to no preview code at all, is the build matrix.
//
// Isolation: every Supabase REST/auth/storage request is answered in the
// browser by the mock; every other non-local request is aborted; every
// non-local WebSocket is closed. The test fails if any of those occurred
// beyond the expected font request, or if a request is neither.
import type { Route } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, GATE_REFUSAL_URL, PRODUCTION_URL_WITH_SLASH } from "./support/mockBackend";
import { buildPhase2Fixtures, PROJECT_ID, BOQ_ID } from "./fixtures/phase2FixtureSet";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

test.use({ baseURL: GATE_REFUSAL_URL });

test("flag on with the production URL spelled differently: the workbench stays unmounted and none of its code loads", async ({ page }) => {
  const aborted: string[] = [];
  const sockets: string[] = [];
  const modules: string[] = [];
  page.on("request", (r) => { if (/Workbench(Layout|Review)/.test(r.url())) modules.push(r.url()); });
  await page.routeWebSocket(() => true, (ws) => {
    if (LOCAL_HOSTS.has(new URL(ws.url()).hostname)) { ws.connectToServer(); return; }
    sockets.push(ws.url());
    void ws.close();
  });
  await page.route("**/*", (route: Route) => {
    const host = new URL(route.request().url()).hostname;
    if (LOCAL_HOSTS.has(host)) return route.continue();
    aborted.push(host);
    return route.abort();
  });
  await seedAuthSession(page, PRODUCTION_URL_WITH_SLASH);
  const fixtures = buildPhase2Fixtures();
  await installMockBackend(page, { fixtures: () => fixtures as unknown as Record<string, unknown>, applyWrites: true });

  // Positive control: the journey renders against the mock on this server.
  await page.goto(`/app/projects/${PROJECT_ID}/boq?boq=${BOQ_ID}`);
  await expect(page.getByRole("navigation", { name: "Project steps" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: fixtures.projects[0].name })).toBeVisible();

  for (const p of ["workbench", "workbench/boq", "workbench/review", "workbench/export"]) {
    await page.goto(`/app/projects/${PROJECT_ID}/${p}?boq=${BOQ_ID}`);
    await expect(page.getByText("This step is not available.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workbench sections" })).toHaveCount(0);
    await expect(page.getByText(/Workbench preview/)).toHaveCount(0);
  }
  // The journey BOQ step keeps its page-scoped undo here (no session disclosure).
  await page.goto(`/app/projects/${PROJECT_ID}/boq?boq=${BOQ_ID}`);
  await expect(page.getByText(/kept for this BOQ in this browser tab/)).toHaveCount(0);

  expect(modules).toEqual([]);
  expect(sockets).toEqual([]);
  expect([...new Set(aborted)].filter((h) => h !== "fonts.googleapis.com")).toEqual([]);
});
