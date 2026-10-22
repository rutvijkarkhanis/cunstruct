// Undo history: last-in first-out; a step refused because its line changed
// elsewhere leaves the stack with every earlier step on the same line, all
// kept as visible "not undone" records; other lines' steps stay usable. The
// session store keeps this per BOQ across unmounts (tab lifetime).
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  EMPTY_UNDO, clearSessionUndoHistories, dismissRefused, popUndo, pushUndo, refuseNewest, useSessionUndoHistory,
  type UndoEntry, type UndoState,
} from "./undoHistory";

const entry = (lineId: string, label = `edit ${lineId}`): UndoEntry => ({ lineId, label, undo: { qty: 1 }, after: { id: lineId, qty: 2 } as UndoEntry["after"] });
const build = (...es: UndoEntry[]) => es.reduce<UndoState>((s, e) => pushUndo(e)(s), EMPTY_UNDO);
const labels = (s: UndoState) => s.entries.map((e) => e.label);

describe("undo stack rules", () => {
  it("pops the newest step only", () => {
    expect(labels(popUndo(build(entry("a", "a1"), entry("b", "b1"))))).toEqual(["a1"]);
    expect(popUndo(EMPTY_UNDO)).toEqual(EMPTY_UNDO);
  });

  it("a refused newest step leaves the stack and no longer blocks other lines' earlier steps", () => {
    const s = refuseNewest(build(entry("a", "a1"), entry("b", "b1")));
    expect(labels(s)).toEqual(["a1"]);
    expect(s.refused).toEqual([{ label: "b1", reason: "changed" }]);
  });

  it("takes every earlier step on the same line with it (newest first), keeping other lines' steps in order", () => {
    const s = refuseNewest(build(entry("a", "a1"), entry("b", "b1"), entry("a", "a2"), entry("c", "c1"), entry("a", "a3")));
    expect(labels(s)).toEqual(["b1", "c1"]);
    expect(s.refused).toEqual([
      { label: "a3", reason: "changed" },
      { label: "a2", reason: "earlier-on-changed-line" },
      { label: "a1", reason: "earlier-on-changed-line" },
    ]);
  });

  it("keeps refused records until dismissed, across later refusals", () => {
    let s = refuseNewest(build(entry("a", "a1"), entry("b", "b1")));
    s = refuseNewest(s);
    expect(s.entries).toEqual([]);
    expect(s.refused.map((r) => r.label)).toEqual(["b1", "a1"]);
    expect(dismissRefused(s)).toEqual(EMPTY_UNDO);
    expect(refuseNewest(EMPTY_UNDO)).toEqual(EMPTY_UNDO);
  });
});

describe("useSessionUndoHistory", () => {
  beforeEach(() => clearSessionUndoHistories());

  it("keeps a BOQ's history, refused records included, after the page unmounts (e.g. the builder hand-off)", () => {
    const first = renderHook(() => useSessionUndoHistory("boq-1"));
    act(() => first.result.current[1](pushUndo(entry("l1"))));
    act(() => first.result.current[1](pushUndo(entry("l2"))));
    act(() => first.result.current[1](refuseNewest));
    first.unmount();
    const again = renderHook(() => useSessionUndoHistory("boq-1"));
    expect(again.result.current[0].entries.map((e) => e.lineId)).toEqual(["l1"]);
    expect(again.result.current[0].refused).toEqual([{ label: "edit l2", reason: "changed" }]);
    act(() => again.result.current[1](popUndo));
    expect(again.result.current[0].entries).toEqual([]);
  });

  it("keeps BOQs apart and ignores updates without a BOQ", () => {
    const a = renderHook(() => useSessionUndoHistory("boq-a"));
    const none = renderHook(() => useSessionUndoHistory(null));
    act(() => a.result.current[1](pushUndo(entry("x"))));
    act(() => none.result.current[1](pushUndo(entry("y"))));
    act(() => a.result.current[1](refuseNewest));
    expect(renderHook(() => useSessionUndoHistory("boq-b")).result.current[0]).toEqual(EMPTY_UNDO);
    expect(none.result.current[0]).toEqual(EMPTY_UNDO);
    expect(a.result.current[0].refused.map((r) => r.label)).toEqual(["edit x"]);
  });
});
