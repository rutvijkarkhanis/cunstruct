/**
 * Non-drag alternatives (WCAG 2.2 SC 2.5.7 Dragging Movements, AA).
 *
 * Every drag interaction in the product must also be operable with single
 * pointer clicks / taps and the keyboard. Two patterns cover the drags we
 * have or plan to have:
 *
 *  - NumericNudge: for drag-to-adjust values (scrubbing a number, dragging
 *    a measurement handle, resizing). Type a value, or press −/+ (or
 *    ArrowUp/ArrowDown, Shift for ×10).
 *  - ReorderButtons: for drag-to-reorder lists. "Move up" / "Move down".
 *
 * All buttons meet the 24×24 CSS px minimum target (SC 2.5.8).
 */
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatQuantity, parseNumericInput } from "./money";
import "./tokens.css";

const BTN = "ds-control ds-target inline-flex h-8 w-8 items-center justify-center";

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export interface NumericNudgeProps {
  /** Current value; null = unresolved. The −/+ buttons stay disabled until a value is typed (never invent one). */
  value: number | null;
  onChange: (value: number) => void;
  /** Accessible name of the value, e.g. "Wall length". Used for the input and button labels. */
  label: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
}

export function NumericNudge({
  value,
  onChange,
  label,
  step = 1,
  min = -Infinity,
  max = Infinity,
  decimals = 2,
  unit,
  disabled = false,
  className,
}: NumericNudgeProps) {
  const id = useId();
  const show = (v: number | null) => (v == null ? "" : formatQuantity(v, decimals));
  const [draft, setDraft] = useState(show(value));
  const [invalid, setInvalid] = useState(false);

  // Keep the field in sync when the value changes from outside.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(show(value)), [value, decimals]);

  const clamp = (n: number) => roundTo(Math.min(max, Math.max(min, n)), decimals);

  const commit = (n: number) => {
    const next = clamp(n);
    setInvalid(false);
    setDraft(show(next));
    if (next !== value) onChange(next);
  };

  const nudge = (dir: 1 | -1, mult = 1) => {
    if (value == null) return;
    commit(value + dir * step * mult);
  };

  const commitDraft = () => {
    if (draft.trim() === "" && value == null) return setInvalid(false);
    const n = parseNumericInput(draft);
    if (n == null) {
      setInvalid(true);
      return;
    }
    commit(n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
    } else if (e.key === "Enter") {
      commitDraft();
    } else if (e.key === "Escape") {
      setInvalid(false);
      setDraft(show(value));
    }
  };

  const noValue = value == null;
  return (
    <div className={cn("inline-flex items-center gap-1", className)} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        className={BTN}
        aria-label={`Decrease ${label} by ${step}`}
        disabled={disabled || noValue || value <= min}
        onClick={() => nudge(-1)}
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </button>
      <input
        id={`${id}-input`}
        type="text"
        inputMode="decimal"
        className="ds-control ds-num ds-target h-8 w-28 px-2"
        aria-label={unit ? `${label} (${unit})` : label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-err` : undefined}
        placeholder="—"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
      />
      {unit && <span className="ds-muted text-sm">{unit}</span>}
      <button
        type="button"
        className={BTN}
        aria-label={`Increase ${label} by ${step}`}
        disabled={disabled || noValue || value >= max}
        onClick={() => nudge(1)}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
      {invalid && (
        <span id={`${id}-err`} role="alert" className="text-sm ds-cell" data-state="blocking">
          Enter a number
        </span>
      )}
    </div>
  );
}

export interface ReorderButtonsProps {
  /** Name of the item being moved, e.g. "BOQ Ground floor". */
  itemLabel: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  className?: string;
}

/** Single-click alternative to drag-to-reorder. */
export function ReorderButtons({ itemLabel, onMoveUp, onMoveDown, isFirst, isLast, className }: ReorderButtonsProps) {
  return (
    <div className={cn("inline-flex gap-1", className)}>
      <button type="button" className={BTN} aria-label={`Move ${itemLabel} up`} disabled={isFirst} onClick={onMoveUp}>
        <ChevronUp aria-hidden="true" className="h-4 w-4" />
      </button>
      <button type="button" className={BTN} aria-label={`Move ${itemLabel} down`} disabled={isLast} onClick={onMoveDown}>
        <ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
