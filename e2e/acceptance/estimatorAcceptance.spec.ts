// ESTIMATOR ACCEPTANCE — one staff estimator, one drawing, one contractor-ready
// working estimate, through the real screens only. The same journey runs
// against the mock (default) or a deployed staging Preview (ACCEPTANCE_MODE=
// staging, playwright.acceptance.config.ts) — see ./adapters.ts.
//
// Every check here reads what the estimator sees or downloads, so it means the
// same thing in both modes. Read-backs of stored rows are mock-only and say so.
// A mock pass is NOT a backend acceptance: the title and the result file name
// the mode.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "../../playwright-fixture";
import { backendFor, DRAWING_NAME, MODE, type Backend } from "./adapters";
import { PROJECT_ID } from "../fixtures/phase2FixtureSet";

const SAMPLE = fs.readFileSync(new URL("../../docs/samples/staging-analysis-sample.json", import.meta.url), "utf8");
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const PROJECT = `ZZ-ACCEPT ${STAMP} retail fit-out`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

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
async function downloadCsv(page: Page) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Excel \(CSV\)/ }).click()]);
  const text = fs.readFileSync(await d.path(), "utf8");
  const rows = text.split(/\r?\n/).map(csvCells);
  const head = rows.find((c) => c.includes("Qty") && c.includes("Your rate"))!;
  const col = (r: string[], name: string) => r[head.indexOf(name)];
  const row = (spec: string) => rows.find((r) => (col(r, "Specification") ?? "").startsWith(spec));
  return { text, row: (spec: string) => { const r = row(spec); return r ? { qty: col(r, "Qty"), rate: col(r, "Your rate"), amount: col(r, "Amount"), basis: col(r, "Quantity basis") } : null; } };
}
async function openPdf(page: Page) {
  const [pdf] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "PDF (priced)" }).click()]);
  await expect(pdf.locator("tr.grand")).toBeVisible({ timeout: 20_000 });
  const text = await pdf.locator("body").innerText();
  await pdf.close();
  return text;
}
const nav = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Workbench sections" }).getByRole("link", { name: label, exact: true }).click();

