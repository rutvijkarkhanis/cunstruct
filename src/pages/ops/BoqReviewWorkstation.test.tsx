// Regression tests for the claim-evidence scope bug fixed after PR #105 merged.
//
// PR #105 introduced `selectedClaim` / `setSelectedClaim` as state on
// `BoqReviewWorkstation`, but `ItemPanel` and `ResolvedEvidenceViewer` (sibling
// functions, not closures of that component) referenced them directly without
// receiving them as props. That compiled with Vite/esbuild (no scope checking)
// and passed a mis-scoped `tsc` invocation, but threw `ReferenceError` at
// runtime: clicking any [Evidence] button crashed, and `ResolvedEvidenceViewer`
// crashed immediately for any item with a real resolved PDF file — including
// the previously-verified page-5 W1 regression case.
//
// These tests prove the fixed prop-drilled wiring: `ItemPanel` accepts
// `onSelectClaim` and calls it, `ResolvedEvidenceViewer` accepts and forwards
// `selectedClaim`, and the claim-filtering it drives still applies correctly to
// the verified page-5 bbox.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemPanel, ResolvedEvidenceViewer, ApplyToBoqDialog } from "./BoqReviewWorkstation";
import type { ApplyCandidate } from "@/lib/review/applyReview";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { StoredDrawing } from "@/lib/review/documentResolve";
import type { ClaimType } from "@/lib/review/analysisSchemaV1";
import { getEvidenceForClaim } from "@/lib/review/evidenceCoords";

// Real filtering (getEvidenceForClaim) drives the fake viewer, so these tests
// exercise the actual production filtering logic end-to-end, not a stub.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: { source?: { evidence: { bbox: number[]; page?: number; claim?: string }[] }; selectedClaim?: ClaimType | null }) => {
    const evidence = props.source?.evidence ?? [];
    const boxes = props.selectedClaim ? getEvidenceForClaim(evidence, props.selectedClaim) : evidence;
    return (
      <div data-testid="pdf-viewer" data-selected-claim={props.selectedClaim ?? ""} data-box-count={boxes.length}>
        {boxes.map((b, i) => (
          <span key={i} data-testid="evidence-box">{JSON.stringify(b.bbox)}</span>
        ))}
      </div>
    );
  },
}));

vi.mock("@/lib/review/drawingStorage", () => ({
  signedDrawingUrl: vi.fn(async () => "https://signed.example/drawing.pdf"),
}));

// W1 evidence: verified page-5 bbox (real Srikakulam PDF, PR #102) plus
// synthetic quantity/dimension/specification/location fixtures (pages 999/998,
// clearly not real PDF geometry — see src/lib/review/claimEvidence.test.ts).
const w1Item: StoredReviewItem = {
  id: "item-1",
  reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "W1",
    item: "W1 — Ground Floor Upper-Right Opening",
    quantity: 7,
    unit: "nos",
    dimension: "6' × 6'9\"",
    specification: "UPVC",
    location: "Ground Floor",
    confidence: 0.9,
    aiStatus: "MEASURED",
    source: {
      documentId: "doc-1",
      document: "test-drawing.pdf",
      page: 5,
      evidence: [
        { page: 5, bbox: [354, 133, 360, 173], claim: "general", label: "W1 plan view" },
        { page: 999, bbox: [50, 100, 450, 130], claim: "quantity", label: "Synthetic schedule row" },
        { page: 999, bbox: [50, 100, 450, 130], claim: "dimension", label: "Synthetic schedule row" },
        { page: 999, bbox: [50, 100, 450, 130], claim: "specification", label: "Synthetic schedule row" },
        { page: 998, bbox: [100, 200, 300, 220], claim: "location", label: "Synthetic location note" },
      ],
    },
  },
};

const drawings: StoredDrawing[] = [
  { documentId: "doc-1", name: "test-drawing.pdf", filePath: "proj/doc-1/rev-1.pdf", pageCount: 12 },
];

function itemPanelProps(onSelectClaim: (c: ClaimType) => void) {
  return {
    item: w1Item, index: 0, count: 1,
    onVerify: () => {}, onEdit: () => {}, onFlag: () => {}, onPending: () => {},
    onPrev: () => {}, onNext: () => {}, onSelectClaim,
    drawings, resolvedDocumentId: null,
  };
}

describe("ItemPanel — claim selection", () => {
  it("renders an evidence link for claims that have evidence, and calls onSelectClaim when clicked", () => {
    const onSelectClaim = vi.fn();
    render(<ItemPanel {...itemPanelProps(onSelectClaim)} />);

    // Quantity, Dimension, Specification, Location all have evidence in the fixture.
    const links = screen.getAllByText(/^Evidence ·/);
    expect(links).toHaveLength(4);

    fireEvent.click(links[0]);
    expect(onSelectClaim).toHaveBeenCalledWith("quantity");
  });

  it("shows the evidence source and page in the link text", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    // Quantity, dimension, and specification all share the same schedule-row region.
    expect(screen.getAllByText("Evidence · Synthetic schedule row · p.999")).toHaveLength(3);
    expect(screen.getByText("Evidence · Synthetic location note · p.998")).toBeInTheDocument();
  });

  it("shows 'No evidence attached' (not a link) for a claim with no evidence", () => {
    const bare: StoredReviewItem = {
      ...w1Item,
      ai: { ...w1Item.ai, source: { document: "test-drawing.pdf", evidence: [] } },
    };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={bare} />);
    expect(screen.queryByText(/^Evidence ·/)).toBeNull();
    expect(screen.getAllByText("No evidence attached")).toHaveLength(4);
  });
});

