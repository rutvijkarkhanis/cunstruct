// SYNTHETIC fixtures only: behaviour of the mock workspace, not accuracy.
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import WorkspaceShell from "./WorkspaceShell";

const grid = () => screen.getByRole("grid", { name: "Demo BOQ grid" });
const cell = (row: number, col: number) => grid().querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)!;
const activeCell = () => grid().querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"]')!;
const key = (k: string, opts: Record<string, unknown> = {}) => fireEvent.keyDown(activeCell(), { key: k, ...opts });
const row = (id: string) => grid().querySelector<HTMLElement>(`[data-line="${id}"]`)!;
const status = () => screen.getByTestId("workspace-shell").querySelector('[aria-live="polite"]')!;
// Columns: 0 item, 1 qty, 2 rate, 3 amount, 4 state, 5 region.

describe("WorkspaceShell — keyboard (I2)", () => {
  it("arrows, Enter / Shift+Enter and Tab / Shift+Tab move the active cell like a spreadsheet", () => {
    render(<WorkspaceShell />);
    expect(activeCell()).toBe(cell(0, 0));
    key("ArrowRight");
    expect(activeCell()).toBe(cell(0, 1));
    key("ArrowDown");
    expect(activeCell()).toBe(cell(1, 1));
    key("ArrowLeft");
    expect(activeCell()).toBe(cell(1, 0));
    key("ArrowUp");
    expect(activeCell()).toBe(cell(0, 0));
    key("Enter");
    expect(activeCell()).toBe(cell(1, 0));
    key("Enter", { shiftKey: true });
    expect(activeCell()).toBe(cell(0, 0));
    key("Tab");
    expect(activeCell()).toBe(cell(0, 1));
    key("Tab", { shiftKey: true });
    expect(activeCell()).toBe(cell(0, 0));
    // Exactly one cell is in the tab order (roving tabindex).
    expect(grid().querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
  });

  it("F2 edits the active quantity; Enter commits and moves down, marked demo", () => {
    render(<WorkspaceShell />);
    key("ArrowRight"); // L-01 qty
    key("F2");
    const input = screen.getByRole("textbox", { name: "Quantity for L-01 (m³)" });
    expect(input).toHaveValue("24");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(activeCell()).toBe(cell(1, 1));
    expect(cell(0, 1)).toHaveTextContent("30.00");
    expect(cell(0, 1)).toHaveTextContent("edited · demo");
    expect(cell(0, 3)).toHaveTextContent("₹12,600"); // 30 × 420
    expect(status()).toHaveTextContent("L-01 quantity updated (demo, not saved).");
  });

  it("typing a digit starts an edit; Tab commits and moves right; Escape cancels without change", () => {
    render(<WorkspaceShell />);
    key("ArrowRight");
    key("ArrowRight"); // L-01 rate
    key("5");
    const input = screen.getByRole("textbox", { name: "Rate for L-01 (₹)" });
    expect(input).toHaveValue("5");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(activeCell()).toBe(cell(0, 3));
    expect(cell(0, 2)).toHaveTextContent("₹500");
    key("ArrowLeft");
    key("F2");
    fireEvent.change(screen.getByRole("textbox", { name: "Rate for L-01 (₹)" }), { target: { value: "999" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rate for L-01 (₹)" }), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(cell(0, 2)).toHaveTextContent("₹500");
  });

  it("an invalid entry stays in the editor with an error; nothing is invented", () => {
    render(<WorkspaceShell />);
    key("ArrowRight");
    key("F2");
    const input = screen.getByRole("textbox", { name: "Quantity for L-01 (m³)" });
    fireEvent.change(input, { target: { value: "4,5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent('Quantity "4,5" is not a number.');
    fireEvent.keyDown(input, { key: "Escape" });
    expect(cell(0, 1)).toHaveTextContent("24.00");
  });

  it("F2 on a read-only column explains instead of editing", () => {
    render(<WorkspaceShell />);
    key("F2");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(status()).toHaveTextContent('"Item" cannot be edited.');
  });

  it("Delete on a quantity makes it pending, never 0, and removes its amount", () => {
    render(<WorkspaceShell />);
    key("ArrowRight");
    key("Delete");
    expect(row("L-01")).toHaveTextContent("Quantity pending");
    expect(cell(0, 3)).not.toHaveTextContent("₹");
    expect(status()).toHaveTextContent("quantity cleared: now pending, not 0");
  });
});

describe("WorkspaceShell — paste a range (I2)", () => {
  const paste = (text: string) => fireEvent.paste(activeCell(), { clipboardData: { getData: () => text } });

  it("pastes a valid qty × rate block from the active cell", () => {
    render(<WorkspaceShell />);
    key("ArrowRight");
    paste("30\t500\n7\t6100");
    expect(cell(0, 1)).toHaveTextContent("30.00");
    expect(cell(0, 2)).toHaveTextContent("₹500");
    expect(cell(1, 1)).toHaveTextContent("7.00");
    expect(cell(1, 2)).toHaveTextContent("₹6,100");
    expect(status()).toHaveTextContent("Pasted 2 × 2 cells (demo, not saved).");
  });

  it("rejects an invalid block entirely and says why", () => {
    render(<WorkspaceShell />);
    key("ArrowRight");
    paste("30\nabc");
    expect(cell(0, 1)).toHaveTextContent("24.00");
    expect(screen.getByRole("alert")).toHaveTextContent('Paste rejected, nothing changed. row 2, cell 1: Quantity "abc" is not a number.');
  });

  it("rejects a block that overflows the grid", () => {
    render(<WorkspaceShell />);
    key("ArrowRight");
    for (let i = 0; i < 5; i++) key("ArrowDown"); // last row
    paste("1\n2");
    expect(screen.getByRole("alert")).toHaveTextContent("row 2, cell 1 falls outside the grid.");
  });
});

describe("WorkspaceShell — quantity states", () => {
  it("pending shows no amount; confirmed zero shows ₹0 and is labelled distinctly", () => {
    render(<WorkspaceShell />);
    const pending = row("L-03");
    expect(pending).toHaveTextContent("Quantity pending");
    expect(within(pending).getAllByText("—").length).toBeGreaterThan(0);
    expect(pending).not.toHaveTextContent("₹0");
    const zero = row("L-04");
    expect(zero).toHaveTextContent("Confirmed zero");
    expect(within(zero).getByText("₹0")).toBeInTheDocument();
  });
});

describe("WorkspaceShell — drawing links both ways (I3)", () => {
  it("selecting a grid line highlights its region on the drawing", () => {
    render(<WorkspaceShell />);
    fireEvent.click(cell(4, 0)); // L-05
    expect(screen.getByRole("button", { name: /Wall layout, ground floor, highlighted/ })).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByRole("button", { name: /^Foundation trench/ })).not.toHaveAttribute("data-highlighted");
  });

  it("selecting a region selects every linked line, by click or keyboard", () => {
    render(<WorkspaceShell />);
    const footing = screen.getByRole("button", { name: /^Footing detail F1/ });
    fireEvent.click(footing);
    expect(row("L-02")).toHaveAttribute("aria-selected", "true");
    expect(row("L-04")).toHaveAttribute("aria-selected", "true");
    expect(row("L-01")).toHaveAttribute("aria-selected", "false");
    expect(status()).toHaveTextContent("Footing detail F1: 2 linked lines (L-02, L-04).");
    fireEvent.keyDown(screen.getByRole("button", { name: /^Foundation trench/ }), { key: "Enter" });
    expect(row("L-01")).toHaveAttribute("aria-selected", "true");
    expect(row("L-02")).toHaveAttribute("aria-selected", "false");
  });

  it("missing and uncertain regions are labelled, never shown as linked or verified", () => {
    render(<WorkspaceShell />);
    expect(row("L-06")).toHaveTextContent("No drawing region");
    expect(row("L-06")).not.toHaveTextContent("Linked region");
    expect(row("L-03")).toHaveTextContent("Region unverified · R-BARS");
    fireEvent.click(screen.getByRole("button", { name: /Bar schedule S-203.*link unverified/ }));
    expect(status()).toHaveTextContent("link unverified");
    expect(screen.getByTestId("workspace-shell")).not.toHaveTextContent(/\bverified region\b/i);
  });

  it("the drawing area is always rendered light (D1 .ds-drawing)", () => {
    render(<WorkspaceShell />);
    expect(screen.getByRole("group", { name: "Synthetic drawing with linked regions" }).closest(".ds-drawing")).not.toBeNull();
  });
});

describe("WorkspaceShell — sign-off ledger", () => {
  it("is one line, updates with demo edits, and never claims a sign-off", () => {
    render(<WorkspaceShell />);
    const ledger = screen.getByTestId("signoff-ledger");
    expect(ledger).toHaveTextContent("6 lines · 1 pending · 1 without a rate · 1 without a drawing region · 1 with an unverified region · 0 edited (demo) · Not signed off");
    key("ArrowRight");
    key("Delete");
    expect(ledger).toHaveTextContent("2 pending");
    expect(ledger).toHaveTextContent("1 edited (demo)");
  });
});
