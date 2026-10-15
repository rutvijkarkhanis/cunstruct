// Shared by ProjectShell and its step pages (kept out of the component file
// so react-refresh only sees components there).
import { useOutletContext } from "react-router-dom";

export interface ShellProject {
  id: string; name: string; client_name: string | null; location: string | null;
  project_type: string | null; status: string; area_sqft: number | null; floors: number | null;
}
export interface ProjectShellContext { projectId: string; project: ShellProject }

export const PROJECT_STEPS = [
  { to: "overview", label: "Overview" },
  { to: "drawings", label: "Drawings" },
  { to: "boq", label: "BOQ" },
  { to: "export", label: "Export & History" },
] as const;

export const useProjectShell = () => useOutletContext<ProjectShellContext>();