describe("ItemPanel — AI vs reviewer separation (P0-4)", () => {
  it("renders distinct AI result and Reviewer result sections", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    expect(screen.getByText("AI result")).toBeInTheDocument();
    expect(screen.getByText("Reviewer result")).toBeInTheDocument();
  });

  it("never implies a high AI confidence should be auto-accepted", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    expect(screen.getByText(/not a substitute for checking the evidence/i)).toBeInTheDocument();
  });

  it("keeps the AI's immutable quantity and the reviewer's edited quantity visibly separate", () => {
    const edited: StoredReviewItem = {
      ...w1Item,
      reviewStatus: "EDITED",
      reviewer: { quantity: 9 },
    };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={edited} />);

    // AI's own value (immutable, from ai.quantity) is untouched.
    expect(screen.getByTitle("7 nos")).toBeInTheDocument();
    // Reviewer's override appears separately, under "Reviewer qty".
    const reviewerQtyLabel = screen.getByText("Reviewer qty");
    expect(reviewerQtyLabel.parentElement).toHaveTextContent("9");
  });
});

describe("ResolvedEvidenceViewer — selectedClaim wiring", () => {
  it("renders the real PDF viewer without throwing when selectedClaim is null (regression: used to throw ReferenceError)", async () => {
    expect(() =>
      render(<ResolvedEvidenceViewer item={w1Item} drawings={drawings} resolvedDocumentId={null} selectedClaim={null} />),
    ).not.toThrow();
    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer).toBeInTheDocument();
  });

  it("passes selectedClaim through to PdfEvidenceViewer", async () => {
    render(<ResolvedEvidenceViewer item={w1Item} drawings={drawings} resolvedDocumentId={null} selectedClaim="quantity" />);
    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer.getAttribute("data-selected-claim")).toBe("quantity");
  });

  it("still resolves and displays the verified page-5 W1 evidence when no claim is selected (general)", async () => {
    render(<ResolvedEvidenceViewer item={w1Item} drawings={drawings} resolvedDocumentId={null} selectedClaim={null} />);
    const viewer = await screen.findByTestId("pdf-viewer");
    // No claim selected → all evidence passes through unfiltered, including the verified box.
    const boxes = await screen.findAllByTestId("evidence-box");
    expect(boxes.map((b) => b.textContent)).toContain(JSON.stringify([354, 133, 360, 173]));
    expect(viewer.getAttribute("data-box-count")).toBe("5");
  });

  it("filters to only the selected claim's evidence (claim filtering works)", async () => {
    render(<ResolvedEvidenceViewer item={w1Item} drawings={drawings} resolvedDocumentId={null} selectedClaim="location" />);
    const boxes = await screen.findAllByTestId("evidence-box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].textContent).toBe(JSON.stringify([100, 200, 300, 220]));
  });
});

