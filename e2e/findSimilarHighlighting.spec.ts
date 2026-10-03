// M8.4 — Find Similar highlighting verified in a REAL browser: the full
// identify -> confirm -> find similar -> rendered-overlay flow, confirm/
// reject visual states, per-page overlay filtering, and the M7.5
// page-awareness fallback — all against the real pdf.js-rendered canvas.
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";
import {
  openReviewWorkstation, identifyToggle, drawingCanvas, evidenceOverlays, clickCanvasFraction,
  selectItemRow, fitPageAndWaitStable, findSimilarButton,
} from "./support/appHelpers";
import { expectedOverlayRect, rectApproxEqual } from "./support/pdfGeometry";
import { DOC_A_PAGE1_DOOR_BBOX, DOC_A_PAGE2_WINDOW_BBOX, PAGE_WIDTH, PAGE_HEIGHT } from "./fixtures/testData";

test.beforeEach(async ({ page }) => {
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
});

/** Shared setup for every test below: open the workstation on the Door D1
 *  item, identify (deterministic "Door" candidate anchored at the real
 *  drawn rectangle), and confirm it — the exact prerequisite Find Similar
 *  requires. Click target is 0.1/0.1 (see clickToIdentify.spec.ts for why:
 *  the item's own drawing marker button covers its evidence bbox). */
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

test("Find Similar displays matches and highlights them at the correct position on their own pages", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  try {
    await getToConfirmedDoor(page, mock);

    mock.setFindSimilarHandler(() => ({
      ok: true,
      result: {
        schemaVersion: "cunstruct.similar.v1",
        reference: { label: "Door", evidence: [{ bbox: DOC_A_PAGE1_DOOR_BBOX, page: 1 }] },
        matches: [
          { label: "Door", description: "Another door on page 1", confidence: 0.8, evidence: [{ bbox: [400, 500, 460, 550], page: 1 }] },
          { label: "Door", description: "A window-shaped door on page 2", confidence: 0.6, evidence: [{ bbox: DOC_A_PAGE2_WINDOW_BBOX, page: 2 }] },
        ],
      },
    }));
    await findSimilarButton(page).click();

    // Result panel shows both deterministic matches.
    await expect(page.getByText("Another door on page 1")).toBeVisible();
    await expect(page.getByText("A window-shaped door on page 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(2);

    // Page 1 is current: only match 1's cyan box renders, at the correct
    // position; match 2 (page 2) must NOT appear here.
    const canvasBox1 = (await drawingCanvas(page).boundingBox())!;
    const cyanBoxes = evidenceOverlays(page).locator("div.border-cyan-600");
    await expect(cyanBoxes).toHaveCount(1);
    const rect1 = (await cyanBoxes.first().boundingBox())!;
    const expected1 = expectedOverlayRect([400, 500, 460, 550], { width: PAGE_WIDTH, height: PAGE_HEIGHT }, canvasBox1);
    expect(rectApproxEqual(
      { x: rect1.x - canvasBox1.x, y: rect1.y - canvasBox1.y, width: rect1.width, height: rect1.height },
      expected1, 6,
    )).toBe(true);

    // No page-awareness message here: match 1 IS visible on this page (the
    // fallback only fires when NONE of the matches are on the current
    // page) — see the dedicated test below for that case.
    await expect(page.getByText(/Similar matches were found — on another page/)).not.toBeVisible();

    // Navigate to page 2 — match 2's overlay should now appear at the
    // correct position (aligned with the real drawn "window" rectangle),
    // and match 1's overlay (page 1) must disappear.
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText(/^2 \/ 3$/)).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(1);
    const canvasBox2 = (await drawingCanvas(page).boundingBox())!;
    const rect2 = (await evidenceOverlays(page).locator("div.border-cyan-600").first().boundingBox())!;
    const expected2 = expectedOverlayRect(DOC_A_PAGE2_WINDOW_BBOX, { width: PAGE_WIDTH, height: PAGE_HEIGHT }, canvasBox2);
    expect(rectApproxEqual(
      { x: rect2.x - canvasBox2.x, y: rect2.y - canvasBox2.y, width: rect2.width, height: rect2.height },
      expected2, 6,
    )).toBe(true);
    // On page 2, match 2 IS visible, so no "on another page" message here.
    await expect(page.getByText(/Similar matches were found — on another page/)).not.toBeVisible();
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("Confirm/Reject recolor a match's overlay independently of the other", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  try {
    await getToConfirmedDoor(page, mock);
    mock.setFindSimilarHandler(() => ({
      ok: true,
      result: {
        schemaVersion: "cunstruct.similar.v1",
        reference: { label: "Door", evidence: [] },
        matches: [
          { label: "Door", description: "Match A", confidence: 0.8, evidence: [{ bbox: [400, 500, 460, 550], page: 1 }] },
          { label: "Door", description: "Match B", confidence: 0.7, evidence: [{ bbox: [420, 100, 480, 160], page: 1 }] },
        ],
      },
    }));
    await findSimilarButton(page).click();
    await expect(page.getByText("Match A")).toBeVisible();

    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(2);
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await expect(page.getByText("Confirmed")).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-emerald-600")).toHaveCount(1);
    // The sibling match's overlay is untouched — still pending (cyan).
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(1);

    await page.getByRole("button", { name: "Reject", exact: true }).first().click();
    await expect(page.getByText("Rejected")).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-dashed.border-muted-foreground\\/40")).toHaveCount(1);
    // Confirmed match's own overlay is unaffected by the reject.
    await expect(evidenceOverlays(page).locator("div.border-emerald-600")).toHaveCount(1);
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(0);
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("shows the 'on another page' message when every match is on a different page than the one shown", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  try {
    await getToConfirmedDoor(page, mock);
    mock.setFindSimilarHandler(() => ({
      ok: true,
      result: {
        schemaVersion: "cunstruct.similar.v1",
        reference: { label: "Door", evidence: [] },
        matches: [{ label: "Door", description: "Only on page 2", confidence: 0.8, evidence: [{ bbox: DOC_A_PAGE2_WINDOW_BBOX, page: 2 }] }],
      },
    }));
    await findSimilarButton(page).click();
    await expect(page.getByText("Only on page 2")).toBeVisible();
    // Still on page 1 — zero of the matches are here.
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(0);
    await expect(page.getByText(/Similar matches were found — on another page/)).toBeVisible();

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText(/^2 \/ 3$/)).toBeVisible();
    await expect(evidenceOverlays(page).locator("div.border-cyan-600")).toHaveCount(1);
    await expect(page.getByText(/Similar matches were found — on another page/)).not.toBeVisible();
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("shows the honest empty state when no matches are found — never the 'on another page' message", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  try {
    await getToConfirmedDoor(page, mock);
    mock.setFindSimilarHandler(() => ({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [] },
    }));
    await findSimilarButton(page).click();
    await expect(page.getByText(/No similar elements found/)).toBeVisible();
    await expect(page.getByText(/Similar matches were found — on another page/)).not.toBeVisible();
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});
