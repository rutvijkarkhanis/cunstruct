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
import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateBoqDialog } from "@/components/ops/workspace/WorkspaceBoqPanel";
import { useBoqManagement } from "@/hooks/useBoqManagement";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSelectedBoq } from "./useSelectedBoq";
import { parseBoqName, renameBoq } from "@/lib/app/boqRename";
import { cn } from "@/lib/utils";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";
import type { ProjectShellContext } from "./projectShellContext";

// The journey's steps, in the journey's order (projectShellContext
// PROJECT_STEPS), opening on the Overview as the journey does. Review embeds
// the review screen itself (WorkbenchReview); the BOQ edits quantities and
// rates in place.
const SECTIONS = [
  { to: "overview", label: "Overview" },
  { to: "drawings", label: "Drawings" },
  { to: "review", label: "Review" },
  { to: "boq", label: "BOQ" },
  { to: "check", label: "Check" },
  { to: "export", label: "Export" },
] as const;

/** A new BOQ for this project (the shared useBoqManagement creation, the Ops
 *  workspace's dialog), opened at once in the workbench's BOQ section. */
function NewBoq({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const { scopes, creatingBoq, createBoq } = useBoqManagement(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />New BOQ</Button>
      <CreateBoqDialog open={open} onOpenChange={setOpen} scopes={scopes ?? []} scopesLoaded={scopes !== undefined} creating={creatingBoq} createBoq={createBoq}
        onCreated={(id) => {
          setOpen(false);
          void qc.invalidateQueries({ queryKey: ["workspace-project-boqs", projectId] });
          void qc.invalidateQueries({ queryKey: ["app-overview-lines", projectId] });
          navigate({ pathname: "boq", search: `?boq=${encodeURIComponent(id)}` });
        }} />
    </>
  );
}

/** Rename the selected BOQ (guarded on the name shown, lib/app/boqRename). */
function RenameBoq({ projectId }: { projectId: string }) {
  const sel = useSelectedBoq(projectId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = sel.selected;
  if (!current) return null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["workspace-project-boqs", projectId] });
    void qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
    void qc.invalidateQueries({ queryKey: ["app-export-boq", current.id] });
    void qc.invalidateQueries({ queryKey: ["rw-boq", current.id] });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseBoqName(draft);
    if ("error" in r) { setError(r.error); return; }
    if (r.name === current.name) { setOpen(false); return; }
    setSaving(true);
    try {
      const out = await renameBoq(current.id, current.name, r.name);
      if (out === "saved") toast.success("BOQ renamed");
      else toast.error("Not renamed: this BOQ was renamed or changed elsewhere since it was loaded. The current name is now shown.");
      // Either way the dialog closes, so the name now saved is what is on screen.
      setOpen(false);
    } catch (err) {
      toast.error(`Not renamed — ${err instanceof Error ? err.message : "unknown error"}`);
    } finally { setSaving(false); refresh(); }
  };
  return (
    <>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { setDraft(current.name); setError(null); setOpen(true); }}>Rename BOQ</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Rename BOQ</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="wb-rename" className="text-xs font-medium text-muted-foreground">BOQ name</label>
              <Input id="wb-rename" value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }} aria-invalid={!!error} />
              {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save name"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorkbenchLayout() {
  const shell = useOutletContext<ProjectShellContext>();
  const [params] = useSearchParams();
  const boq = params.get("boq");
  const search = boq ? `?boq=${encodeURIComponent(boq)}` : "";
  const { pathname } = useLocation();

  // Defensive: App.tsx mounts this route only when the gate is on.
  if (!WORKBENCH_PREVIEW_ENABLED) return <p className="text-sm text-muted-foreground">This step is not available.</p>;
  // workbench/ alone opens the Overview, keeping the selected BOQ (an
  // index <Navigate to="overview"/> would drop ?boq=).
  if (/\/workbench\/?$/.test(pathname)) return <Navigate to={{ pathname: "overview", search }} replace />;

  return (
    <div className="space-y-4 min-w-0">
      <p role="note" className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Workbench preview — off by default, and never built against the production project. It shows the same project data as the rest of the app.
      </p>
      <div className="flex items-end gap-2 border-b -mx-4 px-4">
      <nav aria-label="Workbench sections" className="relative overflow-x-auto flex-1 min-w-0">
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
      <div className="pb-1.5 flex gap-1"><RenameBoq projectId={shell.projectId} /><NewBoq projectId={shell.projectId} /></div>
      </div>
      <Outlet context={shell} />
    </div>
  );
}
