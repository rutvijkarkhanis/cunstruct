// M7 — Find Similar / Identify request-lifecycle and cross-document overlay
// regression tests. These reproduce the three issues from the Post-M6 Find
// Similar Review Report before exercising their fixes:
//   1) a stale Find Similar response reopening the panel after the reviewer
//      has already exited Identify mode or moved on to a newer request;
//   2) a stale Identify response (out-of-order resolution) overwriting a
//      newer one, or clearing a newer request's loading state;
//   3) an Identify highlight or Find Similar match leaking onto a different
//      document that merely happens to share a page number.
//
// Real production BoqReviewWorkstation throughout — only PdfEvidenceViewer
// (jsdom can't render a real PDF) and the network-facing modules are mocked,
// same discipline as BoqReviewWorkstationFindSimilar.test.tsx. The probe is
// extended here to also surface identifyHighlight, since the cross-document
// tests need to assert it directly.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import { identifyAtPoint } from "@/lib/ai/identifyClient";
import { findSimilar } from "@/lib/ai/findSimilarClient";
import type { StoredReviewItem } from "@/lib/review/reviewStore";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// A deferred promise — lets a test control exactly when a mocked network
// call resolves/rejects, independent of call order, so resolution order can
// be driven explicitly (the whole point of these tests).
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Two review items resolving to two DIFFERENT documents, both referencing
// page 1 — the exact shape the Post-M6 review flagged as unguarded: nothing
// before M7 stopped an overlay captured against one document from rendering
// on another purely because both have a "page 1".
const w1: StoredReviewItem = {
  id: "item-w1", reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "W1", item: "Window W1", quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { documentId: "doc-1", document: "plan-a.pdf", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }] },
  },
};
const d1: StoredReviewItem = {
  id: "item-d1", reviewStatus: "PENDING_REVIEW",
  ai: {
    key: "D1", item: "Door D1", quantity: 1, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    source: { documentId: "doc-2", document: "plan-b.pdf", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }] },
  },
};

vi.mock("@/lib/review/reviewStore", () => ({
  // resolved_document_id: null — each item resolves via its OWN
  // source.documentId instead of being forced onto one shared document, so
  // the fixture can genuinely span two documents.
  latestRunForBoq: vi.fn(async () => ({ id: "run-1", source: "json_import", item_count: 2, created_at: "2026-01-01T00:00:00Z", resolved_document_id: null })),
  loadReviewItems: vi.fn(async () => [w1, d1]),
  saveReviewDecision: vi.fn(async () => {}),
  createAnalysisRun: vi.fn(),
  updateResolvedDocument: vi.fn(),
}));

vi.mock("@/lib/review/drawingStorage", () => ({
  loadProjectDrawings: vi.fn(async () => [
    { documentId: "doc-1", name: "Plan A", filePath: "proj-1/doc-1/rev-1.pdf", pageCount: 1 },
    { documentId: "doc-2", name: "Plan B", filePath: "proj-1/doc-2/rev-1.pdf", pageCount: 1 },
  ]),
  signedDrawingUrl: vi.fn(async () => "https://signed.example/plan.pdf"),
}));

vi.mock("@/lib/review/locationObservations", () => ({
  latestLocationRunForDocument: vi.fn(async () => ({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null })),
  loadLocationObservations: vi.fn(async () => []),
}));

vi.mock("@/lib/review/applyReview", async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/applyReview")>("@/lib/review/applyReview");
  return { ...actual, applyReviewPlan: vi.fn(async () => ({ appliedCount: 0, unresolvedCount: 0, conflictedReviewItemIds: [] })) };
});

vi.mock("@/lib/ai/identifyClient", () => ({
  identifyAtPoint: vi.fn(async () => ({
    ok: true,
    result: {
      schemaVersion: "cunstruct.identify.v1",
      point: { page: 1, x: 100, y: 200 },
      candidates: [{ label: "Door", description: "Single leaf door", confidence: 0.82, evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] }],
    },
  })),
}));

vi.mock("@/lib/ai/findSimilarClient", () => ({
  findSimilar: vi.fn(async () => ({
    ok: true,
    result: {
      schemaVersion: "cunstruct.similar.v1",
      reference: { label: "Door", description: "Single leaf door", evidence: [{ bbox: [90, 190, 110, 210], page: 1 }] },
      matches: [{ label: "Door", description: "On the east wall", confidence: 0.75, evidence: [{ bbox: [10, 10, 20, 20], page: 1 }] }],
    },
  })),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "eq", "single", "order", "limit", "in"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: typeof result) => void) => resolve(result);
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "boq") return chain({ data: { id: "boq-1", name: "Test BOQ", project_id: "proj-1" }, error: null });
        if (table === "projects") return chain({ data: { id: "proj-1", name: "Test Project", project_type: null }, error: null });
        return chain({ data: [], error: null });
      },
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    },
  };
});

