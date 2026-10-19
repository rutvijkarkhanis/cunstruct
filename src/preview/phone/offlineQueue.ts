// Offline-first action queue for the B10 phone surfaces (preview lane).
// Actions are kept in localStorage so they survive a reload; NOTHING is ever
// sent: there is no sync target in the preview. Every storage access is wrapped
// in try/catch — storage may be missing, blocked or full — and the queue then
// lives in memory for this tab only.

export type QueuedActionKind = "signoff_approve" | "signoff_return" | "calloff_queue" | "measurement_save";

export interface QueuedAction {
  id: string;
  kind: QueuedActionKind;
  payload: Record<string, string | number | null>;
}

export const QUEUE_KEY = "cunstruct.preview.phone.queue.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or null if it cannot be reached. */
export function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

const isAction = (x: unknown): x is QueuedAction =>
  !!x && typeof x === "object" && typeof (x as QueuedAction).id === "string" && typeof (x as QueuedAction).kind === "string";

/** Read the queue; a missing, unreadable or corrupt entry reads as empty. */
export function loadQueue(storage: StorageLike | null): QueuedAction[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAction) : [];
  } catch {
    return [];
  }
}

/** Persist the queue. Returns false when storage is unavailable or the write fails. */
export function saveQueue(storage: StorageLike | null, queue: QueuedAction[]): boolean {
  if (!storage) return false;
  try {
    if (queue.length === 0) storage.removeItem(QUEUE_KEY);
    else storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

/** Append an action (pure); ids are sequential within the queue. */
export function appendAction(queue: QueuedAction[], kind: QueuedActionKind, payload: QueuedAction["payload"]): QueuedAction[] {
  const n = queue.reduce((max, a) => Math.max(max, Number(a.id.split("-").pop()) || 0), 0) + 1;
  return [...queue, { id: `Q-${n}`, kind, payload }];
}
