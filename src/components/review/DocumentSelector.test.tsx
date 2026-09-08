// DocumentSelector — never guesses a mapping; onSkip is a distinct, explicit
// "import unresolved, link later" action, separate from Cancel (abort).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DocumentSelector from "./DocumentSelector";

describe("DocumentSelector — zero drawings", () => {
  it("shows the empty state and calls onSkip (not onSelect) for 'import without linking'", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const onSkip = vi.fn();
    render(<DocumentSelector searchedFor="floor-plan.pdf" availableDrawings={[]} onSelect={onSelect} onCancel={onCancel} onSkip={onSkip} />);

    expect(screen.getByText("Analysis drawing not found")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Import without linking/));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("omits the skip button entirely when onSkip isn't provided", () => {
    render(<DocumentSelector searchedFor={null} availableDrawings={[]} onSelect={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/Import without linking/)).toBeNull();
  });
});

describe("DocumentSelector — one drawing", () => {
  const doc = { documentId: "doc-1", name: "Floor Plan", originalFilename: "floor-plan.pdf" };

  it("offers 'use this drawing' (onSelect) and skip (onSkip) as distinct actions", () => {
    const onSelect = vi.fn();
    const onSkip = vi.fn();
    render(<DocumentSelector searchedFor="x.pdf" availableDrawings={[doc]} onSelect={onSelect} onCancel={vi.fn()} onSkip={onSkip} />);

    fireEvent.click(screen.getByText("Use this drawing"));
    expect(onSelect).toHaveBeenCalledWith("doc-1");
    expect(onSkip).not.toHaveBeenCalled();
  });
});

describe("DocumentSelector — multiple drawings", () => {
  const docs = [
    { documentId: "doc-1", name: "Floor Plan", originalFilename: "floor-plan.pdf" },
    { documentId: "doc-2", name: "Site Plan", originalFilename: "site-plan.pdf" },
  ];

  it("never auto-selects — each drawing requires an explicit click, and skip is separate", () => {
    const onSelect = vi.fn();
    const onSkip = vi.fn();
    render(<DocumentSelector searchedFor="x.pdf" availableDrawings={docs} onSelect={onSelect} onCancel={vi.fn()} onSkip={onSkip} />);

    fireEvent.click(screen.getByText("Site Plan"));
    expect(onSelect).toHaveBeenCalledWith("doc-2");
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("still allows cancelling out entirely, distinct from skip", () => {
    const onCancel = vi.fn();
    render(<DocumentSelector searchedFor="x.pdf" availableDrawings={docs} onSelect={vi.fn()} onCancel={onCancel} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
