// Verify queue (B5 logic, preview only): money-at-risk ordering from
// src/lib/preview/moneyAtRisk.ts over the demo lines.
import { formatINR, formatQuantity } from "@/design/money";
import { rankByMoneyAtRisk, REASON_LABEL } from "@/lib/preview/moneyAtRisk";
import { lineAmount } from "@/lib/preview/types";
import { statePill } from "./statePill";
import { SurfacePanel, type PreviewLine } from "./shared";

export function VerifyQueuePanel({ queue, materiality, onUpdate }: {
  queue: PreviewLine[];
  materiality: number;
  onUpdate: (id: string, update: Partial<PreviewLine>) => void;
}) {
  const { ranked, totalRiskRs, excluded } = rankByMoneyAtRisk(queue, materiality);
  return (
    <SurfacePanel
      title="Verify queue"
      description="Ordered by money at risk. Actions below update only the local preview state and are discarded when the page reloads."
    >
      <p className="text-sm text-muted-foreground">
        Money at risk = uncertainty × rate × quantity. Uncertainty is a stated assumption (unreviewed 0.5, accepted 0.1, corrected 0.05, verified 0), not a measured error rate.
        Lines at or above the materiality threshold of {formatINR(materiality)} are key items and need 100% review.
        Total illustrative money at risk: <strong>{formatINR(totalRiskRs)}</strong>
        {excluded.pending + excluded.noRate > 0 && <> · left out of ₹ figures: {excluded.pending} pending, {excluded.noRate} with no DSR match</>}.
      </p>
      <div className="overflow-hidden rounded-xl border bg-card">
        {ranked.length === 0 ? (
          <div className="p-8 text-center">
            <div className="font-medium">No demo lines awaiting review</div>
            <p className="mt-1 text-sm text-muted-foreground">Reset by reloading the page.</p>
          </div>
        ) : ranked.map(({ line: engineLine, rank, riskRs, isKey, reasons }) => {
          const line = queue.find((l) => l.id === engineLine.id)!;
          const amount = lineAmount(line);
          return (
            <article key={line.id} className="grid gap-3 border-b p-4 last:border-b-0 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">#{rank} · {line.id}</span>
                  {statePill(line.quantityState)}
                  {line.reviewState !== "needs_review" && statePill(line.reviewState)}
                  {isKey && <span className="inline-flex rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-900">Key item · 100% review</span>}
                </div>
                <h3 className="font-semibold">{line.description}</h3>
                <p className="text-sm text-muted-foreground">{line.note}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>Quantity: <strong>{line.quantityState === "pending" ? "Pending" : `${formatQuantity(line.quantity)} ${line.unit}`}</strong></span>
                  <span>Illustrative rate: <strong>{formatINR(line.rate)}</strong></span>
                  <span>Illustrative amount: <strong>{amount === null ? "Not priced — pending" : formatINR(amount)}</strong></span>
                  <span>Money at risk: <strong>{riskRs === null ? "Not computed — quantity unknown" : formatINR(riskRs)}</strong></span>
                </div>
                <ul className="flex flex-wrap gap-1 text-xs text-muted-foreground" aria-label="Reasons">
                  {reasons.map((r) => <li key={r} className="rounded border px-1.5 py-0.5">{REASON_LABEL[r]}</li>)}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button type="button" onClick={() => onUpdate(line.id, { reviewState: "accepted" })} className="rounded-md border border-emerald-300 px-3 py-2 text-sm hover:bg-emerald-50">
                  Accept in demo
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(line.id, {
                    quantity: line.quantityState === "pending" ? 1 : Math.round((line.quantity + 0.5) * 100) / 100,
                    quantityState: "established",
                    reviewState: "corrected",
                  })}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Correct in demo
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </SurfacePanel>
  );
}
