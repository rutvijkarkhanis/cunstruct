// Drawing-first start in a real browser, against the MOCKED network boundary
// (not a live backend): Projects → Upload drawings (no questionnaire) → a
// draft project owned by the signed-in user, with its drawing → fingerprints
// through preflight only → the project survives a reload → its Drawings
// screen → Analyze drawings opens the analysis step without any AI call.
//
// Storage upload and the ai-analysis function are stubbed here: storage
// accepts the file; preflight reports the drawing fingerprinted. Any other
// ai-analysis action (e.g. "generate", the paid analysis) fails the test.
import type { Route } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL, DOC_A_PDF_PATH, FAKE_USER_ID } from "./support/mockBackend";
import { buildPhase2Fixtures } from "./fixtures/phase2FixtureSet";

test("drawing-first: upload creates an owned draft project, fingerprints without AI, and is there after a reload (MOCK)", async ({ page }) => {
  const fixtures = buildPhase2Fixtures();
  const existing = fixtures.projects[0].name;
  await page.route("**/*", (route: Route) => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) ? route.continue() : route.abort();
  });
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
  const mock = await installMockBackend(page, { fixtures: () => fixtures as unknown as Record<string, unknown>, applyWrites: true });

  const stored: string[] = [];
  await page.route("**/storage/v1/object/project-drawings/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    stored.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ Key: "project-drawings/x" }) });
  });
  const aiActions: string[] = [];
  await page.route("**/functions/v1/ai-analysis", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const body = route.request().postDataJSON() as { action: string };
    aiActions.push(body.action);
    if (body.action !== "preflight") return route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ ok: false, error: "test: no AI call expected" }) });
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ ok: true, preflight: {
      mode: "BOQ", totalProjectFiles: 1, totalEligibleDrawingFiles: 1, filesPendingHash: 0, alreadyAnalysedCount: 0, newFilesCount: 1,
      duplicateFilesSkipped: 0, inFlightCount: 0, allFilesAlreadyAnalysed: false, existingRunCount: 0, latestRunId: null,
      documentCompleteness: "UNKNOWN", willSendFiles: [], alreadyAnalysedFiles: [], duplicateGroups: [],
    } }) });
  });

  await page.goto("/app/projects");
  await expect(page.getByText(existing)).toBeVisible();
  await page.getByRole("checkbox", { name: "Allow server processing of these drawings" }).click();
  await page.getByTestId("upload-drawings-input").setInputFiles(DOC_A_PDF_PATH);

  await expect(page.getByRole("list", { name: "Drawing uploads" })).toContainText("Uploaded", { timeout: 20_000 });
  await expect(page.getByText("Fingerprinted 1 of 1 uploaded drawing.")).toBeVisible();
  const draft = mock.tables.projects.find((p) => p.name === "document-a (draft)");
  expect(draft).toMatchObject({ owner_id: FAKE_USER_ID, account_manager_id: FAKE_USER_ID, ai_processing_enabled: true });
  expect(mock.tables.project_document.filter((d) => d.project_id === draft!.id)).toHaveLength(1);
  expect(stored).toHaveLength(1);
  const list = page.getByRole("list", { name: "Projects" });
  await expect(list).toContainText("document-a (draft)");
  await expect(list).toContainText(existing);

  // A reload keeps both: the draft is a real project, not page state.
  await page.reload();
  await expect(page.getByRole("list", { name: "Projects" })).toContainText("document-a (draft)");
  await expect(page.getByRole("list", { name: "Projects" })).toContainText(existing);

  await page.getByRole("link", { name: /document-a \(draft\)/ }).click();
  await page.getByRole("link", { name: /Project & drawings/ }).click();
  await expect(page.getByText("Fingerprinted 1 of 1 drawing.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Analyze drawings/ }).click();
  await expect(page.getByText(/press Analyze Project to run the AI analysis/)).toBeVisible();
  expect(aiActions.every((a) => a === "preflight")).toBe(true);
  expect(aiActions.length).toBeGreaterThan(0);
});
