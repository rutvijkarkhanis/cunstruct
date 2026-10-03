// FIND SIMILAR RESULT PANEL — the drawing-native inspector's content while
// Find Similar is active (a sibling of IdentifyResultPanel, shown in the
// SAME right-rail slot once the reviewer triggers "Find Similar" from a
// confirmed identification). A dedicated component rather than an extension
// of IdentifyResultPanel: that component's whole shape is built around ONE
// candidate/confirmation slot (`confirmed: {index, label} | null`), while
// Find Similar needs MANY independent matches, each with its own
// Confirm/Reject state concurrently — a materially different model, not
// just a visual variant.
//
// Ephemeral by design, same discipline as IdentifyResultPanel and the
// Click-to-Identify investigation report's decision 9: Confirm/Reject are
// local UI state only, owned by the PARENT (BoqReviewWorkstation) exactly
// like IdentifyResultPanel's own confirmed/candidates — this component
// renders whatever state it's given and never persists anything itself.

import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Layers } from "lucide-react";
import AiStateBadge from "@/components/review/AiStateBadge";
import type { SimilarMatchV1 } from "@/lib/review/findSimilarSchemaV1";
import type { LocationEnrichment } from "@/lib/review/findSimilarLocationEnrichment";

/** A server-reported match plus purely local confirmation state — the
 *  server's own SimilarMatchV1 is never mutated or re-shaped, only
 *  extended with a client-only `status` field (see the Find Similar
 *  investigation report: "the server result remains immutable;
 *  confirmation/rejection is a UI concern"). */
export interface FindSimilarMatchState extends SimilarMatchV1 {
  /** A stable key for this match within one result set (index-derived —
   *  results are never reordered or spliced after arriving, only their
   *  own `status` changes), used for list rendering and canvas highlight
   *  correlation. */
  id: string;
  status: "pending" | "confirmed" | "rejected";
  /** Optional LOCATION enrichment (M5) — purely informational, computed
   *  once when the result arrives; never changes which matches exist or
   *  how many there are. Absent (or null) is the normal case and renders
   *  nothing extra — the same as before this existed. */
  location?: LocationEnrichment | null;
}

export interface FindSimilarResultPanelProps {
  status: "loading" | "success" | "error";
  /** A user-safe error message from the last request, or null. */
  error: string | null;
  matches: FindSimilarMatchState[];
  onConfirm: (match: FindSimilarMatchState, index: number) => void;
  onReject: (match: FindSimilarMatchState, index: number) => void;
  /** Leaves Find Similar entirely, restoring the normal inspector (same
   *  semantics as IdentifyResultPanel's own Exit). */
  onExit: () => void;
}

export default function FindSimilarResultPanel({ status, error, matches, onConfirm, onReject, onExit }: FindSimilarResultPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Layers className="w-4 h-4" /> Find Similar
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>Exit</Button>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching the document…
        </div>
      )}

      {status === "error" && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {status === "success" && matches.length === 0 && (
        <p className="text-xs text-muted-foreground">No similar elements found elsewhere in this document.</p>
      )}

      {status === "success" && matches.map((m, i) => {
        const page = m.evidence[0]?.page;
        return (
          <div key={m.id} className="rounded-md border p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <AiStateBadge state="ai" label="AI identified" />
              {m.confidence != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(m.confidence * 100)}% confidence</span>
              )}
              {page != null && <span className="text-[10px] text-muted-foreground">· page {page}</span>}
            </div>
            <div className="text-sm font-medium">{m.label}</div>
            {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
            {m.location && (
              <p className="text-[10px] text-muted-foreground">
                Matches recorded mark "{m.location.mark}"{m.location.count > 1 ? ` (${m.location.count} known instances)` : ""}
              </p>
            )}

            {m.status === "confirmed" ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                <Check className="w-3.5 h-3.5" /> Confirmed
              </div>
            ) : m.status === "rejected" ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <X className="w-3.5 h-3.5" /> Rejected
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button size="sm" className="h-7 gap-1" onClick={() => onConfirm(m, i)}>
                  <Check className="w-3.5 h-3.5" /> Confirm
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => onReject(m, i)}>
                  <X className="w-3.5 h-3.5" /> Reject
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
