// Tests for the reference-adoption pass: the Category/Type navigator (the
// reference's permanent Instance List, one grain up) and ItemPanel's
// Type -> Instances section. Real production functions throughout — the
// pure grouping logic (typeGrouping.ts) has its own dedicated test file;
// this covers the UI built on top of it.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TypeNavigator, ItemPanel } from "./BoqReviewWorkstation";
import { groupByCategory } from "@/lib/review/typeGrouping";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { TypeInstance } from "@/lib/review/typeInstances";
import type { LocationObservation } from "@/lib/review/locationObservations";
import type { ReviewSummary } from "@/lib/review/reviewQueue";

const w1: StoredReviewItem = {
  id: "item-w1",
  reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "W1", item: "Window W1", quantity: 6, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] },
  },
};
const w2: StoredReviewItem = {
  id: "item-w2",
  reviewStatus: "VERIFIED",
  ai: {
    key: "W2", item: "Window W2", quantity: 4, unit: "nos", confidence: 0.3, aiStatus: "MEASURED",
    source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] },
  },
};
const d1: StoredReviewItem = {
  id: "item-d1",
  reviewStatus: "PENDING_REVIEW",
  ai: { key: "D1", item: "Door D1", quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } },
};

const summary: ReviewSummary = { total: 3, verified: 1, edited: 0, flagged: 0, markedPending: 0, remaining: 2, completionPct: 33 };

function navigatorProps(overrides: Partial<Parameters<typeof TypeNavigator>[0]> = {}) {
  return {
    groups: groupByCategory([w1, w2, d1]),
    currentId: "item-w1",
    onSelect: vi.fn(),
    reviewedCount: 1,
    totalCount: 3,
    completionPct: 33,
    needsReviewOnly: false,
    onNeedsReviewOnlyChange: vi.fn(),
    showBreakdown: false,
    onToggleBreakdown: vi.fn(),
    summary,
    mobileOpen: false,
    onMobileClose: vi.fn(),
    drawingMode: "type" as const,
    selectedCategory: null,
    onSelectCategory: vi.fn(),
    onSelectAll: vi.fn(),
    ...overrides,
  };
}

describe("TypeNavigator — Category -> Type hierarchy", () => {
  it("groups distinct review items under category headers, never merging them into one row", () => {
    render(<TypeNavigator {...navigatorProps()} />);
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(screen.getByText("Doors")).toBeInTheDocument();
    // Both W1 and W2 remain distinct, selectable rows.
    expect(screen.getByText(/W1 — Window W1/)).toBeInTheDocument();
    expect(screen.getByText(/W2 — Window W2/)).toBeInTheDocument();
  });

  it("shows the real, already-extracted quantity as an instance count for a countable type", () => {
    render(<TypeNavigator {...navigatorProps()} />);
    expect(screen.getByText("6 instances")).toBeInTheDocument();
    expect(screen.getByText("4 instances")).toBeInTheDocument();
  });

  it("clicking a type row calls onSelect with that exact review item's id", () => {
    const onSelect = vi.fn();
    render(<TypeNavigator {...navigatorProps({ onSelect })} />);
    fireEvent.click(screen.getByText(/W2 — Window W2/));
    expect(onSelect).toHaveBeenCalledWith("item-w2");
  });

  it("flags the low-confidence type with a needs-attention badge on its category", () => {
    render(<TypeNavigator {...navigatorProps()} />);
    // W2 (confidence 0.3) is the one needing attention in Windows.
    expect(screen.getByText(/1 needs review/)).toBeInTheDocument();
  });

  it("'needs review only' hides an already-reviewed type from the visible list", () => {
    render(<TypeNavigator {...navigatorProps({ needsReviewOnly: true })} />);
    // W2 is VERIFIED — excluded when needsReviewOnly is on.
    expect(screen.queryByText(/W2 — Window W2/)).toBeNull();
    // W1 (PENDING_REVIEW) and D1 (PENDING_REVIEW) remain visible.
    expect(screen.getByText(/W1 — Window W1/)).toBeInTheDocument();
    expect(screen.getByText(/D1 — Door D1/)).toBeInTheDocument();
  });

  it("toggling the checkbox calls onNeedsReviewOnlyChange rather than filtering internally", () => {
    const onChange = vi.fn();
    render(<TypeNavigator {...navigatorProps({ onNeedsReviewOnlyChange: onChange })} />);
    fireEvent.click(screen.getByLabelText(/Needs review only/i, { selector: "input" }).parentElement ?? screen.getByText("Needs review only"));
    expect(onChange).toHaveBeenCalled();
  });
});

