// Integrated flow tab: an action in one surface updates the others. SYNTHETIC
// fixture data, in-memory state only (local component evidence, not a
// real-drawing or real-browser check).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import EngineeringPreview from "@/pages/ops/EngineeringPreview";
import { FlowPanel } from "./FlowPanel";

const row = (id: string) => screen.getByTestId(`flow-line-${id}`);
const queueOrder = () => screen.getAllByTestId(/^flow-queue-/).map((el) => el.getAttribute("data-testid")!.replace("flow-queue-", ""));
const queueItem = (id: string) => screen.getByTestId(`flow-queue-${id}`);
const press = (scope: HTMLElement, name: RegExp) => fireEvent.click(within(scope).getByRole("button", { name }));
const blockers = () => within(screen.getByRole("list", { name: "Flow blockers" })).getAllByRole("listitem").map((li) => li.textContent);

function editCell(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("Integrated flow tab", () => {
  it("is a tab of the engineering preview and is labelled synthetic / illustrative", () => {
    render(<MemoryRouter><EngineeringPreview /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Integrated flow" }));
    expect(screen.getByRole("heading", { name: "Integrated flow" })).toBeInTheDocument();
    expect(screen.getByText(/Synthetic project, illustrative ₹/)).toBeInTheDocument();
    expect(screen.getByText("Certification unavailable")).toBeDisabled();
  });

  it("never shows an amount for the pending line; the no-match line says a market rate is needed", () => {
    render(<FlowPanel />);
    expect(row("FL-6")).toHaveTextContent("Not priced — quantity pending");
    expect(row("FL-6")).not.toHaveTextContent("₹0");
    expect(row("FL-6")).toHaveTextContent("Quantity pending");
    expect(row("FL-5")).toHaveTextContent("No DSR match: market rate needed");
    expect(row("FL-5")).toHaveTextContent("Not priced — no rate");
    expect(row("FL-3")).toHaveTextContent("₹1,39,412");
    expect(queueItem("FL-6")).toHaveTextContent("Measure first");
    expect(within(queueItem("FL-6")).queryByRole("button")).toBeNull();
  });

  it("a check in the verify queue updates the line table, the queue order and the blockers", () => {
    render(<FlowPanel />);
    expect(queueOrder()).toEqual(["FL-6", "FL-3", "FL-4", "FL-2", "FL-1", "FL-5"]);
    expect(blockers()).toContain("5 line(s) not yet reviewed");
    press(queueItem("FL-4"), /Verify against drawing/);
    expect(row("FL-4")).toHaveTextContent("Verified · demo");
    expect(queueOrder()).toEqual(["FL-6", "FL-3", "FL-2", "FL-1", "FL-4", "FL-5"]);
    expect(blockers()).toContain("4 line(s) not yet reviewed");
  });

  it("editing a measurement row updates totals and resets that line's check only", () => {
    render(<FlowPanel />);
    press(queueItem("FL-1"), /^Accept/);
    press(queueItem("FL-2"), /^Accept/);
    expect(row("FL-1")).toHaveTextContent("Accepted · demo");
    expect(row("FL-1")).toHaveTextContent("₹6,747");
    // FL-1's rows are open by default.
    editCell("Footing trenches, grid B: D (m)", "1.35");
    expect(row("FL-1")).toHaveTextContent("29.16");
    expect(row("FL-1")).toHaveTextContent(`₹${new Intl.NumberFormat("en-IN").format(Math.round(29.16 * 260.3))}`);
    expect(row("FL-1")).toHaveTextContent("Needs review");
    expect(row("FL-1")).toHaveTextContent("Reset: inputs changed");
    expect(row("FL-2")).toHaveTextContent("Accepted · demo");
    expect(row("FL-2")).not.toHaveTextContent("Reset");
  });

  it("clearing a measured value takes the amount away instead of showing ₹0", () => {
    render(<FlowPanel />);
    editCell("Footing trenches, grid B: D (m)", "");
    expect(row("FL-1")).toHaveTextContent("Not priced — quantity pending");
    // Pending lines lead the queue (by rate: FL-6 ₹1,553.45, then FL-1 ₹260.30), with no ₹ risk.
    expect(queueOrder().slice(0, 2)).toEqual(["FL-6", "FL-1"]);
    expect(queueItem("FL-1")).toHaveTextContent("Not computed — quantity unknown");
  });

  it("measuring the pending line prices it and lets it be reviewed", () => {
    render(<FlowPanel />);
    fireEvent.click(within(row("FL-6")).getByRole("button", { name: /Measurements/ }));
    editCell("Bedroom floor — not yet measured: L (m)", "4");
    expect(row("FL-6")).toHaveTextContent("20.00");
    expect(row("FL-6")).toHaveTextContent(`₹${new Intl.NumberFormat("en-IN").format(Math.round(20 * 1553.45))}`);
    expect(within(queueItem("FL-6")).getAllByRole("button").length).toBe(3);
  });

  it("a sample difference over tolerable error shows up as a blocker", () => {
    render(<FlowPanel />);
    for (const id of ["FL-1", "FL-2", "FL-4"]) press(queueItem(id), /^Accept/);
    const pool = screen.getByRole("group", { name: "Sample: Accepted non-key lines" });
    press(pool, /50% difference \(demo\) FL-2/);
    press(pool, /No difference \(demo\) FL-1/);
    press(pool, /No difference \(demo\) FL-4/);
    expect(pool).toHaveTextContent(/exceeds the tolerable error/);
    // The overall sampling verdict also needs the no-detection regions checked.
    const regions = screen.getByRole("group", { name: "Sample: No-detection regions" });
    for (const b of within(regions).getAllByRole("button", { name: /Nothing missed/ })) fireEvent.click(b);
    expect(blockers().join(" ")).toMatch(/exceeds tolerable error/);
  });

  it("applying the synthetic revision resets only the changed line and shows the delta", () => {
    render(<FlowPanel />);
    for (const id of ["FL-1", "FL-2", "FL-4"]) press(queueItem(id), /^Accept/);
    fireEvent.click(screen.getByRole("button", { name: "Apply synthetic revision C" }));
    expect(screen.getByText(/1 line\(s\) changed \(FL-1\)/)).toBeInTheDocument();
    expect(row("FL-1")).toHaveTextContent("Reset: inputs changed");
    expect(row("FL-2")).toHaveTextContent("Accepted · demo");
    expect(row("FL-4")).toHaveTextContent("Accepted · demo");
    expect(screen.getByRole("heading", { name: "Revision delta" })).toBeInTheDocument();
    expect(screen.getByText(/1 line\(s\) reset to unverified/)).toBeInTheDocument();
  });

  it("resolving every coverage gap removes the coverage blocker", () => {
    render(<FlowPanel />);
    expect(blockers()).toContain("Coverage gaps not all resolved or excluded with a reason");
    for (const input of screen.getAllByLabelText("Reason, or the line that now covers it")) {
      fireEvent.change(input, { target: { value: "Out of scope for this package (demo)" } });
    }
    for (const b of screen.getAllByRole("button", { name: "Exclude with reason" })) fireEvent.click(b);
    expect(blockers()).not.toContain("Coverage gaps not all resolved or excluded with a reason");
  });
});
