// Where the guide is: which project, which step, which steps were skipped.
// Kept in this browser only (localStorage) so leaving the guide's screen and
// coming back resumes at the same step. It is a viewing convenience, never
// project data: nothing here is sent anywhere. Every storage access is
// guarded — with storage unavailable the guide still works for the tab.
import { useSyncExternalStore } from "react";
import { GUIDE_STEPS, type GuideStepKey } from "./guide";

export interface GuideSession {
  /** The signed-in user who started it: another user on this browser never sees it. */
  userId: string;
  projectId: string;
  projectName: string;
  step: number;
  skipped: GuideStepKey[];
}

export const GUIDE_STORAGE_KEY = "cunstruct.guide.v1";
const STEP_KEYS = new Set<string>(GUIDE_STEPS.map((s) => s.key));

let memory: string | null = null;
let cachedRaw: string | null | undefined;
let cached: GuideSession | null = null;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try { return window.localStorage.getItem(GUIDE_STORAGE_KEY); } catch { return memory; }
}
function writeRaw(v: string | null) {
  memory = v;
  try {
    if (v == null) window.localStorage.removeItem(GUIDE_STORAGE_KEY);
    else window.localStorage.setItem(GUIDE_STORAGE_KEY, v);
  } catch { /* storage unavailable: kept in memory for this tab */ }
  listeners.forEach((l) => l());
}

/** A stored value, only when it is a well-formed session. */
export function parseGuideSession(raw: string | null): GuideSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GuideSession>;
    if (typeof v.userId !== "string" || typeof v.projectId !== "string" || typeof v.projectName !== "string") return null;
    if (typeof v.step !== "number" || !Number.isInteger(v.step) || v.step < 0 || v.step >= GUIDE_STEPS.length) return null;
    const skipped = Array.isArray(v.skipped) ? v.skipped.filter((k): k is GuideStepKey => typeof k === "string" && STEP_KEYS.has(k)) : [];
    return { userId: v.userId, projectId: v.projectId, projectName: v.projectName, step: v.step, skipped };
  } catch { return null; }
}

function snapshot(): GuideSession | null {
  const raw = readRaw();
  if (raw !== cachedRaw) { cachedRaw = raw; cached = parseGuideSession(raw); }
  return cached;
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === GUIDE_STORAGE_KEY) l(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

/** The guide session for this user, or null (none, or another user's). */
export function useGuideSession(userId: string | null | undefined): GuideSession | null {
  const s = useSyncExternalStore(subscribe, snapshot, () => null);
  return s && userId && s.userId === userId ? s : null;
}

export function startGuide(userId: string, projectId: string, projectName: string) {
  writeRaw(JSON.stringify({ userId, projectId, projectName, step: 0, skipped: [] } satisfies GuideSession));
}

function update(fn: (s: GuideSession) => GuideSession) {
  const s = snapshot();
  if (s) writeRaw(JSON.stringify(fn(s)));
}

const clampStep = (n: number) => Math.max(0, Math.min(GUIDE_STEPS.length - 1, n));

/** Go to a step; arriving at a step clears its "skipped" mark. */
export function goToGuideStep(step: number) {
  const n = clampStep(step);
  update((s) => ({ ...s, step: n, skipped: s.skipped.filter((k) => k !== GUIDE_STEPS[n].key) }));
}

/** Mark the current step skipped and move on. */
export function skipGuideStep() {
  update((s) => {
    const key = GUIDE_STEPS[s.step].key;
    return { ...s, step: clampStep(s.step + 1), skipped: s.skipped.includes(key) ? s.skipped : [...s.skipped, key] };
  });
}

export function exitGuide() { writeRaw(null); }
