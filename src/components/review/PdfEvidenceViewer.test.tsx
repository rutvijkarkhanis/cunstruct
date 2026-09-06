// Regression tests for the claim-evidence page-navigation bug found live after
// PR #106: clicking a claim whose evidence lives on a different page than the
// item's default source page (e.g. quantity/dimension/specification on page 8
// vs. general evidence on page 5) never moved the viewer off the default page,
// and a lingering self-referential page-match fallback could make a box with
// no resolvable page appear on whatever page happened to be displayed.
//
// pdf.js is mocked entirely — jsdom has no real PDF/canvas rendering, and these
// tests exercise this component's own page-state and box-filtering logic, not
// pdf.js itself.

import { vi, describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PdfEvidenceViewer from "./PdfEvidenceViewer";
import type { AnalysisSource, ClaimType } from "@/lib/review/analysisSchemaV1";

vi.mock("pdfjs-dist/build/pdf.worker.min?url", () => ({ default: "worker-url" }));

const PAGE_SIZE = { width: 595, height: 842 };
const NUM_PAGES = 9;

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: NUM_PAGES,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: PAGE_SIZE.width * scale, height: PAGE_SIZE.height * scale }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
    destroy: () => {},
  }),
}));

beforeAll(() => {
  // jsdom has no canvas backend; pdf.js itself is mocked and never touches this
  // context, so only its truthiness (to avoid the component's "canvas
  // unavailable" error path) matters here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
});

// Verified: page-5 W1 opening, real Srikakulam PDF coordinate (PR #102) — unchanged.
// Page 8 evidence below is a clearly SYNTHETIC test fixture (like claimEvidence.test.ts's
// page 998/999 convention) — not a real, measured Srikakulam page-8 coordinate.
const source: AnalysisSource = {
  document: "test-drawing.pdf",
  page: 5,
  evidence: [
    { page: 5, bbox: [354, 133, 360, 173], claim: "general", label: "W1 plan view" },
    { page: 8, bbox: [400, 400, 500, 420], claim: "quantity", label: "Synthetic schedule row (qty)" },
    { page: 8, bbox: [400, 400, 500, 420], claim: "dimension", label: "Synthetic schedule row (dim)" },
    { page: 8, bbox: [400, 400, 500, 420], claim: "specification", label: "Synthetic schedule row (spec)" },
  ],
};

// A second fixture with NO item-level `source.page` and one evidence box with
// no `page` of its own either — the genuinely unresolvable case: nothing tells
// the viewer where this box belongs, so it must not be shown just because it
// happens to match whatever page is currently displayed.
const sourceWithUnresolvablePage: AnalysisSource = {
  document: "test-drawing.pdf",
  evidence: [
    { page: 3, bbox: [50, 50, 100, 80], claim: "general", label: "Page-3 box" },
    { bbox: [10, 10, 20, 20], claim: "location", label: "Synthetic no-page evidence" },
  ],
};

function Viewer({ src, selectedClaim }: { src: AnalysisSource; selectedClaim: ClaimType | null }) {
  return <PdfEvidenceViewer fileUrl="https://signed.example/drawing.pdf" source={src} selectedClaim={selectedClaim} />;
}

describe("PdfEvidenceViewer — claim navigation (Fix 1)", () => {
  it("navigates to page 8 when a claim whose evidence is on page 8 is selected", async () => {
    const { rerender } = render(<Viewer src={source} selectedClaim={null} />);
    expect(await screen.findByText(`5 / ${NUM_PAGES}`)).toBeInTheDocument();

    // Simulate the user clicking "Quantity → Evidence": selectedClaim changes
    // on the SAME mounted viewer, exactly as BoqReviewWorkstation does it.
    rerender(<Viewer src={source} selectedClaim="quantity" />);
    expect(await screen.findByText(`8 / ${NUM_PAGES}`)).toBeInTheDocument();
  });

  it("selects claim evidence from the full evidence array, not the currently displayed page", async () => {
    // Mount already showing page 5 (the item's default), but with "quantity"
    // selected from the start — its evidence lives on page 8, not page 5. If the
    // code looked only at the current page's already-filtered boxes, it would
    // find nothing on page 5 and never navigate.
    render(<Viewer src={source} selectedClaim="quantity" />);

    expect(await screen.findByText(`8 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("Synthetic schedule row (qty)")).toBeInTheDocument();
    expect(screen.queryByText("W1 plan view")).toBeNull();
  });

  it("existing page-5 general evidence still works", async () => {
    render(<Viewer src={source} selectedClaim={null} />);

    expect(await screen.findByText(`5 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("W1 plan view")).toBeInTheDocument();
  });

  it("claim filtering still works (only the selected claim's box renders, not all three)", async () => {
    render(<Viewer src={source} selectedClaim="dimension" />);

    expect(await screen.findByText(`8 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("Synthetic schedule row (dim)")).toBeInTheDocument();
    expect(screen.queryByText("Synthetic schedule row (qty)")).toBeNull();
    expect(screen.queryByText("Synthetic schedule row (spec)")).toBeNull();
  });
});

describe("PdfEvidenceViewer — page-filter fallback (Fix 2)", () => {
  it("a box with no page and no source.page default does not appear on the initial page", async () => {
    render(<Viewer src={sourceWithUnresolvablePage} selectedClaim={null} />);
    // No source.page declared → defaults to page 1.
    expect(await screen.findByText(`1 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic no-page evidence")).toBeNull();
  });

  it("a box with no page and no source.page default does not appear after navigating to other pages either", async () => {
    render(<Viewer src={sourceWithUnresolvablePage} selectedClaim={null} />);
    expect(await screen.findByText(`1 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic no-page evidence")).toBeNull();

    // Page 2
    fireEvent.click(screen.getByTitle("Next page"));
    expect(await screen.findByText(`2 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic no-page evidence")).toBeNull();

    // Page 3 — the OTHER (properly paged) box lives here; the pageless one must
    // still not tag along just because it coincides with a page that has evidence.
    fireEvent.click(screen.getByTitle("Next page"));
    expect(await screen.findByText(`3 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("Page-3 box")).toBeInTheDocument();
    expect(screen.queryByText("Synthetic no-page evidence")).toBeNull();
  });

  it("selecting a claim whose only evidence has no resolvable page does not navigate and never shows the box", async () => {
    render(<Viewer src={sourceWithUnresolvablePage} selectedClaim="location" />);
    // Nothing to navigate to (no box.page, no source.page) — stays on the default page 1.
    expect(await screen.findByText(`1 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic no-page evidence")).toBeNull();
  });
});
