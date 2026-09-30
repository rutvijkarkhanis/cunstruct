import { Sparkles, Pencil, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The three states a quantity moves through in Cunstruct's pipeline, given a
 * distinguishable visual identity each — not just three labels in the same
 * pill. Reuses colors already meaningful elsewhere in this app rather than
 * inventing new hues: primary/navy for "from the AI", blue for "edited" (the
 * same blue ItemPanel's StatusBadge already uses for EDITED), emerald for
 * "landed in the BOQ" (the same green used for a current revision). No
 * gradients, no glow, no animation — a construction estimation tool, not a
 * consumer AI dashboard.
 */
export type AiState = "ai" | "human" | "applied";

const CONFIG: Record<AiState, { icon: typeof Sparkles; label: string; cls: string }> = {
  ai: { icon: Sparkles, label: "AI extracted", cls: "text-primary border-primary/30 bg-primary/10" },
  human: { icon: Pencil, label: "Your correction", cls: "text-blue-700 dark:text-blue-400 border-blue-500/30 bg-blue-500/10" },
  applied: { icon: CheckCircle2, label: "Applied to BOQ", cls: "text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
};

export default function AiStateBadge({ state, label, className }: { state: AiState; label?: string; className?: string }) {
  const { icon: Icon, label: defaultLabel, cls } = CONFIG[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide",
        "border rounded px-1.5 py-0.5 whitespace-nowrap",
        cls,
        className,
      )}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      {label ?? defaultLabel}
    </span>
  );
}
