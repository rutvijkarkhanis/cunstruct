// Workbench preview (UX/UI revamp) regression suite — LOCAL / MOCK evidence.
//
// Two dev servers (playwright.config.ts): :8080 is the default build (flag
// off), :8081 the same app with VITE_CUNSTRUCT_WORKBENCH_PREVIEW=true and a
// fake project id. Every request goes to the in-memory mock
// (installMockBackend with applyWrites), and anything else is aborted.
//
// What this proves: routing and gating in a local dev build; what the
// interface sends and reads back from a store that applies writes the way
// the guarded PostgREST filters describe; undo, export and conflict handling
// against that store. What it does NOT prove: real database behaviour, Auth,
// row-level security, constraints and triggers, hosting configuration, or
// anything about production (see the decision log).
import fs from "node:fs";
import type { Page, Route } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL, WORKBENCH_PREVIEW_URL, type MockBackendHandle } from "./support/mockBackend";
import { buildPhase2Fixtures, buildMultiBoqFixtures, LINE_ID, TARGET_LINE, PROJECT_ID, BOQ_ID, BOQ2_ID, BOQ2_LINE_ID } from "./fixtures/phase2FixtureSet";
import { ITEM_COLUMN_ID } from "./fixtures/testData";

const FAKE_HOST = new URL(E2E_FAKE_SUPABASE_URL).hostname;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_URL = "http://localhost:8080";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONFLICT = "not saved: this line was changed elsewhere since it was loaded. The current values are now shown.";

type Row = Record<string, unknown>;

/** Fail-closed network, mocked backend with writes applied, signed-in session. */
async function setUp(page: Page, build: () => ReturnType<typeof buildPhase2Fixtures> = buildPhase2Fixtures, adjust?: (f: Record<string, unknown>) => void) {
  const fixtures = build();
  adjust?.(fixtures as unknown as Record<string, unknown>);
  const blocked: string[] = [];
  const supabaseHosts = new Set<string>();
  page.on("request", (r) => { const h = new URL(r.url()).hostname; if (/supabase\.(co|in)$/.test(h)) supabaseHosts.add(h); });
  // Lowest priority (registered first): abort anything no mock handles, except the local dev servers.
  await page.route("**/*", (route: Route) => {
    const host = new URL(route.request().url()).hostname;
    if (LOCAL_HOSTS.has(host)) return route.continue();
    blocked.push(host);
    return route.abort();
  });
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
  const mock = await installMockBackend(page, { fixtures: () => fixtures as unknown as Record<string, unknown>, applyWrites: true });
  page.setDefaultTimeout(15_000);
  const target = fixtures.boq_line.find((l) => l.id === LINE_ID(TARGET_LINE))!;
  return { mock, target, fixtures, blocked, supabaseHosts, line: () => mock.tables.boq_line.find((l) => l.id === target.id)! };
}

function afterEachCheck(env: { supabaseHosts: Set<string> }) {
  // No request may target a Supabase host other than the fake project.
  expect([...env.supabaseHosts].filter((h) => h !== FAKE_HOST)).toEqual([]);
}

const history = (mock: MockBackendHandle, lineId: string) =>
  (mock.tables.boq_line_change_log ?? []).filter((r: Row) => r.boq_line_id === lineId).map((r: Row) => `${r.field}:${r.old_value}→${r.new_value}`);

/** One CSV line into cells (quoted cells may hold commas and doubled quotes). */
function csvCells(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Download the live CSV from the current export page; returns Qty and Your rate of the row with `code`. */
async function exportedRow(page: Page, code: string) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel \(CSV\)/ }).click()]);
  const lines = fs.readFileSync(await download.path(), "utf8").split(/\r?\n/).map(csvCells);
  const head = lines.find((c) => c.includes("Qty") && c.includes("Your rate"))!;
  const row = lines.find((c) => c[head.indexOf("Code")] === code);
  expect(row, `CSV row for ${code}`).toBeTruthy();
  return { qty: row![head.indexOf("Qty")], rate: row![head.indexOf("Your rate")] };
}

/** Download the live CSV; its file name, and Qty / Your rate of the row with a given code (null if absent). */
async function exportedCsv(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel \(CSV\)/ }).click()]);
  const lines = fs.readFileSync(await download.path(), "utf8").split(/\r?\n/).map(csvCells);
  const head = lines.find((c) => c.includes("Qty") && c.includes("Your rate"))!;
  return {
    name: download.suggestedFilename(),
    row: (code: string) => {
      const r = lines.find((c) => c[head.indexOf("Code")] === code);
      return r ? { qty: r[head.indexOf("Qty")], rate: r[head.indexOf("Your rate")] } : null;
    },
  };
}

