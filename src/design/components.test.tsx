import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { MoneyCell } from "./MoneyCell";
import { QuantityCell } from "./QuantityCell";
import { NumericNudge, ReorderButtons } from "./DragAlternative";
import { parseNumericInput } from "./money";
import { STATES, STATE_META } from "./tokens";

describe("StatusBadge — colour + icon + text for every state (WCAG 1.4.1)", () => {
  const expected: Record<string, string> = {
    VERIFIED_HUMAN: "Verified",
    MACHINE_UNVERIFIED: "Not yet checked",
    NEEDS_REVIEW: "Needs review",
    BLOCKING: "Blocking",
    PENDING_QTY: "Quantity pending",
    UNAVAILABLE: "No evidence",
    EXCLUDED: "Excluded",
  };

  it("uses the shared contract labels", () => {
    for (const s of STATES) expect(STATE_META[s].label).toBe(expected[s]);
  });

  it.each(STATES)("%s renders a visible text label, a decorative icon and a state hook", (state) => {
    const { container } = render(<StatusBadge state={state} />);
    const badge = container.querySelector(".ds-status")!;
    expect(badge).toHaveTextContent(expected[state]);
    // The accessible text is the visible label — nothing hidden, nothing colour-only.
    expect(screen.getByText(expected[state])).toBeVisible();
    const svg = badge.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(badge.getAttribute("data-state")).toBe(state.toLowerCase().replace(/_/g, "-"));
  });

  it("gives every state a distinct icon and a distinct label", () => {
    const icons = new Set(STATES.map((s) => STATE_META[s].icon));
    const labels = new Set(STATES.map((s) => STATE_META[s].label));
    expect(icons.size).toBe(STATES.length);
    expect(labels.size).toBe(STATES.length);
  });
});

describe("MoneyCell", () => {
  it("renders en-IN grouped rupees with tabular, right-aligned figures", () => {
    const { container } = render(<MoneyCell value={1234567} />);
    const cell = container.firstElementChild!;
    expect(cell).toHaveTextContent("₹12,34,567");
    expect(cell.className).toContain("ds-num");
  });

  it("renders compact only when asked", () => {
    render(<MoneyCell value={48200000} compact />);
    expect(screen.getByText("₹4.82 Cr")).toBeInTheDocument();
  });

  it("renders missing as — with a spoken label, never ₹0", () => {
    const { container } = render(<MoneyCell value={null} />);
    expect(container).not.toHaveTextContent("₹0");
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent("—");
    expect(screen.getByText("No value")).toHaveClass("sr-only");
  });

  it("strikes EXCLUDED amounts and announces it in words", () => {
    const { container } = render(<MoneyCell value={5000} state="EXCLUDED" />);
    const cell = container.firstElementChild!;
    expect(cell.className).toContain("ds-strike");
    expect(cell).toHaveTextContent("(excluded)");
  });
});

describe("QuantityCell", () => {
  it("renders grouped fixed decimals with a unit", () => {
    const { container } = render(<QuantityCell value={1234.5} unit="m³" />);
    expect(container.firstElementChild).toHaveTextContent("1,234.50m³");
  });

  it("announces a pending quantity instead of showing 0", () => {
    const { container } = render(<QuantityCell value={null} unit="m³" state="PENDING_QTY" />);
    expect(container).not.toHaveTextContent("0");
    expect(container).not.toHaveTextContent("m³");
    expect(screen.getByText("Quantity pending")).toHaveClass("sr-only");
  });
});

describe("parseNumericInput", () => {
  it("accepts Indian grouping and plain decimals, rejects junk", () => {
    expect(parseNumericInput("12,34,567.5")).toBe(1234567.5);
    expect(parseNumericInput("-3.25")).toBe(-3.25);
    expect(parseNumericInput(".5")).toBe(0.5);
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput("1e5")).toBeNull();
    expect(parseNumericInput("--1")).toBeNull();
  });
});

function Harness({ initial, onChange }: { initial: number | null; onChange?: (n: number) => void }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <NumericNudge
      label="Wall length"
      unit="m"
      value={v}
      step={0.5}
      min={0}
      max={10}
      onChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
    />
  );
}

describe("NumericNudge — non-drag alternative (WCAG 2.5.7) with 24px targets (2.5.8)", () => {
  it("nudges with buttons", () => {
    const spy = vi.fn();
    render(<Harness initial={2} onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase Wall length by 0.5" }));
    expect(spy).toHaveBeenLastCalledWith(2.5);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Wall length by 0.5" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease Wall length by 0.5" }));
    expect(spy).toHaveBeenLastCalledWith(1.5);
    expect(screen.getByRole("textbox", { name: "Wall length (m)" })).toHaveValue("1.50");
  });

  it("nudges with the keyboard, Shift for ×10, and clamps to min/max", () => {
    const spy = vi.fn();
    render(<Harness initial={2} onChange={spy} />);
    const input = screen.getByRole("textbox", { name: "Wall length (m)" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(spy).toHaveBeenLastCalledWith(2.5);
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(7.5);
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(10);
    expect(screen.getByRole("button", { name: /Increase/ })).toBeDisabled();
  });

  it("accepts typed values (with grouping) and rejects junk without changing the value", () => {
    const spy = vi.fn();
    render(<Harness initial={2} onChange={spy} />);
    const input = screen.getByRole("textbox", { name: "Wall length (m)" });
    fireEvent.change(input, { target: { value: "4.25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith(4.25);
    spy.mockClear();
    fireEvent.change(input, { target: { value: "four" } });
    fireEvent.blur(input);
    expect(spy).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number");
  });

  it("never invents a value: buttons are disabled while the value is unresolved", () => {
    const spy = vi.fn();
    render(<Harness initial={null} onChange={spy} />);
    expect(screen.getByRole("button", { name: /Increase/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Decrease/ })).toBeDisabled();
    const input = screen.getByRole("textbox", { name: "Wall length (m)" });
    expect(input).toHaveValue("");
    fireEvent.blur(input);
    expect(spy).not.toHaveBeenCalled();
  });

  it("gives every control the 24px minimum-target class", () => {
    const { container } = render(<Harness initial={2} />);
    const controls = container.querySelectorAll("button, input");
    expect(controls.length).toBe(3);
    controls.forEach((el) => expect(el.className).toContain("ds-target"));
  });
});

describe("ReorderButtons — non-drag alternative to drag-reorder", () => {
  it("moves with single clicks and disables at the ends", () => {
    const up = vi.fn();
    const down = vi.fn();
    const { container } = render(
      <ReorderButtons itemLabel="Ground floor" onMoveUp={up} onMoveDown={down} isFirst isLast={false} />,
    );
    expect(screen.getByRole("button", { name: "Move Ground floor up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Ground floor down" }));
    expect(down).toHaveBeenCalledTimes(1);
    container.querySelectorAll("button").forEach((b) => expect(b.className).toContain("ds-target"));
  });
});
