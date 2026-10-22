// Links between journey steps, kept inside the workbench preview when the
// page is shown there (lib/app/journey inWorkbench, workbenchLink below). Everywhere else — and in
// every build without the preview (WORKBENCH_PREVIEW_ENABLED folds to false) —
// it returns the path unchanged.
import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";
import { inWorkbench, isWorkbenchPath } from "@/lib/app/journey";

/** Whether the current page is shown inside the workbench preview (always false without it). */
export function useInWorkbench(): boolean {
  const { pathname } = useLocation();
  return WORKBENCH_PREVIEW_ENABLED && isWorkbenchPath(pathname);
}

export function useStepLink(): (path: string) => string {
  const workbench = useInWorkbench();
  return useCallback((path: string) => (workbench ? workbenchLink(path) : path), [workbench]);
}

/** A journey step as its workbench section; a hand-off to the Ops console
 *  (builder, BOQ management, review screen) keeps its target but returns to
 *  the workbench (its ?returnTo= is mapped the same way). */
export function workbenchLink(path: string): string {
  if (!path.startsWith("/ops/")) return inWorkbench(path);
  const q = path.indexOf("?");
  if (q < 0) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  const back = params.get("returnTo");
  if (!back) return path;
  params.set("returnTo", inWorkbench(back));
  return `${path.slice(0, q)}?${params}`;
}
