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
import { buildPhase2Fixtures, buildMultiBoqFixtures, dsrCatalogueRow, LINE_ID, TARGET_LINE, PROJECT_ID, BOQ_ID, BOQ2_ID, BOQ2_LINE_ID } from "./fixtures/phase2FixtureSet";
import { ITEM_COLUMN_ID } from "./fixtures/testData";

const FAKE_HOST = new URL(E2E_FAKE_SUPABASE_URL).hostname;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_URL = "http://localhost:8080";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONFLICT = "not saved: this line was changed elsewhere since it was loaded. The current values are now shown.";
// The app's message when the revision database function is unavailable (src/hooks/useBoqRevisions.ts).
const REVISIONS_UNAVAILABLE = "Commercial revisions are not set up on this database yet (migration 20261006000000_boq_commercial_revision.sql has not been applied). The working BOQ and its exports are unaffected.";

type Row = Record<string, unknown>;
type Spec = Record<string, unknown>;

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
    /** The row whose Specification starts with `desc` (for lines without a code). */
    rowBy: (desc: string) => {
      const r = lines.find((c) => (c[head.indexOf("Specification")] ?? "").startsWith(desc));
      return r ? { qty: r[head.indexOf("Qty")], rate: r[head.indexOf("Your rate")], amount: r[head.indexOf("Amount")] } : null;
    },
  };
}

const qtyButton = (page: Page, desc: string) => page.getByRole("button", { name: new RegExp(`^Edit Quantity for ${escapeRe(desc.slice(0, 100))}`) });

async function editQty(page: Page, desc: string, value: string) {
  await qtyButton(page, desc).click();
  const input = page.getByRole("textbox", { name: new RegExp(`^Quantity for ${escapeRe(desc.slice(0, 100))}`) });
  await input.fill(value);
  await input.press("Enter");
}

async function findLine(page: Page, desc: string) {
  await page.getByPlaceholder("Search lines").fill(desc.slice(0, 30));
  await expect(qtyButton(page, desc)).toBeVisible();
}

