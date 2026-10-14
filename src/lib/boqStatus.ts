// Working-BOQ status (existing boq.status column): labels, the one transition
// offered from each status, and the guarded save. See BoqStatusControl.
//
// "Finalized" means finalized internally only — not sent to a client, awarded
// or executed. "sent" is allowed by the schema but never set by this app.

import { db } from "@/lib/untypedDb";

export type BoqStatus = "draft" | "finalized" | "sent";

export const BOQ_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  finalized: "Finalized (internal)",
  sent: "Sent (recorded outside this editor)",
};
export const BOQ_STATUS_HELP: Record<string, string> = {
  draft: "Still being worked on.",
  finalized: "Finalized internally. Not sent to a client, awarded or executed.",
  sent: "Recorded as sent outside this editor. This editor doesn't change it.",
};
export const boqStatusLabel = (s: string | null | undefined) => (s ? BOQ_STATUS_LABEL[s] ?? s : "Unknown");

/** The one transition offered from each status; none from "sent" (or anything unknown). */
export function nextBoqStatus(s: string | null | undefined): "draft" | "finalized" | null {
  if (s === "draft") return "finalized";
  if (s === "finalized") return "draft";
  return null;
}

export async function saveBoqStatus(boqId: string, from: string, to: "draft" | "finalized"): Promise<"saved" | "conflict"> {
  const { data, error } = await db.from("boq").update({ status: to }).eq("id", boqId).eq("status", from).select("id");
  if (error) throw error;
  return ((data as unknown[] | null) ?? []).length > 0 ? "saved" : "conflict";
}
