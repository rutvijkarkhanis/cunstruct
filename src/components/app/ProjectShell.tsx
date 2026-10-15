// Project shell for the journey: project header + numbered step tabs, with
// the active step in an <Outlet/>. The selected BOQ travels in ?boq= so the
// BOQ and Export steps act on the same one, and survives switching steps.
import { Link, NavLink, Outlet, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PROJECT_STEPS, type ShellProject, type ProjectShellContext } from "./projectShellContext";

export default function ProjectShell() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const boq = params.get("boq");
  const { data: project, isLoading, isError } = useQuery({
    queryKey: ["app-project", id],
    enabled: !!id,
    queryFn: async (): Promise<ShellProject | null> => {
      const { data, error } = await supabase.from("projects")
        .select("id, name, client_name, location, project_type, status, area_sqft, floors").eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ShellProject | null;
    },
  });

  return (
    <div className="min-w-0">
      <div className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 pt-3">
          <Link to="/app/projects" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Projects
          </Link>
          {isLoading ? (
            <Skeleton className="h-7 w-56 mt-1" />
          ) : (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
              <h1 className="text-xl font-bold break-words min-w-0">{project?.name ?? "Project"}</h1>
              {project && (
                <span className="text-xs text-muted-foreground">
                  {[project.client_name, project.location, project.project_type].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          )}
          {/* `relative` keeps any visually-hidden (absolutely positioned) text
              inside this scroll container instead of widening the page. */}
          <nav aria-label="Project steps" className="relative mt-2 -mx-4 px-4 overflow-x-auto">
            <ol className="flex gap-1">
              {PROJECT_STEPS.map((s, i) => (
                <li key={s.to}>
                  <NavLink
                    to={{ pathname: s.to, search: boq ? `?boq=${encodeURIComponent(boq)}` : "" }}
                    className={({ isActive }) => cn(
                      "inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap",
                      isActive ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium">{i + 1}</span>
                    <span className="sr-only">Step {i + 1}: </span>{s.label}
                  </NavLink>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-5 min-w-0">
        {isLoading ? (
          <div role="status" className="text-sm text-muted-foreground">Loading project…</div>
        ) : isError ? (
          <div role="alert" className="text-sm">Could not load this project.</div>
        ) : !project ? (
          <div role="alert" className="text-sm">
            Project not found, or you do not have access. <Link to="/app/projects" className="underline">Back to projects</Link>
          </div>
        ) : (
          <Outlet context={{ projectId: project.id, project } satisfies ProjectShellContext} />
        )}
      </div>
    </div>
  );
}