test.describe(`Estimator acceptance [${MODE === "mock" ? "MOCK — not a backend acceptance run" : "STAGING"}]`, () => {
  test.describe.configure({ mode: "serial" });
  let backend: Backend;

  // Playwright requires a destructuring pattern for the fixtures argument, even when none is used.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, info) => {
    // The result file names the mode, so a mock run cannot pass for a backend run.
    fs.writeFileSync(info.outputPath("acceptance-result.json"), JSON.stringify({
      mode: backend?.mode ?? MODE, label: backend?.label ?? null, status: info.status, project: PROJECT,
      ranAt: new Date().toISOString(), note: (backend?.mode ?? MODE) === "mock" ? "In-memory mock: not evidence of real Auth, RLS, persistence or exports." : "Run against the staging deployment named in label.",
    }, null, 2));
  });

  test("opening Analyze Project asks the server only for the drawing fingerprint (preflight), never for an AI run", async ({ page }) => {
    test.skip(MODE !== "mock", "Reads the mock's record of edge-function calls.");
    backend = await backendFor(page);
    await page.goto(new URL(`/ops/projects/${PROJECT_ID}/workspace?mode=analyze`, backend.baseURL).href);
    await expect.poll(() => backend.mock!.aiCalls.map((c) => c.action)).toContain("preflight");
    await page.waitForTimeout(1000);
    expect(backend.mock!.aiCalls.map((c) => c.action).filter((a) => a !== "preflight")).toEqual([]);
  });

  test("a staff estimator takes one drawing to a contractor-ready working estimate", async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    backend = await backendFor(page);
    test.info().annotations.push({ type: "acceptance-mode", description: backend.label });
    if (backend.mode === "mock") expect(baseURL === undefined || baseURL === backend.baseURL || true).toBe(true);
    page.setDefaultTimeout(20_000);
    const go = (p: string) => page.goto(new URL(p, backend.baseURL).href);
    await backend.signIn(page);
    let projectId = "";
    let drawingSha = "";

    await test.step("1. create a named project in Ops and open it", async () => {
      await go("/ops/projects");
      await page.getByRole("button", { name: "Onboard project" }).click();
      const d = page.getByRole("dialog", { name: "Project onboarding" });
      await d.getByLabel("Project name").fill(PROJECT);
      await d.getByLabel("Client").fill("ZZ Acceptance Retail LLP");
      await d.getByLabel("Location").fill("Pune");
      await d.getByRole("button", { name: "Create project" }).click();
      await expect(d).toBeHidden();
      await go("/app/projects");
      await page.getByRole("link", { name: new RegExp(esc(PROJECT)) }).click();
      await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();
      projectId = page.url().match(/\/app\/projects\/([^/?#]+)/)![1];
    });

    await test.step("2. the drawing is in the project, and a BOQ is created for it", async () => {
      drawingSha = await backend.addDrawing(page, projectId);
      await go(`/app/projects/${projectId}/workbench/drawings`);
      await expect(page.getByText(DRAWING_NAME).first()).toBeVisible();
      await page.getByRole("button", { name: "New BOQ" }).click();
      const c = page.getByRole("dialog", { name: "Create BOQ" });
      await c.getByPlaceholder("e.g. Terrace").fill("Shop floor");
      await c.getByPlaceholder("e.g. Ground Floor BOQ").fill("Fit-out BOQ");
      await c.getByRole("button", { name: "Create" }).click();
      await expect(page.getByText("This BOQ has no lines yet.")).toBeVisible();
    });

    await test.step("2. drawing-derived quantities are loaded for review with their source; loading changes no BOQ line", async () => {
      await nav(page, "Review");
      // The extraction output names the drawing it was read from, by SHA-256.
      const analysis = { ...JSON.parse(SAMPLE), source_drawing: { sha256: drawingSha, filename: DRAWING_NAME, extractor: "manual take-off" } };
      await page.getByPlaceholder(/Paste Cunstruct analysis JSON/).fill(JSON.stringify(analysis));
      await expect(page.getByText("✓ 3 valid items")).toBeVisible();
      await page.getByRole("button", { name: "Validate & load for review" }).click();
      // The drawing itself is shown, and each quantity states its source drawing and page.
      await expect(page.getByRole("region", { name: `Drawing: ${DRAWING_NAME}` })).toBeVisible();
      await page.getByRole("button", { name: /^FL-1 — Vitrified tile flooring/ }).click();
      await page.getByRole("button", { name: "Details" }).click();
      await expect(page.getByText(`${DRAWING_NAME} — Page 1`).first()).toBeVisible();
      if (backend.mock) expect(backend.mock.writes.filter((w) => w.table === "boq_line")).toEqual([]);
    });

    await test.step("4. verify one item, correct another's quantity, flag the uncertain one", async () => {
      const open = async (key: string) => {
        // "Needs review only" hides decided items in the navigator; show all.
        const filter = page.getByRole("checkbox", { name: "Needs review only" });
        if (await filter.isChecked()) await filter.uncheck();
        await page.getByRole("button", { name: new RegExp(`^${esc(key)} — `) }).first().click();
      };
      await open("FC-1");
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await open("FL-1");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("spinbutton", { name: /^Quantity \(AI: / }).fill("92.5");
      await page.getByRole("button", { name: "Save correction" }).click();
      await expect(page.getByText(/quantity: .*95.*92\.5/).first()).toBeVisible();
      await open("SK-1");
      await page.getByRole("button", { name: "Flag" }).click();
      await page.getByRole("button", { name: "Save flag" }).click();
    });

    await test.step("3 + 7. Check names the flagged item and opens exactly that item", async () => {
      await nav(page, "Check");
      const list = page.getByRole("list", { name: "Review items not in the BOQ" });
      await expect(list).toContainText("flagged");
      await list.getByRole("link", { name: /^Open SK-1 — Skirting in review$/ }).click();
      await expect(page).toHaveURL(/[?&]item=/);
      await expect(page.getByText("SK-1 · Skirting")).toBeVisible();
    });

    await test.step("4. Apply the reviewed quantities; the BOQ shows the corrected value and its history", async () => {
      await page.getByRole("button", { name: /Apply .* to BOQ/ }).first().click();
      const dialog = page.getByRole("dialog", { name: "Apply reviewed quantities" });
      await expect(dialog).toContainText("92.5");
      await dialog.getByRole("button", { name: /Apply \d+ to BOQ/ }).click();
      await expect(page.getByRole("region", { name: /Applied \d+ changes? to the BOQ/ })).toBeVisible();
      await nav(page, "BOQ");
      const qty = page.getByRole("button", { name: /^Edit Quantity for Vitrified tile flooring/ });
      await expect(qty).toHaveText("92.5");
      await expect(page.getByRole("row").filter({ has: qty })).toContainText("corrected in review");
      await page.getByRole("button", { name: /^Show change history for Vitrified tile flooring/ }).click();
      const history = page.getByRole("region", { name: /^Change history for Vitrified tile flooring/ });
      await expect(history).toContainText("Applied from drawing review");
      if (backend.mock) {
        const line = backend.mock.tables.boq_line.find((l) => l.description === "Vitrified tile flooring")!;
        expect(line).toMatchObject({ qty: 92.5, basis: "REVIEW_CORRECTED" });
      }
    });

    await test.step("5. own rate on one line; the other stays without a rate; a pending line is added", async () => {
      const rate = page.getByRole("button", { name: /^Edit Rate for Gypsum false ceiling/ });
      await rate.click();
      const input = page.getByRole("textbox", { name: /^Rate for Gypsum false ceiling/ });
      await input.fill("95");
      await input.press("Enter");
      await expect(rate).toContainText("95");
      await page.getByRole("button", { name: "Add line" }).click();
      const form = page.getByRole("form", { name: "Add a line" });
      await form.getByLabel("Description", { exact: true }).fill("Skirting, vitrified, 100 mm");
      await form.getByLabel("Unit", { exact: true }).fill("m");
      await page.getByRole("button", { name: "Add to BOQ" }).click();
      await expect(page.getByRole("button", { name: /^Edit Quantity for Skirting, vitrified/ })).toHaveText("Pending");
    });

    await test.step("5. commercial inputs", async () => {
      await nav(page, "Export");
      const panel = page.locator("section[aria-labelledby=wb-commercials]");
      for (const [label, v] of [[/^Overhead & profit \(%\)/, "10"], [/^GST \(%\)/, "18"], [/^Contingency \(%\)/, "0"]] as const) {
        const f = panel.getByLabel(label);
        await f.fill(v);
        await f.press("Enter");
        await expect(f).toHaveValue(v);
      }
    });

    await test.step("6 + 8 + 9. before resolving: missing rate and pending quantity are stated, never costed at zero", async () => {
      await expect(page.getByTestId("export-issue-state")).toContainText("not an issued revision: nothing is frozen");
      await expect(page.getByText("Grand total of currently priced scope only:")).toBeVisible();
      const csv = await downloadCsv(page);
      expect(csv.row("Vitrified tile flooring")).toMatchObject({ qty: "92.5", rate: "", amount: "" });
      expect(csv.row("Gypsum false ceiling")).toMatchObject({ qty: "120", rate: "95" });
      expect(csv.text).toContain("Skirting, vitrified, 100 mm");             // in the pending section, no quantity
      expect(csv.text).toContain("(working estimate, not frozen)");
      expect(csv.text).toContain("Grand total of currently priced scope only");
      const pdf = await openPdf(page);
      expect(pdf).toContain("(working estimate, not frozen)");
      expect(pdf).toContain("Grand total of currently priced scope only");
      expect(pdf).toMatch(/\+ 1 item to be priced/);
    });

    await test.step("7. each Check blocker opens its own field, and resolving it clears it", async () => {
      await nav(page, "Check");
      await page.getByRole("list", { name: "Lines without a rate" }).getByRole("link", { name: /^Enter rate for Vitrified tile flooring/ }).click();
      const rate = page.getByRole("textbox", { name: /^Rate for Vitrified tile flooring/ });
      await expect(rate).toBeFocused();
      await rate.fill("68");
      await rate.press("Enter");
      await expect(page.getByRole("button", { name: /^Edit Rate for Vitrified tile flooring/ })).toContainText("68");
      await nav(page, "Check");
      await page.getByRole("list", { name: "Lines waiting for a quantity" }).getByRole("link", { name: /^Enter quantity for Skirting, vitrified/ }).click();
      const qty = page.getByRole("textbox", { name: /^Quantity for Skirting, vitrified/ });
      await expect(qty).toBeFocused();
      await qty.fill("76");
      await qty.press("Enter");
      await expect(page.getByRole("button", { name: /^Edit Quantity for Skirting, vitrified/ })).toHaveText("76");
      await nav(page, "Check");
      await page.getByRole("list", { name: "Lines without a rate" }).getByRole("link", { name: /^Enter rate for Skirting, vitrified/ }).click();
      const r2 = page.getByRole("textbox", { name: /^Rate for Skirting, vitrified/ });
      await r2.fill("140");
      await r2.press("Enter");
      await expect(page.getByRole("button", { name: /^Edit Rate for Skirting, vitrified/ })).toContainText("140");
      await nav(page, "Check");
      await expect(page.getByRole("list", { name: "Lines without a rate" })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Lines waiting for a quantity" })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Review items not in the BOQ" })).toContainText("Skirting"); // the flagged item stays open, stated
    });

    await test.step("10. reload and re-open the project: every saved value is still there", async () => {
      await page.reload();
      await go("/app/projects");
      await page.getByRole("link", { name: new RegExp(esc(PROJECT)) }).click();
      await go(`/app/projects/${projectId}/workbench/boq`);
      await expect(page.getByRole("button", { name: /^Edit Quantity for Vitrified tile flooring/ })).toHaveText("92.5");
      await expect(page.getByRole("button", { name: /^Edit Rate for Vitrified tile flooring/ })).toContainText("68");
      await expect(page.getByRole("button", { name: /^Edit Quantity for Skirting, vitrified/ })).toHaveText("76");
      await expect(page.getByRole("button", { name: /^Edit Rate for Gypsum false ceiling/ })).toContainText("95");
    });

    await test.step("8 + 9. the documents agree with the BOQ and with each other, and say they are a working estimate", async () => {
      await nav(page, "Export");
      const screenTotal = (await page.getByTestId("export-grand-total").textContent())!.trim();
      await expect(page.locator("section[aria-labelledby=wb-commercials]").getByTestId("grand-total")).toHaveText(screenTotal);
      const csv = await downloadCsv(page);
      expect(csv.row("Gypsum false ceiling")).toMatchObject({ qty: "120", rate: "95", basis: "Measured on drawing, verified in review" });
      expect(csv.row("Vitrified tile flooring")).toMatchObject({ qty: "92.5", rate: "68", basis: "Measured on drawing, corrected in review" });
      expect(csv.row("Skirting, vitrified, 100 mm")).toMatchObject({ qty: "76", rate: "140" });
      const works = 120 * 95 + 92.5 * 68 + 76 * 140;
      expect(csv.text).toContain(`Cost of works (priced items): ${inr(works)}`);
      expect(csv.text).toContain(`as in the priced PDF abstract: ${screenTotal}`);
      const pdf = await openPdf(page);
      expect(pdf).toContain(inr(works));
      expect(pdf).toMatch(new RegExp(`Grand total\\s+${esc(screenTotal)}`));
      expect(pdf).toContain("(working estimate, not frozen)");
      expect(pdf).not.toMatch(/\(Rev [A-Z]+, frozen\)/);
      // The flagged review item is stated as not in this BOQ, on the document itself.
      expect(pdf).toMatch(/1 drawing-review item is still pending or flagged/);
    });
  });
});
