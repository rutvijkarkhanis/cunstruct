import { cn } from "@/lib/utils";
import { STATE_META, stateAttr, type SemanticState } from "./tokens";
import { STATE_ICONS } from "./stateIcons";
import "./tokens.css";

export interface StatusBadgeProps {
  state: SemanticState;
  className?: string;
}

/**
 * A semantic status: colour + icon + visible text label, always all three
 * (WCAG 2.2 SC 1.4.1 — colour is never the only signal). The icon is
 * decorative (aria-hidden); the visible label is the accessible text, so
 * the badge reads the same to sighted, colour-blind and screen-reader users.
 */
export function StatusBadge({ state, className }: StatusBadgeProps) {
  const meta = STATE_META[state];
  const Icon = STATE_ICONS[meta.icon];
  return (
    <span className={cn("ds-status", className)} data-state={stateAttr(state)} title={meta.meaning}>
      <Icon aria-hidden="true" focusable="false" strokeWidth={2.25} />
      <span>{meta.label}</span>
    </span>
  );
}

export default StatusBadge;
