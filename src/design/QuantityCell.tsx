import { formatQuantity } from "./money";
import { NumericText, type NumericCellProps } from "./MoneyCell";

export interface QuantityCellProps extends NumericCellProps {
  value: number | null | undefined;
  /** Unit label, e.g. "m³", "kg", "nos". */
  unit?: string;
  /** Fixed decimals so a column lines up (default 2; use 0 for counts). */
  decimals?: number;
}

/**
 * Quantity for grids: Indian grouping, fixed decimals, tabular and
 * right-aligned. A missing quantity shows "—" (announced as
 * "Quantity pending" when state is PENDING_QTY) — never 0.
 */
export function QuantityCell({ value, unit, decimals = 2, state, missingLabel, ...rest }: QuantityCellProps) {
  const missing = value == null || !Number.isFinite(value);
  return (
    <NumericText
      text={formatQuantity(value, decimals)}
      missing={missing}
      state={state}
      missingLabel={missingLabel ?? (state === "PENDING_QTY" ? "Quantity pending" : "No value")}
      {...rest}
    >
      {unit && !missing && <span className="ml-1 text-[0.85em]">{unit}</span>}
    </NumericText>
  );
}

export default QuantityCell;
