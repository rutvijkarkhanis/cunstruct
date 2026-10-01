// WORKSPACE BOQ PANEL — Phase 11 Stage C3. A compact, contextual BOQ
// selector/creator for the Workspace — never a second BOQ dashboard and
// never the full editor. Reuses the EXISTING boq/boq_line/project_scope
// model and the SAME shared useBoqManagement hook ProjectBoqs.tsx consumes,
// so "create a BOQ" has exactly one implementation regardless of where it's
// invoked from.
//
// "Open full BOQ editor" always links to the existing, untouched
// OpsBoqBuilder route — this panel only answers "which BOQ, and can I make
// one" without embedding the editor itself.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ClipboardCheck, ExternalLink, Plus } from "lucide-react";
import { formatINR } from "@/lib/forecastEngine";
import { useBoqManagement, NEW_SCOPE } from "@/hooks/useBoqManagement";
import { SCOPE_KINDS } from "@/lib/projectDocs";
import type { WorkspaceMode } from "@/lib/review/workspaceState";

export interface WorkspaceBoqPanelProps {
  projectId: string;
  /** The BOQ named in the URL (?boq=), or null when none is specified. May
   *  name a BOQ that doesn't exist or belongs to another project — this
   *  panel verifies it against the project's real BOQs rather than trusting
   *  it blindly. */
  activeBoqId: string | null;
  onEnterMode: (mode: WorkspaceMode, boqId?: string) => void;
}

export default function WorkspaceBoqPanel({ projectId, activeBoqId, onEnterMode }: WorkspaceBoqPanelProps) {
  const { scopes, boqs, counts, creatingBoq, createBoq } = useBoqManagement(projectId);
  const [showList, setShowList] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const boqsLoaded = boqs !== undefined;
  const requestedBoq = activeBoqId ? (boqs ?? []).find((b) => b.id === activeBoqId) : null;
  // A ?boq= that doesn't resolve to a real BOQ of THIS project — stale link,
  // deleted BOQ, or a BOQ that belongs elsewhere. Never silently substituted;
  // surfaced, then the user picks a real one below.
  const requestedInvalid = boqsLoaded && !!activeBoqId && !requestedBoq;

  // No explicit/valid selection: fall back to the only BOQ when there's
  // exactly one (no real ambiguity) — otherwise require an explicit pick.
  const resolvedBoqId = requestedBoq ? requestedBoq.id : (boqs?.length === 1 ? boqs![0].id : null);

  const openCreate = () => setCreateOpen(true);
  const onCreated = (newId: string) => {
    setCreateOpen(false);
    setShowList(false);
    onEnterMode("boq", newId);
  };
  const onSelect = (id: string) => {
    setShowList(false);
    onEnterMode("boq", id);
  };

  return (
    <div className="space-y-3">
      {requestedInvalid && (
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>This BOQ couldn't be found in this project — it may have been deleted or belongs elsewhere. Pick a BOQ below.</span>
        </div>
      )}

      {!boqsLoaded ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : boqs!.length === 0 ? (
        <NoBoq onCreate={openCreate} />
      ) : resolvedBoqId && !showList ? (
        <ActiveBoqCard
          projectId={projectId}
          boqId={resolvedBoqId}
          name={boqs!.find((b) => b.id === resolvedBoqId)?.name ?? "BOQ"}
          onReview={() => onEnterMode("review", resolvedBoqId)}
          onChange={() => setShowList(true)}
        />
      ) : (
        <BoqList
          boqs={boqs!}
          counts={counts}
          activeBoqId={resolvedBoqId}
          onSelect={onSelect}
          onCreate={openCreate}
        />
      )}

      <CreateBoqDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        scopes={scopes ?? []}
        scopesLoaded={scopes !== undefined}
        creating={creatingBoq}
        createBoq={createBoq}
        onCreated={onCreated}
      />
    </div>
  );
}

function NoBoq({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">No BOQ created yet. Create a BOQ to structure quantities and rates.</p>
      <Button size="sm" className="gap-1.5" onClick={onCreate}><Plus className="w-3.5 h-3.5" />Create BOQ</Button>
    </div>
  );
}

/** The compact "which BOQ am I working with" card — a summary, never the
 *  full priced editor. Base total only (qty × rate), explicitly labeled as
 *  such since it doesn't apply the BOQ's markup/overhead spec the way
 *  OpsBoqBuilder's final total does. */
