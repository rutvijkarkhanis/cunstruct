// B11 Procurement tab in the owner-only engineering preview (ILLUSTRATIVE FIXTURES).
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EngineeringPreview from "@/pages/ops/EngineeringPreview";

describe("EngineeringPreview — Procurement and Phone views tabs", () => {
  it("Procurement shows requirements with provenance, not-procurable lines with no amount, call-offs and reconciliation", () => {
    render(<MemoryRouter><EngineeringPreview /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Procurement" }));
    expect(screen.getByRole("heading", { name: "Procurement" })).toBeInTheDocument();
    expect(screen.getAllByText(/DAR 2023 \(repository seed\).*not verified/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("illustrative fixture").length).toBeGreaterThan(0);
    expect(screen.getByText(/PL-02 · Reinforcement — columns/).closest("li")).toHaveTextContent("(no quantity, no amount)");
    expect(screen.getByText(/CO-W2 · needed week 2/)).toBeInTheDocument();
    expect(screen.getAllByText("Over-issue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Under-issue").length).toBeGreaterThan(0);
  });

  it("Phone views renders the 360 px frame", () => {
    render(<MemoryRouter><EngineeringPreview /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Phone views" }));
    expect(screen.getByTestId("phone-frame")).toBeInTheDocument();
  });
});
