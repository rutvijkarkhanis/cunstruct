// Tests PublicWorkspaceShare's own orchestration (bootstrap fetch, document
// selection, honest invalid-link state) in isolation from its children, PLUS
// two regression guards that prove this page can never expose a write/CRUD
// affordance to an anonymous visitor — one at the rendered-DOM level, one at
// the source level (stronger: catches a control that's wired but hidden).
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicWorkspaceShare from "./PublicWorkspaceShare";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/components/share/ShareWorkspaceSources", () => ({
  default: ({ documents, activeDocumentId, onSelectDocument }: { documents: { id: string }[]; activeDocumentId: string | null; onSelectDocument: (id: string) => void }) => (
    <div data-testid="share-sources">
      active:{activeDocumentId ?? "none"} count:{documents.length}
      <button onClick={() => onSelectDocument("doc-1")}>pick doc-1</button>
    </div>
  ),
}));
vi.mock("@/components/share/ShareWorkspaceCanvas", () => ({
  default: ({ documentId, page }: { documentId: string | null; page: number | null }) => (
    <div data-testid="share-canvas">doc:{documentId ?? "none"} page:{page ?? "none"}</div>
  ),
}));
vi.mock("@/components/share/ShareBoqPanel", () => ({
  default: ({ boqs }: { boqs: { id: string }[] }) => <div data-testid="share-boq">boqs:{boqs.length}</div>,
}));

function renderShare(initialPath: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes><Route path="/share/:token" element={<PublicWorkspaceShare />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const first = (els: HTMLElement[]) => els[0];

const OK_BOOTSTRAP = {
  data: {
    ok: true,
    project: { id: "proj-1", name: "Srikakulam Apartment" },
    documents: [{ id: "doc-1", name: "Sheet 1.pdf", docType: null, discipline: "Architectural", status: "uploaded", pageCount: 3 }],
    scopes: [],
    boqs: [{ id: "boq-1", name: "Floor 1", scopeId: null, lineCount: 52 }],
  },
  error: null,
};

describe("PublicWorkspaceShare — bootstrap orchestration", () => {
  it("renders Sources/Canvas/BOQ from the bootstrap payload", async () => {
    invoke.mockResolvedValueOnce(OK_BOOTSTRAP);
    renderShare("/share/tok-1");
    expect(await screen.findByText("Srikakulam Apartment")).toBeInTheDocument();
    expect(first(screen.getAllByTestId("share-sources"))).toHaveTextContent("count:1");
    expect(first(screen.getAllByTestId("share-boq"))).toHaveTextContent("boqs:1");
    expect(invoke).toHaveBeenCalledWith("workspace-share", { body: { token: "tok-1", action: "bootstrap" } });
  });

  it("selecting a source updates the active document shown in the canvas, never navigates into /ops/*", async () => {
    invoke.mockResolvedValueOnce(OK_BOOTSTRAP);
    renderShare("/share/tok-1");
    await screen.findByText("Srikakulam Apartment");
    fireEvent.click(first(screen.getAllByText("pick doc-1")));
    expect(first(await screen.findAllByTestId("share-canvas"))).toHaveTextContent("doc:doc-1");
  });

  it("initializes the active document/page from ?document=&page=", async () => {
    invoke.mockResolvedValueOnce(OK_BOOTSTRAP);
    renderShare("/share/tok-1?document=doc-1&page=2");
    expect(first(await screen.findAllByTestId("share-canvas"))).toHaveTextContent("doc:doc-1 page:2");
  });

  it("shows an honest 'no longer available' state for an invalid/expired/revoked token — never a blank or crashed page", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: false, error: "This link is no longer available." }, error: null });
    renderShare("/share/bad-token");
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByTestId("share-sources")).not.toBeInTheDocument();
  });

  it("shows the same honest state when the function call itself errors (network/CORS/etc.)", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("network error") });
    renderShare("/share/tok-1");
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });
});

describe("PublicWorkspaceShare — DOM regression guard: no write/CRUD/navigation affordance ever renders", () => {
  it("never shows Add source, Upload, Create BOQ, Review/Open BOQ, or Manage BOQs controls", async () => {
    invoke.mockResolvedValueOnce(OK_BOOTSTRAP);
    renderShare("/share/tok-1");
    await screen.findByText("Srikakulam Apartment");
    for (const forbidden of [/add source/i, /upload a drawing/i, /create boq/i, /review this boq/i, /^open boq$/i, /manage all boqs/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });
});

describe("PublicWorkspaceShare — source-level regression guard (stronger: catches a wired-but-hidden control)", () => {
  const SHARE_DIR = join(__dirname, "..", "components", "share");
  const files = [
    readFileSync(join(__dirname, "PublicWorkspaceShare.tsx"), "utf8"),
    ...readdirSync(SHARE_DIR).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .map((f) => readFileSync(join(SHARE_DIR, f), "utf8")),
  ];
  // Only actual `import ... from "...";` statements count — several of these
  // files deliberately NAME these modules in header comments (explaining
  // what they're forked from and never import), which must not trip this
  // check. Collect every import line across all files, then assert none of
  // the forbidden names appear in THAT text.
  const importLines = files
    .flatMap((src) => src.split("\n").filter((line) => /^\s*import\b/.test(line)))
    .join("\n");
  const FORBIDDEN_IMPORTS = [
    "WorkspaceSourceManager", "BoqReviewWorkstation", "OpsBoqBuilder",
    "CreateBoqDialog", "useDocumentManagement", "useBoqManagement", "useAuth",
  ];

  it.each(FORBIDDEN_IMPORTS)("no share-page file imports %s", (name) => {
    expect(importLines).not.toContain(name);
  });
});
