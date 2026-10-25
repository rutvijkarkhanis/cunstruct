// Renaming a BOQ from the workbench: only the name, and only if it is still
// the name that was shown (compare-and-swap) — a rename made elsewhere in the
// meantime is never overwritten. (The Ops BOQ management page renames
// unguarded; this path does not change it.)
import { db } from "@/lib/untypedDb";

export const BOQ_NAME_MAX = 120;

export function parseBoqName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Enter a BOQ name." };
  if (name.length > BOQ_NAME_MAX) return { ok: false, error: `Keep the name under ${BOQ_NAME_MAX} characters.` };
  return { ok: true, name };
}

/** "conflict": the BOQ's name is no longer `from` (or the row is not visible to you); nothing was written. */
export async function renameBoq(boqId: string, from: string, to: string): Promise<"saved" | "conflict"> {
  const { data, error } = await db.from("boq").update({ name: to }).eq("id", boqId).eq("name", from).select("id");
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0 ? "saved" : "conflict";
}
