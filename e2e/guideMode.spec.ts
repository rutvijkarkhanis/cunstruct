// Guide Mode in a real browser, against the MOCKED network boundary (not a
// live backend): Projects home → Start Guided Walkthrough → pick the fixture
// project → all seven steps over the real journey screens → Exit.
//
// Read-only check: the mock store records every write; the test fails on any
// insert/update/delete, database function or edge-function call, and on any
// request to a Supabase host other than the fake fixture project.
// Screenshots go to GUIDE_SCREENSHOT_DIR when it is set (presentation stills).
import path from "node:path";
import type { Route } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";
import { buildPhase2Fixtures, PROJECT_ID, BOQ_ID } from "./fixtures/phase2FixtureSet";

const FAKE_HOST = new URL(E2E_FAKE_SUPABASE_URL).hostname;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SHOTS = process.env.GUIDE_SCREENSHOT_DIR;

test("Guide Mode: home → choose an existing project → seven steps on its own data → exit, with no writes (MOCK)", async ({ page }) => {
  const fixtures = buildPhase2Fixtures();
  const projectName = fixtures.projects[0].name;
  const blocked: string[] = [];
  const functionCalls: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("request", (r) => { if (new URL(r.url()).pathname.includes("/functions/v1/")) functionCalls.push(r.url()); });
  await page.route("**/*", (route: Route) => {
    const host = new URL(route.request().url()).hostname;
    if (LOCAL_HOSTS.has(host)) return route.continue();
    blocked.push(host);
    return route.abort();
  });
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
  const mock = await installMockBackend(page, { fixtures: () => fixtures as unknown as Record<string, unknown>, applyWrites: true });
  await page.setViewportSize({ width: 1366, height: 860 });
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  const panel = page.getByRole("complementary", { name: "Guided walkthrough" });
  const P = `/app/projects/${PROJECT_ID}`;

  await page.goto("/app/projects");
  await shot("01-home");
  await page.getByRole("button", { name: "Start Guided Walkthrough" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("option").filter({ hasText: projectName }).getByRole("button").click();
  await expect(dialog.getByRole("region", { name: "Selected project" })).toContainText("BOQ: Phase 2 fixture BOQ");
  await shot("02-choose-project");
  await dialog.getByRole("button", { name: "Start guide" }).click();

  const steps: [string, RegExp, string][] = [
    ["Project overview", new RegExp(`${P}/overview$`), "Fixture client"],
    ["Drawings", new RegExp(`${P}/drawings\\?boq=${BOQ_ID}$`), "Document A"],
    ["Take-off and quantities", new RegExp(`${P}/review\\?boq=${BOQ_ID}$`), "in the latest take-off"],
    ["Review", new RegExp(`${P}/review\\?boq=${BOQ_ID}$`), "Awaiting a decision"],
    ["BOQ", new RegExp(`${P}/boq\\?boq=${BOQ_ID}$`), "Priced total"],
    ["Checks", new RegExp(`${P}/check\\?boq=${BOQ_ID}$`), ""],
    ["Export", new RegExp(`${P}/export\\?boq=${BOQ_ID}$`), "Excel (CSV)"],
  ];
  for (const [i, [title, url, fact]] of steps.entries()) {
    if (i > 0) await panel.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(url);
    await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(panel).toContainText(`Step ${i + 1} of 7`);
    if (fact) await expect(panel).toContainText(fact);
    // The actual screen is underneath, with its own heading.
    await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
    await shot(`${String(i + 3).padStart(2, "0")}-step-${i + 1}-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`);
  }

  await panel.getByRole("button", { name: "Exit guide" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${P}/export\\?boq=${BOQ_ID}$`));
  await expect(page.getByRole("navigation", { name: "Project steps" })).toBeVisible();

  expect(mock.writes, "the guide must not write").toEqual([]);
  expect(mock.rpcCalls).toEqual([]);
  expect(functionCalls).toEqual([]);
  expect(blocked.filter((h) => h.endsWith(".supabase.co") && h !== FAKE_HOST)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
