import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import EngineeringPreview from "./EngineeringPreview";

function renderPreview() {
  return render(
    <MemoryRouter initialEntries={["/ops/engineering-preview"]}>
      <EngineeringPreview />
    </MemoryRouter>,
  );
}

describe("EngineeringPreview", () => {
  it("exposes the five planned surfaces and labels the content as illustrative", () => {
    renderPreview();

    for (const label of ["Workspace", "Verify queue", "Coverage map", "Sign-off sheet", "Revision delta"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/Illustrative data only/i)).toBeInTheDocument();
    // The default (workspace) view carries the not-certified label in its header;
    // the explicit "Not certified" status lives on the sign-off sheet (last test).
    expect(screen.getByText(/not a certified BOQ/i)).toBeInTheDocument();
  });

  it("never pairs a pending quantity with a monetary amount, while confirmed zero remains ₹0", () => {
    renderPreview();

    const pendingRow = screen.getByText("Reinforcement steel").closest("tr");
    expect(pendingRow).not.toBeNull();
    expect(pendingRow).toHaveTextContent("Quantity pending");
    expect(pendingRow).not.toHaveTextContent("₹0");
    expect(pendingRow).toHaveTextContent("—");

    const zeroRow = screen.getByText("Additional formwork quantity").closest("tr");
    expect(zeroRow).not.toBeNull();
    expect(zeroRow).toHaveTextContent("Confirmed zero");
    expect(within(zeroRow!).getByText("₹0")).toBeInTheDocument();
  });

  it("keeps verify actions local and explicitly marked as demo actions", () => {
    renderPreview();

    fireEvent.click(screen.getByRole("tab", { name: "Verify queue" }));
    const pendingArticle = screen.getByText("Reinforcement steel").closest("article");
    expect(pendingArticle).not.toBeNull();

    fireEvent.click(within(pendingArticle!).getByRole("button", { name: "Correct in demo" }));
    expect(within(pendingArticle!).getByText("Quantity established")).toBeInTheDocument();
    expect(within(pendingArticle!).getByText("Corrected · demo")).toBeInTheDocument();
    expect(within(pendingArticle!).getByText("Illustrative amount:").parentElement).toHaveTextContent("₹68");
  });

  it("does not offer certification without a reference set", () => {
    renderPreview();

    fireEvent.click(screen.getByRole("tab", { name: "Sign-off sheet" }));
    expect(screen.getByText("No independent reference set loaded")).toBeInTheDocument();
    expect(screen.getByText("Not certified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Certification unavailable" })).toBeDisabled();
  });
});
