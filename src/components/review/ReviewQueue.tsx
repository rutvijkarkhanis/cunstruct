import { useState } from "react";
import { Check, AlertTriangle, Circle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewStatus } from "@/lib/review/reviewQueue";

export interface ReviewQueueRow {
  id: string;
  label: string;
  quantity: string;
  status: ReviewStatus;
  critical: boolean;
}

function statusIcon(r: ReviewQueueRow) {
  const Icon = r.status === "PENDING_REVIEW" ? (r.critical ? AlertTriangle : Circle) : Check;
  const cls = r.status === "PENDING_REVIEW"
    ? (r.critical ? "text-amber-600" : "text-muted-foreground/60")
    : r.status === "FLAGGED" ? "text-amber-600" : "text-emerald-600";
  return { Icon, cls };
}

function QueueRow({ r, current, onSelect }: { r: ReviewQueueRow; current: boolean; onSelect: (id: string) => void }) {
  const { Icon, cls } = statusIcon(r);
  return (
    <button
      onClick={() => onSelect(r.id)}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-xs text-left shrink-0 lg:shrink whitespace-nowrap lg:whitespace-normal w-full",
        current ? "bg-primary/10" : "hover:bg-muted/50",
      )}
    >
      <Icon className={cn("h-3 w-3 shrink-0", cls)} />
      <span className="font-medium truncate max-w-[10rem] lg:max-w-none">{r.label}</span>
      <span className="text-muted-foreground tabular-nums">{r.quantity}</span>
    </button>
  );
}

/**
 * The review queue as a real queue, not an item-by-item form with no map of
 * what's left. Desktop (lg+): progress header + the full list, as before.
 * Mobile: the full list would consume the primary viewport, so it collapses
 * by default into a single compact progress control ("Quantity 3 of 12 · 2
 * corrected") that expands to the same list on tap — same rows, same
 * onSelect, same underlying state; only how much of it is shown up front
 * changes. Purely presentational — ordering/filtering/status all come from
 * reviewQueue.ts's existing pure functions.
 */
export default function ReviewQueue({ rows, currentId, onSelect, reviewedCount, totalCount }: {
  rows: ReviewQueueRow[];
  currentId?: string;
  onSelect: (id: string) => void;
  reviewedCount: number;
  totalCount: number;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentIndex = rows.findIndex((r) => r.id === currentId);
  const correctedCount = rows.filter((r) => r.status === "EDITED").length;

  return (
    <div className="rounded-md border">
      {/* Desktop/tablet — unchanged: header + the full list always visible. */}
      <div className="hidden lg:flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-medium">Review queue</span>
        <span className="text-xs text-muted-foreground tabular-nums">{reviewedCount} / {totalCount} reviewed</span>
      </div>
      <div className="hidden lg:flex lg:flex-col divide-y max-h-64 overflow-y-auto">
        {rows.map((r) => <QueueRow key={r.id} r={r} current={r.id === currentId} onSelect={onSelect} />)}
      </div>

      {/* Mobile — a compact progress control, not the full queue. The current
          item is always named; the list is one tap away, never the default view. */}
      <button
        type="button"
        className="lg:hidden w-full flex items-center justify-between px-3 py-2 text-xs"
        onClick={() => setMobileOpen((o) => !o)}
        aria-expanded={mobileOpen}
      >
        <span className="font-medium">
          Quantity {currentIndex >= 0 ? currentIndex + 1 : "—"} of {totalCount}
          {correctedCount > 0 && <span className="text-muted-foreground font-normal"> · {correctedCount} corrected</span>}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", mobileOpen && "rotate-180")} />
      </button>
      {mobileOpen && (
        <div className="lg:hidden flex flex-col divide-y border-t max-h-64 overflow-y-auto">
          {rows.map((r) => (
            <QueueRow key={r.id} r={r} current={r.id === currentId} onSelect={(id) => { onSelect(id); setMobileOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}
