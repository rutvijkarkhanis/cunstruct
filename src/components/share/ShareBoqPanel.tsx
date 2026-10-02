// SHARE BOQ PANEL — the read-only equivalent of
// src/components/ops/workspace/WorkspaceBoqPanel.tsx, for the public,
// unauthenticated share link. Deliberately forked rather than given a
// `readOnly` prop: this file never imports useBoqManagement, CreateBoqDialog,
// or AiStateBadge/review-linkage — "no create/edit/review-jump" is
// structural, not a hidden button.
//
// Lists the project's BOQs (from the bootstrap payload — the exact "Floor 1
// — 52 lines" rows the real Workspace BOQ rail shows), then fetches that
// BOQ's lines via the workspace-share Edge Function on selection. Pricing
// fields (rate/amount/Subtotal/Grand Total) are present in the response only
// when the link's own show_pricing is true — this component renders
// whatever keys the response actually carries, never fabricating a "0" for
// an omitted figure.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatINR } from "@/lib/forecastEngine";
import type { ShareBoqSummary } from "../../../supabase/functions/workspace-share/handler";

export interface ShareBoqPanelProps {
  token: string;
  boqs: ShareBoqSummary[];
}

interface ShareBoqLine {
  id: string;
  description: string | null;
  unit: string | null;
  qty: number;
  included: boolean;
  rate?: number | null;
  amount?: number | null;
}

interface BoqLinesResponse {
  ok: boolean;
  boq?: { id: string; name: string };
  lines?: ShareBoqLine[];
  commercials?: { works: number; subTotal: number; grandTotal: number };
  error?: string;
}

const LINE_PREVIEW_CAP = 6;

export default function ShareBoqPanel({ token, boqs }: ShareBoqPanelProps) {
  const [activeBoqId, setActiveBoqId] = useState<string | null>(boqs.length === 1 ? boqs[0].id : null);
  const [showList, setShowList] = useState(boqs.length !== 1);

  const { data } = useQuery({
    queryKey: ["share-boq-lines", token, activeBoqId],
    enabled: !!activeBoqId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<BoqLinesResponse>("workspace-share", {
        body: { token, action: "boq_lines", boqId: activeBoqId },
      });
      if (error || !data?.ok) return null;
      return data;
    },
  });

  if (boqs.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No BOQ available for this project.</div>;
  }

  if (!activeBoqId || showList) {
    return (
      <div className="p-3 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">BOQ</div>
        <div className="space-y-0.5">
          {boqs.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => { setActiveBoqId(b.id); setShowList(false); }}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs rounded-sm border-l-[3px] transition-colors ${
                b.id === activeBoqId ? "bg-primary/10 border-l-primary font-semibold text-foreground" : "border-l-transparent hover:bg-muted/50 text-foreground/90"
              }`}
            >
              <span className="truncate">{b.name}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">{b.lineCount} line{b.lineCount === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const activeBoq = boqs.find((b) => b.id === activeBoqId)!;
  const lines = data?.lines ?? [];
  const previewLines = lines.slice(0, LINE_PREVIEW_CAP);
  const remaining = lines.length - previewLines.length;

  return (
    <div className="p-3 space-y-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Active BOQ</div>
        <div className="text-sm font-semibold">{activeBoq.name}</div>
        <div className="text-[11px] text-muted-foreground">{activeBoq.lineCount} line{activeBoq.lineCount === 1 ? "" : "s"}</div>
      </div>

      {!data ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">This BOQ has no line items yet.</p>
      ) : (
        <>
          {data.commercials && (
            <div className="rounded border p-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatINR(data.commercials.works)}</span>
              </div>
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Grand Total</span>
                <span className="tabular-nums">{formatINR(data.commercials.grandTotal)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {previewLines.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-2 text-[11px] border-b border-dashed pb-1.5 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="truncate">{l.description ?? "—"}</div>
                  <div className="text-muted-foreground">
                    {l.qty} {l.unit ?? ""}{l.rate != null ? ` · ${formatINR(l.rate)}` : ""}
                  </div>
                </div>
                {l.amount != null && <div className="shrink-0 tabular-nums pt-px">{formatINR(l.amount)}</div>}
              </div>
            ))}
            {remaining > 0 && (
              <p className="text-[11px] text-muted-foreground pt-0.5">+{remaining} more line{remaining === 1 ? "" : "s"}</p>
            )}
          </div>
        </>
      )}

      {boqs.length > 1 && (
        <button type="button" onClick={() => setShowList(true)} className="text-[11px] text-muted-foreground hover:text-foreground">
          Change BOQ
        </button>
      )}
    </div>
  );
}
