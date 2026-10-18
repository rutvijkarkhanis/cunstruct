// Types and labels of the owner-only engineering preview (mock data only).
import type { ReviewState as EngineReviewState } from "@/lib/preview/types";

export type QuantityState = "established" | "confirmed_zero" | "pending";
export type ReviewState = Exclude<EngineReviewState, "verified">;

export interface PreviewLine {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  quantityState: QuantityState;
  rate: number;
  reviewState: ReviewState;
  region: string;
  note: string;
}

export const quantityLabel: Record<QuantityState, string> = {
  established: "Quantity established",
  confirmed_zero: "Confirmed zero",
  pending: "Quantity pending",
};
