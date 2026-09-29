import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The ONE reusable visual marker for "this came from Cunstruct's AI drawing
 * analysis" — used wherever AI-sourced data appears (the Review Queue, and
 * post-Apply on the BOQ) so a viewer learns the visual language once and
 * recognizes it everywhere after, instead of AI-produced and hand-entered
 * data looking identical (see the demo-path UX audit).
 *
 * Deliberately restrained: brand-primary tint at low opacity, a static
 * (non-animated) icon, no gradient, no glow — this is a construction
 * estimation tool that uses AI, not a consumer AI-dashboard product.
 */
export default function AiExtractedBadge({ label = "AI extracted", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide",
        "text-primary border border-primary/25 bg-primary/5 rounded px-1.5 py-0.5 whitespace-nowrap",
        className,
      )}
    >
      <Sparkles className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
