// Status pill for the engineering preview: colour + text, labels shared with the page.
import { quantityLabel, type QuantityState, type ReviewState } from "./labels";

const PILL_LABEL: Record<QuantityState | ReviewState, string> = {
  ...quantityLabel,
  needs_review: "Needs review",
  accepted: "Accepted · demo",
  corrected: "Corrected · demo",
};

const PILL_CLASS: Record<QuantityState | ReviewState, string> = {
  established: "border-sky-200 bg-sky-50 text-sky-800",
  confirmed_zero: "border-violet-200 bg-violet-50 text-violet-800",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  needs_review: "border-amber-200 bg-amber-50 text-amber-900",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  corrected: "border-indigo-200 bg-indigo-50 text-indigo-800",
};

export function statePill(state: QuantityState | ReviewState) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${PILL_CLASS[state]}`}>
      {PILL_LABEL[state]}
    </span>
  );
}
