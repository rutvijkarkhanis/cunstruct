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
import { Plus, Upload, ChevronUp, ChevronDown, Trash2, Pencil, Check, X, Layers, FolderInput, Braces, FileText, GripVertical } from "lucide-react";
import { SCOPE_KINDS, type ProjectScope } from "@/lib/projectDocs";
import { parseBoqImport } from "@/lib/boqImport";
import { parseBoqEvalJson, evalLinesToRows, pendingCount } from "@/lib/boqEvalJson";
import { computeCommercials, roundRupee, openProjectQuote, type ProjectQuoteBoq, type QuoteSubHead } from "@/lib/boqDsrDocument";

interface BoqRow { id: string; name: string; description: string | null; scope_id: string | null; sort: number; status: string; }
interface MovableBoq { id: string; name: string; project_id: string | null; scope_id: string | null; updated_at: string; }
const NEW_SCOPE = "__new__";
type Mode = null | "create" | "import" | "move" | "json" | "share";

// Insert eval-derived boq_line rows, retrying without the optional provenance
// columns (basis / basis_note) on a stale DB that hasn't run that migration.
async function insertEvalRows(rows: ReturnType<typeof evalLinesToRows>) {
  let { error } = await supabase.from("boq_line").insert(rows);
  if (error && /\bbasis\b|schema cache|could not find|does not exist/i.test(error.message)) {
    const stripped = rows.map(({ basis, basis_note, ...r }) => r);
    ({ error } = await supabase.from("boq_line").insert(stripped));
  }
  if (error) throw error;
}

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

  const { data: project } = useQuery({
    queryKey: ["project-meta", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("projects")
        .select("name, client_name, location, project_type, floors, area_sqft").eq("id", projectId!).single();
      return data as { name: string; client_name: string | null; location: string | null; project_type: string | null; floors: number | null; area_sqft: number | null } | null;
    },
  });

  const scopeName = (sid: string | null) => scopes?.find((s) => s.id === sid)?.name ?? "—";

  // BOQs that can be moved into this project: standalone (no project) or under a
  // different project. Loaded only when the Move panel is open.
  const [mode, setMode] = useState<Mode>(null);
  const { data: movable } = useQuery({
    queryKey: ["movable-boqs", projectId],
    enabled: mode === "move" && !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("boq")
        .select("id, name, project_id, scope_id, updated_at")
        .or(`project_id.is.null,project_id.neq.${projectId}`)
        .order("updated_at", { ascending: false });
      return (data ?? []) as MovableBoq[];
    },
  });
  const { data: projectNames } = useQuery({
    queryKey: ["project-names"],
    enabled: mode === "move",
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name");
      const m: Record<string, string> = {};
      for (const p of (data ?? []) as { id: string; name: string }[]) m[p.id] = p.name;
      return m;
    },
  });

  // ---- Shared form state (Create / Generate / Import / Move) ---------------
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeId, setScopeId] = useState<string>("");
  const [newScopeName, setNewScopeName] = useState("");
  const [newScopeKind, setNewScopeKind] = useState<string>("floor");
  const [importText, setImportText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [moveBoqId, setMoveBoqId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setMode(null); setName(""); setDescription(""); setScopeId("");
    setNewScopeName(""); setNewScopeKind("floor"); setImportText(""); setJsonText(""); setMoveBoqId("");
  };

  const preview = useMemo(() => (mode === "import" && importText.trim() ? parseBoqImport(importText) : null), [mode, importText]);
  const jsonPreview = useMemo(() => (mode === "json" && jsonText.trim() ? parseBoqEvalJson(jsonText) : null), [mode, jsonText]);

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

  // Import an existing BOQ: create the BOQ and insert its lines verbatim as manual
  // lines, never re-interpreted. The user's quantities/rates are the source of truth.
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

  // Generate a BOQ from a structured drawing-evaluation JSON. Deterministic: the JSON
  // is validated and its requirements[] are converted into lines verbatim (no AI, no
  // drawing analysis). A numeric qty is kept; a null qty becomes a quantity-pending
  // line — a count is never fabricated.
  const generateFromJson = async () => {
    if (!projectId) return;
    if (!name.trim()) return toast.error("Enter a BOQ name");
    const parsed = jsonPreview;
    if (!parsed) return toast.error("Paste the evaluation JSON");
    if (!parsed.ok) return toast.error(parsed.error ?? "Invalid JSON");
    setBusy(true);
    try {
      const sid = await resolveScopeId();
      if (!sid) return;
      const { data, error } = await supabase.from("boq")
        .insert({ project_id: projectId, name: name.trim(), description: description.trim() || null, scope_id: sid, sort: boqs?.length ?? 0, spec: { _source: "json" }, created_by: user?.id })
        .select("id").single();
      if (error) throw error;
      const boqId = (data as { id: string }).id;
      const rows = evalLinesToRows(boqId, parsed.lines);
      await insertEvalRows(rows);
      finishAndOpen(boqId, `Generated ${rows.length} line${rows.length === 1 ? "" : "s"} from JSON`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate from JSON");
    } finally { setBusy(false); }
  };

  // Move an existing BOQ (standalone or under another project) into this project.
  // Non-destructive: its lines, quantities, rates and spec are untouched — only its
  // parent project and scope change.
  const moveBoq = async () => {
    if (!projectId) return;
    if (!moveBoqId) return toast.error("Pick a BOQ to move");
    setBusy(true);
    try {
      const sid = await resolveScopeId();
      if (!sid) return;
      const { error } = await supabase.from("boq")
        .update({ project_id: projectId, scope_id: sid, sort: boqs?.length ?? 0 }).eq("id", moveBoqId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["movable-boqs", projectId] });
      finishAndOpen(moveBoqId, "BOQ moved into this project");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move BOQ");
    } finally { setBusy(false); }
  };

  // ---- Share with client: one combined priced PDF of all BOQs ---------------
  const [sharing, setSharing] = useState(false);
  const [clientName, setClientName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [firmTagline, setFirmTagline] = useState("");

  // Group one BOQ's included, quantified lines into numbered sub-heads (same ordering
  // as the builder: by DSR chapter, then name), each with a priced subtotal.
  const subheadsFromLines = (lns: { section: string | null; dsr_code: string | null; description: string | null; unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null }[]): QuoteSubHead[] => {
    const groups = new Map<string, typeof lns>();
    for (const l of lns) { const sec = l.section ?? "Other"; const a = groups.get(sec) ?? []; a.push(l); groups.set(sec, a); }
    const chapterNo = (g: typeof lns) => { const coded = g.find((l) => l.dsr_code); return coded ? parseInt(coded.dsr_code!.split(".")[0], 10) || 900 : 999; };
    return [...groups.entries()]
      .sort((a, b) => chapterNo(a[1]) - chapterNo(b[1]) || a[0].localeCompare(b[0]))
      .map(([name, g], gi) => {
        const no = gi + 1;
        let item = 0;
        const lines = g.map((l) => {
          const rate = l.custom_rate ?? l.dsr_rate;
          return { no: `${no}.${String(++item).padStart(2, "0")}`, code: l.dsr_code, spec: l.description ?? "", qty: l.qty, unit: l.unit ?? "", rate, amount: rate != null ? roundRupee(l.qty * rate) : null };
        });
        const subtotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
        return { no, name, subtotal, lines };
      });
  };

  const shareQuote = async (branding: "firm" | "client") => {
    const list = boqs ?? [];
    if (!list.length) return toast.error("No BOQs to share");
    if (branding === "client" && !clientName.trim() && !project?.client_name) return toast.error("Enter the client's name for the final version");
    setSharing(true);
    try {
      const ids = list.map((b) => b.id);
      const [{ data: specRows }, { data: lineRows, error }] = await Promise.all([
        supabase.from("boq").select("id, spec").in("id", ids),
        supabase.from("boq_line").select("boq_id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, included, sort").in("boq_id", ids).order("sort"),
      ]);
      if (error) throw error;
      const specById = new Map<string, Record<string, unknown>>();
      for (const r of (specRows ?? []) as { id: string; spec: Record<string, unknown> | null }[]) specById.set(r.id, r.spec ?? {});
      type Ln = { boq_id: string; section: string | null; dsr_code: string | null; description: string | null; unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null; included: boolean };
      const byBoq = new Map<string, Ln[]>();
      for (const l of (lineRows ?? []) as Ln[]) { const a = byBoq.get(l.boq_id) ?? []; a.push(l); byBoq.set(l.boq_id, a); }

      const quoteBoqs: ProjectQuoteBoq[] = [];
      for (const b of list) {
        const lns = (byBoq.get(b.id) ?? []).filter((l) => l.included && l.qty != null && l.qty > 0);
        const subheads = subheadsFromLines(lns);
        if (!subheads.length) continue;                         // skip a BOQ with no priced lines
        const spec = specById.get(b.id) ?? {};
        const pct = (k: string, d: number) => Number(spec[k] ?? d);
        const works = subheads.reduce((s, sh) => s + sh.subtotal, 0);
        const commercials = computeCommercials(works, {
          costIndexPct: pct("_cost_index_pct", 0), contingencyPct: pct("_contingency_pct", 3),
          overheadPct: pct("_overhead_pct", 15), cessPct: pct("_cess_pct", 1), gstPct: pct("_gst_pct", 18),
        });
        quoteBoqs.push({ name: b.name, scope: scopeName(b.scope_id), subheads, commercials });
      }
      if (!quoteBoqs.length) return toast.error("No priced BOQ lines to share yet — add rates first");

      const firmFromSpec = [...specById.values()].map((s) => String(s._firm_name ?? "").trim()).find(Boolean) ?? "";
      const taglineFromSpec = [...specById.values()].map((s) => String(s._firm_tagline ?? "").trim()).find(Boolean) ?? "";
      const gen = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      const ok = openProjectQuote({
        projectName: project?.name ?? "Project",
        clientName: clientName.trim() || project?.client_name || null,
        location: project?.location, projectType: project?.project_type,
        floors: project?.floors, builtUpSqft: project?.area_sqft,
        generatedOn: gen, branding,
        firmName: branding === "firm" ? (firmName.trim() || firmFromSpec || null) : null,
        firmTagline: branding === "firm" ? (firmTagline.trim() || taglineFromSpec || null) : null,
      }, quoteBoqs);
      if (!ok) toast.error("Allow pop-ups to open the quote");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to build the quote");
    } finally { setSharing(false); }
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
  const onJsonFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJsonText(String(reader.result ?? ""));
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

  // Reorder by rewriting a sequential sort (0..n-1) for the WHOLE list, so ordering is
  // deterministic even when the existing sort values collide (BOQs made via different
  // paths often share a sort). This order is what the generated/combined BOQ follows.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const reorder = async (from: number, to: number) => {
    const list = [...(boqs ?? [])];
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const next = list.map((b, i) => ({ ...b, sort: i }));
    qc.setQueryData(["project-boqs", projectId], next);           // optimistic
    const results = await Promise.all(next.map((b) => supabase.from("boq").update({ sort: b.sort }).eq("id", b.id)));
    const err = results.find((r) => r.error)?.error;
    if (err) toast.error(err.message);
    qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
  };
  const move = (b: BoqRow, dir: -1 | 1) => {
    const i = (boqs ?? []).findIndex((x) => x.id === b.id);
    if (i >= 0) reorder(i, i + dir);
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
      {mode !== "move" && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">BOQ name{mode === "generate" ? " (optional)" : ""}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Floor 2 Electrical" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short note" />
          </div>
        </>
      )}
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
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setMode("create")}><Plus className="h-4 w-4 mr-2" />Create BOQ</Button>
            <Button variant="outline" onClick={() => setMode("json")}><Braces className="h-4 w-4 mr-2" />Generate from JSON</Button>
            <Button variant="outline" onClick={() => setMode("import")}><Upload className="h-4 w-4 mr-2" />Import Existing BOQ</Button>
            <Button variant="outline" onClick={() => setMode("move")}><FolderInput className="h-4 w-4 mr-2" />Move a BOQ Here</Button>
            {!!boqs?.length && (
              <Button variant="outline" onClick={() => { setClientName(project?.client_name ?? ""); setFirmName(""); setFirmTagline(""); setMode("share"); }}
                title="Create one combined PDF of all BOQs to send to the client">
                <FileText className="h-4 w-4 mr-2" />Share with client
              </Button>
            )}
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

      {mode === "json" && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste a structured <b>drawing-evaluation JSON</b> (produced outside Cunstruct). Its <code>requirements[]</code> are
            converted into BOQ lines deterministically — quantities, units, basis, location and notes are kept as given.
            A numeric quantity is used as-is; a <code>null</code> quantity becomes a <b>quantity-pending</b> line. No analysis or AI runs.
          </p>
          {ScopeFields}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Paste the evaluation JSON</label>
              <label className="text-xs text-primary hover:underline cursor-pointer">
                Upload .json<input type="file" accept=".json,application/json,.txt" className="hidden" onChange={(e) => onJsonFile(e.target.files?.[0])} />
              </label>
            </div>
            <Textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8}
              placeholder={'{\n  "requirements": [\n    { "requirement": "WC", "qty": 4, "unit": "nos", "basis": "Counted", "scope": "Works" },\n    { "requirement": "Wardrobe", "qty": null, "unit": null, "scope": "Needs confirmation" }\n  ]\n}'} className="font-mono text-xs" />
          </div>
          {jsonPreview && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              {jsonPreview.ok ? (
                <>
                  <div className="font-medium">
                    {jsonPreview.lines.length} line{jsonPreview.lines.length === 1 ? "" : "s"} detected
                    {pendingCount(jsonPreview.lines) > 0 && <span className="text-amber-600 dark:text-amber-500"> · {pendingCount(jsonPreview.lines)} quantity-pending</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-muted-foreground text-left"><th className="py-1 pr-3">Requirement</th><th className="pr-3">Unit</th><th className="pr-3 text-right">Qty</th><th className="pr-3">Scope</th></tr></thead>
                      <tbody>
                        {jsonPreview.lines.slice(0, 6).map((l, i) => (
                          <tr key={i} className="border-t"><td className="py-1 pr-3">{l.description}</td><td className="pr-3">{l.unit ?? "—"}</td><td className="pr-3 text-right tabular-nums">{l.qty == null ? <span className="text-amber-600 dark:text-amber-500">pending</span> : l.qty.toLocaleString("en-IN")}</td><td className="pr-3">{l.scope ?? "works"}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {jsonPreview.lines.length > 6 && <div className="text-muted-foreground pt-1">…and {jsonPreview.lines.length - 6} more</div>}
                  </div>
                  {jsonPreview.warnings.length > 0 && (
                    <ul className="text-xs text-amber-600 dark:text-amber-400 list-disc pl-4">
                      {jsonPreview.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </>
              ) : (
                <div className="text-sm text-destructive">{jsonPreview.error}</div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={generateFromJson} disabled={busy || !jsonPreview?.ok}>{busy ? "Generating…" : `Generate ${jsonPreview?.ok ? jsonPreview.lines.length : 0} lines`}</Button>
            <Button variant="ghost" onClick={resetForm} disabled={busy}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {mode === "import" && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Import a BOQ you already have — its lines, quantities, units and rates are kept exactly as given and never
            re-interpreted. Paste rows from Excel/Google Sheets, or upload a CSV.
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

      {mode === "move" && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Move a BOQ you generated separately into this project. Its lines, quantities and rates are kept exactly as they
            are — only its project and scope change.
          </p>
          {ScopeFields}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">BOQ to move</label>
            {movable == null ? (
              <div className="text-xs text-muted-foreground">Loading BOQs…</div>
            ) : movable.length === 0 ? (
              <div className="text-xs text-muted-foreground">No BOQs available to move — every BOQ is already in this project.</div>
            ) : (
              <Select value={moveBoqId} onValueChange={setMoveBoqId}>
                <SelectTrigger><SelectValue placeholder="Pick a BOQ" /></SelectTrigger>
                <SelectContent>
                  {movable.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} — {b.project_id ? (projectNames?.[b.project_id] ?? "another project") : "standalone"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={moveBoq} disabled={busy || !moveBoqId}>{busy ? "Moving…" : "Move here"}</Button>
            <Button variant="ghost" onClick={resetForm} disabled={busy}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {mode === "share" && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Create <b>one combined PDF</b> of every BOQ in this project to send to the client — each BOQ as its own priced
            section, with a project abstract and grand total. Choose the version, then <b>Save as PDF</b> in the print dialog.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Client name (for the final version)</label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={project?.client_name ?? "e.g. Dr. Sandeep"} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Your firm name (for approval)</label>
              <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="e.g. The Grid Architects" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Firm tagline (optional)</label>
              <Input value={firmTagline} onChange={(e) => setFirmTagline(e.target.value)} placeholder="architects & interior designers" />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => shareQuote("firm")} disabled={sharing}>
              {sharing ? "Preparing…" : "For approval (your letterhead)"}
            </Button>
            <Button variant="secondary" onClick={() => shareQuote("client")} disabled={sharing}>
              {sharing ? "Preparing…" : "Final — client's name, no logo"}
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={sharing}>Cancel</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only priced lines are included; a BOQ with no rates yet is skipped. Rates come from each BOQ (your rate, else the DSR reference).
          </p>
        </CardContent></Card>
      )}

      {!boqs?.length && !mode && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No BOQs yet. Create one from scratch, generate from an evaluation JSON, import a BOQ you already have, or move one in.</CardContent></Card>
      )}

      {(boqs?.length ?? 0) > 1 && (
        <p className="text-xs text-muted-foreground">Drag the handle (or use the arrows) to set the order — this is the order the shared/combined BOQ follows.</p>
      )}
      <div className="space-y-2">
        {(boqs ?? []).map((b, i) => (
          <Card key={b.id}
            draggable={editId !== b.id && confirmDel !== b.id}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => { if (dragIndex !== null && dragIndex !== i) e.preventDefault(); }}
            onDrop={() => { if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null); }}
            onDragEnd={() => setDragIndex(null)}
            className={dragIndex === i ? "opacity-50" : dragIndex !== null ? "border-dashed" : undefined}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex items-center gap-1">
                <GripVertical className={`h-4 w-4 text-muted-foreground shrink-0 ${editId === b.id ? "opacity-30" : "cursor-grab active:cursor-grabbing"}`} aria-hidden />
                <div className="flex flex-col">
                  <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(b, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(b, 1)} disabled={i === (boqs!.length - 1)} aria-label="Move down"><ChevronDown className="h-4 w-4" /></Button>
                </div>
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
