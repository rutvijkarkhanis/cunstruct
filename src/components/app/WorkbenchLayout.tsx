// WORKBENCH PREVIEW (UX/UI revamp, local preview only) — the smallest
// skeleton of the single estimation workbench: one section nav over the
// existing journey pages, inside ProjectShell (which loads the project and
// hides the journey steps here). The BOQ section keeps its undo history for
// the tab, so it survives the hand-off to the BOQ builder and back.
//
// Mounted only when WORKBENCH_PREVIEW_ENABLED (lib/workbenchPreview): off by
// default and refused against the production project. That is a
// presentation switch, NOT an access control: row-level security, not this
// screen, decides what a signed-in user can read or change.
import { Navigate, NavLink, Outlet, useLocation, useOutletContext, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";
import type { ProjectShellContext } from "./projectShellContext";

// The journey's steps, in the journey's order (projectShellContext
// PROJECT_STEPS). The workbench opens on the BOQ. Review embeds the review
// screen itself (WorkbenchReview).
const SECTIONS = [
  { to: "drawings", label: "Drawings" },
  { to: "review", label: "Review" },
  { to: "boq", label: "BOQ" },
  { to: "check", label: "Check" },
  { to: "export", label: "Export" },
] as const;

export default function WorkbenchLayout() {
  const shell = useOutletContext<ProjectShellContext>();
  const [params] = useSearchParams();
  const boq = params.get("boq");
  const search = boq ? `?boq=${encodeURIComponent(boq)}` : "";
  const { pathname } = useLocation();

  // Defensive: App.tsx mounts this route only when the gate is on.
  if (!WORKBENCH_PREVIEW_ENABLED) return <p className="text-sm text-muted-foreground">This step is not available.</p>;
  // workbench/ alone opens the BOQ section, keeping the selected BOQ (an
  // index <Navigate to="boq"/> would drop ?boq=).
  if (/\/workbench\/?$/.test(pathname)) return <Navigate to={{ pathname: "boq", search }} replace />;

  return (
    <div className="space-y-4 min-w-0">
      <p role="note" className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Workbench preview — local builds only, off by default. It shows the same project data as the rest of the app.
      </p>
      <nav aria-label="Workbench sections" className="relative -mx-4 px-4 overflow-x-auto border-b">
        <ul className="flex gap-1">
          {SECTIONS.map((s) => (
            <li key={s.to}>
              <NavLink
                to={{ pathname: s.to, search }}
                className={({ isActive }) => cn(
                  "inline-flex px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap",
                  isActive ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet context={shell} />
    </div>
  );
}
