// Document teardown in the evidence viewer. The default (production) path destroys a document's loading
// task immediately on unmount or file switch — unchanged. The opt-in `deferDestroyUntilLoaded` path (used
// only by the Measurement Lab) waits for an in-flight load to settle before destroying it, because pdf.js
// 4.x throws an uncaught "Worker was terminated" inside its worker when a document is destroyed mid-load.
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import PdfEvidenceViewer from "./PdfEvidenceViewer";

vi.mock("pdfjs-dist/build/pdf.worker.min?url", () => ({ default: "worker-url" }));
interface Task { url: string; settle: (ok: boolean) => void; destroy: ReturnType<typeof vi.fn>; destroyedWhileLoading: boolean; settled: boolean }
const tasks: Task[] = [];
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  OPS: { constructPath: 0, rectangle: 1, moveTo: 2, lineTo: 3, curveTo: 4, closePath: 5 },
  getDocument: (url: string) => {
    const pages = url.includes("five") ? 5 : 2;
    const doc = { numPages: pages, getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 400 * scale }), render: () => ({ promise: Promise.resolve(), cancel: () => {} }), getOperatorList: async () => ({ fnArray: [], argsArray: [] }), getTextContent: async () => ({ items: [] }) }) };
    const t = {} as Task;
    const promise = new Promise((resolve, reject) => { t.settle = (ok) => { t.settled = true; if (ok) resolve(doc); else reject(new Error("load failed")); }; });
    Object.assign(t, { url, settled: false, destroyedWhileLoading: false, destroy: vi.fn(() => { if (!t.settled) t.destroyedWhileLoading = true; }) });
    tasks.push(t);
    return { promise, destroy: t.destroy };
  },
}));
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
});
beforeEach(() => { tasks.length = 0; });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("PdfEvidenceViewer — document teardown", () => {
  it("default (production) path: unmounting mid-load destroys the loading task immediately, exactly as before", async () => {
    const v = render(<PdfEvidenceViewer fileUrl="blob:two" source={undefined} />);
    v.unmount();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(tasks[0].destroyedWhileLoading).toBe(true);
  });
  it("opt-in: unmounting mid-load waits for the load to settle, then destroys once — never while loading", async () => {
    const v = render(<PdfEvidenceViewer fileUrl="blob:two" source={undefined} deferDestroyUntilLoaded />);
    v.unmount();
    expect(tasks[0].destroy).not.toHaveBeenCalled();
    await act(async () => { tasks[0].settle(true); });
    await flush();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(tasks[0].destroyedWhileLoading).toBe(false);
  });
  it("opt-in: a load that fails after unmount is still destroyed", async () => {
    const v = render(<PdfEvidenceViewer fileUrl="blob:two" source={undefined} deferDestroyUntilLoaded />);
    v.unmount();
    await act(async () => { tasks[0].settle(false); });
    await flush();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(tasks[0].destroyedWhileLoading).toBe(false);
  });
  it("opt-in: an already-loaded document is destroyed immediately on unmount", async () => {
    const v = render(<PdfEvidenceViewer fileUrl="blob:two" source={undefined} deferDestroyUntilLoaded />);
    await act(async () => { tasks[0].settle(true); });
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    v.unmount();
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("opt-in: switching file mid-load never applies the stale document, and destroys it only after it settles", async () => {
    const v = render(<PdfEvidenceViewer fileUrl="blob:two" source={undefined} deferDestroyUntilLoaded />);
    v.rerender(<PdfEvidenceViewer fileUrl="blob:five" source={undefined} deferDestroyUntilLoaded />);
    await act(async () => { tasks[1].settle(true); });
    expect(await screen.findByText("1 / 5")).toBeInTheDocument();
    expect(tasks[0].destroy).not.toHaveBeenCalled();
    await act(async () => { tasks[0].settle(true); });
    await flush();
    expect(screen.getByText("1 / 5")).toBeInTheDocument(); // the late 2-page document is never shown
    expect(tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(tasks[0].destroyedWhileLoading).toBe(false);
    expect(tasks[1].destroy).not.toHaveBeenCalled();
  });
});
