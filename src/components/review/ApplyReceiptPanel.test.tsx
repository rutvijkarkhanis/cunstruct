import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ApplyReceiptPanel from "./ApplyReceiptPanel";
import ApplyReceiptNote from "@/components/app/ApplyReceiptNote";
import { saveReceipt, type ApplyReceipt } from "@/lib/review/applyReceipt";

const receipt = (p: Partial<ApplyReceipt> = {}): ApplyReceipt => ({
  boqId: "boq-1", runId: "run-1", appliedAt: "2026-10-17T05:00:00Z", appliedCount: 2, unresolvedCount: 0,
  correctedCount: 0, reviewedCount: 5, verifiedCount: 5, unauditedCount: 0, conflictedCount: 0,
  revisionChanged: [], justAppliedLineIds: [], ...p,
});
const noop = () => {};

describe("an Apply that stopped part-way is never shown as a success", () => {
  it("the review screen's receipt says what was saved and what was not, in warning style", () => {
    render(<ApplyReceiptPanel receipt={receipt({ failedCount: 3, unresolvedCount: 3, failureMessage: "network error" })} onViewBoq={noop} onDismiss={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Apply stopped part-way: 3 items were not written (network error). The 2 changes above are saved. Apply again to finish",
    );
    expect(screen.getByRole("region", { name: /Applied 2 changes/ }).className).toMatch(/amber/);
  });

  it("a completed Apply has no failure text and keeps the success style", () => {
    render(<ApplyReceiptPanel receipt={receipt()} onViewBoq={noop} onDismiss={noop} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region", { name: /Applied 2 changes/ }).className).toMatch(/emerald/);
  });

  it("the journey's note names the interruption and sends the person back to review", () => {
    window.sessionStorage.clear();
    saveReceipt(receipt({ failedCount: 1, unresolvedCount: 1 }));
    render(<MemoryRouter><ApplyReceiptNote projectId="p" boqId="boq-1" here="boq" /></MemoryRouter>);
    const note = screen.getByRole("status", { name: "Last Apply result" });
    expect(note).toHaveTextContent("2 items applied · stopped part-way — 1 not written · 1 not applied (unresolved)");
    expect(screen.getByRole("link", { name: "Resolve the 1 not applied in Review quantities" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Continue to Check/ })).toBeNull();
  });
});
