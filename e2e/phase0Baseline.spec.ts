// Phase 0 baseline (UX/UI revamp): the Phase 2 slice task scripted on the
// CURRENT interface against the Phase 2 fixture set, with a mocked network.
//
// Evidence label: LOCAL / MOCK. It records navigation, shell transitions,
// context retention, visible errors, the write requests the interface SENDS,
// and automation timing (not human task time). The existing mock backend
// does not apply writes, so persistence, the stored effect of undo, conflict
// behaviour and edit-aware export are recorded as NOT VERIFIED.
//
// Fail-closed: every request that no mock handles is aborted, and the test
// fails if any request targets a Supabase host other than the fake project.
import fs from "node:fs";
import type { Page, Request, Route } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";
import { buildPhase2Fixtures, LINE_ID, TARGET_LINE, PROJECT_ID, BOQ_ID, DOC_A_ID } from "./fixtures/phase2FixtureSet";

const FAKE_HOST = new URL(E2E_FAKE_SUPABASE_URL).hostname;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Stage = { name: string; ok: boolean; steps: number; ms: number; url: string; shell: "app" | "ops" | "other"; opsConsoleVisible: boolean; projectNameVisible: boolean; boqParam: boolean; note?: string };

function applyEqIn(rows: Record<string, unknown>[], params: URLSearchParams) {
  let out = rows;
  for (const [col, expr] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
    const allowed = expr.startsWith("eq.") ? [expr.slice(3)] : expr.startsWith("in.(") && expr.endsWith(")") ? expr.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, "")) : null;
    if (!allowed) continue;
    out = out.filter((r) => r[col] === undefined || allowed.includes(String(r[col])));
  }
  return out;
}

/** The journey's Undo button reads "Undo: <change>" when there is something to undo and "Undo (nothing to undo)" otherwise. Checked without waiting. */
async function journeyUndoAvailable(page: Page) {
  const b = page.getByRole("button", { name: /^Undo: / });
  return (await b.count()) > 0 && (await b.first().isEnabled());
}

