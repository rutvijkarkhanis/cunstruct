// M8 — shared real-browser navigation helpers for the review workstation.
// Selectors here deliberately mirror the ones the existing Vitest/RTL
// integration tests already use against the SAME real component
// (BoqReviewWorkstation.tsx) — e.g. BoqReviewWorkstationFindSimilar.test.tsx
// — since this is the real DOM the real component renders, not a
// re-implementation.
import { expect, type Page } from "@playwright/test";
import { PROJECT_ID, BOQ_ID, PAGE_WIDTH, PAGE_HEIGHT } from "../fixtures/testData";

export const REVIEW_URL = `/ops/projects/${PROJECT_ID}/boqs/${BOQ_ID}/review`;

/** Navigates to the review workstation and waits for it to finish loading
 *  (the item inspector's "Verify" action, present once a review item is
 *  current). */
export async function openReviewWorkstation(page: Page) {
  await page.goto(REVIEW_URL);
  await page.getByRole("button", { name: "Verify", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
}

export function identifyToggle(page: Page) {
  return page.getByTitle("Click a point on the drawing to identify what's there");
}

/** Selects a review item by its TypeNavigator row text ("<key> — <item>"). */
export function selectItemRow(page: Page, key: string, item: string) {
  return page.getByText(`${key} — ${item}`, { exact: false }).first();
}

export function findSimilarButton(page: Page) {
  return page.getByRole("button", { name: /Find Similar/i });
}

export function confirmButton(page: Page) {
  return page.getByRole("button", { name: "Confirm", exact: true }).first();
}

export function exitButton(page: Page) {
  return page.getByRole("button", { name: "Exit", exact: true });
}

/** The real pdf.js <canvas> element inside the drawing viewer. */
export function drawingCanvas(page: Page) {
  return page.locator('[data-testid="evidence-overlays"] canvas');
}

export function evidenceOverlays(page: Page) {
  return page.locator('[data-testid="evidence-overlays"]');
}

/**
 * Clicks "Fit page" and waits for the canvas to actually settle at a
 * portrait layout matching the fixture PDF's own aspect ratio (612x792) —
 * the zoom/scale recompute is async (a resize-driven React state update),
 * so reading boundingBox() immediately after the click can catch a
 * transient/intermediate size. Every spec that clicks the canvas by
 * fraction must call this first.
 */
export async function fitPageAndWaitStable(page: Page) {
  await page.getByTitle("Fit page").click();
  const expectedRatio = PAGE_WIDTH / PAGE_HEIGHT;
  await expect(async () => {
    const box = await drawingCanvas(page).boundingBox();
    if (!box || box.height === 0) throw new Error("canvas not laid out yet");
    const ratio = box.width / box.height;
    if (Math.abs(ratio - expectedRatio) > expectedRatio * 0.05) throw new Error(`canvas aspect ratio not stable yet: ${ratio}`);
  }).toPass({ timeout: 10_000 });
}

/** Clicks the drawing canvas at a FRACTION of its own rendered size (0..1
 *  each axis) — resolution/scale-independent, see pdfGeometry.ts. Uses the
 *  Locator API's own `position` option (not a raw page.mouse.click), which
 *  scrolls the element into view and computes the click position relative
 *  to its CURRENT box at click time — the canvas can be larger than the
 *  viewport at some zoom levels, so this must not assume it's fully
 *  in view already. */
export async function clickCanvasFraction(page: Page, fraction: { x: number; y: number }) {
  const canvas = drawingCanvas(page);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("drawing canvas has no bounding box — did the PDF render?");
  await canvas.click({ position: { x: box.width * fraction.x, y: box.height * fraction.y } });
  return box;
}
