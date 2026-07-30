import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { BookOpen } from "lucide-react";
import { QTY_BASES, QUALITY_TIERS, NOTE } from "@/lib/boqGlossary";

/**
 * A collapsible "How BOQ works" primer. Dropped at the top of the BOQ builder
 * and the ops templates page so a first-timer can learn the model in place.
 */
export function BoqExplainer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30">
      <Accordion type="single" collapsible defaultValue={defaultOpen ? "how" : undefined}>
        <AccordionItem value="how" className="border-none">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="w-4 h-4 text-primary" />
              New to BOQ? How this works
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-4 text-sm text-muted-foreground">
            <p>{NOTE.whatIsBoq}</p>
            <p>{NOTE.whyRooms}</p>

            <div>
              <div className="font-medium text-foreground mb-2">How each quantity is calculated</div>
              <div className="space-y-2">
                {QTY_BASES.map((b) => (
                  <div key={b.key} className="rounded-md border bg-background/60 p-2.5">
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
              <div className="font-medium text-foreground mb-2">Quality tiers</div>
              <div className="space-y-1.5">
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default BoqExplainer;
