import { InfoHint } from "@/components/InfoHint";
import { QTY_BASES, QUALITY_TIERS, NOTE } from "@/lib/boqGlossary";

/**
 * "How BOQ works" — the full primer, packed into a single ⓘ button.
 * Drop it next to a page title; clicking the ⓘ opens the whole guide in a
 * scrollable popover instead of taking up space as a panel.
 */
export function BoqGuideHint({
  side = "bottom",
  align = "start",
}: {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <InfoHint title="How BOQ works" width="w-[22rem]" side={side} align={align}>
      <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-3">
        <p>{NOTE.whatIsBoq}</p>
        <p>{NOTE.whyRooms}</p>

        <div>
          <div className="font-medium text-foreground mb-1.5">How each quantity is calculated</div>
          <div className="space-y-1.5">
            {QTY_BASES.map((b) => (
              <div key={b.key} className="rounded-md border bg-background/60 p-2">
                <div className="flex items-center gap-2">
                  <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-foreground">{b.label}</code>
                  <span className="text-xs">{b.plain}</span>
                </div>
                <div className="text-[11px] mt-1 text-muted-foreground/80">
                  Driven by {b.drivenBy.toLowerCase()}. e.g. {b.example}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="font-medium text-foreground mb-1">Wastage &amp; pack rounding</div>
          <p>{NOTE.wastage}</p>
          <p className="mt-1">{NOTE.packRounding}</p>
        </div>

        <div>
          <div className="font-medium text-foreground mb-1.5">Quality tiers</div>
          <div className="space-y-1">
            {QUALITY_TIERS.map((t) => (
              <div key={t.key} className="text-xs">
                <span className="font-medium text-foreground">{t.label}:</span> {t.note}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="font-medium text-foreground mb-1">Order vs. onboard</div>
          <p>{NOTE.orderVsOnboard}</p>
        </div>
      </div>
    </InfoHint>
  );
}

export default BoqGuideHint;
