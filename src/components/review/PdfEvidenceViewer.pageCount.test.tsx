// The viewer must not state a page total before pdf.js has opened the file.
// Found live: a 4-page drawing showed "1 / 1" and "Sheet 1 of 1" for ~2s
// while it was being parsed, contradicting the list's "4p".
import { vi, describe, it, expect, beforeAll } from "vitest";
import { act, render, screen } from "@testing-library/react";
import PdfEvidenceViewer from "./PdfEvidenceViewer";

vi.mock("pdfjs-dist/build/pdf.worker.min?url", () => ({ default: "worker-url" }));
let finishLoading: (() => void) | null = null;
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  OPS: { constructPath: 0, rectangle: 1, moveTo: 2, lineTo: 3, curveTo: 4, closePath: 5 },
  getDocument: () => {
    const doc = {
      numPages: 4,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 400 * scale }),
        render: () => ({ promise: Promise.resolve() }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        getTextContent: async () => ({ items: [] }),
      }),
    };
    return { promise: new Promise((resolve) => { finishLoading = () => resolve(doc); }), destroy: () => {} };
  },
}));

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
});

describe("PdfEvidenceViewer — page total while loading", () => {
  it("shows no page total until the document is open, then the real one", async () => {
    render(<PdfEvidenceViewer fileUrl="https://signed.example/plan.pdf" source={undefined} documentName="GF Plan" />);
    expect(screen.queryByText("1 / 1")).toBeNull();
    expect(screen.queryByText(/Sheet 1 of 1/)).toBeNull();
    expect(screen.getByLabelText("Loading pages")).toHaveTextContent("– / –");
    expect(screen.getByText("Loading sheets…")).toBeInTheDocument();
    expect(screen.getByTitle("Next page")).toBeDisabled();

    await act(async () => { finishLoading!(); });
    expect(await screen.findByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText(/Sheet 1 of 4/)).toBeInTheDocument();
    expect(screen.getByTitle("Next page")).toBeEnabled();
  });
});
