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

// jsdom has no ResizeObserver; the coordinate-plot fallback (EvidenceViewer)
// uses one to size itself. Only exercised by the re-link-reactivity tests
// below, which render the unresolved (fallback) state on purpose.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

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

describe("ResolvedEvidenceViewer — re-link reactivity (Srikakulam evidence-resolution fix)", () => {
  // Reproduces the reported bug: an item whose source.documentId doesn't match
  // any stored drawing (a stale id / pre-mapping-infra run) falls back to the
  // coordinate-plot viewer. Re-linking sets resolvedDocumentId on the run —
  // this proves the viewer picks that up immediately on the next render, with
  // no re-import and no leaving the workstation, since `resolved` is a
  // useMemo keyed on resolvedDocumentId.
  const unlinkedItem: StoredReviewItem = {
    ...w1Item,
    ai: { ...w1Item.ai, source: { ...w1Item.ai.source!, documentId: "doc-does-not-exist", document: undefined } },
  };

  it("shows the coordinate-plot fallback (not the PDF viewer) while unresolved", async () => {
    render(<ResolvedEvidenceViewer item={unlinkedItem} drawings={drawings} resolvedDocumentId={null} selectedClaim={null} />);
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();
    expect(await screen.findByText(/stored in Cunstruct yet/)).toBeInTheDocument();
  });

  it("switches to the real PDF viewer as soon as resolvedDocumentId is set to the correct drawing, without remounting the item", async () => {
    const { rerender } = render(
      <ResolvedEvidenceViewer item={unlinkedItem} drawings={drawings} resolvedDocumentId={null} selectedClaim={null} />,
    );
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();

    // Simulates handleRelink's setResolvedDocumentId(docId) after a successful
    // updateResolvedDocument write — same item, same drawings, only the
    // run-level override changes.
    rerender(<ResolvedEvidenceViewer item={unlinkedItem} drawings={drawings} resolvedDocumentId="doc-1" selectedClaim={null} />);

    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer).toBeInTheDocument();
    expect(screen.queryByText(/stored in Cunstruct yet/)).toBeNull();
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

// ── PR 2 — item-level review trustworthiness ────────────────────────────────────

describe("ItemPanel — Edit form: Specification field, pre-filled values (items 1 & 2)", () => {
  it("has 5 editable AI-value fields, including Specification (not 4)", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    expect(screen.getByLabelText(/Specification \(AI: UPVC\)/)).toBeInTheDocument();
  });

  it("pre-fills every field with the current AI value instead of starting blank", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    expect(screen.getByLabelText(/Quantity \(AI: 7\)/)).toHaveValue(7);
    expect(screen.getByLabelText(/Unit \(AI: nos\)/)).toHaveValue("nos");
    expect(screen.getByLabelText(/^Dimension/)).toHaveValue("6' × 6'9\"");
    expect(screen.getByLabelText(/Specification \(AI: UPVC\)/)).toHaveValue("UPVC");
    expect(screen.getByLabelText(/^Location/)).toHaveValue("Ground Floor");
  });

  it("pre-fills with the reviewer's own override, not the AI value, once the item is EDITED", () => {
    const edited: StoredReviewItem = { ...w1Item, reviewStatus: "EDITED", reviewer: { specification: "Aluminium" } };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={edited} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    expect(screen.getByLabelText(/Specification \(AI: UPVC\)/)).toHaveValue("Aluminium");
  });

  it("saving a Specification-only correction calls onEdit with just that field", () => {
    const onEdit = vi.fn();
    render(<ItemPanel {...itemPanelProps(vi.fn())} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText(/Specification \(AI: UPVC\)/), { target: { value: "Aluminium" } });
    fireEvent.click(screen.getByRole("button", { name: /Save correction/ }));
    expect(onEdit).toHaveBeenCalledWith({ specification: "Aluminium" });
  });
});

describe("ItemPanel — sticky action controls (items 3 & 4)", () => {
  it("the idle Verify/Edit/Flag/Mark Pending row is sticky to the bottom", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    const row = screen.getByRole("button", { name: /Verify/ }).closest("div");
    expect(row?.className).toMatch(/sticky/);
    expect(row?.className).toMatch(/bottom-0/);
  });

  it("Save/Cancel inside an open Edit form are sticky", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    const row = screen.getByRole("button", { name: /Save correction/ }).closest("div");
    expect(row?.className).toMatch(/sticky/);
  });

  it("Save/Cancel inside an open Flag form are sticky", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    fireEvent.click(screen.getByRole("button", { name: /^Flag$/ }));
    const row = screen.getByRole("button", { name: /Save flag/ }).closest("div");
    expect(row?.className).toMatch(/sticky/);
  });

  // Regression guard: `position: sticky` only has room to operate within its
  // OWN immediate parent's box. An earlier version of this fix nested the
  // sticky Save/Cancel row inside the small bordered form box, which has the
  // right className but silently does nothing — caught only by measuring
  // real layout in a browser, not by the className assertions above. These
  // tests fail if that nesting mistake is ever reintroduced.
  it("the Edit form's Save/Cancel row is a DOM sibling of the bordered field box, never nested inside it", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    const formBox = screen.getByText(/Edit — AI values/).closest(".border.rounded.p-3");
    const stickyRow = screen.getByRole("button", { name: /Save correction/ }).closest(".sticky");
    expect(formBox).not.toBeNull();
    expect(stickyRow).not.toBeNull();
    expect(formBox!.contains(stickyRow!)).toBe(false);
    expect(stickyRow!.parentElement).toBe(formBox!.parentElement);
  });

  it("the Flag form's Save/Cancel row is a DOM sibling of the bordered field box, never nested inside it", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    fireEvent.click(screen.getByRole("button", { name: /^Flag$/ }));
    const formBox = screen.getByPlaceholderText("Optional note").closest(".border.rounded.p-3");
    const stickyRow = screen.getByRole("button", { name: /Save flag/ }).closest(".sticky");
    expect(formBox).not.toBeNull();
    expect(stickyRow).not.toBeNull();
    expect(formBox!.contains(stickyRow!)).toBe(false);
    expect(stickyRow!.parentElement).toBe(formBox!.parentElement);
  });
});

