// "Start Guided Walkthrough": choose one of the projects this user can already
// open, see where it actually stands, and start Guide Mode on it. Reads only —
// the project list is the Projects page's own query (row-level security
// decides what is listed) and the state is the journey's own stages.
// Staff only: the guide walks the staff project screens.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Compass, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { projectMatches, projectStatusLabel, type AppProjectRow } from "@/lib/app/projects";
import { appProjectsKey, loadAppProjects } from "@/lib/app/projectsQuery";
import { journeyPath } from "@/lib/app/journey";
import { useSelectedBoq } from "@/components/app/useSelectedBoq";
import { useBoqJourney } from "@/components/app/useBoqJourney";
import { GUIDE_STEPS } from "@/lib/guide/guide";
import { startGuide, useGuideSession } from "@/lib/guide/guideSession";
import { cn } from "@/lib/utils";

export default function StartGuideButton({ className }: { className?: string }) {
  const { user, isStaff } = useAuth();
  const session = useGuideSession(user?.id);
  const [open, setOpen] = useState(false);
  if (!user || !isStaff) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Compass className="h-4 w-4" aria-hidden="true" /> Start Guided Walkthrough
      </Button>
      {session && (
        <Link className="text-sm underline" to={journeyPath(session.projectId, GUIDE_STEPS[session.step].route, null)}>
          Resume guide: {session.projectName}, step {session.step + 1} of {GUIDE_STEPS.length}
        </Link>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          {open && <PickProject userId={user.id} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PickProject({ userId, onDone }: { userId: string; onDone: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<AppProjectRow | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: appProjectsKey, queryFn: loadAppProjects });
  const rows = useMemo(() => (data ?? []).filter((p) => projectMatches(p, q)), [data, q]);

  const start = () => {
    if (!picked) return;
    startGuide(userId, picked.id, picked.name);
    onDone();
    navigate(journeyPath(picked.id, GUIDE_STEPS[0].route, null));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Guided walkthrough</DialogTitle>
        <DialogDescription>
          Choose an existing project. The guide walks through its real drawings, quantities, review, BOQ, checks and export.
          It only reads: starting or moving through it changes nothing.
        </DialogDescription>
      </DialogHeader>
      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading projects">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : isError ? (
        <div role="alert" className="rounded-md border p-4 text-sm space-y-2">
          <p>Could not load your projects.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">You have no projects to walk through yet. Projects are created in the Ops console.</p>
      ) : (
        <div className="space-y-2 min-w-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="pl-8" />
          </div>
          <ul role="listbox" aria-label="Your projects" className="max-h-56 overflow-y-auto divide-y rounded-md border">
            {rows.map((p) => (
              <li key={p.id} role="option" aria-selected={picked?.id === p.id}>
                <button type="button" onClick={() => setPicked(p)}
                  className={cn("w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-secondary/60", picked?.id === p.id && "bg-secondary")}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{p.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {[p.client_name, p.location, p.project_type].filter(Boolean).join(" · ") || "No details recorded"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{projectStatusLabel(p.status)}</span>
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-3 py-4 text-sm text-muted-foreground text-center">No projects match “{q}”.</li>}
          </ul>
          {picked && <ProjectState project={picked} />}
        </div>
      )}
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={start} disabled={!picked}>Start guide</Button>
      </DialogFooter>
    </>
  );
}

/** Where the chosen project stands now, from the journey stages its screens show. */
function ProjectState({ project }: { project: AppProjectRow }) {
  const sel = useSelectedBoq(project.id);
  const j = useBoqJourney(project.id, sel.selected?.id ?? null, sel.boqs.length > 0);
  return (
    <section aria-label="Selected project" className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
      <p><span className="font-semibold">{project.name}</span> <span className="text-muted-foreground">· {projectStatusLabel(project.status)}</span></p>
      {sel.loading || j.loading ? (
        <p role="status" className="text-muted-foreground">Reading where this project stands…</p>
      ) : sel.error || j.error ? (
        <p role="alert">Could not read this project's current state. You can still start the guide; each step will say what it could not load.</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            {sel.selected ? `BOQ: ${sel.selected.name}${sel.boqs.length > 1 ? ` (1 of ${sel.boqs.length}; switch on the BOQ screen)` : ""}` : "This project has no BOQ yet."}
          </p>
          <ul className="space-y-0.5">
            {j.stages.map((s) => <li key={s.key}><span className="font-medium">{s.title}:</span> {s.summary}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
