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
import { render, screen, fireEvent, within } from "@testing-library/react";
import PdfEvidenceViewer from "./PdfEvidenceViewer";
import type { AnalysisSource, ClaimType } from "@/lib/review/analysisSchemaV1";

vi.mock("pdfjs-dist/build/pdf.worker.min?url", () => ({ default: "worker-url" }));

const PAGE_SIZE = { width: 595, height: 842 };
const NUM_PAGES = 9;

// Page 6 (unused by any other test in this file) simulates a page with a
// 90° rotation: pdf.js's getViewport({scale}) always reports the RENDERED
// (rotation-applied) size, so a rotated page's width/height come back
// swapped relative to the document's other, unrotated pages.
const ROTATED_PAGE = 6;
const ROTATED_PAGE_SIZE = { width: 842, height: 595 };

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: NUM_PAGES,
      getPage: async (n: number) => {
        const size = n === ROTATED_PAGE ? ROTATED_PAGE_SIZE : PAGE_SIZE;
        return {
          getViewport: ({ scale }: { scale: number }) => ({ width: size.width * scale, height: size.height * scale }),
          render: () => ({ promise: Promise.resolve() }),
        };
      },
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

function Viewer({ src, selectedClaim, selectedClaimValue, documentName, pageTitles }: {
  src: AnalysisSource; selectedClaim: ClaimType | null; selectedClaimValue?: string | null; documentName?: string | null;
  pageTitles?: Record<string, string> | null;
}) {
  return (
    <PdfEvidenceViewer
      fileUrl="https://signed.example/drawing.pdf"
      source={src}
      selectedClaim={selectedClaim}
      selectedClaimValue={selectedClaimValue}
      documentName={documentName}
      pageTitles={pageTitles}
    />
  );
}