// Extends the usual probe with identifyHighlight, which the cross-document
// tests need to inspect directly (the result panel's own text isn't enough
// to prove what's rendered ON THE CANVAS).
vi.mock("@/components/review/PdfEvidenceViewer", () => ({
  default: (props: {
    identifyModeActive?: boolean;
    onIdentifyPoint?: (args: { page: number; point: { x: number; y: number }; nearbyText: string[] }) => void;
    identifyHighlight?: { point: { page: number; x: number; y: number } } | null;
    similarMatches?: { id: string; evidence: { page?: number }[]; status: string }[] | null;
  }) => (
    <div
      data-testid="pdf-probe"
      data-identify-active={String(!!props.identifyModeActive)}
      data-identify-highlight={JSON.stringify(props.identifyHighlight ?? null)}
      data-similar-matches={JSON.stringify(props.similarMatches ?? null)}
    >
      <button type="button" onClick={() => props.onIdentifyPoint?.({ page: 1, point: { x: 100, y: 200 }, nearbyText: [] })}>
        simulate drawing click
      </button>
    </div>
  ),
}));

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/review/boq-1"]}>
        <Routes><Route path="/review/:boqId" element={<BoqReviewWorkstation />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const identifyToggle = () => screen.getByTitle(/Click a point on the drawing to identify/);
const clickProbe = async () => fireEvent.click(await screen.findByText("simulate drawing click"));
const confirmCandidate = async (label = "Door") => {
  await screen.findByText(label);
  fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
  await screen.findByText(new RegExp(`Confirmed as "${label}"`));
};

async function getToConfirmedCandidate() {
  renderPage();
  await screen.findByRole("button", { name: /^Verify$/ });
  fireEvent.click(identifyToggle());
  await clickProbe();
  await confirmCandidate();
}

describe("M7.1/M7.4 — Find Similar lifecycle: stale-response guard", () => {
  it("a response resolving after Exit never reopens the panel", async () => {
    await getToConfirmedCandidate();
    const d = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => d.promise as Promise<ReturnType<typeof findSimilar> extends Promise<infer R> ? R : never>);

    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(screen.getByText(/Searching the document/)).toBeInTheDocument();

    // The reviewer leaves Find Similar (and Identify mode) entirely before the request settles.
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();
    // Sanity: the canvas overlay is already clear right after exiting.
    expect(JSON.parse(screen.getByTestId("pdf-probe").getAttribute("data-similar-matches") || "null")).toBeNull();

    d.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "On the east wall", confidence: 0.75, evidence: [{ bbox: [10, 10, 20, 20], page: 1 }] }] },
    });

    // Give the stale .then() a turn to run, then assert nothing changed —
    // including the drawing's own overlay prop, which (unlike the right
    // rail) isn't gated on identifyModeActive and so is the one place a
    // stale response could silently reappear without the panel "reopening"
    // in any visible sense at all.
    await waitFor(() => expect(screen.queryByText("On the east wall")).toBeNull());
    expect(screen.getByRole("button", { name: /^Verify$/ })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("false");
    expect(JSON.parse(screen.getByTestId("pdf-probe").getAttribute("data-similar-matches") || "null")).toBeNull();
  });

  it("a newer Identify click invalidates an outstanding Find Similar request — the newer flow's own results remain visible, the stale ones never appear", async () => {
    await getToConfirmedCandidate();
    const stale = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => stale.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(screen.getByText(/Searching the document/)).toBeInTheDocument();

    // A new identify click supersedes it — resetFindSimilar() invalidates the
    // outstanding request and the right rail falls back to IdentifyResultPanel.
    await clickProbe();
    await screen.findByText("Door");
    expect(screen.queryByText(/Searching the document/)).toBeNull();
    await confirmCandidate();

    const fresh = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => fresh.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));

    fresh.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "Newer match", confidence: 0.8, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] }] },
    });
    expect(await screen.findByText("Newer match")).toBeInTheDocument();

    // The OLDER request now resolves, successfully, with a different match —
    // it must never replace or sit alongside the newer, current result.
    stale.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "Stale match", confidence: 0.9, evidence: [{ bbox: [9, 9, 9, 9], page: 1 }] }] },
    });
    await waitFor(() => expect(screen.queryByText("Stale match")).toBeNull());
    expect(screen.getByText("Newer match")).toBeInTheDocument();
  });

  it("a stale request rejecting (even after a newer one already succeeded) cannot overwrite the current success state with an error", async () => {
    await getToConfirmedCandidate();
    const stale = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => stale.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));

    await clickProbe();
    await screen.findByText("Door");
    await confirmCandidate();

    const fresh = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => fresh.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    fresh.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "Current success", confidence: 0.8, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] }] },
    });
    expect(await screen.findByText("Current success")).toBeInTheDocument();

    stale.reject(new Error("stale network failure"));
    await waitFor(() => expect(screen.queryByText("stale network failure")).toBeNull());
    expect(screen.queryByText("Couldn't search the document. Please try again.")).toBeNull();
    expect(screen.getByText("Current success")).toBeInTheDocument();
  });

  it("resolving the OLDER request first (while a newer one is still pending) leaves the loading state alone — only the newer request's own resolution changes it", async () => {
    await getToConfirmedCandidate();
    const older = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => older.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));

    await clickProbe();
    await screen.findByText("Door");
    await confirmCandidate();

    const newer = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => newer.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(screen.getByText(/Searching the document/)).toBeInTheDocument();

    // The older (already-superseded) request settles first — it must not
    // flip the panel out of its loading state, since the current, newer
    // request is still pending.
    older.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "Stale match", confidence: 0.9, evidence: [{ bbox: [9, 9, 9, 9], page: 1 }] }] },
    });
    await waitFor(() => expect(screen.getByText(/Searching the document/)).toBeInTheDocument());
    expect(screen.queryByText("Stale match")).toBeNull();

    newer.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "Current match", confidence: 0.8, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] }] },
    });
    expect(await screen.findByText("Current match")).toBeInTheDocument();
    expect(screen.queryByText(/Searching the document/)).toBeNull();
  });
});

