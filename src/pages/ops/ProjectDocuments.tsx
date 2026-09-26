import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, FileText, ChevronDown, ChevronRight, CheckCircle2, Link2, Upload, Trash2, FolderPlus, FolderOpen, Folder as FolderIcon } from "lucide-react";
import { DOC_TYPES, DISCIPLINES, type ProjectDocument, type DocumentRevision, type DocumentFolder } from "@/lib/projectDocs";
import { validateDrawingFile, buildDrawingPath, uploadDrawing, deleteDrawing } from "@/lib/review/drawingStorage";
import { buildFolderTree, folderBreadcrumb, parseRelativePath, looksLikePdf, type FolderNode } from "@/lib/documentFolders";
import DocumentLocationExtraction from "@/components/review/DocumentLocationExtraction";

// Chrome/Edge/Safari/Firefox all support selecting a whole folder via the
// non-standard `webkitdirectory` input attribute — no library needed. Each
// resulting File carries `webkitRelativePath` (e.g. "Floor 2/Plan.pdf").
type FileWithRelativePath = File & { webkitRelativePath?: string };

export default function ProjectDocuments() {
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: folders } = useQuery({
    queryKey: ["document-folders", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("document_folder")
        .select("id, project_id, parent_id, name, sort, created_at")
        .eq("project_id", projectId!).order("sort").order("name");
      return (data ?? []) as DocumentFolder[];
    },
  });

  const { data: docs } = useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_document")
        .select("id, project_id, name, doc_type, discipline, current_revision_id, status, folder_id, created_at")
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

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["document-folders", projectId] });
    qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
    qc.invalidateQueries({ queryKey: ["document-revisions", projectId] });
  };

  // ---- Folder tree + document grouping -------------------------------------
  const folderTree = useMemo(() => buildFolderTree(folders ?? []), [folders]);
  const docsByFolder = useMemo(() => {
    const map = new Map<string, ProjectDocument[]>();
    for (const d of docs ?? []) {
      const key = d.folder_id ?? "__unfiled__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [docs]);
  const unfiledDocs = docsByFolder.get("__unfiled__") ?? [];

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (id: string) => setExpandedFolders((e) => ({ ...e, [id]: !(e[id] ?? true) }));

  // ---- New folder -----------------------------------------------------------
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string>("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const createFolder = async () => {
    if (!projectId) return;
    if (!newFolderName.trim()) return toast.error("Enter a folder name");
    setCreatingFolder(true);
    try {
      const { error } = await supabase.from("document_folder")
        .insert({ project_id: projectId, name: newFolderName.trim(), parent_id: newFolderParent || null });
      if (error) throw error;
      toast.success("Folder created");
      setNewFolderName(""); setNewFolderParent(""); setNewFolderOpen(false);
      invalidateAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  // Flat list for the parent picker, indented to show depth.
  const folderOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: FolderNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${"— ".repeat(depth)}${n.name}` });
        walk(n.children, depth + 1);
      }
    };
    walk(folderTree, 0);
    return out;
  }, [folderTree]);

  // ---- Add document (metadata-only, no file) --------------------------------
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
      const { data: rev, error: rerr } = await supabase.from("document_revision")
        .insert({ document_id: (data as { id: string }).id, label: "Rev A", source: "paste", status: "draft" })
        .select("id").single();
      if (!rerr && rev) {
        await supabase.from("project_document").update({ current_revision_id: (rev as { id: string }).id }).eq("id", (data as { id: string }).id);
      }
      toast.success("Document added");
      setName(""); setAdding(false);
      invalidateAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add document");
    } finally { setBusy(false); }
  };

  // ---- Upload a PDF drawing (private storage) — shared by single-file and
  // folder upload, so both go through the exact same path. `folderId` is null
  // for the existing single-file button, unchanged from today's behavior. ----
  const uploadOnePdf = async (file: File, folderId: string | null): Promise<void> => {
    const check = validateDrawingFile(file);
    if (!check.ok) throw new Error(check.error ?? "Invalid file");
    let docId: string | null = null;
    let revId: string | null = null;
    try {
      let pageCount: number | null = null;
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        pageCount = doc.numPages;
      } catch { /* page count is optional */ }

      const docName = file.name.replace(/\.pdf$/i, "");
      // Always a NEW document — never merged into an existing one of the same
      // name, in this folder or elsewhere. Matches today's single-upload
      // behavior exactly; the folder + creation time disambiguate identical names.
      const { data: docRow, error: docErr } = await supabase.from("project_document")
        .insert({ project_id: projectId, name: docName, doc_type: "Architectural", discipline: "Architectural", status: "uploaded", folder_id: folderId })
        .select("id").single();
      if (docErr) throw docErr;
      docId = (docRow as { id: string }).id;

      const { data: revRow, error: revErr } = await supabase.from("document_revision")
        .insert({ document_id: docId, label: "Rev A", source: "upload", status: "uploaded", page_count: pageCount })
        .select("id").single();
      if (revErr) throw revErr;
      revId = (revRow as { id: string }).id;

      const path = buildDrawingPath(projectId!, docId, revId);
      await uploadDrawing(path, file);

      const { error: updErr } = await supabase.from("document_revision")
        .update({ file_path: path, mime_type: file.type || "application/pdf", file_size: file.size, original_filename: file.name })
        .eq("id", revId);
      if (updErr) throw updErr;
      await supabase.from("project_document").update({ current_revision_id: revId }).eq("id", docId);
    } catch (e) {
      if (revId) await supabase.from("document_revision").delete().eq("id", revId);
      if (docId) await supabase.from("project_document").delete().eq("id", docId);
      throw e;
    }
  };

  const [uploading, setUploading] = useState(false);
  const uploadPdf = async (file: File) => {
    if (!projectId) return;
    setUploading(true);
    try {
      await uploadOnePdf(file, null);
      toast.success(`Uploaded ${file.name}`);
      invalidateAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setUploading(false); }
  };

  // ---- Upload Folder — recursively finds PDFs, preserves hierarchy ----------
  const [uploadingFolder, setUploadingFolder] = useState(false);
  const folderResolutionCache = useRef<Map<string, string>>(new Map());

  const resolveFolderPath = async (segments: string[]): Promise<string | null> => {
    let parentId: string | null = null;
    for (const seg of segments) {
      const cacheKey = `${parentId ?? "\0root"}${seg}`;
      let folderId = folderResolutionCache.current.get(cacheKey);
      if (!folderId) {
        const existing = (folders ?? []).find((f) => f.parent_id === parentId && f.name === seg);
        if (existing) {
          folderId = existing.id;
        } else {
          const { data, error } = await supabase.from("document_folder")
            .insert({ project_id: projectId, name: seg, parent_id: parentId })
            .select("id").single();
          if (error) throw error;
          folderId = (data as { id: string }).id;
        }
        folderResolutionCache.current.set(cacheKey, folderId);
      }
      parentId = folderId;
    }
    return parentId;
  };

  const uploadFolder = async (fileList: FileList) => {
    if (!projectId) return;
    const all = Array.from(fileList) as FileWithRelativePath[];
    const pdfs = all.filter(looksLikePdf);
    if (pdfs.length === 0) {
      return toast.error(all.length ? "No PDF files found in the selected folder" : "No files found");
    }
    setUploadingFolder(true);
    folderResolutionCache.current.clear();
    let succeeded = 0;
    let failed = 0;
    try {
      for (const file of pdfs) {
        const relPath = file.webkitRelativePath || file.name;
        const { folderSegments } = parseRelativePath(relPath);
        try {
          const folderId = await resolveFolderPath(folderSegments);
          await uploadOnePdf(file, folderId);
          succeeded++;
        } catch (e) {
          failed++;
          console.error(`Failed to upload ${relPath}:`, e);
        }
      }
      const skipped = all.length - pdfs.length;
      toast[failed ? "warning" : "success"](
        `Uploaded ${succeeded} file(s)${failed ? ` · ${failed} failed` : ""}${skipped ? ` · ${skipped} non-PDF skipped` : ""}`,
      );
      invalidateAll();
    } finally {
      setUploadingFolder(false);
    }
  };

  // ---- Delete a document + its stored files (analysis history is untouched) --
  const deleteDocument = async (doc: ProjectDocument) => {
    if (!confirm(`Delete "${doc.name}" and its uploaded file? Existing analysis review history is kept.`)) return;
    try {
      const paths = revsFor(doc.id).map((r) => r.file_path).filter(Boolean) as string[];
      for (const p of paths) { try { await deleteDrawing(p); } catch { /* keep going */ } }
      const { error } = await supabase.from("project_document").delete().eq("id", doc.id);
      if (error) throw error;
      toast.success(`Deleted ${doc.name}`);
      invalidateAll();
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
    await supabase.from("project_document").update({ current_revision_id: (data as { id: string }).id }).eq("id", docId);
    setRevFor(null); setRevLabel(""); setRevUrl("");
    invalidateAll();
    toast.success("Revision added and set current");
  };

  const setCurrent = async (docId: string, revId: string) => {
    const { error } = await supabase.from("project_document").update({ current_revision_id: revId }).eq("id", docId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  };

  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});

  const documentRow = (d: ProjectDocument, breadcrumb: string[]) => {
    const rs = revsFor(d.id);
    const current = rs.find((r) => r.id === d.current_revision_id);
    const open = expandedDocs[d.id];
    return (
      <Card key={d.id}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <button className="text-muted-foreground" onClick={() => setExpandedDocs((e) => ({ ...e, [d.id]: !e[d.id] }))} aria-label="Toggle revisions">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              {breadcrumb.length > 0 && (
                <div className="text-[11px] text-muted-foreground truncate" data-testid="doc-breadcrumb">
                  {breadcrumb.join(" / ")}
                </div>
              )}
              <div className="font-medium truncate">{d.name}</div>
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                {d.doc_type && <Badge variant="outline">{d.doc_type}</Badge>}
                {d.discipline && <span>{d.discipline}</span>}
                <span>· {current ? `Current: ${current.label}` : "No current revision"}</span>
                <span>· added {d.created_at ? new Date(d.created_at).toLocaleString() : "—"}</span>
                <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />{linkCounts?.[d.id] ?? 0} BOQ{(linkCounts?.[d.id] ?? 0) === 1 ? "" : "s"}</span>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">{d.status}</Badge>
            <Button size="sm" variant="outline" onClick={() => { setRevFor(revFor === d.id ? null : d.id); setRevLabel(""); setRevUrl(""); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Revision
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" title="Delete document" onClick={() => deleteDocument(d)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {open && projectId && (
            <DocumentLocationExtraction
              projectId={projectId}
              documentId={d.id}
            />
          )}

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
  };

  const folderGroup = (node: FolderNode, depth: number) => {
    const isOpen = expandedFolders[node.id] ?? true;
    const nodeDocs = docsByFolder.get(node.id) ?? [];
    const breadcrumb = folderBreadcrumb(node.id, folders ?? []);
    return (
      <div key={node.id} style={{ marginLeft: depth * 20 }} className="space-y-2">
        <button
          className="flex items-center gap-2 text-sm font-medium py-1 w-full text-left"
          onClick={() => toggleFolder(node.id)}
          data-testid={`folder-toggle-${node.id}`}
        >
          {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {isOpen ? <FolderOpen className="h-4 w-4 text-amber-600" /> : <FolderIcon className="h-4 w-4 text-amber-600" />}
          <span>{node.name}</span>
          <span className="text-xs text-muted-foreground font-normal">
            {nodeDocs.length} doc{nodeDocs.length === 1 ? "" : "s"}{node.children.length ? ` · ${node.children.length} subfolder${node.children.length === 1 ? "" : "s"}` : ""}
          </span>
        </button>
        {isOpen && (
          <div className="space-y-2">
            {nodeDocs.map((d) => documentRow(d, breadcrumb))}
            {node.children.map((child) => folderGroup(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const isEmpty = !docs?.length && !folders?.length && !adding && !newFolderOpen;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">Organize documents into folders that match how you already file this project. Every drawing/document exists once and can be referenced by multiple BOQs.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setNewFolderOpen((v) => !v)}>
            <FolderPlus className="h-4 w-4 mr-2" />New Folder
          </Button>
          <Button asChild variant="outline" disabled={uploadingFolder}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />{uploadingFolder ? "Uploading…" : "Upload Folder"}
              <input
                type="file"
                // @ts-expect-error non-standard attributes not in the DOM lib typings
                webkitdirectory="" directory="" multiple
                className="hidden" disabled={uploadingFolder}
                onChange={(e) => { const fl = e.target.files; if (fl && fl.length) uploadFolder(fl); e.currentTarget.value = ""; }}
              />
            </label>
          </Button>
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

      {newFolderOpen && (
        <Card><CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Folder name</label>
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="e.g. Floor 2" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Parent folder (optional)</label>
              <Select value={newFolderParent || "__root__"} onValueChange={(v) => setNewFolderParent(v === "__root__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">— Top level —</SelectItem>
                  {folderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={createFolder} disabled={creatingFolder}>{creatingFolder ? "Creating…" : "Create folder"}</Button>
            <Button variant="ghost" onClick={() => { setNewFolderOpen(false); setNewFolderName(""); setNewFolderParent(""); }} disabled={creatingFolder}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

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

      {isEmpty && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No documents yet. Add a folder or upload the project's drawings and documents here.</CardContent></Card>
      )}

      <div className="space-y-3">
        {folderTree.map((node) => folderGroup(node, 0))}

        {unfiledDocs.length > 0 && (
          <div className="space-y-2">
            {folderTree.length > 0 && (
              <div className="flex items-center gap-2 text-sm font-medium py-1 text-muted-foreground">
                <FolderIcon className="h-4 w-4" />
                <span>Unfiled</span>
                <span className="text-xs font-normal">{unfiledDocs.length} doc{unfiledDocs.length === 1 ? "" : "s"}</span>
              </div>
            )}
            <div className="space-y-2">{unfiledDocs.map((d) => documentRow(d, []))}</div>
          </div>
        )}
      </div>
    </div>
  );
}