// Scopes a text lookup to the evidence-overlay layer specifically, since the
// context banner (P0-1) can legitimately show the same evidence label text
// separately — these two are not the same claim ("is this box rendered on
// the page" vs. "does the banner describe this evidence"), so a global
// screen.findByText would be ambiguous once both are present.
async function overlays() {
  return within(await screen.findByTestId("evidence-overlays"));
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
    expect(await (await overlays()).findByText("Synthetic schedule row (qty)")).toBeInTheDocument();
    expect((await overlays()).queryByText("W1 plan view")).toBeNull();
  });

  it("existing page-5 general evidence still works", async () => {
    render(<Viewer src={source} selectedClaim={null} />);

    expect(await screen.findByText(`5 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await (await overlays()).findByText("W1 plan view")).toBeInTheDocument();
  });

  it("claim filtering still works (only the selected claim's box renders, not all three)", async () => {
    render(<Viewer src={source} selectedClaim="dimension" />);

    expect(await screen.findByText(`8 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await (await overlays()).findByText("Synthetic schedule row (dim)")).toBeInTheDocument();
    expect((await overlays()).queryByText("Synthetic schedule row (qty)")).toBeNull();
    expect((await overlays()).queryByText("Synthetic schedule row (spec)")).toBeNull();
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

  it("selecting a claim whose only evidence has no resolvable page does not navigate and never places the box on the page", async () => {
    render(<Viewer src={sourceWithUnresolvablePage} selectedClaim="location" />);
    // Nothing to navigate to (no box.page, no source.page) — stays on the default page 1.
    expect(await screen.findByText(`1 / ${NUM_PAGES}`)).toBeInTheDocument();
    // The overlay layer never renders it, even though it "exists" for this claim.
    expect((await overlays()).queryByText("Synthetic no-page evidence")).toBeNull();
    // P0-5: explicit, not silent — the context banner still names the evidence
    // it knows about, distinguishing "we have data but no page" from "nothing at all".
    expect(await screen.findByText("Synthetic no-page evidence")).toBeInTheDocument();
  });
});

describe("PdfEvidenceViewer — rotation robustness", () => {
  // Generic fixture: a plan-style region on a page whose own reported size is
  // rotated (842×595) relative to this document's other, unrotated pages
  // (595×842).
  const sourceRotatedPage: AnalysisSource = {
    document: "generic-drawing.pdf",
    page: ROTATED_PAGE,
    evidence: [
      { page: ROTATED_PAGE, bbox: [700, 50, 800, 150], claim: "general", label: "Rotated-page region" },
    ],
  };

  it("uses the rotated page's OWN reported dimensions, not a fixed default, when scaling evidence", async () => {
    // A declared pageSize at exactly 2x the rotated page's true native size
    // (842×595 → 1684×1190) makes the overlay math discriminating: at
    // scale 1 (jsdom's clientWidth is 0, so fit-to-evidence never fires),
    // sx = pageBase.width / space.width. If pageBase correctly holds this
    // page's own rotated dimensions (842×595), sx = sy = 0.5 exactly. If a
    // caching/refetch bug left pageBase on the document's OTHER (unrotated,
    // 595×842) page size instead, sx ≈ 0.3533 and sy ≈ 0.7077 — a clearly
    // different, wrong result. This is the same declared-pageSize-vs-actual
    // relationship real analyses use when coordinates are captured at a
    // different DPI than the PDF's native points.
    const sourceWithDeclaredSpace: AnalysisSource = {
      ...sourceRotatedPage,
      pageSize: { width: 1684, height: 1190 },
      evidence: [{ page: ROTATED_PAGE, bbox: [700, 400, 900, 500], claim: "general", label: "Rotated-page region" }],
    };
    render(<Viewer src={sourceWithDeclaredSpace} selectedClaim={null} />);

    expect(await screen.findByText(`${ROTATED_PAGE} / ${NUM_PAGES}`)).toBeInTheDocument();
    const label = await screen.findByText("Rotated-page region");
    const box = label.parentElement as HTMLElement;
    expect(parseFloat(box.style.left)).toBeCloseTo(350, 1);  // 700 * (842/1684)
    expect(parseFloat(box.style.top)).toBeCloseTo(200, 1);   // 400 * (595/1190)
    expect(parseFloat(box.style.width)).toBeCloseTo(100, 1); // (900-700) * 0.5
    expect(parseFloat(box.style.height)).toBeCloseTo(50, 1); // (500-400) * 0.5
  });

  it("warns (without blocking or auto-correcting) when a declared pageSize looks rotated relative to the PDF's actual page", async () => {
    const sourceWithMismatchedPageSize: AnalysisSource = {
      ...sourceRotatedPage,
      // Declared as if the page were the document's default (unrotated)
      // orientation, but page 6 actually reports the swapped, rotated size.
      pageSize: { width: 595, height: 842 },
    };
    render(<Viewer src={sourceWithMismatchedPageSize} selectedClaim={null} />);

    expect(await screen.findByText(`${ROTATED_PAGE} / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText(/looks rotated/i)).toBeInTheDocument();
    // Still renders the evidence it was given — a warning, never a silent fix.
    expect(await screen.findByText("Rotated-page region")).toBeInTheDocument();
  });

  it("does not warn when the declared pageSize matches the PDF's actual page orientation", async () => {
    const sourceConsistent: AnalysisSource = {
      ...sourceRotatedPage,
      pageSize: { width: 842, height: 595 }, // matches ROTATED_PAGE_SIZE
    };
    render(<Viewer src={sourceConsistent} selectedClaim={null} />);

    expect(await screen.findByText(`${ROTATED_PAGE} / ${NUM_PAGES}`)).toBeInTheDocument();
    await screen.findByText("Rotated-page region");
    expect(screen.queryByText(/looks rotated/i)).toBeNull();
  });
});

describe("PdfEvidenceViewer — evidence context banner (P0-1)", () => {
  it("shows a neutral prompt when no claim is selected", async () => {
    render(<Viewer src={source} selectedClaim={null} />);
    expect(await screen.findByText("Select an Evidence link to inspect the drawing source.")).toBeInTheDocument();
    expect(screen.queryByText(/^Claim:/)).toBeNull();
  });

  it("shows claim, value, evidence source, and page once a claim is selected", async () => {
    render(<Viewer src={source} selectedClaim="quantity" selectedClaimValue="7 nos" />);

    expect(await screen.findByText(`8 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(screen.getByText("Claim:").parentElement).toHaveTextContent("Claim: Quantity");
    expect(screen.getByText("Value:").parentElement).toHaveTextContent("Value: 7 nos");
    expect(screen.getByText("Evidence source:").parentElement).toHaveTextContent("Evidence source: Synthetic schedule row (qty)");
    expect(screen.getByText("Page:").parentElement).toHaveTextContent("Page: 8");
  });

  it("falls back to the resolved document name when the evidence region has no label of its own", async () => {
    const sourceNoLabel: AnalysisSource = {
      document: "generic-drawing.pdf",
      page: 5,
      evidence: [{ page: 5, bbox: [0, 0, 10, 10], claim: "location" }],
    };
    render(<Viewer src={sourceNoLabel} selectedClaim="location" selectedClaimValue="Ground Floor" documentName="Ground Floor Plan" />);

    expect(screen.getByText("Evidence source:").parentElement).toHaveTextContent("Evidence source: Ground Floor Plan");
  });

  it("shows 'unavailable' rather than a guessed name when no label or document name exists", async () => {
    const sourceNoLabel: AnalysisSource = {
      document: "generic-drawing.pdf",
      page: 5,
      evidence: [{ page: 5, bbox: [0, 0, 10, 10], claim: "location" }],
    };
    render(<Viewer src={sourceNoLabel} selectedClaim="location" documentName={null} />);

    expect(screen.getByText("Evidence source:").parentElement).toHaveTextContent("Evidence source: unavailable");
  });
});

describe("PdfEvidenceViewer — sheet identity (page title)", () => {
  // Verified directly against the real Srikakulam PDF (9 pages) — see the
  // full page-by-page map in evidenceDisplay.test.ts. Deliberately left
  // sparse (no entry for page 2) to exercise the no-title fallback below.
  const srikakulamPageTitles: Record<string, string> = {
    "1": "STILT FLOOR PLAN",
    "5": "BRICKWORK DRAWING / GROUND FLOOR PLAN",
    "8": "DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN",
    "9": "DOOR/WINDOW SCHEDULE / TYPICAL FLOOR PLAN (1st, 2nd, 3rd & 4th)",
  };

  it("shows the current page's title alongside its position when known (p.5)", async () => {
    render(<Viewer src={source} selectedClaim={null} pageTitles={srikakulamPageTitles} />);
    expect(await screen.findByText(`5 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("BRICKWORK DRAWING / GROUND FLOOR PLAN")).toBeInTheDocument();
    expect(await screen.findByText("Sheet 5 of 9")).toBeInTheDocument();
  });

  it("updates the sheet identity when navigation moves to a different titled page (p.8)", async () => {
    render(<Viewer src={source} selectedClaim="quantity" pageTitles={srikakulamPageTitles} />);
    expect(await screen.findByText(`8 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("DOOR/WINDOW SCHEDULE / GROUND FLOOR PLAN")).toBeInTheDocument();
    expect(await screen.findByText("Sheet 8 of 9")).toBeInTheDocument();
    // The old page-5 title must not linger.
    expect(screen.queryByText("BRICKWORK DRAWING / GROUND FLOOR PLAN")).toBeNull();
  });

  it("shows only the bare position — never an invented title — for a page with no title entry", async () => {
    render(<Viewer src={source} selectedClaim={null} pageTitles={srikakulamPageTitles} />);
    expect(await screen.findByText(`5 / ${NUM_PAGES}`)).toBeInTheDocument();

    // Page 5 -> 6 -> ... has no entry for page 2 in this fixture; navigate
    // there directly isn't exposed, so instead confirm the no-title case via
    // a page that genuinely has none: none of pages 2-4, 6-7 are populated.
    fireEvent.click(screen.getByTitle("Next page")); // 5 -> 6
    expect(await screen.findByText(`6 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("Sheet 6 of 9")).toBeInTheDocument();
    // No title text rendered for the untitled page.
    expect(screen.queryByText("BRICKWORK DRAWING / GROUND FLOOR PLAN")).toBeNull();
    expect(screen.queryByText(/STILT FLOOR PLAN|DOOR\/WINDOW SCHEDULE/)).toBeNull();
  });

  it("shows only 'Sheet N of M' when pageTitles is absent entirely", async () => {
    render(<Viewer src={source} selectedClaim={null} />);
    expect(await screen.findByText(`5 / ${NUM_PAGES}`)).toBeInTheDocument();
    expect(await screen.findByText("Sheet 5 of 9")).toBeInTheDocument();
  });
});
