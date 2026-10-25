// Step links stay inside the workbench preview only when the build has it and
// the page is in it; otherwise every path is returned unchanged.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/workbenchPreview", () => ({ get WORKBENCH_PREVIEW_ENABLED() { return flag.on; } }));

import { useStepLink } from "./useStepLink";

const at = (path: string) => ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
const link = "/app/projects/p1/review?boq=b1";

describe("useStepLink", () => {
  afterEach(() => { flag.on = false; });

  it("keeps step links in the workbench when the page is there and the build has the preview", () => {
    flag.on = true;
    const { result } = renderHook(() => useStepLink(), { wrapper: at("/app/projects/p1/workbench/boq?boq=b1") });
    expect(result.current(link)).toBe("/app/projects/p1/workbench/review?boq=b1");
    expect(result.current("/app/projects/p1/overview")).toBe("/app/projects/p1/workbench/overview");
    // A hand-off to the Ops console keeps its target but comes back to the workbench.
    expect(result.current("/ops/projects/p1/boqs/b1?returnTo=%2Fapp%2Fprojects%2Fp1%2Fcheck%3Fboq%3Db1"))
      .toBe("/ops/projects/p1/boqs/b1?returnTo=%2Fapp%2Fprojects%2Fp1%2Fworkbench%2Fcheck%3Fboq%3Db1");
    expect(result.current("/ops/projects/p1/boqs/b1")).toBe("/ops/projects/p1/boqs/b1");
  });

  it("changes nothing on journey pages", () => {
    flag.on = true;
    const { result } = renderHook(() => useStepLink(), { wrapper: at("/app/projects/p1/boq?boq=b1") });
    expect(result.current(link)).toBe(link);
  });

  it("changes nothing in a build without the preview, even on a workbench path", () => {
    const { result } = renderHook(() => useStepLink(), { wrapper: at("/app/projects/p1/workbench/boq?boq=b1") });
    expect(result.current(link)).toBe(link);
  });
});
