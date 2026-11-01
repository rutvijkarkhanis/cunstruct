import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import { useState } from "react";

// SYNTHETIC measurements and verdicts. The real verdict log is used; the PDF viewer is a stand-in that
// records the markers it is given and lets the test "click" one on the drawing.
const viewer = vi.hoisted(() => ({ props: null as null | { markers?: { id: string; reviewItemId: string; emphasis: string; page: number }[]; onSelectMarker?: (id: string) => void } }));
vi.mock("@/components/review/PdfEvidenceViewer", () => ({ default: (p: typeof viewer.props) => { viewer.props = p; return <div data-testid="viewer" />; } }));

import MeasurementReviewWorkspace, { type WorkspaceUi } from "./MeasurementReviewWorkspace";
import { appendVerdict, freezeRun, type CorrectionEvent, type FrozenRun, type LabMeasurement } from "@/lib/measurement-lab/core";

const m = (id: string, over: Partial<LabMeasurement> = {}): LabMeasurement => ({
  id, page: 1, text: id === "D2" ? "900" : "1730", value: id === "D2" ? 900 : 1730, unit: "mm", textAnchor: [100, 50], line: { a: [80, 54], b: [130, 54] },
  span: { start: [80, 54], end: [130, 54], length: 50 }, decision: "held", status: "hold", reasons: [], association: null, ...over,
});
let run: FrozenRun;
const verdictSpy = vi.fn();
function Harness({ initial, initialLog = [] }: { initial?: Partial<WorkspaceUi>; initialLog?: readonly CorrectionEvent[] }) {
  const [ui, setUi] = useState<WorkspaceUi>({ filter: "all", selected: null, inspector_open: true, focus: true, shortcuts: true, ...initial });
  const [log, setLog] = useState<readonly CorrectionEvent[]>(initialLog);
  return (
    <div>
      <div data-testid="ui">{JSON.stringify(ui)}</div>
      <MeasurementReviewWorkspace run={run} log={log} drawing={{ name: "t.pdf", url: "blob:x", pageSizes: { 1: { width: 600, height: 400 }, 2: { width: 600, height: 400 } } }} ui={ui}
        onUi={(p) => setUi((u) => ({ ...u, ...p }))}
        onVerdict={async (x) => { verdictSpy(x); const next = await appendVerdict(log, { run_id: run.run_id, measurement_id: x.measurement_id, verdict: x.verdict, note: x.note, reviewer_id: "u1", reviewer_label: "admin@x", correction: x.corrected_value !== null ? { value: x.corrected_value } : null }); setLog(next); }} />
    </div>
  );
}
const ui = () => JSON.parse(screen.getByTestId("ui").textContent!) as WorkspaceUi;
const ws = () => screen.getByTestId("review-workspace");
const key = async (k: string, target: Element = ws(), mod = {}) => { await act(async () => { fireEvent.keyDown(target, { key: k, ...mod }); await new Promise((r) => setTimeout(r, 0)); }); };
const inspector = () => screen.getByRole("complementary", { name: "Measurement inspector" });

beforeEach(async () => {
  verdictSpy.mockReset();
  run = await freezeRun("engine-9ac1f71", { name: "t.pdf", sha256: "a".repeat(64), pages: [1, 2] }, { measurements: [m("D1"), m("D2", { page: 2, textAnchor: [300, 90] }), m("D3", { textAnchor: [Number.NaN, 0], line: null, span: null }), m("D4", { decision: "accepted", status: "acceptable" })], raw: {} });
});