async function runBaseline(page: Page, viewport: { width: number; height: number }) {
  const fixtures = buildPhase2Fixtures();
  const target = fixtures.boq_line.find((l) => l.id === LINE_ID(TARGET_LINE))!;
  const targetDesc = target.description;
  const projectName = fixtures.projects[0].name;

  const requests: { method: string; host: string; path: string }[] = [];
  const writes: { method: string; table: string; columns: string[]; ms: number }[] = [];
  const blocked: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const t0 = Date.now();

  page.on("request", (r: Request) => {
    const u = new URL(r.url());
    requests.push({ method: r.method(), host: u.hostname, path: u.pathname });
    const m = u.pathname.match(/\/rest\/v1\/([^/?]+)/);
    if (m && r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS") {
      let columns: string[] = [];
      try { const b = r.postDataJSON(); columns = Object.keys(Array.isArray(b) ? b[0] ?? {} : b ?? {}); } catch { /* no body */ }
      writes.push({ method: r.method(), table: m[1], columns, ms: Date.now() - t0 });
    }
  });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)));

  // Lowest priority (registered first): abort anything no mock handles, except the local dev server.
  await page.route("**/*", (route: Route) => {
    const host = new URL(route.request().url()).hostname;
    if (LOCAL_HOSTS.has(host)) return route.continue();
    blocked.push(host);
    return route.abort();
  });
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
  await installMockBackend(page, { fixtures: () => fixtures as unknown as Record<string, unknown> });
  // Spec-local override (highest priority): the existing mock always serves
  // `boq` and `projects` as single objects; list queries need arrays.
  await page.route((url) => url.hostname === FAKE_HOST && /\/rest\/v1\/(boq|projects)$/.test(url.pathname), async (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fallback();
    const u = new URL(req.url());
    const table = u.pathname.endsWith("/boq") ? "boq" : "projects";
    const rows = applyEqIn(fixtures[table] as Record<string, unknown>[], u.searchParams);
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(single ? rows[0] ?? null : rows) });
  });

  await page.setViewportSize(viewport);
  // A stuck step must fail on its own and be recorded, not consume the whole test timeout.
  page.setDefaultTimeout(15_000);
  const stages: Stage[] = [];
  let steps = 0;
  const act = async <T>(fn: () => Promise<T>) => { steps += 1; return fn(); };
  const stage = async (name: string, fn: () => Promise<string | void>) => {
    const s0 = Date.now(); steps = 0;
    let ok = true; let note: string | undefined;
    try { const r = await fn(); note = typeof r === "string" ? r : undefined; } catch (e) { ok = false; note = String((e as Error).message).split("\n")[0].slice(0, 200); }
    const url = new URL(page.url());
    stages.push({
      name, ok, steps, ms: Date.now() - s0, url: url.pathname + url.search,
      shell: url.pathname.startsWith("/app") ? "app" : url.pathname.startsWith("/ops") ? "ops" : "other",
      opsConsoleVisible: (await page.getByText("Operations Console", { exact: true }).filter({ visible: true }).count()) > 0,
      projectNameVisible: (await page.getByText(projectName, { exact: false }).filter({ visible: true }).count()) > 0,
      boqParam: url.searchParams.get("boq") === BOQ_ID || url.pathname.includes(`/boqs/${BOQ_ID}`),
      note,
    });
    return ok;
  };
  const writeCount = (table: string) => writes.filter((w) => w.table === table).length;

  await stage("1 open project", async () => {
    await act(() => page.goto("/app/projects"));
    await act(() => page.getByRole("link", { name: new RegExp(escapeRe(projectName)) }).click());
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/overview`));
    await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
  });
  await stage("2 find the quantity", async () => {
    await act(() => page.getByRole("navigation", { name: "Project steps" }).getByRole("link", { name: /Build BOQ/ }).click());
    await expect(page).toHaveURL(/\/boq/);
    await act(() => page.getByPlaceholder("Search lines").fill(targetDesc.slice(0, 30)));
    await expect(page.getByRole("button", { name: new RegExp(`^Edit Quantity for ${escapeRe(targetDesc.slice(0, 40))}`) })).toBeVisible();
  });
  await stage("3 inspect drawing evidence", async () => {
    await act(() => page.getByRole("button", { name: /^Show evidence for / }).first().click());
    await expect(page.getByRole("group", { name: /^Evidence for / })).toBeVisible();
    await act(() => page.getByRole("link", { name: /Show the measured region on/ }).click());
    await expect(page).toHaveURL(new RegExp(`/drawings\\?.*document=${DOC_A_ID}`));
    await expect(page.getByRole("heading", { name: "Drawings", exact: true })).toBeVisible();
  });
  let searchRetained = false;
  await stage("4 return to the BOQ", async () => {
    await act(() => page.goBack());
    await expect(page).toHaveURL(/\/boq/);
    searchRetained = (await page.getByPlaceholder("Search lines").inputValue()) === targetDesc.slice(0, 30);
    if (!searchRetained) await act(() => page.getByPlaceholder("Search lines").fill(targetDesc.slice(0, 30)));
    return `search term retained after return: ${searchRetained}`;
  });
  let journeyUndoAfterEdit = false;
  await stage("5 correct the quantity (journey table)", async () => {
    const before = writeCount("boq_line");
    await act(() => page.getByRole("button", { name: new RegExp(`^Edit Quantity for ${escapeRe(targetDesc.slice(0, 40))}`) }).click());
    const input = page.getByRole("textbox", { name: new RegExp(`^Quantity for ${escapeRe(targetDesc.slice(0, 40))}`) });
    await act(() => input.fill("2"));
    await act(() => input.press("Enter"));
    await expect.poll(() => writeCount("boq_line")).toBeGreaterThan(before);
    journeyUndoAfterEdit = await journeyUndoAvailable(page);
    return `journey Undo available after edit: ${journeyUndoAfterEdit}`;
  });
  await stage("6 correct the rate (hand-off to the builder)", async () => {
    await act(() => page.getByRole("link", { name: "Edit in builder" }).click());
    await expect(page).toHaveURL(new RegExp(`/ops/projects/${PROJECT_ID}/boqs/${BOQ_ID}`));
    const before = writeCount("boq_line");
    const rate = page.getByRole("spinbutton", { name: new RegExp(`^Rate for ${escapeRe(targetDesc.slice(0, 40))}`) });
    await act(() => rate.fill("1500"));
    await act(() => rate.press("Tab"));
    await expect.poll(() => writeCount("boq_line")).toBeGreaterThan(before);
  });
  let builderUndoClicked = false;
  await stage("7 undo (builder)", async () => {
    await act(() => page.getByRole("button", { name: /Advanced settings/ }).click());
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    if (await undo.isEnabled().catch(() => false)) { await act(() => undo.click()); builderUndoClicked = true; }
    return builderUndoClicked ? "builder Undo clicked" : "builder Undo not available (no recorded change in this session)";
  });
  let journeyUndoAfterReturn = false;
  await stage("8 return to the project", async () => {
    await act(() => page.getByRole("button", { name: "Back to project" }).click());
    await expect(page).toHaveURL(new RegExp(`/app/projects/${PROJECT_ID}/boq`));
    journeyUndoAfterReturn = await journeyUndoAvailable(page);
    return `journey Undo available after return: ${journeyUndoAfterReturn}`;
  });
  let csvHasEditedQty: boolean | null = null;
  await stage("9 check and export", async () => {
    await act(() => page.getByRole("navigation", { name: "Project steps" }).getByRole("link", { name: /Check & finalise/ }).click());
    await expect(page).toHaveURL(/\/check/);
    await act(() => page.getByRole("navigation", { name: "Project steps" }).getByRole("link", { name: /Export/ }).click());
    await expect(page).toHaveURL(/\/export/);
    const [download] = await Promise.all([page.waitForEvent("download"), act(() => page.getByRole("button", { name: /Excel \(CSV\)/ }).click())]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    const row = csv.split(/\r?\n/).find((l) => l.includes(targetDesc.slice(0, 30))) ?? "";
    csvHasEditedQty = /(^|,)"?2"?(,|$)/.test(row);
    return `CSV row for the edited line shows the edited quantity: ${csvHasEditedQty} (mock does not apply writes)`;
  });

  const shellTransitions = stages.reduce((n, s, i) => (i > 0 && s.shell !== stages[i - 1].shell ? n + 1 : n), 0);
  const supabaseHosts = [...new Set(requests.map((r) => r.host).filter((h) => /supabase\.(co|in)$/.test(h)))];
  const errorBoundary = await page.getByText("Something went wrong").isVisible().catch(() => false);
  return {
    label: "LOCAL/MOCK baseline of the CURRENT interface. Not acceptance evidence. Timings are automation time, not human task time.",
    viewport, stages, shellTransitions,
    context: { searchRetainedAfterEvidence: searchRetained, journeyUndoAfterEdit, journeyUndoAfterReturn, builderUndoClicked },
    writesSent: writes,
    errors: { consoleErrors, pageErrors, errorBoundaryVisible: errorBoundary },
    network: { supabaseHosts, blockedExternalHosts: [...new Set(blocked)], requestCount: requests.length },
    notVerified: {
      persistence: "NOT VERIFIED — the mock answers writes with fixture rows and does not apply them",
      storedUndoEffect: "NOT VERIFIED — no stored state to undo",
      conflictBehaviour: "NOT VERIFIED — no conflict response is produced",
      editAwareExport: `NOT VERIFIED — observed CSV shows the edited quantity: ${csvHasEditedQty}`,
    },
  };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`Phase 0 baseline — current interface, ${viewport.width}×${viewport.height} (LOCAL/MOCK)`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const result = await runBaseline(page, viewport);
    const json = JSON.stringify(result, null, 2);
    await testInfo.attach(`baseline-${viewport.width}.json`, { body: json, contentType: "application/json" });
    const out = process.env.PHASE0_BASELINE_OUT;
    if (out) fs.writeFileSync(out.replace(/\.json$/, `-${viewport.width}.json`), json);

    // Fail-closed isolation: no request may reach a Supabase host other than the fake project.
    expect(result.network.supabaseHosts.filter((h) => h !== FAKE_HOST)).toEqual([]);
    // Every stage of the scripted task must be reachable on the current interface.
    expect(result.stages.filter((s) => !s.ok).map((s) => `${s.name}: ${s.note}`)).toEqual([]);
    // The interface must at least SEND the quantity and rate writes (their effect is not verified).
    expect(result.writesSent.filter((w) => w.table === "boq_line" && w.method === "PATCH").length).toBeGreaterThanOrEqual(2);
  });
}
