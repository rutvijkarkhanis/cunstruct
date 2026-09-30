import { Check, AlertTriangle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewStatus } from "@/lib/review/reviewQueue";

export interface ReviewQueueRow {
  id: string;
  label: string;
  quantity: string;
  status: ReviewStatus;
  critical: boolean;
}

/**
 * The review queue as a real queue, not an item-by-item form with no map of
 * what's left. A compact strip: progress up top, one line per item below,
 * current item highlighted. Purely presentational — the ordering, filtering
 * and status data all come from reviewQueue.ts's existing pure functions;
 * this only renders what's already been computed.
 */
export default function ReviewQueue({ rows, currentId, onSelect, reviewedCount, totalCount }: {
  rows: ReviewQueueRow[];
  currentId?: string;
  onSelect: (id: string) => void;
  reviewedCount: number;
  totalCount: number;
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-medium">Review queue</span>
        <span className="text-xs text-muted-foreground tabular-nums">{reviewedCount} / {totalCount} reviewed</span>
      </div>
      <div className="flex overflow-x-auto lg:flex-col divide-x lg:divide-x-0 lg:divide-y max-h-none lg:max-h-64 lg:overflow-y-auto">
        {rows.map((r) => {
          const Icon = r.status === "PENDING_REVIEW" ? (r.critical ? AlertTriangle : Circle) : Check;
          const iconCls = r.status === "PENDING_REVIEW"
            ? (r.critical ? "text-amber-600" : "text-muted-foreground/60")
            : r.status === "FLAGGED" ? "text-amber-600" : "text-emerald-600";
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs text-left shrink-0 lg:shrink whitespace-nowrap lg:whitespace-normal",
                r.id === currentId ? "bg-primary/10" : "hover:bg-muted/50",
              )}
            >
              <Icon className={cn("h-3 w-3 shrink-0", iconCls)} />
              <span className="font-medium truncate max-w-[10rem] lg:max-w-none">{r.label}</span>
              <span className="text-muted-foreground tabular-nums">{r.quantity}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
