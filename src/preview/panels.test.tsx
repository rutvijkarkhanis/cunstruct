// The engineering preview's engine-backed tabs, on SYNTHETIC demo data only.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import EngineeringPreview from "@/pages/ops/EngineeringPreview";

const open = (tab: string) => {
  render(<MemoryRouter><EngineeringPreview /></MemoryRouter>);
  fireEvent.click(screen.getByRole("tab", { name: tab }));
};

describe("Verify queue — money-at-risk ordering", () => {
  it("lists the pending line first with no ₹ figure, then priced lines by money at risk, with the key item marked", () => {
    open("Verify queue");
    const cards = screen.getAllByRole("article");
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual([
      "Reinforcement steel", // pending: listed first, never priced
      "Brickwork above plinth", // 0.5 × ₹1,34,680
      "Excavation in foundation trenches", // 0.5 × ₹10,080
    ]);
    expect(cards[0]).toHaveTextContent("Money at risk: Not computed — quantity unknown");
    expect(cards[1]).toHaveTextContent("Money at risk: ₹67,340");
    expect(cards[1]).toHaveTextContent("Key item · 100% review");
    expect(cards[2]).not.toHaveTextContent("Key item");
    expect(screen.getByText(/left out of ₹ figures: 1 pending/)).toBeInTheDocument();
  });
});

describe("Coverage map — gaps must be resolved or excluded with a reason", () => {
  it("lists the three gap kinds, and an exclusion needs a typed reason", () => {
    open("Coverage map");
    expect(screen.getByText(/3 open · 0 resolved · 0 excluded/)).toBeInTheDocument();
    expect(screen.getByText("WC fixture symbol (legend)")).toBeInTheDocument();
    expect(screen.getByText("A-103 · Store room")).toBeInTheDocument();
    expect(screen.queryByText("A-104 · Stair core")).toBeNull(); // linked to a line
    expect(screen.getByText("Terrace waterproofing")).toBeInTheDocument();

    const excludeButtons = screen.getAllByRole("button", { name: "Exclude with reason" });
    expect(excludeButtons[0]).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason, or the line that now covers it", { selector: "#reason-legend\\:WC" }), { target: { value: "No WC in this package" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Exclude with reason" })[0]);
    expect(screen.getByText(/2 open · 0 resolved · 1 excluded/)).toBeInTheDocument();
    expect(screen.getByText(/Excluded · No WC in this package/)).toBeInTheDocument();
  });
});

describe("Sign-off sheet — sampling, blockers, never certified", () => {
  it("lists every blocker, including that the preview never certifies", () => {
    open("Sign-off sheet");
    const blockers = screen.getByRole("list", { name: "Blockers" });
    expect(within(blockers).getByText("Engineering preview: certification is never issued here")).toBeInTheDocument();
    expect(within(blockers).getByText("1 key item(s) not yet verified (100% review required)")).toBeInTheDocument();
    expect(within(blockers).getByText("1 line(s) with a pending quantity")).toBeInTheDocument();
    expect(screen.getByText("Not certified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Certification unavailable" })).toBeDisabled();
  });

  it("evaluates the sample once checked; a small pool is checked in full", () => {
    open("Sign-off sheet");
    expect(screen.getByText(/every line is checked/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "No difference (demo)" })[0]);
    expect(screen.getByText(/Upper error limit \(95%\): ₹0 — within the tolerable error/)).toBeInTheDocument();
  });
});

describe("Revision delta — computed, sorted by |Δ₹|, resets only changed lines", () => {
  it("computes deltas from revision A to the current demo state", () => {
    open("Revision delta");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Brickwork above plinth");
    expect(rows[0]).toHaveTextContent("+₹10,360");
    expect(rows[1]).toHaveTextContent("+₹1,260");
    const steel = rows.find((r) => r.textContent!.includes("Reinforcement steel"))!;
    expect(steel).toHaveTextContent("Not priced — quantity or rate unknown");
    const pcc = rows.find((r) => r.textContent!.includes("PCC below footings"))!;
    expect(pcc).toHaveTextContent("Unchanged");
  });
});
