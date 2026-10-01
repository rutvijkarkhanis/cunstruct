import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FindSimilarResultPanel, { type FindSimilarMatchState } from "./FindSimilarResultPanel";

const MATCH_A: FindSimilarMatchState = { id: "m1", label: "Door", description: "On the east wall", confidence: 0.82, evidence: [{ bbox: [1, 1, 2, 2], page: 2 }], status: "pending" };
const MATCH_B: FindSimilarMatchState = { id: "m2", label: "Door", description: "On the west wall", confidence: 0.6, evidence: [{ bbox: [3, 3, 4, 4], page: 7 }], status: "pending" };

describe("FindSimilarResultPanel", () => {
  it("shows a loading state while the search is in flight", () => {
    render(<FindSimilarResultPanel status="loading" error={null} matches={[]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/Searching the document/)).toBeInTheDocument();
  });

  it("shows a server error message", () => {
    render(<FindSimilarResultPanel status="error" error="Something went wrong" matches={[]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows an honest empty-result message — never a fabricated match", () => {
    render(<FindSimilarResultPanel status="success" error={null} matches={[]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/No similar elements found/)).toBeInTheDocument();
  });

  it("renders a single match with its label, description, confidence, and page", () => {
    render(<FindSimilarResultPanel status="success" error={null} matches={[MATCH_A]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText("Door")).toBeInTheDocument();
    expect(screen.getByText("On the east wall")).toBeInTheDocument();
    expect(screen.getByText("82% confidence")).toBeInTheDocument();
    expect(screen.getByText(/page 2/)).toBeInTheDocument();
  });

  it("renders multiple matches independently, including ones on different pages, never collapsed into one", () => {
    render(<FindSimilarResultPanel status="success" error={null} matches={[MATCH_A, MATCH_B]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText("On the east wall")).toBeInTheDocument();
    expect(screen.getByText("On the west wall")).toBeInTheDocument();
    expect(screen.getByText(/page 2/)).toBeInTheDocument();
    expect(screen.getByText(/page 7/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(2);
  });

  it("calls onConfirm with the exact match and index clicked — confirming one never affects another", () => {
    const onConfirm = vi.fn();
    render(<FindSimilarResultPanel status="success" error={null} matches={[MATCH_A, MATCH_B]} onConfirm={onConfirm} onReject={vi.fn()} onExit={vi.fn()} />);
    const confirmButtons = screen.getAllByRole("button", { name: /^Confirm$/ });
    fireEvent.click(confirmButtons[1]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(MATCH_B, 1);
  });

  it("calls onReject with the exact match and index clicked — rejecting one never affects another", () => {
    const onReject = vi.fn();
    render(<FindSimilarResultPanel status="success" error={null} matches={[MATCH_A, MATCH_B]} onConfirm={vi.fn()} onReject={onReject} onExit={vi.fn()} />);
    const rejectButtons = screen.getAllByRole("button", { name: /^Reject$/ });
    fireEvent.click(rejectButtons[0]);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(MATCH_A, 0);
  });

  it("shows a confirmed acknowledgment instead of Confirm/Reject once a match is confirmed, leaving its sibling's actions untouched", () => {
    render(
      <FindSimilarResultPanel
        status="success" error={null}
        matches={[{ ...MATCH_A, status: "confirmed" }, MATCH_B]}
        onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()}
      />,
    );
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    // MATCH_B is still pending — its own Confirm/Reject remain available.
    expect(screen.getAllByRole("button", { name: /^Confirm$/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Reject$/ })).toHaveLength(1);
  });

  it("shows a rejected acknowledgment instead of Confirm/Reject once a match is rejected", () => {
    render(
      <FindSimilarResultPanel
        status="success" error={null}
        matches={[{ ...MATCH_A, status: "rejected" }]}
        onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()}
      />,
    );
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Confirm$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reject$/ })).toBeNull();
  });

  it("never invents a confidence percentage when a match has none", () => {
    render(<FindSimilarResultPanel status="success" error={null} matches={[{ ...MATCH_A, confidence: null }]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText(/% confidence/)).not.toBeInTheDocument();
  });

  it("calls onExit when Exit is clicked", () => {
    const onExit = vi.fn();
    render(<FindSimilarResultPanel status="success" error={null} matches={[]} onConfirm={vi.fn()} onReject={vi.fn()} onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalled();
  });
});
