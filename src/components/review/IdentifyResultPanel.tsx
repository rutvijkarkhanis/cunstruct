// CLICK-TO-IDENTIFY RESULT PANEL — the "existing drawing-native inspector"
// slot's content while Identify mode is active. A sibling of ItemPanel, not
// an edit to it: ItemPanel is built around StoredReviewItem/AnalysisItemV1
// (quantity, unit, Verify/Edit/Flag) and none of that applies here —
// identification never creates or edits a BOQ line, a type, or an instance.
//
// Ephemeral by design (see the Click-to-Identify investigation report,
// decision 9): "Confirm"/"Change"/"Dismiss" are local UI state only, never
// persisted — there is no existing UX surface that reads a stored
// identification, so nothing here writes one.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check, Pencil, X, Crosshair } from "lucide-react";
import AiStateBadge from "@/components/review/AiStateBadge";
import type { IdentificationCandidateV1 } from "@/lib/review/identifySchemaV1";

export interface IdentifyResultPanelProps {
  /** True once a click has been made and a request is in flight. */
  loading: boolean;
  /** A user-safe error message from the last request, or null. */
  error: string | null;
  /** Null until the user has clicked a point on the drawing. */
  hasPoint: boolean;
  candidates: IdentificationCandidateV1[];
  /** Local-only: which candidate (by index) the user confirmed, and under
   *  what label (may differ from the AI's own label if the user changed it
   *  before confirming). Null when nothing has been confirmed yet. */
  confirmed: { index: number; label: string } | null;
  onConfirm: (candidate: IdentificationCandidateV1, index: number) => void;
  onChangeLabel: (candidate: IdentificationCandidateV1, index: number, newLabel: string) => void;
  onDismiss: () => void;
  /** Leaves Identify mode entirely, restoring the normal inspector. */
  onExit: () => void;
}

export default function IdentifyResultPanel({
  loading, error, hasPoint, candidates, confirmed, onConfirm, onChangeLabel, onDismiss, onExit,
}: IdentifyResultPanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Crosshair className="w-4 h-4" /> Identify
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>Exit</Button>
      </div>

      {!hasPoint && !loading && (
        <p className="text-xs text-muted-foreground">Click anywhere on the drawing to identify what's there.</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Identifying…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && hasPoint && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground">Couldn't identify anything at this point. Try clicking a bit more precisely on the element.</p>
      )}

      {!loading && !error && candidates.map((c, i) => {
        const isConfirmed = confirmed?.index === i;
        const isEditing = editingIndex === i;
        return (
          <div key={i} className="rounded-md border p-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
              <AiStateBadge state="ai" label="AI identified" />
              {c.confidence != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(c.confidence * 100)}% confidence</span>
              )}
            </div>
            {isEditing ? (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                  className="h-7 text-sm" placeholder="Your label"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editValue.trim()) { onChangeLabel(c, i, editValue.trim()); setEditingIndex(null); }
                    if (e.key === "Escape") setEditingIndex(null);
                  }}
                />
                <Button size="sm" className="h-7" disabled={!editValue.trim()} onClick={() => { onChangeLabel(c, i, editValue.trim()); setEditingIndex(null); }}>Save</Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditingIndex(null)}>Cancel</Button>
              </div>
            ) : (
              <div className="text-sm font-medium">{isConfirmed ? confirmed.label : c.label}</div>
            )}
            {c.description && !isEditing && <p className="text-xs text-muted-foreground">{c.description}</p>}

            {isConfirmed ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                <Check className="w-3.5 h-3.5" /> Confirmed as "{confirmed.label}"
              </div>
            ) : !isEditing && (
              <div className="flex items-center gap-1.5">
                <Button size="sm" className="h-7 gap-1" onClick={() => onConfirm(c, i)}>
                  <Check className="w-3.5 h-3.5" /> Confirm
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setEditingIndex(i); setEditValue(c.label); }}>
                  <Pencil className="w-3.5 h-3.5" /> Change
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={onDismiss}>
                  <X className="w-3.5 h-3.5" /> Dismiss
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {!loading && !error && hasPoint && candidates.length === 0 && (
        <Button size="sm" variant="outline" onClick={onDismiss}>Try another point</Button>
      )}
    </div>
  );
}