const qtyButton = (page: Page, desc: string) => page.getByRole("button", { name: new RegExp(`^Edit Quantity for ${escapeRe(desc.slice(0, 40))}`) });

async function editQty(page: Page, desc: string, value: string) {
  await qtyButton(page, desc).click();
  const input = page.getByRole("textbox", { name: new RegExp(`^Quantity for ${escapeRe(desc.slice(0, 40))}`) });
  await input.fill(value);
  await input.press("Enter");
}

async function findLine(page: Page, desc: string) {
  await page.getByPlaceholder("Search lines").fill(desc.slice(0, 30));
  await expect(qtyButton(page, desc)).toBeVisible();
}

const SECTION_LABEL = { drawings: "Drawings", review: "Review", boq: "BOQ", check: "Check", export: "Export" } as const;
const section = (page: Page, s: keyof typeof SECTION_LABEL) =>
  page.getByRole("navigation", { name: "Workbench sections" }).getByRole("link", { name: SECTION_LABEL[s], exact: true }).click();
const undoLast = (page: Page) => page.getByRole("button", { name: /^Undo: / });
const nothingToUndo = (page: Page) => page.getByRole("button", { name: "Undo (nothing to undo)" });
const notUndone = (page: Page) => page.getByRole("region", { name: "Changes that could not be undone" });
const boqPicker = (page: Page) => page.getByRole("combobox", { name: "BOQ" });

const undoButton = (page: Page) => page.getByRole("button", { name: /^Undo: |^Undo \(nothing to undo\)$/ });

