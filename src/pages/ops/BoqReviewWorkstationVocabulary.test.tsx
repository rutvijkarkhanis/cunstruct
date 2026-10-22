// Review-outcome wording (charter §3.5, vocabulary): the review breakdown
// calls a reviewer-changed quantity "Corrected", the same word the project
// journey and the line evidence panel use, never "Edited". The stored status
// value (EDITED) is unchanged.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TypeNavigator } from "./BoqReviewWorkstation";
import { groupByCategory } from "@/lib/review/typeGrouping";
import type { StoredReviewItem } from "@/lib/review/reviewStore";
import type { ReviewSummary } from "@/lib/review/reviewQueue";

const item = (id: string, key: string, reviewStatus: StoredReviewItem["reviewStatus"]): StoredReviewItem => ({
  id, reviewStatus,
  ai: { key, item: `Window ${key}`, quantity: 2, unit: "nos", confidence: 0.9, aiStatus: "MEASURED", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } },
});
const items = [item("a", "W1", "EDITED"), item("b", "W2", "EDITED"), item("c", "W3", "VERIFIED")];
const summary: ReviewSummary = { total: 3, verified: 1, edited: 2, flagged: 0, markedPending: 0, remaining: 0, completionPct: 100 };

describe("review breakdown wording", () => {
  it("labels reviewer-changed items 'Corrected', never 'Edited'", () => {
    render(
      <TypeNavigator
        groups={groupByCategory(items)} currentId="a" onSelect={vi.fn()} reviewedCount={3} totalCount={3} completionPct={100}
        needsReviewOnly={false} onNeedsReviewOnlyChange={vi.fn()} showBreakdown onToggleBreakdown={vi.fn()} summary={summary}
        mobileOpen={false} onMobileClose={vi.fn()} drawingMode="type" selectedCategory={null} onSelectCategory={vi.fn()} onSelectAll={vi.fn()}
      />,
    );
    const label = screen.getByText("Corrected");
    expect(label.previousElementSibling?.textContent).toBe("2");
    expect(screen.queryByText("Edited")).toBeNull();
  });
});
