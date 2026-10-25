import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { GUIDE_STORAGE_KEY, exitGuide, goToGuideStep, parseGuideSession, skipGuideStep, startGuide, useGuideSession } from "./guideSession";

beforeEach(() => { exitGuide(); window.localStorage.clear(); });

describe("guide session (browser storage only)", () => {
  it("start, move, skip and exit; arriving at a skipped step clears its mark", () => {
    const { result } = renderHook(() => useGuideSession("u1"));
    act(() => startGuide("u1", "p1", "Tower B"));
    expect(result.current).toMatchObject({ projectId: "p1", projectName: "Tower B", step: 0, skipped: [] });
    act(() => skipGuideStep());
    expect(result.current).toMatchObject({ step: 1, skipped: ["overview"] });
    act(() => goToGuideStep(0));
    expect(result.current).toMatchObject({ step: 0, skipped: [] });
    act(() => goToGuideStep(99));
    expect(result.current?.step).toBe(6);
    act(() => exitGuide());
    expect(result.current).toBeNull();
    expect(window.localStorage.getItem(GUIDE_STORAGE_KEY)).toBeNull();
  });

  it("another user's session is not returned", () => {
    act(() => startGuide("u1", "p1", "Tower B"));
    expect(renderHook(() => useGuideSession("u2")).result.current).toBeNull();
    expect(renderHook(() => useGuideSession(null)).result.current).toBeNull();
  });

  it("ignores malformed stored values", () => {
    expect(parseGuideSession("{")).toBeNull();
    expect(parseGuideSession(JSON.stringify({ userId: "u", projectId: "p", projectName: "n", step: 9, skipped: [] }))).toBeNull();
    expect(parseGuideSession(JSON.stringify({ userId: "u", projectId: "p", projectName: "n", step: 1, skipped: ["boq", "nope"] }))?.skipped).toEqual(["boq"]);
  });
});