const SECTION_LABEL = { overview: "Overview", drawings: "Drawings", review: "Review", boq: "BOQ", check: "Check", export: "Export" } as const;
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
    // The journey keeps rates read-only (edited in the builder) and has no per-line history.
    await expect(page.getByRole("button", { name: /^Edit Rate for / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /change history for/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit in builder" })).toBeVisible();
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
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/overview\\?boq=${BOQ_ID}$`));
    await expect(page.getByRole("note").filter({ hasText: "Workbench preview" })).toContainText("off by default");
    const nav = page.getByRole("navigation", { name: "Workbench sections" });
    // The journey's steps, in the journey's order; the workbench opens on the Overview, as the journey does.
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Drawings", "Review", "BOQ", "Check", "Export"]);
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Project steps" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: env.fixtures.projects[0].name })).toBeVisible();
    // Section links keep the selected BOQ.
    for (const s of ["drawings", "review", "check", "export", "overview", "boq"] as const) {
      await nav.getByRole("link", { name: SECTION_LABEL[s], exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/workbench/${s}\\?boq=${BOQ_ID}$`));
      await expect(page.getByRole("navigation", { name: "Project steps" })).toHaveCount(0);
    }
    await expect(page.getByText("Undo history is kept for this BOQ in this browser tab until the page is reloaded.")).toBeVisible();
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

    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
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
    const rate = page.getByRole("spinbutton", { name: new RegExp(`^Rate for ${escapeRe(desc.slice(0, 100))}`) });
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
    await page.getByRole("textbox", { name: new RegExp(`^Quantity for ${escapeRe(desc.slice(0, 100))}`) }).press("Escape");
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
    await expect(page).toHaveURL(new RegExp(`/workbench/overview\\?boq=${BOQ_ID}$`));

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

  // --- Contractor workspace: overview, rates, history, honest gaps -----------

  // 100 characters: several DSR descriptions share their first 40.
  const rateButton = (page: Page, desc: string) => page.getByRole("button", { name: new RegExp(`^Edit Rate for ${escapeRe(desc.slice(0, 100))}`) });
  async function editRate(page: Page, desc: string, value: string) {
    await rateButton(page, desc).click();
    const input = page.getByRole("textbox", { name: new RegExp(`^Rate for ${escapeRe(desc.slice(0, 100))}`) });
    await input.fill(value);
    await input.press("Enter");
  }
  const RATE_CONFLICT = "This line's rate was changed elsewhere since you opened it — nothing was saved. The current rate is shown.";

  test("overview: each BOQ's figures come from its rows, update after review, and lead into the workbench", async ({ page }) => {
    const env = await setUp(page, buildMultiBoqFixtures);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/overview?boq=${BOQ_ID}`);
    const boqs = page.getByRole("region", { name: "BOQs" }).or(page.locator("section[aria-labelledby=ov-boqs]"));
    const item = (name: string) => boqs.getByRole("listitem").filter({ hasText: name });
    const stat = (name: string, label: string) => item(name).locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
    // BOQ 1: 8 lines, one excluded; line 4 has a pending quantity; review item C1 still needs a decision.
    await expect(stat("Phase 2 fixture BOQ", "Included lines")).toHaveText("7");
    await expect(stat("Phase 2 fixture BOQ", "Pending quantity")).toHaveText("1");
    await expect(stat("Phase 2 fixture BOQ", "Need a review decision")).toHaveText("1");
    // BOQ 2: 3 included lines, none pending, no review run.
    await expect(stat("Second fixture BOQ", "Included lines")).toHaveText("3");
    await expect(stat("Second fixture BOQ", "Need a review decision")).toHaveText("0");

    // Decide the open review item in the workbench; the overview reflects it.
    await section(page, "review");
    await page.getByRole("button", { name: "Verify", exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => (env.mock.tables.analysis_review_item.find((r) => r.id === ITEM_COLUMN_ID) as Row).review_status).toBe("VERIFIED");
    await section(page, "overview");
    await expect(stat("Phase 2 fixture BOQ", "Need a review decision")).toHaveText("0");

    // "Open BOQ" for the second BOQ stays in the workbench, on that BOQ.
    await item("Second fixture BOQ").getByRole("link", { name: "Open BOQ" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/boq\\?boq=${BOQ2_ID}$`));
    await expect(boqPicker(page)).toHaveValue(BOQ2_ID);
    // No link on the overview leads back into the journey's own step routes.
    await section(page, "overview");
    const journeyLinks = await page.locator(`a[href^="/app/projects/${PROJECT_ID}/"]:not([href*="/workbench/"])`).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(journeyLinks).toEqual([]);
    afterEachCheck(env);
  });

  test("rates are edited in the BOQ through the audited path, recorded, shown with their source, and undoable — without leaving the workbench", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target; // DSR rate 1330.15, no own rate, qty 1
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    await expect(rateButton(page, a.description)).toContainText("1,330.15");
    await expect(page.getByRole("row").filter({ has: rateButton(page, a.description) })).toContainText("DSR rate");

    await editRate(page, a.description, "1,500");
    await expect.poll(() => env.line().custom_rate).toBe(1500);
    await expect(rateButton(page, a.description)).toContainText("1,500");
    const row = page.getByRole("row").filter({ has: rateButton(page, a.description) });
    await expect(row).toContainText("own rate");
    await expect(row.getByRole("cell").nth(6)).toHaveText(/^1,500/); // amount = 1 × 1,500
    expect(history(env.mock, a.id)).toEqual(["custom_rate:null→1500"]);
    // The PATCH was guarded on the rate shown (compare-and-swap).
    expect(env.mock.writes.find((w) => w.table === "boq_line" && w.method === "PATCH")!.query).toMatch(/custom_rate=is\.null/);
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}`));

    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Rate of .*: DSR 1,330\.15 → 1,500$/);
    await undoLast(page).click();
    await expect.poll(() => env.line().custom_rate).toBe(null);
    expect(history(env.mock, a.id)).toEqual(["custom_rate:null→1500", "custom_rate:1500→null"]);
    // The cell shows the persisted rate after undo (the builder's uncontrolled rate input does not — docs/deployment-log.md 2026-10-21).
    await expect(rateButton(page, a.description)).toContainText("1,330.15");
    await expect(page.getByRole("row").filter({ has: rateButton(page, a.description) })).toContainText("DSR rate");
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  test("an invalid rate is refused in place and nothing is written", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    for (const [v, msg] of [["-5", "Rate cannot be negative."], ["abc", "Enter a rate in rupees, or leave it empty to use the DSR rate."]]) {
      await editRate(page, a.description, v);
      await expect(page.getByRole("alert").filter({ hasText: msg })).toBeVisible();
      await page.getByRole("textbox", { name: new RegExp(`^Rate for `) }).press("Escape");
    }
    expect(env.mock.writes.filter((w) => w.table === "boq_line")).toEqual([]);
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  test("a stale rate edit, and a stale rate undo, never overwrite the newer rate", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    env.mock.mutate("boq_line", { id: a.id }, { custom_rate: 1700 }); // someone else, after load
    await editRate(page, a.description, "1500");
    await expect(page.getByText(RATE_CONFLICT)).toBeVisible();
    expect(env.line().custom_rate).toBe(1700);
    await expect(nothingToUndo(page)).toBeDisabled();
    expect(history(env.mock, a.id)).toEqual([]);

    await page.getByRole("textbox", { name: /^Rate for / }).press("Escape");
    await expect(rateButton(page, a.description)).toContainText("1,700");
    await editRate(page, a.description, "1800");
    await expect.poll(() => env.line().custom_rate).toBe(1800);
    env.mock.mutate("boq_line", { id: a.id }, { custom_rate: 1900 });
    await undoLast(page).click();
    await expect(page.getByText(`Undo not saved: ${RATE_CONFLICT}`)).toBeVisible();
    expect(env.line().custom_rate).toBe(1900);
    await expect(notUndone(page)).toContainText(/Rate of .*1,700 → 1,800/);
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  test("replacing an adopted rate asks first; keeping it writes nothing", async ({ page }) => {
    const env = await setUp(page, buildPhase2Fixtures, (f) => {
      const lines = f.boq_line as Row[];
      lines.find((l) => l.id === LINE_ID(2))!.custom_rate = 2000;
      f.boq_line_rate_adoption = [{ id: "ad-1", boq_id: BOQ_ID, boq_line_id: LINE_ID(2), previous_rate: null, previous_basis: "DSR", adopted_rate: 2000,
        source_kind: "quote", source_label: "Vendor quote Q-17", source_unit: null, source_date: null, acknowledged_caveats: [], confirmation_text: "", confirmed_by: "e2e-user-1", confirmed_at: "2026-10-05T00:00:00Z" }];
    });
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(2))!;
    const rateOf = () => env.mock.tables.boq_line.find((l) => l.id === b.id)!.custom_rate;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, b.description);
    await editRate(page, b.description, "2100");
    const dialog = page.getByRole("alertdialog", { name: "Replace the adopted rate?" });
    await expect(dialog).toContainText("Vendor quote Q-17");
    await dialog.getByRole("button", { name: "Keep adopted rate" }).click();
    expect(rateOf()).toBe(2000);
    expect(env.mock.writes.filter((w) => w.table === "boq_line")).toEqual([]);

    await page.getByRole("textbox", { name: /^Rate for / }).press("Escape");
    await editRate(page, b.description, "2100");
    await dialog.getByRole("button", { name: "Replace with manual rate" }).click();
    await expect.poll(rateOf).toBe(2100);
    // The adoption record is history; it is never changed by a manual edit.
    expect(env.mock.writes.filter((w) => w.table === "boq_line_rate_adoption")).toEqual([]);
    afterEachCheck(env);
  });

  test("each line shows what changed and why, from its recorded history", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, a.description);
    await editQty(page, a.description, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    await editRate(page, a.description, "1500");
    await expect.poll(() => env.line().custom_rate).toBe(1500);
    await page.getByRole("button", { name: new RegExp(`^Show change history for ${escapeRe(a.description.slice(0, 30))}`) }).click();
    const panel = page.getByRole("region", { name: /^Change history for / });
    const items = panel.getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Own rate: none (DSR rate) → 1500");
    await expect(items.nth(0)).toContainText("Manual edit");
    await expect(items.nth(1)).toContainText("Quantity: 1 → 2");
    afterEachCheck(env);
  });

  test("where change history is not set up, the history panel says so instead of showing an empty list", async ({ page }) => {
    const env = await setUp(page);
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line_change_log"), (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "42P01", message: 'relation "public.boq_line_change_log" does not exist' }) })
        : route.fallback());
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, env.target.description);
    await page.getByRole("button", { name: /^Show change history for / }).first().click();
    await expect(page.getByText("Change history is not set up on this database, so changes to this line are not recorded.")).toBeVisible();
    afterEachCheck(env);
  });

  test("a line with no rate is stated as such everywhere — table, check, export — and the check leads back to it", async ({ page }) => {
    const env = await setUp(page);
    const m = env.fixtures.boq_line.find((l) => l.id === LINE_ID(8))!; // own rate 1500, no DSR code or rate
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, m.description);
    await editRate(page, m.description, ""); // clear the own rate: there is no DSR rate to fall back to
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === m.id)!.custom_rate).toBe(null);
    const row = page.getByRole("row").filter({ has: rateButton(page, m.description) });
    await expect(row).toContainText("no rate");
    await expect(row).toContainText("needs a rate");
    await expect(row).toContainText("No rate");

    await section(page, "check");
    await expect(page.getByText("No rate yet:", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("1");
    const fix = page.getByRole("link", { name: "Add rates in the BOQ" }).first();
    await expect(fix).toHaveAttribute("href", `/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}&status=unpriced`);
    await fix.click();
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("unpriced");
    await expect(rateButton(page, m.description)).toBeVisible();
    await expect(page.getByText("Showing 1 of 8 lines")).toBeVisible();

    await section(page, "export");
    const csv = await exportedCsv(page);
    // Exported with its quantity; its rate and amount cells stay empty — never invented.
    expect(csv.rowBy(m.description.slice(0, 100))).toEqual({ qty: "4", rate: "", amount: "" });
    afterEachCheck(env);
  });

  test("Apply from the embedded review writes through the real Apply, lands on the workbench BOQ, and says what changed", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Verify", exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => (env.mock.tables.analysis_review_item.find((r) => r.id === ITEM_COLUMN_ID) as Row).review_status).toBe("VERIFIED");
    const linesBefore = env.mock.tables.boq_line.length;

    await page.getByRole("button", { name: /Review complete.*Apply to BOQ/ }).click();
    const dialog = page.getByRole("dialog", { name: "Apply reviewed quantities" });
    const apply = dialog.getByRole("button", { name: /Apply \d+ to BOQ/ });
    await expect(apply).toBeEnabled({ timeout: 15_000 });
    await apply.click();
    const receipt = page.getByRole("region", { name: /Applied \d+ changes? to the BOQ/ });
    await expect(receipt).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/workbench/review\\?boq=${BOQ_ID}$`));

    // The verified column became a BOQ line, recorded against its review item.
    const added = env.mock.tables.boq_line.slice(linesBefore);
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({ boq_id: BOQ_ID, basis: "REVIEW_VERIFIED" });
    const recorded = (env.mock.tables.boq_line_change_log ?? []).filter((r: Row) => r.boq_line_id === added[0].id);
    expect(recorded.length).toBeGreaterThan(0);

    await receipt.getByRole("button", { name: "View updated BOQ" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/workbench/boq\\?boq=${BOQ_ID}$`));
    await expect(page.getByRole("status", { name: "Last Apply result" })).toContainText(/Last applied from review in this browser tab/);
    const desc = String(added[0].description);
    await findLine(page, desc);
    await page.getByRole("button", { name: new RegExp(`^Show change history for ${escapeRe(desc.slice(0, 30))}`) }).click();
    await expect(page.getByRole("region", { name: /^Change history for / })).toContainText("Line created");
    // The applied quantity is what the export carries, with its review basis.
    await section(page, "export");
    const csv = await exportedCsv(page);
    const row = csv.rowBy(desc.slice(0, 100));
    expect(row?.qty).toBe(String(added[0].qty));
    // Apply never started an analysis, and only the expected tables were written.
    expect(new Set(env.mock.writes.map((w) => `${w.method} ${w.table}`))).toEqual(new Set(["PATCH analysis_review_item", "POST boq_line", "POST boq_line_change_log"]));
    afterEachCheck(env);
  });

  test("a quantity corrected in review reaches the BOQ, its history, Check and the export as the corrected value, with its basis", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click({ timeout: 20_000 });
    const qty = page.getByRole("spinbutton", { name: /^Quantity \(AI: / });
    await qty.fill("12.5");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect.poll(() => (env.mock.tables.analysis_review_item.find((r) => r.id === ITEM_COLUMN_ID) as Row).review_status).toBe("EDITED");
    expect(((env.mock.tables.analysis_review_item.find((r) => r.id === ITEM_COLUMN_ID) as Row).reviewer_json as Row).quantity).toBe(12.5);
    // A correction alone changes nothing in the BOQ until Apply.
    const linesBefore = env.mock.tables.boq_line.length;
    expect(env.mock.writes.filter((w) => w.table === "boq_line")).toEqual([]);

    await page.getByRole("button", { name: /Review complete.*Apply to BOQ/ }).click();
    const dialog = page.getByRole("dialog", { name: "Apply reviewed quantities" });
    const apply = dialog.getByRole("button", { name: /Apply \d+ to BOQ/ });
    await expect(apply).toBeEnabled({ timeout: 15_000 });
    await apply.click();
    await expect(page.getByRole("region", { name: /Applied \d+ changes? to the BOQ/ })).toBeVisible();

    const added = env.mock.tables.boq_line.slice(linesBefore);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ boq_id: BOQ_ID, qty: 12.5, basis: "REVIEW_CORRECTED" });
    expect((env.mock.tables.boq_line_change_log ?? []).filter((r: Row) => r.boq_line_id === added[0].id && r.review_item_id === ITEM_COLUMN_ID).length).toBeGreaterThan(0);

    // BOQ: the corrected quantity, labelled as corrected in review.
    await section(page, "boq");
    const desc = String(added[0].description);
    await findLine(page, desc);
    await expect(qtyButton(page, desc)).toHaveText("12.5");
    await expect(page.getByRole("row").filter({ has: qtyButton(page, desc) })).toContainText("Counted on drawing, corrected in review");

    // Export: the same quantity and basis.
    await section(page, "export");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel \(CSV\)/ }).click()]);
    const rows = fs.readFileSync(await download.path(), "utf8").split(/\r?\n/).map(csvCells);
    const head = rows.find((c) => c.includes("Qty") && c.includes("Quantity basis"))!;
    const row = rows.find((c) => (c[head.indexOf("Specification")] ?? "").startsWith(desc.slice(0, 60)))!;
    expect(row[head.indexOf("Qty")]).toBe("12.5");
    expect(row[head.indexOf("Quantity basis")]).toBe("Counted on drawing, corrected in review");
    afterEachCheck(env);
  });

  test("a project with no BOQ says so in every section and offers to create one, returning to the workbench", async ({ page }) => {
    const env = await setUp(page, buildPhase2Fixtures, (f) => { f.boq = []; f.boq_line = []; });
    await page.goto(`/app/projects/${PROJECT_ID}/workbench`);
    await expect(page).toHaveURL(new RegExp(`/workbench/overview$`));
    await expect(page.getByText("No BOQs yet.")).toBeVisible();
    await section(page, "boq");
    await expect(page.getByRole("heading", { name: "No BOQ yet" })).toBeVisible();
    const create = page.getByRole("link", { name: "Create a BOQ" });
    await expect(create).toHaveAttribute("href", `/ops/projects/${PROJECT_ID}/boqs/manage?returnTo=${encodeURIComponent(`/app/projects/${PROJECT_ID}/workbench/boq`)}`);
    await section(page, "review");
    await expect(page.getByRole("heading", { name: "No BOQ to review into yet" })).toBeVisible();
    await section(page, "export");
    await expect(page.getByText(/This project has no BOQ/)).toBeVisible();
    expect(env.mock.writes).toEqual([]);
    afterEachCheck(env);
  });

  test("when the lines cannot be read, the BOQ says so and offers a retry — it never shows an empty BOQ", async ({ page }) => {
    const env = await setUp(page);
    let fail = true;
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line"), (route) =>
      fail && route.request().method() === "GET"
        ? route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "mock read failure" }) })
        : route.fallback());
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await expect(page.getByText("Could not load the lines of this BOQ.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("This BOQ has no lines yet.")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(qtyButton(page, env.target.description)).toBeVisible();
    afterEachCheck(env);
  });

  // --- Full lifecycle in the workbench: add, remove, exclude, create, finalise ---

  const fill = async (page: Page, label: string, value: string) => page.getByRole("form", { name: "Add a line" }).getByLabel(label, { exact: true }).fill(value);
  const subtotal = async (page: Page) => (await page.getByText(/^Priced works subtotal:/).locator("xpath=following-sibling::dd[1]").textContent())!.trim();

  test("adding lines: without a quantity it is pending (never invented), from DSR it carries code and reference rate; both recorded and undoable", async ({ page }) => {
    const env = await setUp(page, buildPhase2Fixtures, (f) => { f.dsr_item = [dsrCatalogueRow("21.15.1")]; });
    const before = env.mock.tables.boq_line.length;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Add line" }).click();

    // Incomplete: refused in place, nothing written.
    await fill(page, "Description", "Plinth protection");
    await page.getByRole("button", { name: "Add to BOQ" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter a unit." })).toBeVisible();
    expect(env.mock.writes.filter((w) => w.table === "boq_line")).toEqual([]);

    await fill(page, "Unit", "sqm");
    await page.getByRole("button", { name: "Add to BOQ" }).click();
    await expect.poll(() => env.mock.tables.boq_line.length).toBe(before + 1);
    const added = env.mock.tables.boq_line[before];
    expect(added).toMatchObject({ boq_id: BOQ_ID, description: "Plinth protection", unit: "sqm", qty: 0, basis: "PENDING", quantity_status: "PENDING", custom_rate: null, dsr_rate: null, section: "Other" });
    expect(history(env.mock, added.id as string)).toEqual(["line_created:null→Plinth protection", "qty:null→0", "unit:null→sqm"]);
    await findLine(page, "Plinth protection");
    await expect(qtyButton(page, "Plinth protection")).toHaveText("Pending");
    await expect(page.getByRole("row").filter({ has: qtyButton(page, "Plinth protection") })).toContainText("Quantity pending");

    // From DSR 2023, with a measured quantity.
    const dsr = dsrCatalogueRow("21.15.1");
    await page.getByPlaceholder("Search lines").fill("");
    await page.getByRole("button", { name: "Add line" }).click();
    await fill(page, "Description", "my own words");
    await page.getByRole("button", { name: "Pick from DSR 2023…" }).click();
    const picker = page.getByRole("dialog", { name: "Find a DSR item" });
    await picker.getByRole("textbox").fill("21.15");
    await picker.getByText(dsr.code, { exact: true }).first().click();
    await expect(page.getByRole("form", { name: "Add a line" })).toContainText(`DSR ${dsr.code}`);
    // A DSR-coded line carries the item's standard description and unit, not text typed before picking.
    await expect(page.getByRole("form", { name: "Add a line" }).getByLabel("Description", { exact: true })).toHaveValue(dsr.description);
    await fill(page, "Quantity", "3");
    await page.getByRole("button", { name: "Add to BOQ" }).click();
    await expect.poll(() => env.mock.tables.boq_line.length).toBe(before + 2);
    expect(env.mock.tables.boq_line[before + 1]).toMatchObject({ dsr_code: dsr.code, description: dsr.description, unit: dsr.unit, dsr_rate: dsr.rate, qty: 3, basis: "MANUAL", custom_rate: null });

    // Export carries it with its reference rate; the pending line has no amount.
    await section(page, "export");
    const csv = await exportedCsv(page);
    expect(csv.row(dsr.code)).toEqual({ qty: "3", rate: String(dsr.rate) });

    // Undo removes the added lines, newest first, only as added.
    await section(page, "boq");
    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Added “Providing and fixing aluminium/);
    await undoLast(page).click();
    await expect.poll(() => env.mock.tables.boq_line.length).toBe(before + 1);
    await undoLast(page).click();
    await expect.poll(() => env.mock.tables.boq_line.length).toBe(before);
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  test("removing a line asks first, records the complete line, and undo restores it exactly — evidence, history and totals included", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target; // evidence-linked (D1), drawing source Document A
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    const total0 = await subtotal(page);
    await findLine(page, a.description);
    await editQty(page, a.description, "2");
    await expect.poll(() => env.line().qty).toBe(2);
    await expect.poll(() => subtotal(page)).not.toBe(total0);
    const total1 = await subtotal(page);

    const remove = page.getByRole("button", { name: new RegExp(`^Remove line ${escapeRe(a.description.slice(0, 60))}`) });
    await remove.click();
    const dialog = page.getByRole("alertdialog", { name: "Remove this line?" });
    await dialog.getByRole("button", { name: "Keep line" }).click();
    expect(env.mock.tables.boq_line.some((l) => l.id === a.id)).toBe(true);

    await remove.click();
    // The line carries verified review evidence: the dialog says what removing it leaves out.
    await expect(dialog.getByRole("note")).toContainText("This line carries drawing-review item “D1” (verified on the drawings). Removing it leaves that reviewed quantity out of the BOQ.");
    await dialog.getByRole("button", { name: "Remove line" }).click();
    await expect.poll(() => env.mock.tables.boq_line.some((l) => l.id === a.id)).toBe(false);
    // The removal is recorded right after the delete.
    await expect.poll(() => (env.mock.tables.boq_line_change_log as Row[]).some((r) => r.field === "line_removed")).toBe(true);
    const removal = (env.mock.tables.boq_line_change_log as Row[]).find((r) => r.field === "line_removed")!;
    expect(JSON.parse(String(removal.old_value))).toMatchObject({ id: a.id, qty: 2, external_key: "D1", source_document_id: a.source_document_id });
    await expect(page.getByRole("row").filter({ has: qtyButton(page, a.description) })).toHaveCount(0);
    await expect.poll(() => subtotal(page)).not.toBe(total1);

    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Removed “/);
    await undoLast(page).click();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === a.id)).toMatchObject({ qty: 2, external_key: "D1", source_document_id: a.source_document_id, source_page: "1" });
    // Its history is re-attached (and records the removal and the restore).
    await expect.poll(() => (env.mock.tables.boq_line_change_log as Row[]).some((r) => r.field === "line_restored" && r.boq_line_id === a.id)).toBe(true);
    await expect.poll(() => history(env.mock, a.id)).toEqual(expect.arrayContaining(["qty:1→2", "line_removed:" + String(removal.old_value) + "→null"]));
    await findLine(page, a.description);
    await expect(page.getByRole("button", { name: /^Show evidence for / }).first()).toBeVisible();
    await expect.poll(() => subtotal(page)).toBe(total1);
    // Its history reads as removed and restored — the stored JSON is never dumped on screen.
    await page.getByRole("button", { name: new RegExp(`^Show change history for ${escapeRe(a.description.slice(0, 30))}`) }).click();
    const hist = page.getByRole("region", { name: /^Change history for / });
    await expect(hist).toContainText("Line removed (the complete line is kept in this record)");
    await expect(hist).toContainText("Line restored");
    await expect(hist).not.toContainText("{");
    // The earlier quantity edit is still undoable after the restore.
    await undoLast(page).click();
    await expect.poll(() => env.line().qty).toBe(1);
    await expect.poll(() => subtotal(page)).toBe(total0);
    afterEachCheck(env);
  });

  test("removal is refused when it would destroy linked records (offering to exclude instead) or when the line changed elsewhere", async ({ page }) => {
    const env = await setUp(page, buildPhase2Fixtures, (f) => { f.vendor_quotation = [{ id: "vq-1", boq_line_id: LINE_ID(2), amount: 1 }]; });
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(2))!;
    const removeBtn = (d: string) => page.getByRole("button", { name: new RegExp(`^Remove line ${escapeRe(d.slice(0, 60))}`) });
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, b.description);
    await removeBtn(b.description).click();
    await page.getByRole("alertdialog", { name: "Remove this line?" }).getByRole("button", { name: "Remove line" }).click();
    await expect(page.getByText(/Line not removed: it has a linked vendor quotation/)).toBeVisible();
    expect(env.mock.tables.boq_line.some((l) => l.id === b.id)).toBe(true);
    await page.getByRole("button", { name: "Exclude instead" }).click();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === b.id)!.included).toBe(false);
    expect(history(env.mock, b.id)).toEqual(["included:true→false"]);

    // Changed elsewhere after load: refused, nothing deleted.
    const a = env.target;
    await findLine(page, a.description);
    env.mock.mutate("boq_line", { id: a.id }, { qty: 9 });
    await removeBtn(a.description).click();
    await page.getByRole("alertdialog", { name: "Remove this line?" }).getByRole("button", { name: "Remove line" }).click();
    await expect(page.getByText(/Line not removed: it was changed elsewhere since it was loaded/)).toBeVisible();
    expect(env.mock.tables.boq_line.find((l) => l.id === a.id)!.qty).toBe(9);
    expect(env.mock.writes.filter((w) => w.method === "DELETE")).toEqual([]);
    afterEachCheck(env);
  });

  test("excluding and including a line moves the totals, is recorded, and is undoable", async ({ page }) => {
    const env = await setUp(page);
    const l1 = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    const t0 = await subtotal(page);
    await findLine(page, l1.description);
    // A double click sends one change, not a second one refused as "changed elsewhere".
    await page.getByRole("button", { name: new RegExp(`^Exclude ${escapeRe(l1.description.slice(0, 40))}`) }).dblclick();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === l1.id)!.included).toBe(false);
    await expect(page.getByText(`Change ${CONFLICT}`)).toHaveCount(0);
    expect(env.mock.writes.filter((w) => w.table === "boq_line" && w.method === "PATCH").length).toBe(1);
    await expect(page.getByRole("row").filter({ has: qtyButton(page, l1.description) })).toContainText("Excluded");
    await expect.poll(() => subtotal(page)).not.toBe(t0);
    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Excluded “.*” from the total$/);
    await undoLast(page).click();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === l1.id)!.included).toBe(true);
    await expect.poll(() => subtotal(page)).toBe(t0);
    expect(history(env.mock, l1.id)).toEqual(["included:true→false", "included:false→true"]);
    afterEachCheck(env);
  });

  test("a new BOQ is created in the workbench, opened in place, kept apart from the others, and listed on the overview", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, env.target.description);
    await editQty(page, env.target.description, "2");
    await expect.poll(() => env.line().qty).toBe(2);

    await page.getByRole("button", { name: "New BOQ" }).click();
    const dialog = page.getByRole("dialog", { name: "Create BOQ" });
    await dialog.getByPlaceholder("e.g. Terrace").fill("Terrace");
    await dialog.getByPlaceholder("e.g. Ground Floor BOQ").fill("Terrace BOQ");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => env.mock.tables.boq.some((b) => b.name === "Terrace BOQ")).toBe(true);
    const created = env.mock.tables.boq.find((b) => b.name === "Terrace BOQ")!;
    expect(created).toMatchObject({ project_id: PROJECT_ID });
    expect(env.mock.tables.project_scope?.find((s) => s.id === created.scope_id)).toMatchObject({ name: "Terrace", project_id: PROJECT_ID });
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${escapeRe(String(created.id))}$`));
    await expect(page.getByText("This BOQ has no lines yet.")).toBeVisible();
    await expect(nothingToUndo(page)).toBeDisabled();

    await page.getByRole("button", { name: "Add line" }).click();
    await fill(page, "Description", "Waterproofing");
    await fill(page, "Unit", "sqm");
    await fill(page, "Quantity", "120");
    await page.getByRole("button", { name: "Add to BOQ" }).click();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.description === "Waterproofing")?.boq_id).toBe(created.id);

    // The new BOQ is a draft and takes commercial changes (guarded on its updated_at).
    await section(page, "export");
    await expect(page.getByText("Status: Draft", { exact: true })).toBeVisible();
    const gst = page.locator("section[aria-labelledby=wb-commercials]").getByLabel(/^GST \(%\)/);
    await gst.fill("12");
    await gst.press("Enter");
    await expect.poll(() => (env.mock.tables.boq.find((b) => b.id === created.id)!.spec as Spec)._gst_pct).toBe(12);

    await section(page, "overview");
    await expect(page.locator("section[aria-labelledby=ov-boqs]").getByRole("listitem").filter({ hasText: "Terrace BOQ" })).toBeVisible();
    // Back to the first BOQ in place (no reload): its own undo step is still there; the new BOQ's is not mixed in.
    await section(page, "boq");
    await boqPicker(page).selectOption(BOQ_ID);
    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Quantity of .* 1 → 2$/);
    await expect(undoLast(page)).toHaveText(/Undo \(1\)/);
    afterEachCheck(env);
  });

  test("finalising and preparing a revision happen in the workbench; freezing (a database function) is not simulated and is reported, never faked", async ({ page }) => {
    const env = await setUp(page);
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/export?boq=${BOQ_ID}`);
    const fin = page.locator("section[aria-labelledby=wb-finalise]");
    await expect(fin.getByTestId("boq-status")).toContainText("Draft");
    await fin.getByRole("button", { name: "Mark finalized" }).click();
    await expect.poll(() => env.mock.tables.boq.find((b) => b.id === BOQ_ID)!.status).toBe("finalized");
    await expect(fin.getByTestId("boq-status")).toContainText("Finalized");
    await expect(page.getByRole("link", { name: /Freeze a revision in the BOQ builder/ })).toHaveCount(0);

    await fin.getByRole("button", { name: "Prepare a new revision…" }).click();
    const draft = fin.getByRole("region", { name: "New revision" });
    await expect(draft).toBeVisible();
    // The snapshot is built from the saved BOQ: its limitations (a pending line, a line without a rate) are listed and must be acknowledged.
    await expect(draft.getByRole("list", { name: "Revision limitations" })).toBeVisible();
    await expect(draft.getByRole("button", { name: "Freeze revision" })).toBeDisabled();
    await draft.getByRole("checkbox").check();
    await draft.getByRole("button", { name: "Freeze revision" }).click();
    await expect.poll(() => env.mock.rpcCalls).toEqual(["create_boq_commercial_revision"]);
    await expect(page.getByText(REVISIONS_UNAVAILABLE)).toBeVisible();
    await expect(page.getByText("Commercial revision frozen")).toHaveCount(0);
    expect(env.mock.tables.boq_revision ?? []).toEqual([]);
    afterEachCheck(env);
  });

  test("writes the database refuses (row-level security) are reported and leave no undo step", async ({ page }) => {
    const env = await setUp(page);
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line"), (route) => {
      const m = route.request().method();
      if (m === "POST") return route.fulfill({ status: 403, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "42501", message: 'new row violates row-level security policy for table "boq_line"' }) });
      if (m === "DELETE") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" });
      if (m === "PATCH") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" });
      return route.fallback();
    });
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Add line" }).click();
    await fill(page, "Description", "Not allowed");
    await fill(page, "Unit", "nos");
    await fill(page, "Quantity", "1");
    await page.getByRole("button", { name: "Add to BOQ" }).click();
    await expect(page.getByText(/^Line not added — /)).toBeVisible();
    await page.getByRole("button", { name: "Close add a line" }).click();

    const a = env.target;
    await findLine(page, a.description);
    await page.getByRole("button", { name: new RegExp(`^Remove line ${escapeRe(a.description.slice(0, 60))}`) }).click();
    await page.getByRole("alertdialog", { name: "Remove this line?" }).getByRole("button", { name: "Remove line" }).click();
    await expect(page.getByText(/the database removed nothing — .*you do not have permission/)).toBeVisible();

    // A guarded update RLS filters out looks like a conflict: refused, nothing claimed.
    await editQty(page, a.description, "2");
    await expect(page.getByText(`Change ${CONFLICT}`)).toBeVisible();
    await expect(nothingToUndo(page)).toBeDisabled();
    expect(env.mock.tables.boq_line.find((l) => l.id === a.id)).toMatchObject({ qty: 1 });
    afterEachCheck(env);
  });

  // --- Commercials and failure handling ---------------------------------------

  test("commercials: the abstract shows what is persisted, edits are validated and guarded, and the grand total follows", async ({ page }) => {
    const env = await setUp(page);
    const boqRow = () => env.mock.tables.boq.find((b) => b.id === BOQ_ID)!;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/export?boq=${BOQ_ID}`);
    const panel = page.locator("section[aria-labelledby=wb-commercials]");
    const overhead = panel.getByLabel(/^Overhead & profit \(%\)/);
    await expect(panel.getByText("Overhead & profit (%) — default")).toBeVisible();
    await expect(overhead).toHaveValue("15");
    const g0 = (await panel.getByTestId("grand-total").textContent())!;

    await overhead.fill("150");
    await overhead.press("Enter");
    await expect(panel.getByRole("alert")).toHaveText("A percentage must be between 0 and 100.");
    expect(env.mock.writes.filter((w) => w.table === "boq")).toEqual([]);

    await overhead.fill("10");
    await overhead.press("Enter");
    await expect.poll(() => (boqRow().spec as Spec | null)?._overhead_pct).toBe(10);
    // Guarded: the write was filtered on the BOQ's updated_at and moved it forward.
    expect(env.mock.writes.find((w) => w.table === "boq" && w.method === "PATCH")!.query).toMatch(/updated_at=eq\./);
    await expect(panel.getByText("Overhead & profit (%)", { exact: true })).toBeVisible();
    await expect.poll(async () => panel.getByTestId("grand-total").textContent()).not.toBe(g0);

    // Letterhead
    await panel.getByLabel("Firm name on exports").fill("Fixture Builders");
    await panel.getByLabel("Firm name on exports").blur();
    await expect.poll(() => (boqRow().spec as Spec | null)?._firm_name).toBe("Fixture Builders");

    // Another writer keeps winning: nothing is overwritten, and the persisted value stays shown.
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq"), (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" })
        : route.fallback());
    const gst = panel.getByLabel(/^GST \(%\)/);
    await gst.fill("12");
    await gst.press("Enter");
    await expect(page.getByText("GST not saved: the BOQ was changed elsewhere while saving. The current values are now shown.")).toBeVisible();
    await expect(gst).toHaveValue("18");
    expect((boqRow().spec as Spec | null)?._gst_pct).toBeUndefined();
    afterEachCheck(env);
  });

  test("an add whose history record fails is taken out again: no line, no undo step, and the screen says so", async ({ page }) => {
    const env = await setUp(page);
    const before = env.mock.tables.boq_line.length;
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line_change_log"), (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "mock history failure" }) })
        : route.fallback());
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Add line" }).click();
    await fill(page, "Description", "Unrecorded line");
    await fill(page, "Unit", "nos");
    await fill(page, "Quantity", "2");
    await page.getByRole("button", { name: "Add to BOQ" }).click();
    await expect(page.getByText("Line not added: its history record couldn't be saved (mock history failure).")).toBeVisible();
    await expect.poll(() => env.mock.tables.boq_line.length).toBe(before);
    await expect(nothingToUndo(page)).toBeDisabled();
    // The form stays open with what was typed, so nothing is lost.
    await expect(page.getByRole("form", { name: "Add a line" }).getByLabel("Description", { exact: true })).toHaveValue("Unrecorded line");
    afterEachCheck(env);
  });

  test("a removal whose history record fails is put back: the line stays, with no undo step", async ({ page }) => {
    const env = await setUp(page);
    const b = env.fixtures.boq_line.find((l) => l.id === LINE_ID(2))!;
    await page.route((u) => u.hostname === FAKE_HOST && u.pathname.endsWith("/rest/v1/boq_line_change_log"), (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "mock history failure" }) })
        : route.fallback());
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, b.description);
    await page.getByRole("button", { name: new RegExp(`^Remove line ${escapeRe(b.description.slice(0, 60))}`) }).click();
    await page.getByRole("alertdialog", { name: "Remove this line?" }).getByRole("button", { name: "Remove line" }).click();
    await expect(page.getByText(/Line not removed/).first()).toBeVisible();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === b.id)).toMatchObject({ qty: b.qty, description: b.description });
    await expect(nothingToUndo(page)).toBeDisabled();
    afterEachCheck(env);
  });

  // --- Removed reviewed evidence, commercial undo, rename, consistency ---------

  test("Check flags a verified review quantity whose line was removed, says how to bring it back, and clears when it is back", async ({ page }) => {
    const env = await setUp(page);
    const a = env.target; // carries verified D1
    const other = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!; // no review evidence
    const removeVia = async (desc: string) => {
      await findLine(page, desc);
      await page.getByRole("button", { name: new RegExp(`^Remove line ${escapeRe(desc.slice(0, 60))}`) }).click();
      await page.getByRole("alertdialog", { name: "Remove this line?" }).getByRole("button", { name: "Remove line" }).click();
    };
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await removeVia(other.description);
    await expect.poll(() => env.mock.tables.boq_line.some((l) => l.id === other.id)).toBe(false);
    await section(page, "check");
    await expect(page.getByText("No rate yet:", { exact: true })).toBeVisible();
    // A line without review evidence is not a reviewed quantity: nothing flagged.
    await expect(page.getByRole("region", { name: "Reviewed quantities removed from the BOQ" })).toHaveCount(0);

    await section(page, "boq");
    await removeVia(a.description);
    await expect.poll(() => (env.mock.tables.boq_line_change_log as Row[]).filter((r) => r.field === "line_removed").length).toBe(2);
    await section(page, "check");
    const note = page.getByRole("region", { name: "Reviewed quantities removed from the BOQ" });
    await expect(note).toContainText("1 reviewed quantity is no longer in this BOQ");
    await expect(note).toContainText("“D1”");
    await expect(note).toContainText("verified on the drawings");
    await expect(note.getByRole("link", { name: "apply the review again" })).toHaveAttribute("href", `/app/projects/${PROJECT_ID}/workbench/review?boq=${BOQ_ID}`);

    // Undo the removal: it is back, and the check is quiet again.
    await section(page, "boq");
    await expect(undoLast(page)).toHaveAccessibleName(/^Undo: Removed “Providing and fixing required/);
    await undoLast(page).click();
    await expect.poll(() => env.mock.tables.boq_line.some((l) => l.id === a.id)).toBe(true);
    await section(page, "check");
    await expect(page.getByText("No rate yet:", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reviewed quantities removed from the BOQ" })).toHaveCount(0);
    afterEachCheck(env);
  });

  test("commercial changes are undoable — from the panel or the BOQ's undo — and never over a newer value", async ({ page }) => {
    const env = await setUp(page, buildMultiBoqFixtures);
    const spec = () => (env.mock.tables.boq.find((b) => b.id === BOQ_ID)!.spec as Spec | null) ?? {};
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/export?boq=${BOQ_ID}`);
    const panel = page.locator("section[aria-labelledby=wb-commercials]");
    const setPct = async (label: RegExp, v: string) => { const f = panel.getByLabel(label); await f.fill(v); await f.press("Enter"); };

    // Panel undo: back to the default (the key is removed, not set to 15).
    await setPct(/^Overhead & profit \(%\)/, "10");
    await expect.poll(() => spec()._overhead_pct).toBe(10);
    const undoBtn = panel.getByRole("button", { name: "Undo: Overhead & profit: 15% (default) → 10%" });
    await undoBtn.click();
    await expect.poll(() => "_overhead_pct" in spec()).toBe(false);
    await expect(panel.getByText("Overhead & profit (%) — default")).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Undo: / })).toHaveCount(0);

    // The BOQ's undo button undoes a commercial change too (one history per BOQ).
    await setPct(/^Contingency \(%\)/, "4");
    await expect.poll(() => spec()._contingency_pct).toBe(4);
    await section(page, "boq");
    await expect(undoLast(page)).toHaveAccessibleName("Undo: Contingency: 3% (default) → 4%");
    await undoLast(page).click();
    await expect.poll(() => "_contingency_pct" in spec()).toBe(false);
    await expect(nothingToUndo(page)).toBeDisabled();
    // Kept per BOQ: the second BOQ has none of it.
    await boqPicker(page).selectOption(BOQ2_ID);
    await expect(nothingToUndo(page)).toBeDisabled();
    await boqPicker(page).selectOption(BOQ_ID);

    // Someone else changes GST after our change: undo refuses and keeps theirs.
    await section(page, "export");
    await setPct(/^GST \(%\)/, "12");
    await expect.poll(() => spec()._gst_pct).toBe(12);
    env.mock.mutate("boq", { id: BOQ_ID }, { spec: { ...spec(), _gst_pct: 5 } });
    await panel.getByRole("button", { name: "Undo: GST: 18% (default) → 12%" }).click();
    await expect(page.getByText("Undo not saved: GST was changed elsewhere since. The current value is kept.").first()).toBeVisible();
    expect(spec()._gst_pct).toBe(5);
    await expect(panel.getByLabel(/^GST \(%\)/)).toHaveValue("5");
    await section(page, "boq");
    await expect(notUndone(page)).toContainText("GST: 18% (default) → 12%");
    afterEachCheck(env);
  });

  test("renaming a BOQ is guarded on the name shown and is reflected everywhere", async ({ page }) => {
    const env = await setUp(page);
    const boqRow = () => env.mock.tables.boq.find((b) => b.id === BOQ_ID)!;
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await page.getByRole("button", { name: "Rename BOQ" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename BOQ" });
    await dialog.getByLabel("BOQ name").fill("   ");
    await dialog.getByRole("button", { name: "Save name" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a BOQ name.");
    await dialog.getByLabel("BOQ name").fill("Ground floor — civil");
    await dialog.getByRole("button", { name: "Save name" }).click();
    await expect.poll(() => boqRow().name).toBe("Ground floor — civil");
    expect(env.mock.writes.find((w) => w.table === "boq" && w.method === "PATCH")!.query).toMatch(/name=eq\./);
    await expect(boqPicker(page).locator("option:checked")).toHaveText("Ground floor — civil");

    // Renamed elsewhere after load: refused, theirs kept and shown.
    env.mock.mutate("boq", { id: BOQ_ID }, { name: "Renamed by someone else" });
    await page.getByRole("button", { name: "Rename BOQ" }).click();
    await dialog.getByLabel("BOQ name").fill("My name");
    await dialog.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Not renamed: this BOQ was renamed or changed elsewhere since it was loaded. The current name is now shown.")).toBeVisible();
    expect(boqRow().name).toBe("Renamed by someone else");
    await expect(boqPicker(page).locator("option:checked")).toHaveText("Renamed by someone else");
    afterEachCheck(env);
  });

  test("pilot path: the stages include rates; each Check blocker opens its own field; the export states the totals the documents carry", async ({ page }) => {
    const unpricedId = LINE_ID(8); // own rate 1500, no DSR rate: cleared below, so it has no rate
    const env = await setUp(page, buildPhase2Fixtures, (f) => {
      (f.boq_line as Row[]).forEach((l) => { if (l.id === unpricedId) l.custom_rate = null; });
    });
    const unpriced = env.fixtures.boq_line.find((l) => l.id === unpricedId)!;
    const pending = env.fixtures.boq_line.find((l) => l.quantity_status === "PENDING" && l.included)!;
    const name = (l: { description: unknown }) => String(l.description).slice(0, 40);

    // Overview: the workbench's stages include Rates & costing, from the saved lines.
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/overview?boq=${BOQ_ID}`);
    const stages = page.getByRole("list", { name: "BOQ stages" });
    await expect(stages.getByRole("listitem").filter({ hasText: "Rates & costing" })).toContainText("1 line with a quantity still has no rate.");

    // Check names the line without a rate; its link opens that line's rate editor.
    await section(page, "check");
    const noRate = page.getByRole("list", { name: "Lines without a rate" });
    await noRate.getByRole("link", { name: new RegExp(`^Enter rate for ${escapeRe(name(unpriced))}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/workbench/boq\\?boq=${BOQ_ID}&line=${escapeRe(unpricedId)}&field=rate$`));
    const rateInput = page.getByRole("textbox", { name: new RegExp(`^Rate for ${escapeRe(name(unpriced))}`) });
    await expect(rateInput).toBeFocused();
    await rateInput.fill("900");
    await rateInput.press("Enter");
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === unpricedId)!.custom_rate).toBe(900);

    // Back in Check the rate blocker is gone; the pending quantity opens its quantity editor.
    await section(page, "check");
    await expect(page.getByRole("list", { name: "Lines waiting for a quantity" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Lines without a rate" })).toHaveCount(0);
    await page.getByRole("list", { name: "Lines waiting for a quantity" }).getByRole("link", { name: new RegExp(`^Enter quantity for ${escapeRe(name(pending))}`) }).click();
    const qtyInput = page.getByRole("textbox", { name: new RegExp(`^Quantity for ${escapeRe(name(pending))}`) });
    await expect(qtyInput).toBeFocused();
    await qtyInput.fill("7");
    await qtyInput.press("Enter");
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === pending.id)!.qty).toBe(7);
    await section(page, "check");
    await expect(page.getByRole("list", { name: "Lines waiting for a quantity" })).toHaveCount(0);

    // Export: the pre-issue grand total is the commercials' grand total, and the CSV and PDF carry the same figure.
    await section(page, "export");
    await expect(page.getByTestId("export-issue-state")).toContainText("not an issued revision: nothing is frozen");
    const summaryTotal = (await page.getByTestId("export-grand-total").textContent())!.trim();
    await expect(page.locator("section[aria-labelledby=wb-commercials]").getByTestId("grand-total")).toHaveText(summaryTotal);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel \(CSV\)/ }).click()]);
    const csvText = fs.readFileSync(await download.path(), "utf8");
    expect(csvText).toContain("(working estimate, not frozen)");
    expect(csvText).toContain(`as in the priced PDF abstract: ${summaryTotal}`);
    const [pdf] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "PDF (priced)" }).click()]);
    await expect(pdf.locator("body")).toContainText("(working estimate, not frozen)");
    await expect(pdf.locator("tr.grand")).toContainText(summaryTotal);
    await pdf.close();
    afterEachCheck(env);
  });

  test("excluded and pending lines are treated the same in the BOQ, the commercials and the export", async ({ page }) => {
    const env = await setUp(page);
    const l1 = env.fixtures.boq_line.find((l) => l.id === LINE_ID(1))!;   // priced, will be excluded
    const pend = env.fixtures.boq_line.find((l) => l.id === LINE_ID(4))!; // pending quantity
    await page.goto(`/app/projects/${PROJECT_ID}/workbench/boq?boq=${BOQ_ID}`);
    await findLine(page, l1.description);
    await page.getByRole("button", { name: new RegExp(`^Exclude ${escapeRe(l1.description.slice(0, 40))}`) }).click();
    await expect.poll(() => env.mock.tables.boq_line.find((l) => l.id === l1.id)!.included).toBe(false);
    await page.getByPlaceholder("Search lines").fill("");
    const boqSubtotal = (await page.getByText(/^Priced works subtotal:/).locator("xpath=following-sibling::dd[1]").textContent())!.replace(/[^\d]/g, "");

    await section(page, "export");
    const works = (await page.locator("section[aria-labelledby=wb-commercials] dl[aria-label=Abstract] dd").first().textContent())!.replace(/[^\d]/g, "");
    // The same works figure in the BOQ and in the abstract the export prints.
    expect(works).toBe(boqSubtotal);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel \(CSV\)/ }).click()]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    const [priced, pendingPart = ""] = csv.split("IDENTIFIED — PENDING QUANTIFICATION");
    expect(priced).not.toContain(l1.dsr_code!);          // excluded: not exported
    expect(priced).not.toContain(pend.dsr_code!);        // pending: never priced…
    expect(pendingPart).toContain(pend.dsr_code!);       // …but listed, not dropped
    afterEachCheck(env);
  });
});
