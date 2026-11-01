// Zoom in the evidence viewer. Regression for "zoom does nothing": every render stored a NEW page-size
// object, which re-ran the automatic fit and snapped any manual zoom straight back. Here the drawing area
// has a real (mocked) size, so the automatic fit genuinely runs, as it does in a browser.
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import PdfEvidenceViewer from "./PdfEvidenceViewer";

vi.mock("pdfjs-dist/build/pdf.worker.min?url", () => ({ default: "worker-url" }));
const PAGE = vi.hoisted(() => ({ w: 1200, h: 800 }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  OPS: { constructPath: 0, rectangle: 1, moveTo: 2, lineTo: 3, curveTo: 4, closePath: 5 },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: PAGE.w * scale, height: PAGE.h * scale }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        getTextContent: async () => ({ items: [] }),
      }),
    }),
    destroy: () => {},
  }),
}));

const box = { w: 624, h: 424 }; // drawing area: (624 - 24) / 1200 = 50% fit width; (424 - 24) / 800 = 50% fit height
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
  for (const k of ["clientWidth", "clientHeight"] as const) saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).getAttribute("role") === "region" ? box.w : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).getAttribute("role") === "region" ? box.h : 0; } });
});
afterAll(() => { for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, k, d); });
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const zoomText = () => screen.getByText(/^\d+%$/).textContent;
const canvas = () => document.querySelector("canvas") as HTMLCanvasElement;

describe("PdfEvidenceViewer — zoom (default toolbar, as production uses it)", () => {
  it("a manual zoom holds after the page re-renders instead of snapping back to the fit", async () => {
    render(<PdfEvidenceViewer fileUrl="blob:x" source={undefined} />);
    await settle();
    expect(zoomText()).toBe("50%"); // automatic fit-to-width ran
    fireEvent.click(screen.getByTitle("Zoom in"));
    await settle();
    expect(zoomText()).toBe("75%");
    expect(canvas().style.width).toBe("900px");
    fireEvent.click(screen.getByTitle("Zoom in"));
    await settle();
    expect(zoomText()).toBe("100%");
  });
  it("the default toolbar is unchanged: no Fit width / 100% / Fit page (0) buttons", async () => {
    render(<PdfEvidenceViewer fileUrl="blob:x" source={undefined} />);
    await settle();
    expect(screen.getByTitle("Fit page")).toBeTruthy();
    expect(screen.queryByTitle("Fit width")).toBeNull();
    expect(screen.queryByTitle("Actual size, 100% (1)")).toBeNull();
  });
  it("in marker mode a manual zoom survives page navigation", async () => {
    const markers = [{ id: "m1", reviewItemId: "a", category: "Other" as const, kind: "evidence" as const, box: { bbox: [100, 100, 140, 112] as [number, number, number, number], page: 1, label: "x" }, page: 1, label: "x", emphasis: "muted" as const }];
    render(<PdfEvidenceViewer fileUrl="blob:x" source={undefined} markers={markers} zoomControls="full" />);
    await settle();
    fireEvent.click(screen.getByTitle("Actual size, 100% (1)"));
    await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("100%");
    fireEvent.click(screen.getByTitle("Next page"));
    await settle();
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("100%");
  });
});

describe("PdfEvidenceViewer — full zoom controls (opt-in, Measurement Lab)", () => {
  it("fit width, fit page, 100%, zoom steps, and + − 0 1 keys on the drawing", async () => {
    PAGE.w = 1200; PAGE.h = 1600; // a tall page: fit page (height) differs from fit width
    render(<PdfEvidenceViewer fileUrl="blob:x" source={undefined} zoomControls="full" />);
    await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("50%");
    fireEvent.click(screen.getByTitle("Fit page (0)"));
    await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("25%"); // (424 - 24) / 1600
    fireEvent.click(screen.getByTitle("Fit width"));
    await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("50%");
    fireEvent.click(screen.getByTitle("Actual size, 100% (1)"));
    await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("100%");
    fireEvent.click(screen.getByTitle("Zoom in (+)"));
    await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("125%");
    const region = screen.getByRole("region", { name: "Drawing" });
    fireEvent.keyDown(region, { key: "-" }); await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("100%");
    fireEvent.keyDown(region, { key: "0" }); await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("25%");
    fireEvent.keyDown(region, { key: "1" }); await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("100%");
    fireEvent.keyDown(region, { key: "+" }); await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("125%");
    fireEvent.keyDown(region, { key: "+", ctrlKey: true }); await settle(); // modified keys are left to the browser
    expect(screen.getByLabelText("Zoom level").textContent).toBe("125%");
    PAGE.w = 1200; PAGE.h = 800;
  });
  it("Ctrl/⌘ + wheel zooms; a plain wheel does not (it scrolls)", async () => {
    render(<PdfEvidenceViewer fileUrl="blob:x" source={undefined} zoomControls="full" />);
    await settle();
    const region = screen.getByRole("region", { name: "Drawing" });
    fireEvent.wheel(region, { deltaY: -100 }); await settle();
    expect(screen.getByLabelText("Zoom level").textContent).toBe("50%");
    fireEvent.wheel(region, { deltaY: -100, ctrlKey: true }); await settle();
    expect(Number(screen.getByLabelText("Zoom level").textContent!.replace("%", ""))).toBeGreaterThan(50);
  });
});

describe("PdfEvidenceViewer — canvas resolution", () => {
  it("renders at the device pixel ratio, but a huge sheet at high zoom stays inside safe canvas limits", async () => {
    const dpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    render(<PdfEvidenceViewer fileUrl="blob:x" source={undefined} zoomControls="full" />);
    await settle();
    fireEvent.click(screen.getByTitle("Actual size, 100% (1)")); await settle();
    expect(canvas().width).toBe(2400); // 1200 pt × 100% × DPR 2: sharp
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByTitle("Zoom in (+)"));
    await settle();
    const c = canvas();
    expect(parseFloat(c.style.width)).toBeGreaterThan(9000); // displayed at the requested zoom
    expect(c.width).toBeLessThanOrEqual(16384);
    expect(c.width * c.height).toBeLessThanOrEqual(32_000_000 + 20_000);
    if (dpr) Object.defineProperty(window, "devicePixelRatio", dpr);
  });
});
