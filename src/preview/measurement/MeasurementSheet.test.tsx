// The measurement sheet over SYNTHETIC sample lines (no real project data).
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MeasurementSheet } from "./MeasurementSheet";
import { SAMPLE_MEASUREMENT_LINES } from "./sampleLines";

const renderSheet = () => render(<MeasurementSheet initialLines={SAMPLE_MEASUREMENT_LINES} />);
const section = (id: string) => screen.getByRole("heading", { name: new RegExp(`^${id} ·`) }).closest("section")!;
const footer = (id: string) => section(id).querySelector("tfoot")!;

describe("MeasurementSheet — totals from rows", () => {
  it("brickwork: gross minus deduction rows, tabular, with the deduction marked in words", () => {
    renderSheet();
    const s = section("ML-1");
    expect(footer("ML-1")).toHaveTextContent("Total: gross 16.97 − deductions 1.66");
    expect(footer("ML-1")).toHaveTextContent(/15\.31\s?m³/);
    const opening = within(s).getByText("Window openings").closest("tr")!;
    expect(opening).toHaveAttribute("data-deduction", "true");
    expect(opening).toHaveTextContent("Deduct:");
    expect(opening).toHaveTextContent("−1.66");
  });

  it("plaster: a door deducted; a missing rule citation is listed as a note, not hidden", () => {
    renderSheet();
    expect(footer("ML-2")).toHaveTextContent(/47\.10\s?m²/);
    expect(within(section("ML-2")).getByText("Note (ML-2.2): No rule cited.")).toBeInTheDocument();
  });

  it("a row not yet measured makes the line pending: no total, announced as pending, never 0", () => {
    renderSheet();
    const f = footer("ML-3");
    expect(f).toHaveTextContent("Total pending: a row is not fully measured");
    expect(within(f).getAllByText("Quantity pending").length).toBeGreaterThan(0);
    expect(f).not.toHaveTextContent(/\d+\.\d\d m/);
  });

  it("a dimension the unit does not use is an error: the total is withheld, not computed", () => {
    renderSheet();
    expect(footer("ML-4")).toHaveTextContent("Total withheld: fix the errors below");
    expect(within(section("ML-4")).getByText(/Error \(ML-4\.1\): D is given, but a sqm line/)).toBeInTheDocument();
    expect(within(section("ML-4")).getByText("No drawing reference")).toBeInTheDocument();
  });

  it("labels every rule citation as not verified", () => {
    renderSheet();
    expect(screen.getAllByText("IS 1200 Part [sample], cl. [sample] — not verified against the standard").length).toBeGreaterThan(5);
    expect(screen.queryByText(/compliant|verified against IS 1200/i)).toBeNull();
  });
});

describe("MeasurementSheet — keyboard editing (local demo state only)", () => {
  it("entering the missing length resolves the pending line", () => {
    renderSheet();
    const input = screen.getByLabelText("Bedroom perimeter — not yet measured: L (m)");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5.2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(footer("ML-3")).toHaveTextContent(/21\.60\s?m\b/);
  });

  it("rejects text that is not a number and keeps the value", () => {
    renderSheet();
    const input = screen.getByLabelText("Long walls: L (m)");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "six" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(footer("ML-1")).toHaveTextContent(/15\.31\s?m³/);
  });

  it("Escape restores the previous value", () => {
    renderSheet();
    const input = screen.getByLabelText("Long walls: L (m)") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("6");
    expect(footer("ML-1")).toHaveTextContent(/15\.31\s?m³/);
  });

  it("clearing a value makes the line pending rather than zero", () => {
    renderSheet();
    const input = screen.getByLabelText("Cross walls: No");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(footer("ML-1")).toHaveTextContent("Total pending");
  });

  it("a negative value is an error that withholds the total", () => {
    renderSheet();
    const input = screen.getByLabelText("Long walls: L (m)");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-6" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(footer("ML-1")).toHaveTextContent("Total withheld");
    expect(within(section("ML-1")).getByText(/Error \(ML-1\.1\): L is negative/)).toBeInTheDocument();
  });

  it("every editable cell is a named control with a 24 px target class", () => {
    renderSheet();
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(20);
    for (const i of inputs) {
      expect(i).toHaveAccessibleName(/\S/);
      expect(i).toHaveClass("ds-target");
    }
  });
});
