// Links between journey steps, kept inside the workbench preview when the
// page is shown there (lib/app/journey inWorkbench). Everywhere else — and in
// every build without the preview (WORKBENCH_PREVIEW_ENABLED folds to false) —
// it returns the path unchanged.
import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";
import { inWorkbench, isWorkbenchPath } from "@/lib/app/journey";

export function useStepLink(): (path: string) => string {
  const { pathname } = useLocation();
  const workbench = WORKBENCH_PREVIEW_ENABLED && isWorkbenchPath(pathname);
  return useCallback((path: string) => (workbench ? inWorkbench(path) : path), [workbench]);
}
