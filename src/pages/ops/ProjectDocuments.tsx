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
import { Plus, FileText, ChevronDown, ChevronRight, CheckCircle2, Link2, Upload, Trash2, Stethoscope } from "lucide-react";
import { DOC_TYPES, DISCIPLINES, type ProjectDocument, type DocumentRevision } from "@/lib/projectDocs";
import { validateDrawingFile, buildDrawingPath, uploadDrawing, deleteDrawing, signedDrawingUrl } from "@/lib/review/drawingStorage";

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
        .select("id, document_id, label, revision_date, source, file_path, external_url, page_count, status, created_at, mime_type, file_size, original_filename")
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

  // ---- Upload a PDF drawing (private storage) ------------------------------
  const [uploading, setUploading] = useState(false);
  const uploadPdf = async (file: File) => {
    if (!projectId) return;
    const check = validateDrawingFile(file);
    if (!check.ok) return toast.error(check.error ?? "Invalid file");
    setUploading(true);
    let docId: string | null = null;
    let revId: string | null = null;
    try {
      // Count pages deterministically (pdf.js), best-effort.
      let pageCount: number | null = null;
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        pageCount = doc.numPages;
      } catch { /* page count is optional */ }

      const docName = file.name.replace(/\.pdf$/i, "");
      const { data: docRow, error: docErr } = await supabase.from("project_document")
        .insert({ project_id: projectId, name: docName, doc_type: "Architectural", discipline: "Architectural", status: "uploaded" })
        .select("id").single();
      if (docErr) throw docErr;
      docId = (docRow as { id: string }).id;

      const { data: revRow, error: revErr } = await supabase.from("document_revision")
        .insert({ document_id: docId, label: "Rev A", source: "upload", status: "uploaded", page_count: pageCount })
        .select("id").single();
      if (revErr) throw revErr;
      revId = (revRow as { id: string }).id;

      const path = buildDrawingPath(projectId, docId, revId);
      await uploadDrawing(path, file);

      const { error: updErr } = await supabase.from("document_revision")
        .update({ file_path: path, mime_type: file.type || "application/pdf", file_size: file.size, original_filename: file.name })
        .eq("id", revId);
      if (updErr) throw updErr;
      await supabase.from("project_document").update({ current_revision_id: revId }).eq("id", docId);

      toast.success(`Uploaded ${file.name}${pageCount ? ` · ${pageCount} page(s)` : ""}`);
      qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
      qc.invalidateQueries({ queryKey: ["document-revisions", projectId] });
    } catch (e) {
      // Best-effort cleanup so a failed upload leaves no orphan records.
      if (revId) await supabase.from("document_revision").delete().eq("id", revId);
      if (docId) await supabase.from("project_document").delete().eq("id", docId);
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setUploading(false); }
  };

  // ---- Delete a document + its stored files (analysis history is untouched) --
  const deleteDocument = async (doc: ProjectDocument) => {
    if (!confirm(`Delete "${doc.name}" and its uploaded file? Existing analysis review history is kept.`)) return;
    try {
      // Remove storage objects for any uploaded revisions first (best-effort).
      const paths = revsFor(doc.id).map((r) => r.file_path).filter(Boolean) as string[];
      for (const p of paths) { try { await deleteDrawing(p); } catch { /* keep going */ } }
      // Deleting the document row cascades its revisions. Analysis runs reference
      // the document only by id in ai_json (no FK), so they remain intact.
      const { error } = await supabase.from("project_document").delete().eq("id", doc.id);
      if (error) throw error;
      toast.success(`Deleted ${doc.name}`);
      qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
      qc.invalidateQueries({ queryKey: ["document-revisions", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
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

  // ---- TEMPORARY DIAGNOSTIC — Srikakulam file_path/retrieval investigation ---
  // Read-only. Reuses data already fetched above; the only network call this
  // adds is signedDrawingUrl() (Storage createSignedUrl — reads, never writes,
  // uploads, or modifies a document/revision). Remove this block once the
  // investigation is done: search "TEMPORARY DIAGNOSTIC" in this file.
  const [diagOpen, setDiagOpen] = useState<Record<string, boolean>>({});
  const [diagCheck, setDiagCheck] = useState<Record<string, { checking: boolean; ok: boolean | null; detail: string }>>({});
  const checkRetrieval = async (revId: string, filePath: string | null) => {
    if (!filePath) {
      setDiagCheck((c) => ({ ...c, [revId]: { checking: false, ok: false, detail: "No file_path on this revision — nothing to retrieve." } }));
      return;
    }
    setDiagCheck((c) => ({ ...c, [revId]: { checking: true, ok: null, detail: "" } }));
    const url = await signedDrawingUrl(filePath);
    setDiagCheck((c) => ({
      ...c,
      [revId]: url
        ? { checking: false, ok: true, detail: "Signed URL generated — the storage object exists and is readable." }
        : { checking: false, ok: false, detail: "createSignedUrl failed — the storage object is missing, or access was denied." },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">Every drawing/document exists once and can be referenced by multiple BOQs.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" disabled={uploading}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />{uploading ? "Uploading…" : "Upload PDF"}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(f); e.currentTarget.value = ""; }} />
            </label>
          </Button>
          {!adding && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-2" />Add document</Button>}
        </div>
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
                  <Button size="sm" variant="ghost" title="Temporary read-only diagnostic — file_path / storage retrieval" onClick={() => setDiagOpen((s) => ({ ...s, [d.id]: !s[d.id] }))}>
                    <Stethoscope className="h-3.5 w-3.5 mr-1" />Diagnostics
                  </Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title="Delete document" onClick={() => deleteDocument(d)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {diagOpen[d.id] && (() => {
                  const cur = current;
                  const check = cur ? diagCheck[cur.id] : undefined;
                  return (
                    <div className="mt-3 pl-7">
                      <div className="rounded border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2 text-xs">
                        <div className="font-medium text-amber-900 dark:text-amber-200">
                          Temporary diagnostic — read-only, no data changed
                        </div>
                        {!cur ? (
                          <div className="text-muted-foreground">No current revision set on this document.</div>
                        ) : (
                          <>
                            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                              <dt className="text-muted-foreground">Current revision ID</dt>
                              <dd className="font-mono break-all">{cur.id}</dd>
                              <dt className="text-muted-foreground">Revision status</dt>
                              <dd>{cur.status ?? "—"}</dd>
                              <dt className="text-muted-foreground">Source</dt>
                              <dd>{cur.source ?? "—"}</dd>
                              <dt className="text-muted-foreground">file_path</dt>
                              <dd>
                                {cur.file_path ? (
                                  <span className="text-emerald-700 dark:text-emerald-400">present — <span className="font-mono break-all">{cur.file_path}</span></span>
                                ) : (
                                  <span className="text-red-700 dark:text-red-400 font-medium">MISSING (null)</span>
                                )}
                              </dd>
                              <dt className="text-muted-foreground">file_size</dt>
                              <dd>{cur.file_size != null ? `${cur.file_size.toLocaleString()} bytes` : "—"}</dd>
                              <dt className="text-muted-foreground">mime_type</dt>
                              <dd>{cur.mime_type ?? "—"}</dd>
                              <dt className="text-muted-foreground">original_filename</dt>
                              <dd>{cur.original_filename ?? "—"}</dd>
                            </dl>
                            <div className="flex items-center gap-2 pt-1">
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={check?.checking} onClick={() => checkRetrieval(cur.id, cur.file_path)}>
                                {check?.checking ? "Checking…" : "Test PDF retrieval"}
                              </Button>
                              {check && !check.checking && (
                                <span className={check.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                                  {check.ok ? "✅" : "❌"} {check.detail}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

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