describe("M7.2/M7.4 — Identify lifecycle: out-of-order response guard", () => {
  it("two Identify requests resolved in reverse order: the most recent click's candidates win, and the stale one never appears", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());

    const first = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    const second = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(identifyAtPoint).mockImplementationOnce(() => first.promise as ReturnType<typeof identifyAtPoint>);
    vi.mocked(identifyAtPoint).mockImplementationOnce(() => second.promise as ReturnType<typeof identifyAtPoint>);

    const probe = await screen.findByText("simulate drawing click");
    fireEvent.click(probe); // request 1 (stale)
    fireEvent.click(probe); // request 2 (current)

    // Resolve the NEWER request first.
    second.resolve({ ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 100, y: 200 }, candidates: [{ label: "Door-B", confidence: 0.6, evidence: [] }] } });
    expect(await screen.findByText("Door-B")).toBeInTheDocument();

    // The OLDER request now resolves — it must never replace the current candidates.
    first.resolve({ ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 100, y: 200 }, candidates: [{ label: "Door-A", confidence: 0.6, evidence: [] }] } });
    await waitFor(() => expect(screen.queryByText("Door-A")).toBeNull());
    expect(screen.getByText("Door-B")).toBeInTheDocument();
  });

  it("exiting Identify mode while a request is pending: the eventual success cannot restore stale state", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());

    const pending = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(identifyAtPoint).mockImplementationOnce(() => pending.promise as ReturnType<typeof identifyAtPoint>);
    await clickProbe();
    expect(screen.getByText(/Identifying…/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();

    pending.resolve({ ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 100, y: 200 }, candidates: [{ label: "Stale door", confidence: 0.6, evidence: [] }] } });
    await waitFor(() => expect(screen.queryByText("Stale door")).toBeNull());
    expect(screen.getByRole("button", { name: /^Verify$/ })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-probe").getAttribute("data-identify-active")).toBe("false");

    // Re-entering Identify mode (with no new click, so hasPoint is false)
    // must not reveal whatever the stale response silently wrote into
    // identifyCandidates — IdentifyResultPanel renders its candidate list
    // whenever one is non-empty, regardless of hasPoint, so this is the
    // one place the leak would actually become visible.
    fireEvent.click(identifyToggle());
    expect(screen.queryByText("Stale door")).toBeNull();
    expect(screen.getByText(/Click anywhere on the drawing to identify what's there\./)).toBeInTheDocument();
  });

  it("exiting Identify mode while a request is pending: the eventual FAILURE also cannot restore stale state", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());

    const pending = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(identifyAtPoint).mockImplementationOnce(() => pending.promise as ReturnType<typeof identifyAtPoint>);
    await clickProbe();

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(await screen.findByRole("button", { name: /^Verify$/ })).toBeInTheDocument();

    pending.reject(new Error("stale identify failure"));
    await waitFor(() => expect(screen.queryByText("stale identify failure")).toBeNull());
    expect(screen.getByRole("button", { name: /^Verify$/ })).toBeInTheDocument();

    // Same leak check as the success case above, via the error branch.
    fireEvent.click(identifyToggle());
    expect(screen.queryByText("stale identify failure")).toBeNull();
    expect(screen.getByText(/Click anywhere on the drawing to identify what's there\./)).toBeInTheDocument();
  });

  it("a stale request's finally cannot clear a newer request's loading state", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    fireEvent.click(identifyToggle());

    const older = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    const newer = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(identifyAtPoint).mockImplementationOnce(() => older.promise as ReturnType<typeof identifyAtPoint>);
    vi.mocked(identifyAtPoint).mockImplementationOnce(() => newer.promise as ReturnType<typeof identifyAtPoint>);

    const probe = await screen.findByText("simulate drawing click");
    fireEvent.click(probe);
    fireEvent.click(probe);
    expect(screen.getByText(/Identifying…/)).toBeInTheDocument();

    // The OLDER request's own finally must not clear loading — the NEWER
    // request (still pending) still owns it.
    older.resolve({ ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 100, y: 200 }, candidates: [{ label: "Door-A", confidence: 0.6, evidence: [] }] } });
    await waitFor(() => expect(screen.getByText(/Identifying…/)).toBeInTheDocument());
    expect(screen.queryByText("Door-A")).toBeNull();

    newer.resolve({ ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 100, y: 200 }, candidates: [{ label: "Door-B", confidence: 0.6, evidence: [] }] } });
    expect(await screen.findByText("Door-B")).toBeInTheDocument();
    expect(screen.queryByText(/Identifying…/)).toBeNull();
  });
});

