// SIMULATED REVIEW — deterministic stand-ins for the human review step, so the
// end-to-end harness can run the real Apply path offline.
//
// These are NOT human review. No person looked at any item a policy accepts.
// Every decision carries the policy name and its rule, and every harness
// report labels its review step "SIMULATED", so a score produced under a
// policy is never read as the accuracy of a reviewed BOQ.

import type { ReviewItem, ReviewStatus } from "@/lib/review/reviewQueue";

export type SimulatedPolicyName = "accept-evidenced-measurements" | "accept-everything";

export interface SimulatedDecision {
  kind: "SIMULATED";
  policy: SimulatedPolicyName;
  status: Extract<ReviewStatus, "VERIFIED" | "PENDING_REVIEW">;
  rule: string;
}

export const POLICY_DESCRIPTIONS: Record<SimulatedPolicyName, string> = {
  "accept-evidenced-measurements":
    "Simulated reviewer verifies an item only when it is MEASURED with a positive quantity, carries at least one evidence box, and is not a duplicate. Everything else is left unreviewed (held).",
  "accept-everything":
    "Simulated reviewer verifies every item without looking, including pending ones. A worst-case control for what Apply and export do with unchecked items.",
};

export function simulatedDecision(item: ReviewItem, policy: SimulatedPolicyName): SimulatedDecision {
  const decide = (status: SimulatedDecision["status"], rule: string): SimulatedDecision => ({ kind: "SIMULATED", policy, status, rule });
  if (policy === "accept-everything") return decide("VERIFIED", "accept-everything verifies every item.");
  const ai = item.ai;
  if (item.duplicateOf) return decide("PENDING_REVIEW", `Held: duplicate of ${item.duplicateOf}.`);
  if (ai.aiStatus !== "MEASURED") return decide("PENDING_REVIEW", `Held: status is ${ai.aiStatus}, not MEASURED.`);
  if (!(typeof ai.quantity === "number" && ai.quantity > 0)) return decide("PENDING_REVIEW", "Held: no positive quantity.");
  if (!(ai.source?.evidence?.length)) return decide("PENDING_REVIEW", "Held: no evidence box.");
  return decide("VERIFIED", "Verified: MEASURED, positive quantity, evidence present, not a duplicate.");
}