describe("ItemPanel — keyboard shortcuts never fire while a form is open (item 5)", () => {
  it("pressing 'v' while Edit is open does not call onVerify", () => {
    const onVerify = vi.fn();
    render(<ItemPanel {...itemPanelProps(vi.fn())} onVerify={onVerify} keyboardEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    fireEvent.keyDown(window, { key: "v" });
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("pressing 'p' while Flag is open does not call onPending", () => {
    const onPending = vi.fn();
    render(<ItemPanel {...itemPanelProps(vi.fn())} onPending={onPending} keyboardEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /^Flag$/ }));
    fireEvent.keyDown(window, { key: "p" });
    expect(onPending).not.toHaveBeenCalled();
  });
});

describe("ItemPanel — Escape cancels an open form (item 6)", () => {
  it("Escape closes the Edit form", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} keyboardEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    expect(screen.getByRole("button", { name: /Save correction/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /Save correction/ })).toBeNull();
  });

  it("Escape closes the Flag form", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} keyboardEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /^Flag$/ }));
    expect(screen.getByRole("button", { name: /Save flag/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /Save flag/ })).toBeNull();
  });

  it("Escape is a no-op when no form is open", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} keyboardEnabled />);
    expect(() => fireEvent.keyDown(window, { key: "Escape" })).not.toThrow();
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeInTheDocument();
  });
});

describe("ItemPanel — Verify disabled for PENDING/quantity-less items (item 7)", () => {
  const pendingItem: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, quantity: null, aiStatus: "PENDING" } };

  it("disables the Verify button", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={pendingItem} />);
    expect(screen.getByRole("button", { name: /Verify/ })).toBeDisabled();
  });

  it("the 'v' shortcut does not verify a PENDING item", () => {
    const onVerify = vi.fn();
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={pendingItem} onVerify={onVerify} keyboardEnabled />);
    fireEvent.keyDown(window, { key: "v" });
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("Edit, Flag, and Mark Pending remain fully available", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={pendingItem} />);
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Flag$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Mark Pending/ })).toBeEnabled();
  });
});

describe("ItemPanel — 'Review required' risk banner (item 8)", () => {
  it("shows no banner for a routine, high-confidence, measured item with evidence", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    expect(screen.queryByText(/Review required/)).toBeNull();
  });

  it("shows 'Review required — Low confidence' for a low-confidence item", () => {
    const lowConf: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, confidence: 0.3 } };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={lowConf} />);
    expect(screen.getByText(/Review required/)).toBeInTheDocument();
    expect(screen.getByText(/Low confidence/)).toBeInTheDocument();
  });

  it("names multiple applicable reasons together", () => {
    const item: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, aiStatus: "INFERRED" }, duplicateOf: "W0" };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={item} />);
    // "Possible duplicate" also appears in the separate "of W0" line — the
    // banner itself is the one combining both reasons in one place.
    expect(screen.getByText(/Review required/).closest("div")?.textContent).toContain("Possible duplicate · Inferred");
  });

  it("color-codes the AI status and Confidence fields for risky values", () => {
    const item: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, aiStatus: "INFERRED", confidence: 0.3 } };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={item} />);
    expect(screen.getByText("INFERRED").className).toMatch(/amber/);
    expect(screen.getByText("30%").className).toMatch(/rose/);
  });
});

