// Projects list for the project journey. Reads the same `projects` rows the
// Ops console's Projects page does; creating/deleting projects stays there.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { projectMatches, projectStatusLabel } from "@/lib/app/projects";
import { appProjectsKey, loadAppProjects } from "@/lib/app/projectsQuery";
import StartGuideButton from "@/components/guide/StartGuideButton";


export default function AppProjects() {
  const [q, setQ] = useState("");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: appProjectsKey,
    queryFn: loadAppProjects,
  });
  const rows = useMemo(() => (data ?? []).filter((p) => projectMatches(p, q)), [data, q]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">Open a project to work through its drawings, BOQ and exports.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <StartGuideButton />
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects"
              aria-label="Search projects" className="pl-8" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading projects">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : isError ? (
        <div role="alert" className="rounded-md border p-6 text-center space-y-3">
          <p className="text-sm">Could not load projects.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : !data?.length ? (
        <div className="rounded-md border p-8 text-center space-y-2">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground">
            Create projects in the <Link to="/ops/projects" className="underline">Ops console</Link>.
          </p>
        </div>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No projects match “{q}”.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card" aria-label="Projects">
          {rows.map((p) => (
            <li key={p.id}>
              <Link to={`/app/projects/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 focus-visible:bg-secondary/60">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[p.client_name, p.location, p.project_type].filter(Boolean).join(" · ") || "No details yet"}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{projectStatusLabel(p.status)}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
