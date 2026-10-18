// The Measurement sheet tab inside the owner-only engineering preview (SYNTHETIC data).
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EngineeringPreview from "@/pages/ops/EngineeringPreview";

describe("EngineeringPreview — Measurement sheet tab", () => {
  it("is offered as a tab and shows sample rows with unverified citations", () => {
    render(<MemoryRouter initialEntries={["/ops/engineering-preview"]}><EngineeringPreview /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: "Measurement sheet" }));
    expect(screen.getByRole("heading", { name: "Measurement sheet" })).toBeInTheDocument();
    expect(screen.getByText(/Sample measurements, not a real project/)).toBeInTheDocument();
    expect(screen.getAllByText(/not verified against the standard/).length).toBeGreaterThan(0);
  });
});
