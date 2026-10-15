// Preview + explicit confirmation for adopting ONE evidence rate as a BOQ
// line's commercial rate. Rendering and ticking boxes write nothing; only the
// "Confirm and apply rate" button calls onConfirm, and it stays disabled until
// the candidate is adoptable, every caveat is acknowledged, and adoption
// storage exists. Cancel discards the selection without any write.

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assessAdoption, BASIS_LABEL, confirmationText, previewAdoption,
  type AdoptionSources, type CommercialLine,
} from "@/lib/rateAdoption";
import type { EvidenceItem } from "@/lib/rateEvidence";

const money = (n: number | null) => (n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

export default function RateAdoptionPreview({ line, item, sources, today, available, unavailableMessage, busy, onConfirm, onCancel }: {
  line: CommercialLine; item: EvidenceItem; sources: AdoptionSources; today: string;
  available: boolean; unavailableMessage: string; busy: boolean;
  onConfirm: (acknowledged: string[]) => void; onCancel: () => void;
}) {
  const assessment = assessAdoption(line, item, sources, today);
  const [acked, setAcked] = useState<string[]>([]);
  const allAcked = assessment.acknowledgements.every((a) => acked.includes(a));
  // Current side is always shown; the proposed side only when the source has a rate.
  const current = previewAdoption(line, 0);
  const preview = item.rate != null ? previewAdoption(line, item.rate) : null;

  return (
    <section role="region" aria-label="Rate adoption preview" className="rounded-md border-2 border-primary/40 p-3 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Adopt this rate into the commercial BOQ?</h3>
        <p className="text-[11px] text-muted-foreground">Preview only — nothing changes until you confirm. Quantity, unit, description and scope are never changed.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="rounded border p-2" data-testid="adoption-current">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current</div>
          <div>{money(current.currentRate)}{line.unit ? ` / ${line.unit}` : ""}</div>
          <div className="text-xs text-muted-foreground">{BASIS_LABEL[current.currentBasis]}</div>
          <div className="text-xs">Amount: {current.quantityPending ? "quantity pending" : money(current.currentAmount)}</div>
        </div>
        <div className="rounded border p-2" data-testid="adoption-proposed">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Proposed</div>
          <div>{money(item.rate)}{item.unit ? ` / ${item.unit}` : ""}</div>
          <div className="text-xs text-muted-foreground">{item.source} · {item.dateLabel}</div>
          <div className="text-xs">
            Amount: {preview?.quantityPending ? "quantity pending" : money(preview?.proposedAmount ?? null)}
            {preview?.delta != null && <> ({preview.delta >= 0 ? "+" : "−"}{money(Math.abs(preview.delta))})</>}
          </div>
        </div>
      </div>

      {item.detail && (
        <div className="text-xs"><span className="font-medium">Source specification:</span> {item.detail}</div>
      )}
      <div className="text-xs"><span className="font-medium">BOQ line:</span> {line.description ?? "Untitled line"} · measured {line.qty ?? "—"} {line.unit ?? ""}</div>

      {assessment.blockers.length > 0 ? (
        <ul className="space-y-1 text-xs text-destructive" aria-label="Adoption blocked">
          {assessment.blockers.map((b) => <li key={b} className="flex gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{b}</li>)}
        </ul>
      ) : assessment.acknowledgements.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Acknowledge each caveat before adopting:</legend>
          {assessment.acknowledgements.map((a) => (
            <label key={a} className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={acked.includes(a)}
                onChange={(e) => setAcked((s) => (e.target.checked ? [...s, a] : s.filter((x) => x !== a)))} />
              {a}
            </label>
          ))}
        </fieldset>
      )}

      {assessment.adoptable && <p className="text-xs italic">{confirmationText(line, item)}</p>}
      {!available && <p className="text-xs text-destructive">{unavailableMessage}</p>}

      <div className="flex gap-2">
        <Button size="sm" disabled={!assessment.adoptable || !allAcked || !available || busy} onClick={() => onConfirm(acked)}>
          Confirm and apply rate
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </section>
  );
}
