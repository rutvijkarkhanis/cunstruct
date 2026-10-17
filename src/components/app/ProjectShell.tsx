// Project shell for the journey: project header, the Overview tab and the
// five numbered steps, with the active step in an <Outlet/>. Each step opens
// with where it stands (StepStatus) and ends with Back/Next. The selected BOQ
// travels in ?boq= so every step acts on the same one.
import { Link, NavLink, Outlet, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PROJECT_STEPS, type ShellProject, type ProjectShellContext } from "./projectShellContext";
import { BoqPhases, StepNav, StepStatus } from "./Journey";

export default function ProjectShell() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const boq = params.get("boq");
  const { pathname } = useLocation();
  const search = boq ? `?boq=${encodeURIComponent(boq)}` : "";
  const at = PROJECT_STEPS.findIndex((s) => pathname.endsWith(`/${s.to}`));
  const stepLink = (i: number) => (i >= 0 && i < PROJECT_STEPS.length ? { label: PROJECT_STEPS[i].label, to: `${PROJECT_STEPS[i].to}${search}` } : null);
  const { data: project, isLoading, isError, refetch } = useQuery({
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
          <BoqPhases />
          {/* `relative` keeps any visually-hidden (absolutely positioned) text
              inside this scroll container instead of widening the page. */}
          <nav aria-label="Project steps" className="relative mt-2 -mx-4 px-4 overflow-x-auto">
            <ol className="flex gap-1">
              {PROJECT_STEPS.map((s, i) => (
                <li key={s.to} className={i === 1 ? "ml-2 pl-2 border-l" : undefined}>
                  <NavLink
                    to={{ pathname: s.to, search }}
                    className={({ isActive }) => cn(
                      "inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap",
                      isActive ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.stage && <>
                      <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium">{i}</span>
                      <span className="sr-only">Step {i}: </span>
                    </>}{s.label}
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
          // A failed read is not "not found": say so, and offer a retry and a way out.
          <div role="alert" className="text-sm space-y-2">
            <p>Could not load this project. Nothing has been changed.</p>
            <p className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>
              <Link to="/app/projects" className="underline">Back to projects</Link>
            </p>
          </div>
        ) : !project ? (
          <div role="alert" className="text-sm">
            Project not found, or you do not have access. <Link to="/app/projects" className="underline">Back to projects</Link>
          </div>
        ) : (
          <>
            {at >= 0 && PROJECT_STEPS[at].stage && (
              <StepStatus projectId={project.id} stage={PROJECT_STEPS[at].stage!} next={stepLink(at + 1)} />
            )}
            <Outlet context={{ projectId: project.id, project } satisfies ProjectShellContext} />
            {at >= 0 && <StepNav prev={stepLink(at - 1)} next={stepLink(at + 1)} />}
          </>
        )}
      </div>
    </div>
  );
}