function ActiveBoqCard({ projectId, boqId, name, onReview, onChange }: { projectId: string; boqId: string; name: string; onReview: () => void; onChange: () => void }) {
  const { data: lines } = useQuery({
    queryKey: ["workspace-boq-lines", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data } = await supabase.from("boq_line").select("qty, dsr_rate, custom_rate, included").eq("boq_id", boqId);
      return data ?? [];
    },
  });
  const includedLines = (lines ?? []).filter((l) => l.included);
  const baseTotal = includedLines.reduce((sum, l) => sum + (l.qty ?? 0) * ((l.custom_rate ?? l.dsr_rate) ?? 0), 0);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Active BOQ</div>
        <div className="text-sm font-semibold">{name}</div>
        <div className="text-[11px] text-muted-foreground">
          {(lines ?? []).length} line{(lines ?? []).length === 1 ? "" : "s"} · {formatINR(baseTotal)} base (excl. markup)
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={onReview}>
          <ClipboardCheck className="w-3.5 h-3.5" /> Review this BOQ's items
        </Button>
        <Link to={`/ops/projects/${projectId}/boqs/${boqId}`}>
          <Button size="sm" variant="default" className="w-full justify-start gap-2">
            <ExternalLink className="w-3.5 h-3.5" /> Open BOQ
          </Button>
        </Link>
        <Button size="sm" variant="ghost" onClick={onChange}>Change BOQ</Button>
      </div>
    </div>
  );
}

function BoqList({ boqs, counts, activeBoqId, onSelect, onCreate }: {
  boqs: { id: string; name: string }[];
  counts: Record<string, number> | undefined;
  activeBoqId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">BOQ</div>
      <div className="space-y-0.5">
        {boqs.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b.id)}
            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs rounded-sm border-l-[3px] transition-colors ${
              b.id === activeBoqId ? "bg-primary/10 border-l-primary font-semibold text-foreground" : "border-l-transparent hover:bg-muted/50 text-foreground/90"
            }`}
          >
            <span className="truncate">{b.name}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{counts?.[b.id] ?? 0} lines</span>
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" className="gap-1.5 w-full justify-start" onClick={onCreate}>
        <Plus className="w-3.5 h-3.5" /> Create BOQ
      </Button>
    </div>
  );
}

function CreateBoqDialog({ open, onOpenChange, scopes, scopesLoaded, creating, createBoq, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopes: { id: string; name: string }[];
  scopesLoaded: boolean;
  creating: boolean;
  createBoq: ReturnType<typeof useBoqManagement>["createBoq"];
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [newScopeName, setNewScopeName] = useState("");
  const [newScopeKind, setNewScopeKind] = useState("floor");

  // Reset the form each time the dialog opens.
  const onDialogOpenChange = (next: boolean) => {
    if (next) {
      setName(""); setScopeId(""); setNewScopeName(""); setNewScopeKind("floor");
    }
    onOpenChange(next);
  };

  // Default to the project's only scope once it's loaded — there's no real
  // ambiguity to ask about. Deliberately re-checked whenever `scopes`
  // resolves (not just at open-time), since the scopes query can still be
  // in flight the moment the dialog opens; never overwrites a choice the
  // user already made (guarded by `scopeId === ""`).
  useEffect(() => {
    if (!open || scopeId !== "" || !scopesLoaded) return;
    if (scopes.length === 1) setScopeId(scopes[0].id);
    else if (scopes.length === 0) setScopeId(NEW_SCOPE);
  }, [open, scopes, scopeId, scopesLoaded]);

  const submit = async () => {
    const id = await createBoq({ name, scopeId, newScopeName, newScopeKind });
    if (id) onCreated(id);
  };

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Create BOQ</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Scope</label>
            <Select value={scopeId} onValueChange={setScopeId}>
              <SelectTrigger><SelectValue placeholder="Select or create a scope" /></SelectTrigger>
              <SelectContent>
                {scopes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                <SelectItem value={NEW_SCOPE}>+ New scope…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scopeId === NEW_SCOPE && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">New scope name</label>
                <Input value={newScopeName} onChange={(e) => setNewScopeName(e.target.value)} placeholder="e.g. Terrace" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Kind</label>
                <Select value={newScopeKind} onValueChange={setNewScopeKind}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SCOPE_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">BOQ name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ground Floor BOQ" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>Cancel</Button>
            <Button onClick={submit} disabled={creating}>{creating ? "Creating…" : "Create"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
