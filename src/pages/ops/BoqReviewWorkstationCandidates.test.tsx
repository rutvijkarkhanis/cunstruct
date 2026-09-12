// UI BEHAVIOR — ItemPanel must show the AI's conflicting-source candidates
// clearly (value + basis + source), not just a bare, unexplained PENDING.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemPanel } from "./BoqReviewWorkstation";
import type { StoredReviewItem } from "@/lib/review/reviewStore";

function panel(item: StoredReviewItem) {
  const mocks = {
    onVerify: vi.fn(), onEdit: vi.fn(), onFlag: vi.fn(), onPending: vi.fn(),
    onPrev: vi.fn(), onNext: vi.fn(), onSelectClaim: vi.fn(),
  };
  const result = render(
    <ItemPanel
      item={item} index={0} count={1}
      {...mocks}
      drawings={[]} resolvedDocumentId={null}
    />,
  );
  return { ...result, mocks };
}

const conflictedItem: StoredReviewItem = {
  id: "ri-1",
  reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "SLAB-TOTAL", item: "Total slab area", quantity: null, unit: "sq ft",
    confidence: null, aiStatus: "PENDING",
    candidates: [
      { value: 25176, unit: "sq ft", basis: "Arithmetic sum of component slab areas" },
      { value: 25101, unit: "sq ft", basis: "Printed total on the 2025 area statement", source: { document: "area-statement.pdf", page: 1, evidence: [] } },
    ],
  },
};

const plainPendingItem: StoredReviewItem = {
  id: "ri-2",
  reviewStatus: "PENDING_REVIEW",
  ai: { key: "X", item: "Something", quantity: null, confidence: null, aiStatus: "PENDING" },
};

const measuredItem: StoredReviewItem = {
  id: "ri-3",
  reviewStatus: "PENDING_REVIEW",
  ai: { key: "W1", item: "Window W1", quantity: 3, confidence: 0.9, aiStatus: "MEASURED" },
};

describe("ItemPanel — conflicting-source candidates", () => {
  it("shows the conflict banner with candidate count", () => {
    panel(conflictedItem);
    expect(screen.getByText(/Conflicting sources — 2 candidate values found/i)).toBeInTheDocument();
  });

  it("lists every candidate's value and basis", () => {
    panel(conflictedItem);
    expect(screen.getByText(/25176 sq ft/)).toBeInTheDocument();
    expect(screen.getByText(/Arithmetic sum of component slab areas/)).toBeInTheDocument();
    expect(screen.getByText(/25101 sq ft/)).toBeInTheDocument();
    expect(screen.getByText(/Printed total on the 2025 area statement/)).toBeInTheDocument();
  });

  it("shows each candidate's source document and page when supplied", () => {
    panel(conflictedItem);
    expect(screen.getByText(/area-statement\.pdf p\.1/)).toBeInTheDocument();
  });

  it("tells the reviewer no value has been chosen yet", () => {
    panel(conflictedItem);
    expect(screen.getByText(/No value has been chosen/i)).toBeInTheDocument();
  });

  it("surfaces the conflict in the Review required banner", () => {
    panel(conflictedItem);
    expect(screen.getByText(/Conflicting sources \(2 candidates\)/)).toBeInTheDocument();
  });

  it("does not show the conflict banner for a plain pending item with no candidates", () => {
    panel(plainPendingItem);
    expect(screen.queryByText(/Conflicting sources/i)).not.toBeInTheDocument();
  });

  it("does not show the conflict banner for a normal measured item", () => {
    panel(measuredItem);
    expect(screen.queryByText(/Conflicting sources/i)).not.toBeInTheDocument();
  });
});

describe("ItemPanel — 'Use this value' stages a candidate without verifying or applying", () => {
  it("shows one 'Use this value' action per candidate", () => {
    panel(conflictedItem);
    expect(screen.getAllByText("Use this value")).toHaveLength(2);
  });

  it("clicking it opens the Edit form pre-filled with that candidate's value", () => {
    panel(conflictedItem);
    fireEvent.click(screen.getAllByText("Use this value")[0]); // the 25176 candidate
    const qtyInput = screen.getByLabelText(/Quantity \(AI:/) as HTMLInputElement;
    expect(qtyInput.value).toBe("25176");
  });

  it("switching to a different candidate updates the field to that value", () => {
    panel(conflictedItem);
    fireEvent.click(screen.getAllByText("Use this value")[0]); // 25176
    fireEvent.click(screen.getAllByText("Use this value")[1]); // 25101
    const qtyInput = screen.getByLabelText(/Quantity \(AI:/) as HTMLInputElement;
    expect(qtyInput.value).toBe("25101");
  });

  it("does NOT call onVerify, onEdit, or onFlag — it only stages a draft value", () => {
    const { mocks } = panel(conflictedItem);
    fireEvent.click(screen.getAllByText("Use this value")[0]);
    expect(mocks.onVerify).not.toHaveBeenCalled();
    expect(mocks.onEdit).not.toHaveBeenCalled();
    expect(mocks.onFlag).not.toHaveBeenCalled();
  });

  it("the reviewer must still explicitly click Save correction for it to be committed", () => {
    const { mocks } = panel(conflictedItem);
    fireEvent.click(screen.getAllByText("Use this value")[0]);
    fireEvent.click(screen.getByText("Save correction"));
    expect(mocks.onEdit).toHaveBeenCalledTimes(1);
    expect(mocks.onEdit).toHaveBeenCalledWith({ quantity: 25176 });
  });

  it("has no 'Use this value' action when there are no candidates", () => {
    panel(plainPendingItem);
    expect(screen.queryByText("Use this value")).not.toBeInTheDocument();
  });
});
