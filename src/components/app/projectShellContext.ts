// Shared by ProjectShell and its step pages (kept out of the component file
// so react-refresh only sees components there).
import { useOutletContext } from "react-router-dom";

export interface ShellProject {
  id: string; name: string; client_name: string | null; location: string | null;
  project_type: string | null; status: string; area_sqft: number | null; floors: number | null;
}
export interface ProjectShellContext { projectId: string; project: ShellProject }

/** The project home (Overview) and the five Quantity BOQ steps, in order.
 *  `stage` names the lib/app/journey stage each step is where you work on. */
export const PROJECT_STEPS = [
  { to: "overview", label: "Overview", stage: null },
  { to: "drawings", label: "Project & drawings", stage: "drawings" },
  { to: "review", label: "Review quantities", stage: "review" },
  { to: "boq", label: "Build BOQ", stage: "boq" },
  { to: "check", label: "Check & finalise", stage: "checks" },
  { to: "export", label: "Export", stage: "export" },
] as const;

export const useProjectShell = () => useOutletContext<ProjectShellContext>();
