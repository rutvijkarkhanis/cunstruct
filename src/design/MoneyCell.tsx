import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatINR, formatINRCompact } from "./money";
import { STATE_META, stateAttr, type SemanticState } from "./tokens";
import "./tokens.css";

export interface NumericCellProps {
  /** Optional semantic state: tints the text and, for EXCLUDED, strikes it through. */
  state?: SemanticState;
  /** Screen-reader text for a missing value (default "No value"). */
  missingLabel?: string;
  className?: string;
}

/**
 * Shared shell for numeric cells: tabular figures, right-aligned, and the
 * non-visual parts of state (strike-through and "—" are announced in words,
 * since neither is perceivable by a screen reader on its own).
 */
export function NumericText({
  text,
  missing,
  state,
  missingLabel = "No value",
  className,
  children,
}: NumericCellProps & { text: string; missing: boolean; children?: ReactNode }) {
  const strike = state ? STATE_META[state].strike : false;
  return (
    <span
      className={cn("ds-num inline-block w-full", state && "ds-cell", strike && "ds-strike", className)}
      data-state={state ? stateAttr(state) : undefined}
    >
      {missing ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{missingLabel}</span>
        </>
      ) : (
        text
      )}
      {children}
      {strike && <span className="sr-only"> (excluded)</span>}
    </span>
  );
}

export interface MoneyCellProps extends NumericCellProps {
  value: number | null | undefined;
  /** Compact lakh/crore form — for summaries only, never in grids. */
  compact?: boolean;
}

/** Rupee amount for grids: "₹12,34,567", tabular and right-aligned; missing → "—", never 0. */
export function MoneyCell({ value, compact = false, ...rest }: MoneyCellProps) {
  const text = compact ? formatINRCompact(value) : formatINR(value);
  const missing = value == null || !Number.isFinite(value);
  return <NumericText text={text} missing={missing} {...rest} />;
}

export default MoneyCell;
