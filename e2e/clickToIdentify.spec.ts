// M8.3 — Click-to-Identify verified in a REAL browser: a real click on the
// real pdf.js-rendered canvas, a real (mocked-at-the-network-boundary)
// round trip, and a real highlight overlay checked against actual rendered
// geometry — not DOM text alone.
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";
import { openReviewWorkstation, identifyToggle, drawingCanvas, evidenceOverlays, clickCanvasFraction, selectItemRow, fitPageAndWaitStable } from "./support/appHelpers";
import { expectedPagePoint, expectedOverlayRect, rectApproxEqual, approxEqual } from "./support/pdfGeometry";
import { DOC_A_PAGE1_DOOR_BBOX, PAGE_WIDTH, PAGE_HEIGHT } from "./fixtures/testData";

test.beforeEach(async ({ page }) => {
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
});

test("clicking a drawing element identifies it and renders the highlight at the correct position", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
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

  try {
    await openReviewWorkstation(page);
    // The fixture's first item (Door D1) resolves to document A; its
    // drawing should already be the one on screen by default — select it
    // explicitly so the test doesn't depend on default ordering.
    await selectItemRow(page, "D1", "Door D1").click();

    const canvas = drawingCanvas(page);
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    // pdf.js has genuinely rendered something — a real canvas with real
    // pixel dimensions, not a zero-size placeholder.
    const canvasBoxBeforeClick = await canvas.boundingBox();
    expect(canvasBoxBeforeClick?.width).toBeGreaterThan(50);
    expect(canvasBoxBeforeClick?.height).toBeGreaterThan(50);

    // The default zoom can leave the canvas larger than the viewport
    // (scrolled); "Fit page" brings the WHOLE page into view so a
    // fraction-of-canvas click lands where expected.
    await fitPageAndWaitStable(page);
    await identifyToggle(page).click();

    // Click in an empty corner of the page, NOT inside the door rectangle:
    // the review item's own existing drawing marker (a real, separately
    // clickable <button>, unrelated to Find Similar/M8) is rendered sized
    // to that exact bbox, and would intercept a click aimed there. The
    // identify CONTRACT doesn't require the clicked point and the returned
    // evidence box to coincide (the model reports both independently) — the
    // mocked response below still anchors its evidence at the real door
    // rectangle, so the overlay-position assertion stays meaningful.
    const clickFraction = { x: 0.1, y: 0.1 };
    const canvasBox = await clickCanvasFraction(page, clickFraction);

    // The mocked backend genuinely received this click's request — assert
    // the EXACT page-space point it computed, not just "a call happened".
    await expect.poll(() => mock.aiCalls.filter((c) => c.action === "identify").length).toBeGreaterThan(0);
    const sent = mock.aiCalls.find((c) => c.action === "identify") as { page: number; point: { x: number; y: number } };
    const expectedPoint = expectedPagePoint(clickFraction, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(sent.page).toBe(1);
    expect(approxEqual(sent.point.x, expectedPoint.x, 3)).toBe(true);
    expect(approxEqual(sent.point.y, expectedPoint.y, 3)).toBe(true);

    // The reviewer interface shows the correct, deterministic candidate.
    await expect(page.getByText("Door", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Single leaf door")).toBeVisible();

    // The highlight overlay is visible at the mathematically-correct
    // position for the evidence bbox the mock returned — checked against
    // the REAL canvas's REAL measured bounding box, not an assumed scale.
    // PdfEvidenceViewer renders TWO elements sharing "border-violet-600":
    // the fixed-size (12px) click-point dot, THEN the evidence-box
    // rectangle (which scales with zoom) — nth(1) is the rectangle.
    const violetBoxes = evidenceOverlays(page).locator("div.border-violet-600");
    await expect(violetBoxes).toHaveCount(2);
    const violetBox = violetBoxes.nth(1);
    const violetRect = await violetBox.boundingBox();
    // Re-read the canvas's CURRENT box — the right rail's content can
    // settle after the response arrives, and this must reflect that, not
    // whatever was measured back when the click itself was dispatched.
    const canvasBoxNow = (await drawingCanvas(page).boundingBox())!;
    expect(violetRect).not.toBeNull();
    const expectedRect = expectedOverlayRect(DOC_A_PAGE1_DOOR_BBOX, { width: PAGE_WIDTH, height: PAGE_HEIGHT }, { width: canvasBoxNow.width, height: canvasBoxNow.height });
    const actualRelative = {
      x: violetRect!.x - canvasBoxNow.x, y: violetRect!.y - canvasBoxNow.y,
      width: violetRect!.width, height: violetRect!.height,
    };
    expect(rectApproxEqual(actualRelative, expectedRect, 6)).toBe(true);
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});

test("Identify shows an honest 'nothing found' result when the model returns no candidates", async ({ page }, testInfo) => {
  const mock = await installMockBackend(page);
  mock.setIdentifyHandler((body) => {
    const b = body as { page: number; point: { x: number; y: number } };
    return { ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: b.page, x: b.point.x, y: b.point.y }, candidates: [] } };
  });
  try {
    await openReviewWorkstation(page);
    await selectItemRow(page, "D1", "Door D1").click();
    await expect(drawingCanvas(page)).toBeVisible({ timeout: 15_000 });
    await fitPageAndWaitStable(page);
    await identifyToggle(page).click();
    await clickCanvasFraction(page, { x: 0.1, y: 0.1 });
    await expect(page.getByText(/Couldn't identify anything at this point/)).toBeVisible();
  } catch (e) {
    await page.screenshot({ path: testInfo.outputPath("failure.png"), fullPage: true });
    throw e;
  }
});