describe("TypeNavigator — Category/All selection drives the drawing (Section 6/7)", () => {
  it("clicking a category's name calls onSelectCategory with that exact category, not a merged/guessed one", () => {
    const onSelectCategory = vi.fn();
    render(<TypeNavigator {...navigatorProps({ onSelectCategory })} />);
    fireEvent.click(screen.getByText(/^Windows/));
    expect(onSelectCategory).toHaveBeenCalledWith("Windows");
    fireEvent.click(screen.getByText(/^Doors/));
    expect(onSelectCategory).toHaveBeenCalledWith("Doors");
  });

  it("clicking the chevron only expands/collapses — it never calls onSelectCategory", () => {
    const onSelectCategory = vi.fn();
    render(<TypeNavigator {...navigatorProps({ onSelectCategory })} />);
    fireEvent.click(screen.getByLabelText("Collapse Windows"));
    expect(onSelectCategory).not.toHaveBeenCalled();
    // The category's types are now hidden, but the header itself remains.
    expect(screen.queryByText(/W1 — Window W1/)).toBeNull();
    expect(screen.getByText(/^Windows/)).toBeInTheDocument();
  });

  it("renders an 'All categories' control that calls onSelectAll when clicked", () => {
    const onSelectAll = vi.fn();
    render(<TypeNavigator {...navigatorProps({ onSelectAll })} />);
    fireEvent.click(screen.getByText("All categories"));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it("highlights whichever scope is active — 'all', a category, or neither when browsing a single type", () => {
    const { rerender } = render(<TypeNavigator {...navigatorProps({ drawingMode: "all" })} />);
    expect(screen.getByText("All categories").className).toMatch(/bg-primary/);

    rerender(<TypeNavigator {...navigatorProps({ drawingMode: "category", selectedCategory: "Windows" })} />);
    expect(screen.getByText("All categories").className).not.toMatch(/bg-primary/);
  });
});

function obs(overrides: Partial<LocationObservation> & { id: string; mark: string }): LocationObservation {
  return {
    observationType: "opening", scopeHint: null, locationText: null, attributes: {},
    evidence: { evidence: [{ bbox: [0, 0, 1, 1] }], page: 3 } as LocationObservation["evidence"],
    evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function itemPanelBaseProps() {
  return {
    item: w1, index: 0, count: 1,
    onVerify: vi.fn(), onEdit: vi.fn(), onFlag: vi.fn(), onPending: vi.fn(),
    onPrev: vi.fn(), onNext: vi.fn(), onSelectClaim: vi.fn(),
    drawings: [], resolvedDocumentId: null,
  };
}

describe("ItemPanel — Type -> Instances (Section 6/7/8 of the reference-adoption plan)", () => {
  it("shows the category as a small eyebrow above the type's identity", () => {
    render(<ItemPanel {...itemPanelBaseProps()} category="Windows" />);
    expect(screen.getByText("Windows")).toBeInTheDocument();
  });

  it("an honest 'instance detail unavailable' state for a countable type with no LOCATION instances — never fabricates placements", () => {
    render(<ItemPanel {...itemPanelBaseProps()} instances={[]} />);
    expect(screen.getByText(/Instance detail unavailable/)).toBeInTheDocument();
  });

  it("never shows instance UI at all for a non-countable (measured) type", () => {
    const wall: StoredReviewItem = { id: "wall", reviewStatus: "PENDING_REVIEW", ai: { key: "WALL-EXT", item: "External wall", quantity: 128.4, unit: "sq ft", confidence: 0.8, aiStatus: "MEASURED" } };
    render(<ItemPanel {...itemPanelBaseProps()} item={wall} instances={[]} />);
    expect(screen.queryByText(/Instance detail unavailable/)).toBeNull();
    expect(screen.queryByText(/instances located on the drawing/)).toBeNull();
  });

  it("lists real LOCATION instances when they exist, one row per observation", () => {
    const instances: TypeInstance[] = [
      { observation: obs({ id: "o1", mark: "W1" }), differsFromType: false },
      { observation: obs({ id: "o2", mark: "W1" }), differsFromType: false },
    ];
    render(<ItemPanel {...itemPanelBaseProps()} instances={instances} />);
    expect(screen.getByText("2 instances located on the drawing")).toBeInTheDocument();
    expect(screen.getByText(/Instance 1/)).toBeInTheDocument();
    expect(screen.getByText(/Instance 2/)).toBeInTheDocument();
  });

  it("flags an instance that genuinely differs from its parent type's declared dimension/specification", () => {
    const instances: TypeInstance[] = [{ observation: obs({ id: "o1", mark: "W1" }), differsFromType: true }];
    render(<ItemPanel {...itemPanelBaseProps()} instances={instances} />);
    expect(screen.getByText(/differs from type/)).toBeInTheDocument();
  });

  it("clicking an instance row calls onFocusInstance with that observation's id", () => {
    const onFocusInstance = vi.fn();
    const instances: TypeInstance[] = [{ observation: obs({ id: "o1", mark: "W1" }), differsFromType: false }];
    render(<ItemPanel {...itemPanelBaseProps()} instances={instances} onFocusInstance={onFocusInstance} />);
    fireEvent.click(screen.getByText(/Instance 1/));
    expect(onFocusInstance).toHaveBeenCalledWith("o1");
  });

  it("clicking an already-focused instance row toggles it off (calls onFocusInstance with null)", () => {
    const onFocusInstance = vi.fn();
    const instances: TypeInstance[] = [{ observation: obs({ id: "o1", mark: "W1" }), differsFromType: false }];
    render(<ItemPanel {...itemPanelBaseProps()} instances={instances} focusedInstanceId="o1" onFocusInstance={onFocusInstance} />);
    fireEvent.click(screen.getByText(/Instance 1/));
    expect(onFocusInstance).toHaveBeenCalledWith(null);
  });
});
