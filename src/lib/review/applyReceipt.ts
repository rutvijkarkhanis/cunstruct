// APPLY RECEIPT — the outcome of the last Apply-to-BOQ, kept so it does not
// vanish with a 4-second toast. Built only from the ApplyResult and counts the
// Review screen already computed; nothing here is a new figure.
//
// Persistence is deliberately per browser tab (sessionStorage, keyed by BOQ):
// it survives navigating away and back, and reloads, in the same tab. It is
// not an audit record — the BOQ lines and their change log are that — so it
// is not shared across tabs, devices or users, and it never blocks anything.

export interface ApplyReceipt {
  boqId: string;
  runId: string | null;
  appliedAt: string;              // ISO time the Apply call returned
  appliedCount: number;
  unresolvedCount: number;
  correctedCount: number;
  reviewedCount: number;
  verifiedCount: number;
  /** Lines saved whose change-log row failed — saved but unaudited. */
  unauditedCount: number;
  /** Selected items the server refused because the line changed underneath. */
  conflictedCount: number;
  /** Source drawings that changed while applying. */
  revisionChanged: string[];
  /** Existing lines this call is known to have modified (never NEW_LINE ids). */
  justAppliedLineIds: string[];
}

export const receiptStorageKey = (boqId: string) => `cunstruct.applyReceipt.${boqId}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defaultStore = (): Store | null => {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
};

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isStrArr = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");

/** Shape check for what comes back out of storage — anything else is ignored. */
export function parseReceipt(raw: string | null, boqId: string): ApplyReceipt | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    const ok = r.boqId === boqId && typeof r.appliedAt === "string" && !Number.isNaN(Date.parse(r.appliedAt))
      && (r.runId === null || typeof r.runId === "string")
      && ["appliedCount", "unresolvedCount", "correctedCount", "reviewedCount", "verifiedCount", "unauditedCount", "conflictedCount"].every((k) => isNum(r[k]))
      && isStrArr(r.revisionChanged) && isStrArr(r.justAppliedLineIds);
    return ok ? (r as unknown as ApplyReceipt) : null;
  } catch {
    return null;
  }
}

export function loadReceipt(boqId: string, store: Store | null = defaultStore()): ApplyReceipt | null {
  try { return parseReceipt(store?.getItem(receiptStorageKey(boqId)) ?? null, boqId); } catch { return null; }
}

/** Best effort: storage may be full or blocked; the receipt still shows for this visit. */
export function saveReceipt(r: ApplyReceipt, store: Store | null = defaultStore()): void {
  try { store?.setItem(receiptStorageKey(r.boqId), JSON.stringify(r)); } catch { /* shown in memory only */ }
}

export function clearReceipt(boqId: string, store: Store | null = defaultStore()): void {
  try { store?.removeItem(receiptStorageKey(boqId)); } catch { /* nothing stored */ }
}
