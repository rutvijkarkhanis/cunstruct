// M8.5/M8.6 — cross-document overlay isolation and request-lifecycle
// guards (M7), verified in a REAL browser against REAL rendered overlays —
// not just internal state. The fixture's two review items resolve to two
// DIFFERENT documents (A, B) that both have a "page 1", the exact shape
// the Post-M6 review flagged as previously unguarded.
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";
import {
  openReviewWorkstation, identifyToggle, drawingCanvas, evidenceOverlays, clickCanvasFraction,
  selectItemRow, fitPageAndWaitStable, findSimilarButton,
} from "./support/appHelpers";
import { DOC_A_PAGE1_DOOR_BBOX, DOC_B_PAGE1_COLUMN_BBOX } from "./fixtures/testData";

test.beforeEach(async ({ page }) => {
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function getToConfirmedDoor(page: Parameters<typeof openReviewWorkstation>[0], mock: Awaited<ReturnType<typeof installMockBackend>>) {
  mock.setIdentifyHandler((body) => {
    const b = body as { page: number; point: { x: number; y: number } };
    return {
      ok: true,
      result: {
        schemaVersion: "cunstruct.identify.v1",
        point: { page: b.page, x: b.point.x, y: b.point.y },
        candidates: [{ label: "Door", description: "Single leaf door", confidence: 0.9, evidence: [{ bbox: DOC_A_PAGE1_DOOR_BBOX, page: 1 }] }],
      },
    };
  });
  await openReviewWorkstation(page);
  await selectItemRow(page, "D1", "Door D1").click();
  await expect(drawingCanvas(page)).toBeVisible({ timeout: 15_000 });
  await fitPageAndWaitStable(page);
  await identifyToggle(page).click();
  await clickCanvasFraction(page, { x: 0.1, y: 0.1 });
  await expect(page.getByText("Door", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
}

test("M8.5 — switching to a different document hides A's identify highlight and Find Similar matches; switching back restores them", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  try {
    await getToConfirmedDoor(page, mock);
    mock.setFindSimilarHandler(() => ({
      ok: true,
      result: {
        schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] },
        matches: [{ label: "Door", description: "Door match on A", confidence: 0.8, evidence: [{ bbox: [400, 500, 460, 550], page: 1 }] }],
      },
    }));
    await findSimilarButton(page).click();
    await expect(page.getByText("Door match on A")).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-violet-600")).toHaveCount(2); // dot + identify evidence box
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(1);

    // Switch to the OTHER document's item (Column C1, document B) — Identify
    // mode stays active (by design, navigation never exits it), but NEITHER
    // overlay may render here, even though B also has a page 1.
    await selectItemRow(page, "C1", "Column C1").click();
    await expect(drawingCanvas(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Document B\.pdf$/).first()).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-violet-600")).toHaveCount(0);
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(0);
    // The result panel itself (not document-scoped by design) still shows
    // the match text — only the CANVAS overlay is document-scoped (M7).
    await expect(page.getByText("Door match on A")).toBeVisible();

    // Switch back to document A's item — both overlays reappear: nothing
    // was discarded by navigating away, only hidden while viewing B.
    await selectItemRow(page, "D1", "Door D1").click();
    await expect(page.getByText(/^Document A\.pdf$/).first()).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-violet-600")).toHaveCount(2);
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(1);
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("M8.5/M8.6 — resolving a pending Find Similar request AFTER switching documents never exposes its matches on the new document", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  try {
    await getToConfirmedDoor(page, mock);
    const gate = deferred<unknown>();
    mock.setFindSimilarHandler(() => gate.promise);
    await findSimilarButton(page).click();
    await expect(page.getByText(/Searching the document/)).toBeVisible();

    // Switch to document B WHILE the document-A request is still pending.
    await selectItemRow(page, "C1", "Column C1").click();
    await expect(page.getByText(/^Document B\.pdf$/).first()).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(0);

    // Now resolve it.
    gate.resolve({
      ok: true,
      result: {
        schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] },
        matches: [{ label: "Door", description: "Document A match", confidence: 0.8, evidence: [{ bbox: [400, 500, 460, 550], page: 1 }] }],
      },
    });
    // Give the resolution a moment to apply internally, then assert
    // document B's canvas still shows nothing — the response updated
    // ephemeral state, but the overlay stayed scoped to document A.
    await page.waitForTimeout(500);
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(0);

    // Switching back to A shows the real match the request found.
    await selectItemRow(page, "D1", "Door D1").click();
    await expect(page.getByText("Document A match")).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(1);
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("M8.6 — exiting Identify mode while a request is pending: the eventual response cannot reopen anything", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  const gate = deferred<unknown>();
  mock.setIdentifyHandler(() => gate.promise);
  try {
    await openReviewWorkstation(page);
    await selectItemRow(page, "D1", "Door D1").click();
    await expect(drawingCanvas(page)).toBeVisible({ timeout: 15_000 });
    await fitPageAndWaitStable(page);
    await identifyToggle(page).click();
    await clickCanvasFraction(page, { x: 0.1, y: 0.1 });
    await expect(page.getByText(/Identifying…/)).toBeVisible();

    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeVisible();

    gate.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 10, y: 10 }, candidates: [{ label: "Door", confidence: 0.9, evidence: [{ bbox: DOC_A_PAGE1_DOOR_BBOX, page: 1 }] }] },
    });
    await page.waitForTimeout(500);
    // Still the normal inspector — the stale response never reopened Identify.
    await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-violet-600")).toHaveCount(0);
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("M8.6 — a newer Identify click wins over an older, still-pending one, resolved afterward", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  const older = deferred<unknown>();
  let call = 0;
  mock.setIdentifyHandler((body) => {
    call += 1;
    if (call === 1) return older.promise;
    const b = body as { page: number; point: { x: number; y: number } };
    return {
      ok: true,
      result: { schemaVersion: "cunstruct.identify.v1", point: { page: b.page, x: b.point.x, y: b.point.y }, candidates: [{ label: "Door-B", confidence: 0.6, evidence: [] }] },
    };
  });
  try {
    await openReviewWorkstation(page);
    await selectItemRow(page, "D1", "Door D1").click();
    await expect(drawingCanvas(page)).toBeVisible({ timeout: 15_000 });
    await fitPageAndWaitStable(page);
    await identifyToggle(page).click();
    await clickCanvasFraction(page, { x: 0.1, y: 0.1 }); // request 1 (stale)
    await expect(page.getByText(/Identifying…/)).toBeVisible();
    await clickCanvasFraction(page, { x: 0.15, y: 0.15 }); // request 2 (current, resolves immediately)
    await expect(page.getByText("Door-B", { exact: true })).toBeVisible();

    older.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 1, y: 1 }, candidates: [{ label: "Door-A", confidence: 0.6, evidence: [] }] },
    });
    await page.waitForTimeout(500);
    await expect(page.getByText("Door-B", { exact: true })).toBeVisible();
    await expect(page.getByText("Door-A", { exact: true })).not.toBeVisible();
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});
