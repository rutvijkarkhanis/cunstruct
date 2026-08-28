import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, FileText, ChevronDown, ChevronRight, CheckCircle2, Link2 } from "lucide-react";
import { DOC_TYPES, DISCIPLINES, type ProjectDocument, type DocumentRevision } from "@/lib/projectDocs";

export default function ProjectDocuments() {
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: docs } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_document")
        .select("id, project_id, name, doc_type, discipline, current_revision_id, status, created_at")
        .eq("project_id", projectId!).order("created_at");
      return (data ?? []) as ProjectDocument[];
    },
  });

  const ids = (docs ?? []).map((d) => d.id);
  const { data: revs } = useQuery({
    queryKey: ["document-revisions", projectId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("document_revision")
        .select("id, document_id, label, revision_date, source, external_url, page_count, status, created_at")
        .in("document_id", ids).order("created_at");
      return (data ?? []) as DocumentRevision[];
    },
  });

  const { data: linkCounts } = useQuery({
    queryKey: ["document-links", projectId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("boq_document").select("document_id").in("document_id", ids);
      const out: Record<string, number> = {};
      for (const r of (data ?? []) as { document_id: string }[]) out[r.document_id] = (out[r.document_id] ?? 0) + 1;
      return out;
    },
  });

  const revsFor = (docId: string) => (revs ?? []).filter((r) => r.document_id === docId);

  // ---- Add document -------------------------------------------------------
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<string>("Architectural");
  const [discipline, setDiscipline] = useState<string>("Architectural");
  const [busy, setBusy] = useState(false);

  const addDoc = async () => {
    if (!projectId) return;
    if (!name.trim()) return toast.error("Enter a document name");
    setBusy(true);
    try {
      const { data, error } = await supabase.from("project_document")
        .insert({ project_id: projectId, name: name.trim(), doc_type: docType, discipline, status: "uploaded" })
        .select("id").single();
      if (error) throw error;
      // seed a first revision so the document is immediately usable
      const { data: rev, error: rerr } = await supabase.from("document_revision")
        .insert({ document_id: (data as { id: string }).id, label: "Rev A", source: "paste", status: "draft" })
        .select("id").single();
      if (!rerr && rev) {
        await supabase.from("project_document").update({ current_revision_id: (rev as { id: string }).id }).eq("id", (data as { id: string }).id);
      }
      toast.success("Document added");
      setName(""); setAdding(false);
      qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
      qc.invalidateQueries({ queryKey: ["document-revisions", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add document");
    } finally { setBusy(false); }
  };

  // ---- Add revision -------------------------------------------------------
  const [revFor, setRevFor] = useState<string | null>(null);
  const [revLabel, setRevLabel] = useState("");
  const [revUrl, setRevUrl] = useState("");
  const addRevision = async (docId: string) => {
    if (!revLabel.trim()) return toast.error("Enter a revision label (e.g. Rev B)");
    const { data, error } = await supabase.from("document_revision")
      .insert({ document_id: docId, label: revLabel.trim(), source: revUrl.trim() ? "url" : "paste", external_url: revUrl.trim() || null, status: "draft" })
      .select("id").single();
    if (error) return toast.error(error.message);
    // new revision becomes current
    await supabase.from("project_document").update({ current_revision_id: (data as { id: string }).id }).eq("id", docId);
    setRevFor(null); setRevLabel(""); setRevUrl("");
    qc.invalidateQueries({ queryKey: ["document-revisions", projectId] });
    qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
    toast.success("Revision added and set current");
  };

  const setCurrent = async (docId: string, revId: string) => {
    const { error } = await supabase.from("project_document").update({ current_revision_id: revId }).eq("id", docId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">Every drawing/document exists once and can be referenced by multiple BOQs.</p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-2" />Add document</Button>}
      </div>

      {adding && (
        <Card><CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Electrical Drawing" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Discipline</label>
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DISCIPLINES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={addDoc} disabled={busy}>{busy ? "Adding…" : "Add document"}</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setName(""); }} disabled={busy}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {!docs?.length && !adding && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No documents yet. Add the project's drawings and documents here.</CardContent></Card>
      )}

      <div className="space-y-2">
        {(docs ?? []).map((d) => {
          const rs = revsFor(d.id);
          const current = rs.find((r) => r.id === d.current_revision_id);
          const open = expanded[d.id];
          return (
            <Card key={d.id}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <button className="text-muted-foreground" onClick={() => setExpanded((e) => ({ ...e, [d.id]: !e[d.id] }))} aria-label="Toggle revisions">
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                      {d.doc_type && <Badge variant="outline">{d.doc_type}</Badge>}
                      {d.discipline && <span>{d.discipline}</span>}
                      <span>· {current ? `Current: ${current.label}` : "No current revision"}</span>
                      <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />{linkCounts?.[d.id] ?? 0} BOQ{(linkCounts?.[d.id] ?? 0) === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">{d.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => { setRevFor(revFor === d.id ? null : d.id); setRevLabel(""); setRevUrl(""); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Revision
                  </Button>
                </div>

                {revFor === d.id && (
                  <div className="mt-3 pl-7 flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Label</label>
                      <Input value={revLabel} onChange={(e) => setRevLabel(e.target.value)} placeholder="Rev B" className="h-8 w-28" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Link (optional)</label>
                      <Input value={revUrl} onChange={(e) => setRevUrl(e.target.value)} placeholder="https://…" className="h-8 w-64" />
                    </div>
                    <Button size="sm" onClick={() => addRevision(d.id)}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevFor(null)}>Cancel</Button>
                  </div>
                )}

                {open && rs.length > 0 && (
                  <div className="mt-3 pl-7 space-y-1">
                    {rs.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 text-sm">
                        <Badge variant={r.id === d.current_revision_id ? "default" : "outline"}>{r.label}</Badge>
                        {r.revision_date && <span className="text-xs text-muted-foreground">{r.revision_date}</span>}
                        <span className="text-xs text-muted-foreground">{r.source}</span>
                        {r.external_url && <a href={r.external_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate max-w-[16rem]">{r.external_url}</a>}
                        {r.id === d.current_revision_id ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />current</span>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setCurrent(d.id, r.id)}>Set current</Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
