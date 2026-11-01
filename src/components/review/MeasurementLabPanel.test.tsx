import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// SYNTHETIC UI checks: no drawing is processed here (the engines are covered in measurement-lab tests).
vi.mock("pdfjs-dist/build/pdf.worker.min?url", () => ({ default: "worker-url" }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), OPS: {} }));
vi.mock("@/components/review/PdfEvidenceViewer", () => ({ default: () => <div data-testid="viewer" /> }));
const auth = vi.hoisted(() => ({ roles: ["admin"] as string[], user: { id: "u1", email: "admin@example.test" } as { id: string; email: string } | null }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

import MeasurementLabLauncher from "./MeasurementLabLauncher";
import MeasurementLabPanel from "./MeasurementLabPanel";
import BlindReferenceCapture from "./BlindReferenceCapture";
import { evidenceFor } from "@/lib/measurement-lab/overlay";
import { replay } from "@/lib/measurement-lab/reference";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
beforeEach(() => { auth.roles = ["admin"]; auth.user = { id: "u1", email: "admin@example.test" }; });

describe("Measurement Lab authorization (client side)", () => {
  it("the launcher renders nothing for ops, contractor or signed-out users", () => {
    for (const roles of [["ops"], ["contractor"], ["site_engineer"], []]) {
      auth.roles = roles;
      const { container, unmount } = wrap(<MeasurementLabLauncher />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
  it("the panel itself refuses non-admins and signed-out users even if loaded directly", () => {
    auth.roles = ["ops"];
    const a = wrap(<MeasurementLabPanel />);
    expect(screen.getByTestId("measurement-lab-denied")).toBeTruthy();
    expect(screen.queryByTestId("measurement-lab")).toBeNull();
    a.unmount();
    auth.roles = ["admin"]; auth.user = null;
    wrap(<MeasurementLabPanel />);
    expect(screen.getByTestId("measurement-lab-denied")).toBeTruthy();
  });
  it("an admin opens it from the launcher; the lab loads only then; the reviewer shown is the signed-in user", async () => {
    wrap(<MeasurementLabLauncher />);
    expect(screen.queryByTestId("measurement-lab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /measurement lab/i }));
    expect(await screen.findByTestId("measurement-lab")).toBeTruthy();
    expect(screen.getByText(/Signed in as admin@example.test/)).toBeTruthy();
  });
});

describe("Measurement Lab panel", () => {
  it("before a drawing: no engine controls; the boundary is stated", () => {
    wrap(<MeasurementLabPanel />);
    expect(screen.getByText(/Nothing here changes the BOQ/)).toBeTruthy();
    expect(screen.getByLabelText("Drawing PDF")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /run both engines/i })).toBeNull();
    expect(screen.queryByTestId("track-b-status")).toBeNull();
  });
  it("Stage A shows the drawing and the reference form only — no engine output — and cannot lock an empty reference", () => {
    const state = replay([]);
    wrap(<BlindReferenceCapture fileUrl="blob:x" fileName="t.pdf" pageSizes={{ 1: { width: 600, height: 400 } }} numPages={1} state={state} engineRunsExisted={false} busy={false}
      onAdd={() => {}} onEdit={() => {}} onWithdraw={() => {}} onLock={() => {}} />);
    expect(screen.getByTestId("blind-reference")).toBeTruthy();
    expect(screen.queryByText(/accepted|held|rejected|engine dimension line/i)).toBeNull();
    expect((screen.getByRole("button", { name: /lock reference/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("Stage A warns when engine results already existed for the drawing", () => {
    wrap(<BlindReferenceCapture fileUrl="blob:x" fileName="t.pdf" pageSizes={{}} numPages={1} state={replay([])} engineRunsExisted busy={false} onAdd={() => {}} onEdit={() => {}} onWithdraw={() => {}} onLock={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/may not be blind/);
  });
  it("overlays the engine's text, line and endpoints as evidence boxes in page points", () => {
    const src = evidenceFor({ id: "D1-1", page: 2, text: "1730", value: 1730, unit: "mm", textAnchor: [100, 50], line: { a: [80, 54], b: [130, 54] }, span: { start: [80, 54], end: [130, 54], length: 50 }, decision: "accepted", status: "acceptable", reasons: [], association: null }, { width: 600, height: 400 });
    expect(src.page).toBe(2);
    expect(src.evidence.map((e) => e.label)).toEqual(['printed "1730"', "engine dimension line", "engine endpoint 1", "engine endpoint 2"]);
    expect(src.evidence[1].bbox).toEqual([78.5, 52.5, 131.5, 55.5]);
  });
});

describe("resume identity in the panel (content fingerprint, not filename)", () => {
  const urls = { made: [] as string[], revoked: [] as string[] };
  const file = (name: string, text: string) => {
    const f = new File([text], name, { type: "application/pdf" });
    if (!("arrayBuffer" in f)) Object.defineProperty(f, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
    return f;
  };
  const shaOf = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  beforeEach(async () => {
    localStorage.clear();
    const pdfjs = await import("pdfjs-dist");
    (pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => ({ getViewport: () => ({ width: 600, height: 400 }) }), destroy: async () => {} }), destroy: async () => {} }));
    let n = 0; urls.made = []; urls.revoked = [];
    Object.defineProperty(URL, "createObjectURL", { value: () => { const u = `blob:test-${++n}`; urls.made.push(u); return u; }, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: (u: string) => { urls.revoked.push(u); }, configurable: true });
  });
  const upload = async (f: File) => { fireEvent.change(screen.getByLabelText("Drawing PDF"), { target: { files: [f] } }); };
  it("restores the saved place for the same content under another name, never for different content with the same name", async () => {
    const { saveUi } = await import("@/lib/measurement-lab/reviewState");
    saveUi({ v: 1, drawing: { name: "plan-original.pdf", sha256: await shaOf("%PDF SYNTHETIC A"), numPages: 2 }, context_path: "/ops", mode: "blind", ref_scope: "blind", pages_text: "2", engine: "engine-9ac1f71", filter: "all", selected: "D1-4", inspector_open: true, register_open: true, show_reviewed: false, focus: true, shortcuts: true, last_reviewed: "D1-3", saved_at: "2026-11-01T09:00:00Z" });
    wrap(<MeasurementLabPanel />);
    expect(screen.getByTestId("lab-resume").textContent).toMatch(/plan-original\.pdf.*matched by its content/);
    await upload(file("renamed-copy.pdf", "%PDF SYNTHETIC A"));
    expect((await screen.findByTestId("lab-restored")).textContent).toMatch(/last reviewed D1-3.*Same drawing content as “plan-original\.pdf”/);
    expect((screen.getByLabelText("Pages") as HTMLInputElement).value).toBe("2");
    await upload(file("plan-original.pdf", "%PDF SYNTHETIC B"));
    await waitFor(() => expect(screen.getByText(/plan-original\.pdf · 2 pages/)).toBeTruthy());
    expect(screen.queryByTestId("lab-restored")).toBeNull();
    expect((screen.getByLabelText("Pages") as HTMLInputElement).value).toBe("2"); // left as typed; nothing restored from the other file
    expect(urls.revoked).toEqual([]); // never revoked while a viewer may still be reading it (see the panel)
  });
  it("a fingerprint failure opens nothing, restores nothing and clears the previous drawing from the screen", async () => {
    wrap(<MeasurementLabPanel />);
    await upload(file("a.pdf", "%PDF SYNTHETIC A"));
    await waitFor(() => expect(screen.getByText(/a\.pdf · 2 pages/)).toBeTruthy());
    const spy = vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("SubtleCrypto unavailable"));
    await upload(file("b.pdf", "%PDF SYNTHETIC B"));
    expect((await screen.findByRole("status")).textContent).toMatch(/Could not fingerprint the drawing \(SubtleCrypto unavailable\).*nothing was restored or saved/);
    expect(screen.queryByText(/a\.pdf · 2 pages/)).toBeNull();
    expect(screen.queryByTestId("lab-restored")).toBeNull();
    spy.mockRestore();
  });
  it("only the latest file opened wins: a slower earlier open never replaces it, and its failure never clears it", async () => {
    const pdfjs = await import("pdfjs-dist");
    let releaseSlow: () => void = () => {};
    const gate = new Promise<void>((r) => { releaseSlow = r; });
    const destroyed: string[] = [];
    (pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>).mockImplementation(({ data }: { data: Uint8Array }) => {
      const tag = new TextDecoder().decode(data);
      const doc = { numPages: 1, getPage: async () => { if (tag.includes("SLOW")) await gate; return { getViewport: () => ({ width: 600, height: 400 }) }; }, destroy: async () => {} };
      return { promise: Promise.resolve(doc), destroy: async () => { destroyed.push(tag); } };
    });
    wrap(<MeasurementLabPanel />);
    await upload(file("slow.pdf", "%PDF SLOW"));
    await upload(file("fast.pdf", "%PDF FAST"));
    await waitFor(() => expect(screen.getByText(/fast\.pdf · 1 pages/)).toBeTruthy());
    await act(async () => { releaseSlow(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByText(/fast\.pdf · 1 pages/)).toBeTruthy();
    expect(screen.queryByText(/slow\.pdf/)).toBeNull();
    expect(destroyed.sort()).toEqual(["%PDF FAST", "%PDF SLOW"]); // every temporary document is destroyed
    expect(urls.made).toHaveLength(1); // the superseded open never even created a blob URL
  });
  it("a document is destroyed even when reading its pages fails", async () => {
    const pdfjs = await import("pdfjs-dist");
    const destroy = vi.fn(async () => {});
    (pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => { throw new Error("bad page"); } }), destroy }));
    wrap(<MeasurementLabPanel />);
    await upload(file("broken.pdf", "%PDF BROKEN"));
    expect((await screen.findByRole("status")).textContent).toMatch(/Could not open the PDF: bad page/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
