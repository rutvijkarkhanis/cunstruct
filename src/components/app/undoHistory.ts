// Undo history for the journey BOQ step. By default ProjectBoq keeps it in the
// page (lost when the page unmounts, e.g. on the hand-off to the BOQ builder).
// The workbench preview keeps it per BOQ for the life of this tab instead: a
// module-level store survives client-side navigation and is cleared on reload
// (nothing is written to storage; decision A1, provisional).
//
// Undo is last-in, first-out. When the newest step is refused because its line
// was changed elsewhere, it leaves the active stack — together with every
// earlier step for the SAME line, which was made on top of a state that no
// longer holds (the guarded write cannot say which field changed, so undoing
// them could overwrite the other change). Each one is kept, visibly, in
// `refused`. Steps for other lines stay usable.
import { useCallback, useSyncExternalStore } from "react";
import type { BoqTableLine } from "@/lib/app/boqTable";

/** `after` is the line as this edit left it — what undo expects to find. */
export interface UndoEntry { lineId: string; label: string; undo: Partial<BoqTableLine>; after: BoqTableLine }
/** A step taken out of the active stack, and why: its line changed elsewhere,
 *  or a later step on the same line was refused for that reason. */
export interface RefusedUndo { label: string; reason: "changed" | "earlier-on-changed-line" }
export interface UndoState { entries: UndoEntry[]; refused: RefusedUndo[] }

export const EMPTY_UNDO: UndoState = { entries: [], refused: [] };

export const pushUndo = (e: UndoEntry) => (s: UndoState): UndoState => ({ ...s, entries: [...s.entries, e] });
/** The newest step took effect: drop it. */
export const popUndo = (s: UndoState): UndoState => ({ ...s, entries: s.entries.slice(0, -1) });
/** The newest step was refused because its line changed elsewhere (see the header). */
export function refuseNewest(s: UndoState): UndoState {
  const last = s.entries[s.entries.length - 1];
  if (!last) return s;
  const rest = s.entries.slice(0, -1);
  const sameLine = rest.filter((e) => e.lineId === last.lineId);
  return {
    entries: rest.filter((e) => e.lineId !== last.lineId),
    refused: [
      ...s.refused,
      { label: last.label, reason: "changed" },
      ...sameLine.reverse().map((e) => ({ label: e.label, reason: "earlier-on-changed-line" as const })),
    ],
  };
}
export const dismissRefused = (s: UndoState): UndoState => ({ ...s, refused: [] });

type Update = (s: UndoState) => UndoState;

const histories = new Map<string, UndoState>();
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Session (tab) history for one BOQ; `null` reads as empty and ignores updates. */
export function useSessionUndoHistory(boqId: string | null): [UndoState, (u: Update) => void] {
  const history = useSyncExternalStore(subscribe, () => (boqId ? histories.get(boqId) ?? EMPTY_UNDO : EMPTY_UNDO));
  const update = useCallback((u: Update) => {
    if (!boqId) return;
    histories.set(boqId, u(histories.get(boqId) ?? EMPTY_UNDO));
    listeners.forEach((l) => l());
  }, [boqId]);
  return [history, update];
}

/** Test hook: forget every session history. */
export function clearSessionUndoHistories() {
  histories.clear();
  listeners.forEach((l) => l());
}