describe("ItemPanel — verification gate for critical items with evidence (item 9)", () => {
  it("a routine, non-critical item has Verify enabled immediately — no slowdown", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />);
    expect(screen.getByRole("button", { name: /Verify/ })).toBeEnabled();
  });

  it("a critical item WITH evidence starts with Verify disabled, until an evidence link is opened", () => {
    const lowConf: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, confidence: 0.3 } };
    const onSelectClaim = vi.fn();
    render(<ItemPanel {...itemPanelProps(onSelectClaim)} item={lowConf} />);
    expect(screen.getByRole("button", { name: /Verify/ })).toBeDisabled();

    fireEvent.click(screen.getAllByText(/^Evidence ·/)[0]);
    expect(onSelectClaim).toHaveBeenCalled(); // the underlying selection still works
    expect(screen.getByRole("button", { name: /Verify/ })).toBeEnabled();
  });

  it("a critical item with NO evidence at all is never dead-ended", () => {
    const noEvidence: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, confidence: 0.3, source: { document: "d", evidence: [] } } };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={noEvidence} />);
    expect(screen.getByRole("button", { name: /Verify/ })).toBeEnabled();
  });

  it("the 'v' shortcut respects the evidence gate", () => {
    const onVerify = vi.fn();
    const lowConf: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, confidence: 0.3 } };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={lowConf} onVerify={onVerify} keyboardEnabled />);
    fireEvent.keyDown(window, { key: "v" });
    expect(onVerify).not.toHaveBeenCalled();
  });
});

describe("ItemPanel — unresolvable evidence is a risk, and blocks Verify (fix for the DO NOT MERGE #112 finding)", () => {
  // w1Item itself is otherwise routine (high confidence, MEASURED, no
  // duplicate) — rendering it with NO stored drawings is the only change,
  // so any risk/gating here is attributable solely to evidence resolution,
  // not to any of the other four criticalReasons() conditions.
  it("shows 'Evidence unavailable' and treats the item as critical when its evidence can't be resolved to a drawing", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} drawings={[]} />);
    expect(screen.getByText(/Review required/).closest("div")?.textContent).toContain("Evidence unavailable");
  });

  it("disables Verify with a distinct reason, not the generic 'check the evidence' message", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} drawings={[]} />);
    const verifyBtn = screen.getByRole("button", { name: /Verify/ });
    expect(verifyBtn).toBeDisabled();
    expect(verifyBtn).toHaveAttribute("title", expect.stringMatching(/source drawing isn't available/));
  });

  it("clicking the unresolvable evidence link does NOT unlock Verify — a broken link isn't usable evidence", () => {
    const onSelectClaim = vi.fn();
    render(<ItemPanel {...itemPanelProps(onSelectClaim)} drawings={[]} />);
    fireEvent.click(screen.getAllByText(/^Evidence ·/)[0]);
    expect(onSelectClaim).toHaveBeenCalled(); // selection itself still fires
    expect(screen.getByRole("button", { name: /Verify/ })).toBeDisabled(); // but Verify stays blocked
  });

  it("the 'v' shortcut respects the unresolvable-evidence gate", () => {
    const onVerify = vi.fn();
    render(<ItemPanel {...itemPanelProps(vi.fn())} drawings={[]} onVerify={onVerify} keyboardEnabled />);
    fireEvent.keyDown(window, { key: "v" });
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("a genuinely evidence-less item is still never dead-ended (unchanged from before this fix)", () => {
    const noEvidence: StoredReviewItem = { ...w1Item, ai: { ...w1Item.ai, source: { document: "d", evidence: [] } } };
    render(<ItemPanel {...itemPanelProps(vi.fn())} item={noEvidence} drawings={[]} />);
    expect(screen.getByRole("button", { name: /Verify/ })).toBeEnabled();
    expect(screen.queryByText(/Evidence unavailable/)).toBeNull();
  });

  it("a routine item with RESOLVABLE evidence remains unaffected and one-click", () => {
    render(<ItemPanel {...itemPanelProps(vi.fn())} />); // default props already resolve via `drawings`
    expect(screen.getByRole("button", { name: /Verify/ })).toBeEnabled();
    expect(screen.queryByText(/Evidence unavailable/)).toBeNull();
  });
});