describe("ItemPanel + ResolvedEvidenceViewer — end-to-end claim selection", () => {
  it("clicking a claim's [Evidence] button in ItemPanel drives ResolvedEvidenceViewer's filtering", async () => {
    function Harness() {
      const [selectedClaim, setSelectedClaim] = useState<ClaimType | null>(null);
      return (
        <>
          <ItemPanel {...itemPanelProps(setSelectedClaim)} />
          <ResolvedEvidenceViewer item={w1Item} drawings={drawings} resolvedDocumentId={null} selectedClaim={selectedClaim} />
        </>
      );
    }
    render(<Harness />);

    // Before any click: verified page-5 box plus all synthetic boxes are present (unfiltered).
    expect((await screen.findAllByTestId("evidence-box"))).toHaveLength(5);

    // AI-result field order is Quantity, Dimension, Specification, Location —
    // the 3rd evidence link is Specification.
    const specButton = screen.getAllByText(/^Evidence ·/)[2];
    fireEvent.click(specButton);

    const boxes = await screen.findAllByTestId("evidence-box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].textContent).toBe(JSON.stringify([50, 100, 450, 130]));
  });
});

describe("ApplyToBoqDialog — confirmation screen", () => {
  const candidates: ApplyCandidate[] = [
    {
      reviewItemId: "1", itemKey: "W1", itemName: "Window W1", classification: "APPLY", matchedLineId: "line-1",
      changes: [{ field: "qty", from: "9", to: "8" }], unsupportedChanges: [],
    },
    {
      reviewItemId: "2", itemKey: "W9", itemName: "Window W9", classification: "NEW_LINE", matchedLineId: null,
      changes: [{ field: "qty", from: "—", to: "4" }, { field: "unit", from: "—", to: "nos" }], unsupportedChanges: [],
      newLine: { description: "Window W9", unit: "nos", qty: 4, pending: false },
    },
    { reviewItemId: "3", itemKey: "W2", itemName: "Window W2", classification: "NO_CHANGE", matchedLineId: "line-2", changes: [], unsupportedChanges: [] },
    { reviewItemId: "4", itemKey: "W3", itemName: "Window W3", classification: "NOT_ELIGIBLE", matchedLineId: null, changes: [], unsupportedChanges: [], reason: "Flagged — resolve before applying" },
    { reviewItemId: "5", itemKey: "W4", itemName: "Window W4", classification: "CANNOT_APPLY", matchedLineId: null, changes: [], unsupportedChanges: [], reason: "Cannot apply automatically — BOQ line not found" },
  ];

  // A second fixture, isolated from `candidates` above so its extra rows don't
  // perturb the exact-count assertions those tests make.
  const candidatesWithUnsupported: ApplyCandidate[] = [
    {
      reviewItemId: "6", itemKey: "W5", itemName: "Window W5", classification: "APPLY", matchedLineId: "line-5",
      changes: [{ field: "qty", from: "3", to: "5" }], unsupportedChanges: [{ field: "specification", from: "UPVC", to: "Aluminium" }],
    },
    {
      reviewItemId: "7", itemKey: "W6", itemName: "Window W6", classification: "REVIEWED_NOT_APPLICABLE", matchedLineId: "line-6",
      changes: [], unsupportedChanges: [{ field: "dimension", from: "6x6", to: "7x7" }],
    },
  ];

  it("shows exact before → after values only for genuine apply candidates", () => {
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set(["1", "2"])} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByText("Ready to apply (2)")).toBeInTheDocument();
    expect(screen.getAllByText(/qty:/).length).toBeGreaterThan(0);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("lists NO_CHANGE items separately, inside a collapsed <details>, never as an apply candidate", () => {
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set()} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByText("No change (1)")).toBeInTheDocument();
    // Present (native <details> keeps content in the DOM) but under the
    // collapsed summary, not among the selectable "Ready to apply" rows.
    expect(screen.getByText("Window W2").closest("details")).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Window W2/ })).toBeNull();
  });

  it("lists flagged/cannot-apply items as not applied, with their reason, and never selectable", () => {
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set()} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByText("Not applied (2)")).toBeInTheDocument();
    expect(screen.getByText(/Window W3 — Flagged/)).toBeInTheDocument();
    expect(screen.getByText(/Window W4 — Cannot apply automatically/)).toBeInTheDocument();
  });

  it("Apply button is disabled with nothing selected, and reflects the selected count", () => {
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set()} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByRole("button", { name: /Apply 0 to BOQ/ })).toBeDisabled();
  });

  it("calls onToggle when a candidate checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set(["1"])} onToggle={onToggle} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    fireEvent.click(screen.getByText("Window W9").closest("label")!.querySelector("input")!);
    expect(onToggle).toHaveBeenCalledWith("2");
  });

  it("calls onApply only when clicked, never automatically", () => {
    const onApply = vi.fn();
    render(<ApplyToBoqDialog candidates={candidates} selectedIds={new Set(["1"])} onToggle={() => {}} onSelectAll={() => {}} onApply={onApply} applying={false} />);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Apply 1 to BOQ/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // Blocker 1 fix: a reviewer correction to dimension/specification/location
  // must never be silently dropped — it's disclosed, never marked "applied".
  it("discloses an unsupported field change inline on an APPLY row, alongside its qty/unit change", () => {
    render(<ApplyToBoqDialog candidates={candidatesWithUnsupported} selectedIds={new Set(["6"])} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByText("Window W5")).toBeInTheDocument();
    expect(screen.getByText("Not applied to BOQ:")).toBeInTheDocument();
    expect(screen.getByText("Specification: UPVC → Aluminium")).toBeInTheDocument();
  });

  it("lists a specification/dimension/location-only correction under 'Reviewed changes not applied to BOQ', never under 'No change'", () => {
    render(<ApplyToBoqDialog candidates={candidatesWithUnsupported} selectedIds={new Set()} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    expect(screen.getByText("Reviewed changes not applied to BOQ (1)")).toBeInTheDocument();
    expect(screen.getByText("Window W6")).toBeInTheDocument();
    expect(screen.getByText(/Dimension/)).toBeInTheDocument();
    expect(screen.getByText("6x6")).toBeInTheDocument();
    expect(screen.getByText("7x7")).toBeInTheDocument();
    // Never shown as an apply candidate, and never inside "No change" either.
    expect(screen.queryByRole("checkbox", { name: /Window W6/ })).toBeNull();
  });

  it("a REVIEWED_NOT_APPLICABLE row renders as plain text, not a selectable label/checkbox", () => {
    render(<ApplyToBoqDialog candidates={candidatesWithUnsupported} selectedIds={new Set()} onToggle={() => {}} onSelectAll={() => {}} onApply={() => {}} applying={false} />);
    const nameEl = screen.getByText("Window W6");
    const row = nameEl.parentElement!; // the row container the name and its unsupported-change lines share
    expect(row.closest("label")).toBeNull();
    expect(row.querySelector("input")).toBeNull();
  });
});
