import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Upload, ChevronUp, ChevronDown, Trash2, Pencil, Check, X, Layers } from "lucide-react";
import { SCOPE_KINDS, type ProjectScope } from "@/lib/projectDocs";
import { parseBoqImport } from "@/lib/boqImport";

interface BoqRow { id: string; name: string; description: string | null; scope_id: string | null; sort: number; status: string; }
const NEW_SCOPE = "__new__";
type Mode = null | "create" | "import";

export default function ProjectBoqs() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: scopes } = useQuery({
    queryKey: ["project-scopes", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_scope")
        .select("id, project_id, name, kind, sort, status").eq("project_id", projectId!).order("sort");
      return (data ?? []) as ProjectScope[];
    },
  });

  const { data: boqs } = useQuery({
    queryKey: ["project-boqs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("boq")
        .select("id, name, description, scope_id, sort, status").eq("project_id", projectId!)
        .order("sort").order("created_at");
      return (data ?? []) as BoqRow[];
    },
  });

  const { data: counts } = useQuery({
    queryKey: ["project-boq-counts", projectId, (boqs ?? []).map((b) => b.id).join(",")],
    enabled: !!boqs?.length,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all((boqs ?? []).map(async (b) => {
        const { count } = await supabase.from("boq_line").select("id", { count: "exact", head: true }).eq("boq_id", b.id);
        out[b.id] = count ?? 0;
      }));
      return out;
    },
  });

  const scopeName = (sid: string | null) => scopes?.find((s) => s.id === sid)?.name ?? "—";

  // ---- Shared form state (Create + Import) --------------------------------
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeId, setScopeId] = useState<string>("");
  const [newScopeName, setNewScopeName] = useState("");
  const [newScopeKind, setNewScopeKind] = useState<string>("floor");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setMode(null); setName(""); setDescription(""); setScopeId("");
    setNewScopeName(""); setNewScopeKind("floor"); setImportText("");
  };

  const preview = useMemo(() => (mode === "import" && importText.trim() ? parseBoqImport(importText) : null), [mode, importText]);

  // Resolve (creating if needed) the scope to use for a new BOQ.
  const resolveScopeId = async (): Promise<string | null> => {
    if (!scopeId) { toast.error("Select or create a scope"); return null; }
    if (scopeId !== NEW_SCOPE) return scopeId;
    if (!newScopeName.trim()) { toast.error("Enter the new scope name"); return null; }
    const { data, error } = await supabase.from("project_scope")
      .insert({ project_id: projectId, name: newScopeName.trim(), kind: newScopeKind, sort: scopes?.length ?? 0 })
      .select("id").single();
    if (error) { toast.error(error.message); return null; }
    return (data as { id: string }).id;
  };

  const createBoq = async () => {
    if (!projectId) return;
    if (!name.trim()) return toast.error("Enter a BOQ name");
    setBusy(true);
    try {
      const sid = await resolveScopeId();
      if (!sid) return;
      const { data, error } = await supabase.from("boq")
        .insert({ project_id: projectId, name: name.trim(), description: description.trim() || null, scope_id: sid, sort: boqs?.length ?? 0, spec: {}, created_by: user?.id })
        .select("id").single();
      if (error) throw error;
      finishAndOpen((data as { id: string }).id, "BOQ created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create BOQ");
    } finally { setBusy(false); }
  };

  // Import an existing BOQ: create the BOQ (no drawing analysis) and insert its lines
  // verbatim as manual lines. The user's quantities/rates are the source of truth.
  const importBoq = async () => {
    if (!projectId) return;
    if (!name.trim()) return toast.error("Enter a BOQ name");
    const parsed = preview;
    if (!parsed || !parsed.lines.length) return toast.error("No BOQ lines to import — paste your BOQ or upload a CSV");
    setBusy(true);
    try {
      const sid = await resolveScopeId();
      if (!sid) return;
      const { data, error } = await supabase.from("boq")
        .insert({ project_id: projectId, name: name.trim(), description: description.trim() || null, scope_id: sid, sort: boqs?.length ?? 0, spec: { _source: "import" }, created_by: user?.id })
        .select("id").single();
      if (error) throw error;
      const boqId = (data as { id: string }).id;
      const rows = parsed.lines.map((l, i) => ({
        boq_id: boqId,
        section: l.section ?? "Imported",
        dsr_code: l.code ?? null,
        description: l.description,
        unit: l.unit ?? null,
        qty: l.qty,
        custom_rate: l.rate ?? null,   // the user's rate is the source of truth
        included: true,
        source: "manual",              // never touched by the drawing/regeneration engine
        sort: i,
      }));
      const { error: lerr } = await supabase.from("boq_line").insert(rows);
      if (lerr) throw lerr;
      finishAndOpen(boqId, `Imported ${rows.length} line${rows.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import BOQ");
    } finally { setBusy(false); }
  };

  const finishAndOpen = (boqId: string, msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
    qc.invalidateQueries({ queryKey: ["project-scopes", projectId] });
    resetForm();
    navigate(boqId);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  // ---- Rename / description inline edit ------------------------------------
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const startEdit = (b: BoqRow) => { setEditId(b.id); setEditName(b.name); setEditDesc(b.description ?? ""); };
  const saveEdit = async () => {
    if (!editId) return;
    if (!editName.trim()) return toast.error("Name can't be empty");
    const { error } = await supabase.from("boq").update({ name: editName.trim(), description: editDesc.trim() || null }).eq("id", editId);
    if (error) return toast.error(error.message);
    setEditId(null);
    qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
  };

  const move = async (b: BoqRow, dir: -1 | 1) => {
    const list = [...(boqs ?? [])];
    const i = list.findIndex((x) => x.id === b.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], c = list[j];
    const aSort = a.sort ?? i, cSort = c.sort ?? j;
    await Promise.all([
      supabase.from("boq").update({ sort: cSort }).eq("id", a.id),
      supabase.from("boq").update({ sort: aSort }).eq("id", c.id),
    ]);
    qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
  };

  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const del = async (bid: string) => {
    const { error } = await supabase.from("boq").delete().eq("id", bid);
    if (error) return toast.error(error.message);
    setConfirmDel(null);
    toast.success("BOQ deleted");
    qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
  };

  // Shared scope + name + description fields for both Create and Import panels.
  const ScopeFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Scope</label>
        <Select value={scopeId} onValueChange={setScopeId}>
          <SelectTrigger><SelectValue placeholder="Select or create a scope" /></SelectTrigger>
          <SelectContent>
            {(scopes ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            <SelectItem value={NEW_SCOPE}>+ New scope…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {scopeId === NEW_SCOPE && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">New scope name</label>
            <Input value={newScopeName} onChange={(e) => setNewScopeName(e.target.value)} placeholder="e.g. Terrace, Structural" />
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
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Floor 2 Electrical" />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">BOQs</h2>
          <p className="text-sm text-muted-foreground">Define the BOQ structure for this project. One scope can have several BOQs.</p>
        </div>
        {!mode && (
          <div className="flex gap-2">
            <Button onClick={() => setMode("create")}><Plus className="h-4 w-4 mr-2" />Create BOQ</Button>
            <Button variant="outline" onClick={() => setMode("import")}><Upload className="h-4 w-4 mr-2" />Import Existing BOQ</Button>
          </div>
        )}
      </div>

      {mode === "create" && (
        <Card><CardContent className="p-4 space-y-3">
          {ScopeFields}
          <div className="flex gap-2">
            <Button onClick={createBoq} disabled={busy}>{busy ? "Creating…" : "Create BOQ"}</Button>
            <Button variant="ghost" onClick={resetForm} disabled={busy}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {mode === "import" && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Import a BOQ you already have — its lines, quantities, units and rates are kept exactly as given. No drawing analysis runs.
            Paste rows from Excel/Google Sheets, or upload a CSV.
          </p>
          {ScopeFields}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Paste your BOQ (or upload a CSV)</label>
              <label className="text-xs text-primary hover:underline cursor-pointer">
                Upload CSV<input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
            <Textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8}
              placeholder={"Description, Unit, Qty, Rate, Amount\nEuropean WC with cistern, each, 5, 1100, 5500\n15A socket point, point, 25, 450, 11250"} className="font-mono text-xs" />
          </div>
          {preview && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div className="font-medium">{preview.lines.length} line{preview.lines.length === 1 ? "" : "s"} detected</div>
              {preview.lines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted-foreground text-left"><th className="py-1 pr-3">Description</th><th className="pr-3">Unit</th><th className="pr-3 text-right">Qty</th><th className="pr-3 text-right">Rate</th></tr></thead>
                    <tbody>
                      {preview.lines.slice(0, 6).map((l, i) => (
                        <tr key={i} className="border-t"><td className="py-1 pr-3">{l.description}</td><td className="pr-3">{l.unit ?? "—"}</td><td className="pr-3 text-right tabular-nums">{l.qty}</td><td className="pr-3 text-right tabular-nums">{l.rate != null ? l.rate.toLocaleString("en-IN") : "—"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.lines.length > 6 && <div className="text-muted-foreground pt-1">…and {preview.lines.length - 6} more</div>}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <ul className="text-xs text-amber-600 dark:text-amber-400 list-disc pl-4">
                  {preview.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={importBoq} disabled={busy || !preview?.lines.length}>{busy ? "Importing…" : `Import ${preview?.lines.length ?? 0} lines`}</Button>
            <Button variant="ghost" onClick={resetForm} disabled={busy}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {!boqs?.length && !mode && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No BOQs yet. Create one from scratch, or import a BOQ you already have.</CardContent></Card>
      )}

      <div className="space-y-2">
        {(boqs ?? []).map((b, i) => (
          <Card key={b.id}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex flex-col">
                <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(b, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(b, 1)} disabled={i === (boqs!.length - 1)} aria-label="Move down"><ChevronDown className="h-4 w-4" /></Button>
              </div>
              <div className="min-w-0 flex-1">
                {editId === b.id ? (
                  <div className="space-y-2">
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" />
                    <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="h-8" placeholder="Description" />
                  </div>
                ) : (
                  <>
                    <div className="font-medium truncate">{b.name}</div>
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{scopeName(b.scope_id)}</span>
                      <span>· {counts?.[b.id] ?? 0} items</span>
                      {b.description && <span className="truncate">· {b.description}</span>}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {editId === b.id ? (
                  <>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit} aria-label="Save"><Check className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)} aria-label="Cancel"><X className="h-4 w-4" /></Button>
                  </>
                ) : confirmDel === b.id ? (
                  <>
                    <span className="text-xs text-muted-foreground">Delete?</span>
                    <Button size="sm" variant="destructive" className="h-8" onClick={() => del(b.id)}>Yes</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setConfirmDel(null)}>No</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" onClick={() => navigate(b.id)}>Open</Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(b)} aria-label="Rename"><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setConfirmDel(b.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
