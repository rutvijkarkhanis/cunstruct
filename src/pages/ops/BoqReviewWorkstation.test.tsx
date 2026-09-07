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
import { ItemPanel, ResolvedEvidenceViewer } from "./BoqReviewWorkstation";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { StoredDrawing } from "@/lib/review/documentResolve";
import type { ClaimType } from "@/lib/review/analysisSchemaV1";
import { getEvidenceForClaim } from "@/lib/review/evidenceCoords";

// Real filtering (getEvidenceForClaim) drives the fake viewer, so these tests
// exercise the actual production filtering logic end-to-end, not a stub.
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: {
    source?: { evidence: { bbox: number[]; page?: number; claim?: string }[] };
    selectedClaim?: ClaimType | null;
    pageTitles?: Record<string, string> | null;
  }) => {
    const evidence = props.source?.evidence ?? [];
    const boxes = props.selectedClaim ? getEvidenceForClaim(evidence, props.selectedClaim) : evidence;
    return (
      <div
        data-testid="pdf-viewer"
        data-selected-claim={props.selectedClaim ?? ""}
        data-box-count={boxes.length}
        data-page-titles={props.pageTitles ? JSON.stringify(props.pageTitles) : ""}
      >
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
  {
    documentId: "doc-1", name: "test-drawing.pdf", filePath: "proj/doc-1/rev-1.pdf", pageCount: 12,
    // Verified against the real Srikakulam PDF — see documentResolve.test.ts.
    pageTitles: { "5": "BRICKWORK DRAWING / GROUND FLOOR PLAN", "8": "DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN" },
  },
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

  it("passes the resolved drawing's pageTitles through to PdfEvidenceViewer", async () => {
    render(<ResolvedEvidenceViewer item={w1Item} drawings={drawings} resolvedDocumentId={null} selectedClaim={null} />);
    const viewer = await screen.findByTestId("pdf-viewer");
    expect(JSON.parse(viewer.getAttribute("data-page-titles") || "{}")).toEqual({
      "5": "BRICKWORK DRAWING / GROUND FLOOR PLAN",
      "8": "DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN",
    });
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