describe("M7.3/M7.4 — cross-document overlay isolation", () => {
  const selectW1 = () => fireEvent.click(screen.getByText(/W1 — Window W1/));
  const selectD1 = () => fireEvent.click(screen.getByText(/D1 — Door D1/));

  it("an Identify highlight captured on document A is absent once the reviewer switches to document B, and reappears on switching back", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    selectW1();
    fireEvent.click(identifyToggle());
    await clickProbe();
    await screen.findByText("Door");

    let probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-identify-highlight") || "null")).not.toBeNull();

    // Switch to document B's item — identify mode is untouched (by design,
    // navigation never exits it), but the highlight must not render here.
    selectD1();
    probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-identify-highlight") || "null")).toBeNull();

    // Switching back to document A restores it — nothing was discarded by
    // navigating away, only hidden while viewing the other document.
    selectW1();
    probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-identify-highlight") || "null")).not.toBeNull();
  });

  it("Find Similar matches found on document A never render on document B despite both having a page 1, and reappear when switching back to A", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    selectW1();
    fireEvent.click(identifyToggle());
    await clickProbe();
    await confirmCandidate();
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    await screen.findByText("On the east wall");

    let probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-similar-matches") || "null")).toHaveLength(1);

    selectD1();
    probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-similar-matches") || "null")).toBeNull();

    selectW1();
    probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-similar-matches") || "null")).toHaveLength(1);
  });

  it("resolving a pending Find Similar request AFTER switching documents never exposes its matches in the newly-selected document", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Verify$/ });
    selectW1();
    fireEvent.click(identifyToggle());
    await clickProbe();
    await confirmCandidate();

    const pending = deferred<{ ok: boolean; result?: unknown; error?: string }>();
    vi.mocked(findSimilar).mockImplementationOnce(() => pending.promise as ReturnType<typeof findSimilar>);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));

    // Switch to document B WHILE the document-A request is still in flight.
    selectD1();
    let probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-similar-matches") || "null")).toBeNull();

    pending.resolve({
      ok: true,
      result: { schemaVersion: "cunstruct.similar.v1", reference: { label: "Door", evidence: [] }, matches: [{ label: "Door", description: "Document A match", confidence: 0.8, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] }] },
    });
    // Give the resolution a turn to apply internally, then assert document
    // B still shows nothing — the response updated ephemeral state, but the
    // overlay stayed correctly scoped to the document it was captured for.
    await waitFor(() => expect(screen.queryByText("Document A match")).toBeNull());
    probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-similar-matches") || "null")).toBeNull();

    // Switching back to document A shows the match the request actually
    // found — proving the data wasn't lost, only hidden while on document B.
    selectW1();
    expect(await screen.findByText("Document A match")).toBeInTheDocument();
    probe = screen.getByTestId("pdf-probe");
    expect(JSON.parse(probe.getAttribute("data-similar-matches") || "null")).toHaveLength(1);
  });
});
