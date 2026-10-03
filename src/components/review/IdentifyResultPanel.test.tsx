import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import IdentifyResultPanel from "./IdentifyResultPanel";
import type { IdentificationCandidateV1 } from "@/lib/review/identifySchemaV1";

const CANDIDATE: IdentificationCandidateV1 = { label: "Door", description: "Single leaf door", confidence: 0.82, evidence: [] };

describe("IdentifyResultPanel", () => {
  it("shows a prompt to click the drawing before any point is clicked", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={false} candidates={[]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/Click anywhere on the drawing/)).toBeInTheDocument();
  });

  it("shows a loading state while a request is in flight", () => {
    render(<IdentifyResultPanel loading={true} error={null} hasPoint={true} candidates={[]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/Identifying/)).toBeInTheDocument();
  });

  it("shows an honest 'unable to identify' message for zero candidates — never a fabricated guess", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/Couldn't identify anything/)).toBeInTheDocument();
  });

  it("shows a server error message", () => {
    render(<IdentifyResultPanel loading={false} error="Something went wrong" hasPoint={true} candidates={[]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders a candidate with its label, description and confidence", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText("Door")).toBeInTheDocument();
    expect(screen.getByText("Single leaf door")).toBeInTheDocument();
    expect(screen.getByText("82% confidence")).toBeInTheDocument();
  });

  it("calls onConfirm with the candidate and index", () => {
    const onConfirm = vi.fn();
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={null} onConfirm={onConfirm} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(CANDIDATE, 0);
  });

  it("shows a confirmed acknowledgment instead of the action buttons once confirmed", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={{ index: 0, label: "Door" }} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/Confirmed as "Door"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Confirm$/i })).not.toBeInTheDocument();
  });

  it("does not show a Find Similar action before a candidate is confirmed, even when the callback is provided", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} onFindSimilar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Find Similar/i })).not.toBeInTheDocument();
  });

  it("shows Find Similar once a candidate is confirmed, when the callback is provided", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={{ index: 0, label: "Door" }} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} onFindSimilar={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Find Similar/i })).toBeInTheDocument();
  });

  it("never shows Find Similar when no callback is provided, even once confirmed — purely additive, zero behavior change for a caller that doesn't wire it", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={{ index: 0, label: "Door" }} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Find Similar/i })).not.toBeInTheDocument();
  });

  it("calls onFindSimilar when the Find Similar button is clicked", () => {
    const onFindSimilar = vi.fn();
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={{ index: 0, label: "Door" }} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} onFindSimilar={onFindSimilar} />);
    fireEvent.click(screen.getByRole("button", { name: /Find Similar/i }));
    expect(onFindSimilar).toHaveBeenCalledTimes(1);
  });

  it("lets the user change the label before confirming, never auto-saving an empty value", () => {
    const onChangeLabel = vi.fn();
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={onChangeLabel} onDismiss={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Change/i }));
    const input = screen.getByPlaceholderText("Your label");
    fireEvent.change(input, { target: { value: "Window" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChangeLabel).toHaveBeenCalledWith(CANDIDATE, 0, "Window");
  });

  it("calls onDismiss when Dismiss is clicked", () => {
    const onDismiss = vi.fn();
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[CANDIDATE]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={onDismiss} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("calls onExit when Exit is clicked", () => {
    const onExit = vi.fn();
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={false} candidates={[]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("never invents a confidence percentage when the candidate has none", () => {
    render(<IdentifyResultPanel loading={false} error={null} hasPoint={true} candidates={[{ ...CANDIDATE, confidence: null }]} confirmed={null} onConfirm={vi.fn()} onChangeLabel={vi.fn()} onDismiss={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText(/% confidence/)).not.toBeInTheDocument();
  });
});