test.describe("default build (flag off, :8080)", () => {
  test.use({ baseURL: DEFAULT_URL });

  test("the workbench route is not mounted; the path falls through to 'not available'", async ({ page }) => {
    const env = await setUp(page);
    for (const p of ["workbench", "workbench/boq", "workbench/review", "workbench/export"]) {
      await page.goto(`/app/projects/${PROJECT_ID}/${p}?boq=${BOQ_ID}`);
      await expect(page.getByText("This step is not available.")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Workbench sections" })).toHaveCount(0);
      await expect(page.getByText(/Workbench preview/)).toHaveCount(0);
      // The journey chrome is unchanged on the fall-through page.
      await expect(page.getByRole("navigation", { name: "Project steps" })).toBeVisible();
    }
    afterEachCheck(env);
  });

  test("existing journey routes render as before, with the journey steps and page-scoped undo", async ({ page }) => {
    const env = await setUp(page);
    for (const step of ["overview", "drawings", "review", "boq", "check", "export"]) {
      await page.goto(`/app/projects/${PROJECT_ID}/${step}?boq=${BOQ_ID}`);
      await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/${step}`));
      await expect(page.getByRole("navigation", { name: "Project steps" })).toBeVisible();
      await expect(page.getByText("This step is not available.")).toHaveCount(0);
    }
    await page.goto(`/app/projects/${PROJECT_ID}/boq?boq=${BOQ_ID}`);
    await expect(undoButton(page)).toBeVisible();
    await expect(page.getByText(/kept for this BOQ in this browser tab/)).toHaveCount(0);
    afterEachCheck(env);
  });

  test("journey (unchanged behaviour): the edit is stored, but undo is lost after the builder hand-off", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    await expect(page.getByRole("button", { name: /^Undo: Quantity of / })).toBeEnabled();

    await page.getByRole("link", { name: "Edit in builder" }).click();
    await expect(page).toHaveURL(new RegExp(`/ops/projects/${PROJECT_ID}/boqs/${BOQ_ID}`));
    await page.getByRole("button", { name: "Back to project" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/boq`));
    await expect(page.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
    expect(env.line().qty).toBe(2);
    afterEachCheck(env);
  });
});

test.describe("workbench preview build (flag on, fake project, :8081)", () => {
  test.use({ baseURL: WORKBENCH_PREVIEW_URL });

  test("the workbench route is mounted, says it is a preview, and replaces the journey chrome", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench?boq=${BOQ_ID}`);
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/boq\\?boq=${BOQ_ID}$`));
    await expect(page.getByRole("note").filter({ hasText: "Workbench preview" })).toContainText("off by default");
    const nav = page.getByRole("navigation", { name: "Workbench sections" });
    // The journey's steps, in the journey's order; the workbench opens on the BOQ.
    await expect(nav.getByRole("link")).toHaveText(["Drawings", "Review", "BOQ", "Check", "Export"]);
    await expect(nav.getByRole("link", { name: "BOQ", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Project steps" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: env.fixtures.projects[0].name })).toBeVisible();
    await expect(page.getByText("Undo history is kept for this BOQ in this browser tab until the page is reloaded.")).toBeVisible();
    // Section links keep the selected BOQ.
    for (const s of ["drawings", "review", "check", "export", "boq"] as const) {
      await nav.getByRole("link", { name: SECTION_LABEL[s], exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/workbench/${s}\\?boq=${BOQ_ID}$`));
      await expect(page.getByRole("navigation", { name: "Project steps" })).toHaveCount(0);
    }
    afterEachCheck(env);
  });

  test("existing journey routes are unchanged in the preview build", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/boq?boq=${BOQ_ID}`);
    await expect(page.getByRole("navigation", { name: "Project steps" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workbench sections" })).toHaveCount(0);
    await expect(page.getByText(/kept for this BOQ in this browser tab/)).toHaveCount(0);
    afterEachCheck(env);
  });

  test("context and undo survive the builder hand-off; undo restores the stored value; export reflects edits", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    const code = env.target.dsr_code!;
    const before = { qty: env.line().qty, rate: env.line().custom_rate };
    expect(before).toEqual({ qty: 1, rate: null });

    await page.goto(`/app/projects/${PROJECT_ID}/workbench?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    expect(history(env.mock, env.target.id)).toEqual(["qty:1→2"]);

    // Export after the quantity edit.
    const nav = page.getByRole("navigation", { name: "Workbench sections" });
    await nav.getByRole("link", { name: "Export", exact: true }).click();
    // "Your rate" is the line's effective rate: the DSR rate until a rate of its own is set.
    expect(await exportedRow(page, code)).toEqual({ qty: "2", rate: String(env.target.dsr_rate) });

    // Hand-off to the builder for the rate, and back.
    await nav.getByRole("link", { name: "BOQ", exact: true }).click();
    await findLine(page, desc);
    await page.getByRole("link", { name: "Edit in builder" }).click();
    await expect(page).toHaveURL(new RegExp(`/ops/projects/${PROJECT_ID}/boqs/${BOQ_ID}\\?returnTo=${escapeRe(encodeURIComponent(`/app/projects/${PROJECT_ID}/workbench/boq`))}`));
    const rate = page.getByRole("spinbutton", { name: new RegExp(`^Rate for ${escapeRe(desc.slice(0, 40))}`) });
    await rate.fill("1500");
    await rate.press("Tab");
    await expect.poll(() => env.line().custom_rate).toBe(1500);
    await page.getByRole("button", { name: "Back to project" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/boq\\?boq=${BOQ_ID}`));
    await expect(page.getByRole("navigation", { name: "Workbench sections" })).toBeVisible();

    // The quantity edit made before the hand-off can still be undone.
    const undo = page.getByRole("button", { name: /^Undo: Quantity of / });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect.poll(() => env.line().qty).toBe(1);
    await expect(page.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
    // Undo reverts only the quantity; the builder's rate edit stays, and both are in the history.
    expect(env.line().custom_rate).toBe(1500);
    expect(history(env.mock, env.target.id)).toEqual(["qty:1→2", "custom_rate:null→1500", "qty:2→1"]);

    // Export after undo and the rate edit.
    await nav.getByRole("link", { name: "Export", exact: true }).click();
    expect(await exportedRow(page, code)).toEqual({ qty: "1", rate: "1500" });
    afterEachCheck(env);
  });

  test("reloading the page clears the session undo history (nothing is stored)", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect(page.getByRole("button", { name: /^Undo: Quantity of / })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
    expect(env.line().qty).toBe(2);
    afterEachCheck(env);
  });

  test("a stale edit is refused: nothing is written and the current value is shown", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    // Someone else saves 3 after this page loaded the line at 1.
    expect(env.mock.mutate("boq_line", { id: env.target.id }, { qty: 3 })).toBe(1);
    await editQty(page, desc, "2");
    await expect(page.getByText(`Change ${CONFLICT}`)).toBeVisible();
    expect(env.line().qty).toBe(3);
    expect(history(env.mock, env.target.id)).toEqual([]);
    await expect(page.getByRole("button", { name: "Undo (nothing to undo)" })).toBeDisabled();
    // Existing editor contract: the field stays open with what was typed and
    // says so; Escape closes it on the value the database now holds.
    await expect(page.getByText("Could not save. Try again, or press Escape to cancel.")).toBeVisible();
    await page.getByRole("textbox", { name: new RegExp(`^Quantity for ${escapeRe(desc.slice(0, 40))}`) }).press("Escape");
    await expect(qtyButton(page, desc)).toHaveText("3");
    afterEachCheck(env);
  });

  test("a stale undo is refused: someone else's later value is kept, and the step is listed as not undone", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    env.mock.mutate("boq_line", { id: env.target.id }, { qty: 5 });
    await page.getByRole("button", { name: /^Undo: Quantity of / }).click();
    await expect(page.getByText(`Undo ${CONFLICT}`)).toBeVisible();
    expect(env.line().qty).toBe(5);
    expect(history(env.mock, env.target.id)).toEqual(["qty:1→2"]);
    // The refused step leaves the stack and stays listed as not undone.
    await expect(nothingToUndo(page)).toBeDisabled();
    await expect(notUndone(page)).toContainText(/Quantity of .* 1 → 2/);
    afterEachCheck(env);
  });

  test("the mock refuses a write it cannot interpret instead of guessing", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, env.target.description);
    const status = await page.evaluate(async ([url, id]) => {
      const r = await fetch(`${url}/rest/v1/boq_line?id=eq.${id}&qty=gt.0`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ qty: 99 }) });
      return r.status;
    }, [E2E_FAKE_SUPABASE_URL, env.target.id] as const);
    expect(status).toBe(400);
    expect(env.line().qty).toBe(1);
    afterEachCheck(env);
  });

  // --- Undo lifecycle (decision A1, provisional): tab-session memory --------

  test("undo history survives moving between every workbench section, and back/forward", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect(undoLast(page)).toBeEnabled();
    for (const s of ["drawings", "review", "check", "export"] as const) {
      await section(page, s);
      await expect(page).toHaveURL(new RegExp(`/workbench/${s}\\?boq=${BOQ_ID}$`));
    }
    await section(page, "boq");
    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Quantity of .* 1 → 2$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/workbench\/export/);
    await page.goForward();
    await expect(undoLast(page)).toBeEnabled();
    afterEachCheck(env);
  });

  test("undo history is kept in memory only: nothing in web storage, and a new tab starts empty", async ({ page, context }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    const storage = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    const before = await storage();
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect(undoLast(page)).toBeEnabled();
    const after = await storage();
    expect(after).toBe(before);
    expect(after).not.toContain(env.target.id);

    const other = await context.newPage();
    const env2 = await setUp(other);
    await other.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await expect(nothingToUndo(other)).toBeDisabled();
    // The first tab keeps its own history.
    await expect(undoLast(page)).toBeEnabled();
    afterEachCheck(env);
    afterEachCheck(env2);
  });

  test("several edits are undone last-first, each restoring exactly its own change", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target;
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!;
    const qtyOf = (id: string) => env.mock.tables.boq_line.find((l) => l.id === id)!.qty;
    expect([a.qty, b.qty]).toEqual([1, 42.5]);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    await editQty(page, a.description, "2");
    await expect.poll(() => qtyOf(a.id)).toBe(2);
    await findLine(page, b.description);
    await editQty(page, b.description, "40");
    await expect.poll(() => qtyOf(b.id)).toBe(40);
    await findLine(page, a.description);
    await editQty(page, a.description, "3");
    await expect.poll(() => qtyOf(a.id)).toBe(3);
    await expect(undoLast(page)).toHaveText(/Undo \(3\)/);

    const steps: [string, RegExp, [number, number]][] = [
      [a.id, /2 → 3$/, [2, 40]],
      [b.id, /42\.5 → 40$/, [2, 42.5]],
      [a.id, /1 → 2$/, [1, 42.5]],
    ];
    for (const [, label, [qa, qb]] of steps) {
      await expect(undoLast(page)).toHaveAccessibleName(label);
      await undoLast(page).click();
      await expect.poll(() => [qtyOf(a.id), qtyOf(b.id)]).toEqual([qa, qb]);
    }
    await expect(nothingToUndo(page)).toBeDisabled();
    expect(history(env.mock, a.id)).toEqual(["qty:1→2", "qty:2→3", "qty:3→2", "qty:2→1"]);
    expect(history(env.mock, b.id)).toEqual(["qty:42.5→40", "qty:40→42.5"]);
    // Undo restores the basis the quantity edit replaced, too.
    expect(env.mock.tables.boq_line.find((l) => l.id === b.id)!.basis).toBe(b.basis);
    afterEachCheck(env);
  });

  test("after the builder hand-off, undo refuses to overwrite a later conflicting change", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    await page.getByRole("link", { name: "Edit in builder" }).click();
    await expect(page).toHaveURL(new RegExp(`/ops/projects/${PROJECT_ID}/boqs/${BOQ_ID}`));
    // Someone else changes the quantity while this user is in the builder.
    env.mock.mutate("boq_line", { id: env.target.id }, { qty: 7 });
    await page.getByRole("button", { name: "Back to project" }).click();
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}`));
    await undoLast(page).click();
    await expect(page.getByText(`Undo ${CONFLICT}`)).toBeVisible();
    expect(env.line().qty).toBe(7);
    expect(history(env.mock, env.target.id)).toEqual(["qty:1→2"]);
    await expect(nothingToUndo(page)).toBeDisabled();
    await expect(notUndone(page)).toContainText(/Quantity of .* 1 → 2/);
    afterEachCheck(env);
  });

  // --- Review section and return navigation ---------------------------------

  test("the review screen runs inside the workbench: decisions save to the same store, and Back leads to the BOQ section", async ({ page }) => {
    const env = await setUp(page);
    const opsRequests: string[] = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame() && new URL(f.url()).pathname.startsWith("/ops")) opsRequests.push(f.url()); });
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);
    await expect(page.getByRole("heading", { name: "Review quantities" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workbench sections" }).getByRole("link", { name: "Review", exact: true })).toHaveAttribute("aria-current", "page");
    // The existing review screen, embedded: its own Verify action, on the item still needing a decision.
    const statusOf = (id: string) => (env.mock.tables.analysis_review_item.find((r) => r.id === id) as Row).review_status;
    expect(statusOf(ITEM_COLUMN_ID)).toBe("PENDING_REVIEW");
    await page.getByRole("button", { name: "Verify", exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => statusOf(ITEM_COLUMN_ID)).toBe("VERIFIED");
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/review\\?boq=${BOQ_ID}$`));
    // Its Back control returns to the workbench's BOQ section, same BOQ.
    await page.getByRole("button", { name: "Back to project" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/boq\\?boq=${BOQ_ID}$`));
    // Returning to Review shows the saved decision (one store, re-read).
    await section(page, "review");
    await expect(page.getByRole("heading", { name: "Review quantities" })).toBeVisible();
    expect(statusOf(ITEM_COLUMN_ID)).toBe("VERIFIED");
    expect(env.mock.writes.filter((w) => w.table === "analysis_review_item").map((w) => w.method)).toContain("PATCH");
    expect(opsRequests).toEqual([]);
    afterEachCheck(env);
  });

  test("the embedded review keeps the existing role restriction: a non-staff user is sent away", async ({ page }) => {
    const env = await setUp(page, buildPhase2Fixtures, (f) => { f.user_roles = [{ user_id: "e2e-user-1", role: "contractor" }]; });
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);
    await expect(page).toHaveURL(/\/my-projects$/);
    await expect(page.getByRole("button", { name: "Verify", exact: true })).toHaveCount(0);
    expect(env.mock.writes).toEqual([]);
    afterEachCheck(env);
  });

  test("links between sections stay in the workbench and keep the BOQ (check → pending lines, BOQ → review)", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/check?boq=${BOQ_ID}`);
    const pending = page.getByRole("link", { name: "Show pending lines" }).first();
    await expect(pending).toHaveAttribute("href", `/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}&status=pending`);
    await pending.click();
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}&status=pending$`));
    const toReview = page.getByRole("link", { name: "Review quantities" }).first();
    await expect(toReview).toHaveAttribute("href", `/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);
    await toReview.click();
    await expect(page.getByRole("heading", { name: "Review quantities" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/workbench/review\\?boq=${BOQ_ID}$`));
    // No link on these pages leads back into the journey's own step routes.
    const journeyLinks = await page.locator(`a[href^="/app/projects/${PROJECT_ID}/"]:not([href*="/workbench/"])`).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(journeyLinks).toEqual([]);
    afterEachCheck(env);
  });

  test("drawing evidence opens in the workbench's Drawings section and comes back to the BOQ", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await page.getByRole("button", { name: /^Show evidence for / }).first().click();
    await page.getByRole("link", { name: /Show the measured region on/ }).click();
    await expect(page).toHaveURL(new RegExp(`/workbench/drawings\\?boq=${BOQ_ID}&document=`));
    await expect(page.getByRole("navigation", { name: "Workbench sections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drawings", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}$`));
    await expect(page.getByRole("navigation", { name: "Workbench sections" })).toBeVisible();
    afterEachCheck(env);
  });

  // --- Undo entries are recorded only for writes that took effect -----------

  test("a failed save records no undo step", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    // Highest priority: the next line update fails at the server.
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line"), (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "mock failure" }) })
        : route.fallback());
    await editQty(page, desc, "2");
    await expect(page.getByText(/^Not saved — /)).toBeVisible();
    expect(env.line().qty).toBe(1);
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  test("a save whose history record fails is put back and records no undo step", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line_change_log"), (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "mock history failure" }) })
        : route.fallback());
    await editQty(page, desc, "2");
    await expect(page.getByText(/Change not saved: its history record couldn't be saved \(mock history failure\)\. The previous value was kept\./)).toBeVisible();
    // lib/lineEdit wrote 2, then put 1 back (guarded on 2).
    expect(env.mock.writes.filter((w) => w.table === "boq_line" && w.method === "PATCH").map((w) => (w.body as Row).qty)).toEqual([2, 1]);
    expect(env.line().qty).toBe(1);
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  // --- Stale undo (contract: LIFO; a stale step is set aside, never blocks others) ---

  test("a stale newest step is set aside and an earlier step on another line still undoes", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target;
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!;
    const qtyOf = (id: string) => env.mock.tables.boq_line.find((l) => l.id === id)!.qty;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    await editQty(page, a.description, "2");
    await expect.poll(() => qtyOf(a.id)).toBe(2);
    await findLine(page, b.description);
    await editQty(page, b.description, "40");
    await expect.poll(() => qtyOf(b.id)).toBe(40);
    env.mock.mutate("boq_line", { id: b.id }, { qty: 41 }); // someone else, after our edit of b
    await undoLast(page).click();
    await expect(page.getByText(`Undo ${CONFLICT}`)).toBeVisible();
    expect(qtyOf(b.id)).toBe(41);
    await expect(notUndone(page)).toContainText(/42\.5 → 40/);
    // The earlier, independent step is next and works.
    await expect(undoLast(page)).toHaveAccessibleName(/1 → 2$/);
    await undoLast(page).click();
    await expect.poll(() => qtyOf(a.id)).toBe(1);
    expect(qtyOf(b.id)).toBe(41);
    await expect(nothingToUndo(page)).toBeDisabled();
    // The explanation survives section moves (tab session), and can be dismissed.
    await section(page, "check");
    await section(page, "boq");
    await expect(notUndone(page)).toContainText(/42\.5 → 40/);
    await notUndone(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(notUndone(page)).toHaveCount(0);
    expect(history(env.mock, a.id)).toEqual(["qty:1→2", "qty:2→1"]);
    expect(history(env.mock, b.id)).toEqual(["qty:42.5→40"]);
    afterEachCheck(env);
  });

  test("several edits of one line: a stale newest step also sets aside that line's earlier steps, other lines still undo", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target;
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!;
    const qtyOf = (id: string) => env.mock.tables.boq_line.find((l) => l.id === id)!.qty;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    await editQty(page, a.description, "2");
    await expect.poll(() => qtyOf(a.id)).toBe(2);
    await findLine(page, b.description);
    await editQty(page, b.description, "40");
    await expect.poll(() => qtyOf(b.id)).toBe(40);
    await findLine(page, a.description);
    await editQty(page, a.description, "3");
    await expect.poll(() => qtyOf(a.id)).toBe(3);
    // Someone else sets a back to 2 — the value our first step left. Undoing
    // that first step would now silently overwrite their change, so it is set aside too.
    env.mock.mutate("boq_line", { id: a.id }, { qty: 2 });
    await undoLast(page).click();
    await expect(page.getByText(`Undo ${CONFLICT}`)).toBeVisible();
    await expect(notUndone(page).getByRole("listitem")).toHaveCount(2);
    await expect(notUndone(page).getByRole("listitem").nth(0)).toContainText(/2 → 3/);
    await expect(notUndone(page).getByRole("listitem").nth(1)).toContainText(/1 → 2 \(an earlier edit of the same line\)/);
    await expect(undoLast(page)).toHaveAccessibleName(/42\.5 → 40$/);
    await undoLast(page).click();
    await expect.poll(() => qtyOf(b.id)).toBe(42.5);
    await expect(nothingToUndo(page)).toBeDisabled();
    expect(qtyOf(a.id)).toBe(2);
    expect(history(env.mock, a.id)).toEqual(["qty:1→2", "qty:2→3"]);
    afterEachCheck(env);
  });

  test("reload clears refused records together with the undo history", async ({ page }) => {
    const env = await setUp(page);
    const desc = env.target.description;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, desc);
    await editQty(page, desc, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    env.mock.mutate("boq_line", { id: env.target.id }, { qty: 6 });
    await undoLast(page).click();
    await expect(notUndone(page)).toBeVisible();
    await page.reload();
    await expect(nothingToUndo(page)).toBeDisabled();
    await expect(notUndone(page)).toHaveCount(0);
    afterEachCheck(env);
  });

  // --- Multi-BOQ --------------------------------------------------------------

  test("switching BOQs keeps each BOQ's own undo history, and returning restores it", async ({ page }) => {
    const env = await setUp(page, buildMultiBoqFixtures);
    const b2 = env.fixtures.boq_line.find((l) => l.id === BOQ2_LINE_ID(1))!;
    const qtyOf = (id: string) => env.mock.tables.boq_line.find((l) => l.id === id)!.qty;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await expect(boqPicker(page)).toHaveValue(BOQ_ID);
    await findLine(page, env.target.description);
    await editQty(page, env.target.description, "2");
    await expect.poll(() => env.line().qty).toBe(2);

    await boqPicker(page).selectOption(BOQ2_ID);
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ2_ID}`));
    await expect(nothingToUndo(page)).toBeDisabled();
    await findLine(page, b2.description);
    await editQty(page, b2.description, "6");
    await expect.poll(() => qtyOf(b2.id)).toBe(6);
    await expect(undoLast(page)).toHaveAccessibleName(/5 → 6$/);

    await boqPicker(page).selectOption(BOQ_ID);
    await expect(undoLast(page)).toHaveAccessibleName(/1 → 2$/);
    await expect(undoLast(page)).toHaveText(/Undo \(1\)/);
    await undoLast(page).click();
    await expect.poll(() => env.line().qty).toBe(1);
    expect(qtyOf(b2.id)).toBe(6);

    await boqPicker(page).selectOption(BOQ2_ID);
    await expect(undoLast(page)).toHaveAccessibleName(/5 → 6$/);
    afterEachCheck(env);
  });

  test("?boq for the second BOQ survives every section and back/forward, and each section shows that BOQ", async ({ page }) => {
    const env = await setUp(page, buildMultiBoqFixtures);
    const b2code = env.fixtures.boq_line.find((l) => l.id === BOQ2_LINE_ID(1))!.dsr_code!;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ2_ID}`);
    await expect(page.getByRole("cell", { name: b2code, exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: env.target.dsr_code!, exact: true })).toHaveCount(0);
    for (const s of ["drawings", "review", "check", "export", "boq"] as const) {
      await section(page, s);
      await expect(page).toHaveURL(new RegExp(`/workbench/${s}\\?boq=${BOQ2_ID}$`));
      if (s !== "drawings") await expect(boqPicker(page)).toHaveValue(BOQ2_ID);
    }
    for (const s of ["export", "check", "review", "drawings"]) {
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/workbench/${s}\\?boq=${BOQ2_ID}$`));
    }
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/workbench/review\\?boq=${BOQ2_ID}$`));
    await expect(boqPicker(page)).toHaveValue(BOQ2_ID);
    afterEachCheck(env);
  });

  test("a stale undo in one BOQ cannot affect the other BOQ", async ({ page }) => {
    const env = await setUp(page, buildMultiBoqFixtures);
    const b2 = env.fixtures.boq_line.find((l) => l.id === BOQ2_LINE_ID(1))!;
    const qtyOf = (id: string) => env.mock.tables.boq_line.find((l) => l.id === id)!.qty;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, env.target.description);
    await editQty(page, env.target.description, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    await boqPicker(page).selectOption(BOQ2_ID);
    await findLine(page, b2.description);
    await editQty(page, b2.description, "6");
    await expect.poll(() => qtyOf(b2.id)).toBe(6);
    env.mock.mutate("boq_line", { id: b2.id }, { qty: 7 });
    await undoLast(page).click();
    await expect(notUndone(page)).toContainText(/5 → 6/);
    expect(qtyOf(b2.id)).toBe(7);
    expect(env.line().qty).toBe(2);

    await boqPicker(page).selectOption(BOQ_ID);
    await expect(notUndone(page)).toHaveCount(0);
    await expect(undoLast(page)).toHaveAccessibleName(/1 → 2$/);
    await undoLast(page).click();
    await expect.poll(() => env.line().qty).toBe(1);
    expect(qtyOf(b2.id)).toBe(7);
    afterEachCheck(env);
  });

  test("export uses the selected BOQ's current data", async ({ page }) => {
    const env = await setUp(page, buildMultiBoqFixtures);
    const b2 = env.fixtures.boq_line.find((l) => l.id === BOQ2_LINE_ID(2))!;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ2_ID}`);
    await findLine(page, b2.description);
    await editQty(page, b2.description, "9");
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === b2.id)!.qty).toBe(9);
    await section(page, "export");
    const csv2 = await exportedCsv(page);
    expect(csv2.name).toMatch(/^Second_fixture_BOQ_BOQ\.csv$/);
    expect(csv2.row(b2.dsr_code!)).toEqual({ qty: "9", rate: String(b2.dsr_rate) });
    expect(csv2.row(env.target.dsr_code!)).toBeNull();

    await boqPicker(page).selectOption(BOQ_ID);
    await expect(page).toHaveURL(new RegExp(`/workbench/export\\?boq=${BOQ_ID}$`));
    const csv1 = await exportedCsv(page);
    expect(csv1.name).toMatch(/^Phase_2_fixture_BOQ_BOQ\.csv$/);
    expect(csv1.row(env.target.dsr_code!)).toEqual({ qty: "1", rate: String(env.target.dsr_rate) });
    expect(csv1.row(b2.dsr_code!)).toBeNull();
    afterEachCheck(env);
  });

  // --- End to end, and the embedded review's layout ---------------------------

  test("end to end: review, edits, builder hand-off, conflict, undo, BOQ switching and export in one session", async ({ page }) => {
    test.setTimeout(120_000);
    const env = await setUp(page, buildMultiBoqFixtures);
    const a = env.target;
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!;
    const c = env.fixtures.boq_line.find((l) => l.id === BOQ2_LINE_ID(1))!;
    const row = (id: string) => env.mock.tables.boq_line.find((l) => l.id === id)!;
    const statusOf = (id: string) => (env.mock.tables.analysis_review_item.find((r) => r.id === id) as Row).review_status;

    await page.goto(`/app/projects/${PROJECT_ID}/workbench?boq=${BOQ_ID}`);
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}$`));

    // Review: decide the item still pending, inside the workbench.
    await section(page, "review");
    await page.getByRole("button", { name: "Verify", exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => statusOf(ITEM_COLUMN_ID)).toBe("VERIFIED");

    // BOQ: two quantity edits.
    await section(page, "boq");
    await findLine(page, a.description);
    await editQty(page, a.description, "2");
    await expect.poll(() => row(a.id).qty).toBe(2);
    await findLine(page, b.description);
    await editQty(page, b.description, "40");
    await expect.poll(() => row(b.id).qty).toBe(40);

    // Rate in the builder, and back with undo intact.
    await findLine(page, a.description);
    await page.getByRole("link", { name: "Edit in builder" }).click();
    const rate = page.getByRole("spinbutton", { name: new RegExp(`^Rate for ${escapeRe(a.description.slice(0, 40))}`) });
    await rate.fill("1500");
    await rate.press("Tab");
    await expect.poll(() => row(a.id).custom_rate).toBe(1500);
    await page.getByRole("button", { name: "Back to project" }).click();
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}`));
    await expect(undoLast(page)).toHaveText(/Undo \(2\)/);

    // Someone else changes line b: its undo is refused and set aside; a's undo still works.
    env.mock.mutate("boq_line", { id: b.id }, { qty: 41 });
    await undoLast(page).click();
    await expect(notUndone(page)).toContainText(/42\.5 → 40/);
    await undoLast(page).click();
    await expect.poll(() => row(a.id).qty).toBe(1);
    expect([row(a.id).custom_rate, row(b.id).qty]).toEqual([1500, 41]);

    // Second BOQ: its own edit and export.
    await boqPicker(page).selectOption(BOQ2_ID);
    await expect(nothingToUndo(page)).toBeDisabled();
    await expect(notUndone(page)).toHaveCount(0);
    await findLine(page, c.description);
    await editQty(page, c.description, "6");
    await expect.poll(() => row(c.id).qty).toBe(6);
    await section(page, "export");
    const csv2 = await exportedCsv(page);
    expect(csv2.row(c.dsr_code!)).toEqual({ qty: "6", rate: String(c.dsr_rate) });
    expect(csv2.row(a.dsr_code!)).toBeNull();

    // Back to the first BOQ's export: every change above, as stored.
    await boqPicker(page).selectOption(BOQ_ID);
    const csv1 = await exportedCsv(page);
    expect(csv1.row(a.dsr_code!)).toEqual({ qty: "1", rate: "1500" });
    expect(csv1.row(b.dsr_code!)?.qty).toBe("41");

    // The first BOQ's not-undone record is still there for it.
    await section(page, "boq");
    await expect(notUndone(page)).toContainText(/42\.5 → 40/);
    expect(history(env.mock, a.id)).toEqual(["qty:1→2", "custom_rate:null→1500", "qty:2→1"]);
    expect(history(env.mock, b.id)).toEqual(["qty:42.5→40"]);
    afterEachCheck(env);
  });

  test("the embedded review fits the window below the workbench header (no page scroll at 1440×900)", async ({ page }) => {
    const env = await setUp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Verify", exact: true }).waitFor({ timeout: 20_000 });
    const panes = page.locator("[data-rw-panes]");
    await expect.poll(async () => (await panes.boundingBox())?.height ?? 0).toBeGreaterThan(460);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
    const box = (await panes.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect(box.y + box.height).toBeGreaterThan(900 - 60); // fills the window, no large gap
    // The review screen and the workbench nav are both on screen.
    await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeInViewport();
    await expect(page.getByRole("navigation", { name: "Workbench sections" })).toBeInViewport();
    afterEachCheck(env);
  });
});
