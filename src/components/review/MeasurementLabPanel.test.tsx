import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