describe("contextual inspector and drawing linking", () => {
  it("list selection fills the inspector and highlights that measurement on the drawing; switching updates both", async () => {
    render(<Harness />);
    expect(within(inspector()).getByText(/Select a measurement/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /D1 · “1730”/ }));
    expect(within(inspector()).getByText("D1")).toBeTruthy();
    expect(within(inspector()).getByRole("region", { name: "Measurement" }).textContent).toMatch(/D1 · 1730 mm.*Typelinear dimension.*Page1.*Engine resultheld.*Your verdictnot reviewed/);
    expect(within(inspector()).getByText("Scale used").nextSibling?.textContent).toMatch(/missing/);
    expect(within(inspector()).getByText("Endpoint distance on the sheet").nextSibling?.textContent).toMatch(/derived · 50 pt/);
    expect(viewer.props!.markers!.filter((k) => k.emphasis === "primary").every((k) => k.reviewItemId === "D1")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /D2 · “900”/ }));
    expect(within(inspector()).getByRole("region", { name: "Measurement" }).textContent).toMatch(/D2 · 900 mm.*Page2/);
    const primary = viewer.props!.markers!.filter((k) => k.emphasis === "primary");
    expect(primary.length).toBe(4);
    expect(primary.every((k) => k.reviewItemId === "D2" && k.page === 2)).toBe(true); // the viewer follows the primary marker to its page
  });
  it("clicking a measurement on the drawing selects it (drawing → inspector), also among overlapping markers", () => {
    render(<Harness initial={{ selected: "D1" }} />);
    const d4 = viewer.props!.markers!.find((k) => k.reviewItemId === "D4")!;
    act(() => viewer.props!.onSelectMarker!(d4.id));
    expect(ui().selected).toBe("D4");
    expect(within(inspector()).getByText("D4")).toBeTruthy();
  });
  it("says so when a measurement has no position, instead of placing a highlight", () => {
    render(<Harness initial={{ selected: "D3" }} />);
    expect(screen.getByRole("note").textContent).toMatch(/Precise location linking is unavailable for D3.*page 1/);
    expect(viewer.props!.markers!.some((k) => k.reviewItemId === "D3")).toBe(false);
    expect(within(inspector()).getByText("Dimension line").nextSibling?.textContent).toMatch(/missing/);
  });
  it("focus off shows the whole sheet with nothing emphasised; the inspector can be hidden and shown", async () => {
    render(<Harness initial={{ selected: "D1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Whole sheet/ }));
    expect(viewer.props!.markers!.some((k) => k.emphasis === "primary")).toBe(false);
    expect(ui().selected).toBe("D1");
    fireEvent.click(screen.getByRole("button", { name: /Hide inspector/ }));
    expect(screen.queryByRole("complementary", { name: "Measurement inspector" })).toBeNull();
    await key("i");
    expect(inspector()).toBeTruthy();
  });
});

describe("review state", () => {
  it("selecting never marks a measurement reviewed; progress counts verdicts only", () => {
    render(<Harness />);
    for (const id of ["D1", "D2", "D4"]) fireEvent.click(screen.getByRole("button", { name: new RegExp(`${id} · `) }));
    expect(screen.getByLabelText("Review progress").textContent).toMatch(/0 of 4 reviewed/);
    expect(verdictSpy).not.toHaveBeenCalled();
  });
  it("A records correct; progress, list badge and history update; What changed lists the receipt", async () => {
    render(<Harness initial={{ selected: "D1" }} />);
    await key("a");
    expect(verdictSpy).toHaveBeenCalledWith({ measurement_id: "D1", verdict: "correct", note: "", corrected_value: null });
    await waitFor(() => expect(screen.getByLabelText("Review progress").textContent).toMatch(/1 of 4 reviewed/));
    expect(within(screen.getByRole("button", { name: /D1 · / })).getByText("correct")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /What changed/ }));
    expect(screen.getByLabelText("What changed").textContent).toMatch(/D1.*not reviewed → correct · value unchanged/);
  });
});

describe("keyboard review", () => {
  it("R and U never record without a reason: they focus the reason field; Ctrl+Enter then records", async () => {
    render(<Harness initial={{ selected: "D1" }} />);
    await key("r");
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/Type why it is incorrect.*Nothing has been recorded/);
    const reason = screen.getByLabelText("Verdict note");
    expect(document.activeElement).toBe(reason); // focused within the key event itself, so no keystroke can be lost
    fireEvent.change(screen.getByLabelText("Corrected value"), { target: { value: "1735" } });
    fireEvent.change(reason, { target: { value: "reads 1735 at 400%" } });
    await key("Enter", reason, { ctrlKey: true });
    expect(verdictSpy).toHaveBeenCalledWith({ measurement_id: "D1", verdict: "incorrect", note: "reads 1735 at 400%", corrected_value: 1735 });
    await waitFor(() => expect(within(inspector()).getByLabelText("Verdict history").textContent).toMatch(/not reviewed → incorrect · value 1730 → 1735/));
    expect(within(inspector()).getByText(/human corrected/)).toBeTruthy();
    expect(run.measurements[0].value).toBe(1730); // frozen engine output untouched
    await key("u");
    expect(verdictSpy).toHaveBeenCalledTimes(1);
  });
  it("shortcuts never fire while typing, and can be switched off", async () => {
    render(<Harness initial={{ selected: "D1" }} />);
    await key("a", screen.getByLabelText("Verdict note"));
    await key("n", screen.getByLabelText("Corrected value"));
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(ui().selected).toBe("D1");
    fireEvent.click(screen.getByLabelText("Keyboard shortcuts on"));
    await key("a");
    expect(verdictSpy).not.toHaveBeenCalled();
  });
  it("N goes to the next unresolved, P to the previous, F re-focuses, ? shows the list, Esc clears", async () => {
    const pre = await appendVerdict([], { run_id: run.run_id, measurement_id: "D2", verdict: "correct", reviewer_id: "u1" });
    render(<Harness initial={{ selected: "D1" }} initialLog={pre} />);
    await key("n");
    expect(ui().selected).toBe("D3"); // D2 is reviewed
    await key("p");
    expect(ui().selected).toBe("D2");
    const before = viewer.props!.markers;
    await key("f");
    expect(viewer.props!.markers).not.toBe(before);
    await key("?");
    expect(screen.getByLabelText("Keyboard shortcuts").textContent).toMatch(/Next unresolved measurement/);
    await key("Escape");
    expect(ui().selected).toBeNull();
    expect(ws().getAttribute("data-lab-esc")).toBeNull(); // with nothing selected, Esc is left to the dialog
  });
  it("R with the inspector hidden opens it and focuses the reason field in the same key event", async () => {
    render(<Harness initial={{ selected: "D1", inspector_open: false }} />);
    act(() => { fireEvent.keyDown(ws(), { key: "u" }); });
    expect(document.activeElement).toBe(screen.getByLabelText("Verdict note"));
    expect(verdictSpy).not.toHaveBeenCalled();
  });
  it("a verdict with nothing selected records nothing", async () => {
    render(<Harness />);
    await key("a");
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/Select a measurement first/);
  });
});
