import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DrawingThumbnail from "@/components/review/DrawingThumbnail";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import { toast } from "sonner";
import { Plus, FileText, ChevronDown, ChevronRight, CheckCircle2, Link2, Upload, Trash2, FolderPlus, FolderOpen, Folder as FolderIcon, Sparkles, MoreVertical, ArrowRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDocumentManagement, DOC_TYPES, DISCIPLINES, type ProjectDocument, type FolderNode } from "@/hooks/useDocumentManagement";
import DocumentLocationExtraction from "@/components/review/DocumentLocationExtraction";

export default function ProjectDocuments() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dm = useDocumentManagement(projectId);

  // Routes "Generate BOQ from this drawing" into the EXISTING Review Analysis
  // flow rather than duplicating any generation logic here — Documents never
  // calls the AI itself. A document isn't tied to one BOQ (a project can have
  // several), so this only knows where to send the user: straight to the one
  // BOQ's review screen when unambiguous, otherwise to BOQs to pick/create one.
  const { data: boqIds } = useQuery({
    queryKey: ["project-boq-ids", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("boq").select("id").eq("project_id", projectId!);
      return (data ?? []).map((b) => (b as { id: string }).id);
    },
  });
  const goGenerateFrom = (docName: string) => {
    if (boqIds?.length === 1) { navigate(`../boqs/${boqIds[0]}/review`); return; }
    if (!boqIds?.length) toast.info(`Create a BOQ first, then use Review Analysis to generate quantities from "${docName}".`);
    navigate("../boqs");
  };

  // In-app drawing preview (Section 4) — replaces window.open() for the
  // primary "look at this drawing" action. Signed URLs are still fetched
  // fresh, never cached/stored, via the shared hook's resolvePreviewUrl();
  // this just renders the result inside Cunstruct instead of a new browser
  // tab. The per-revision "Open" links deeper in the expanded revision list
  // are untouched — this only replaces the card's own primary preview action.
  const [previewing, setPreviewing] = useState<{ name: string; url: string } | null>(null);
  const previewDrawing = async (revId: string, path: string, name: string) => {
    const url = await dm.resolvePreviewUrl(revId, path);
    if (url) setPreviewing({ name, url });
  };

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (id: string) => setExpandedFolders((e) => ({ ...e, [id]: !(e[id] ?? true) }));

  // ---- New folder -----------------------------------------------------------
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string>("");

  const createFolder = async () => {
    const ok = await dm.createFolder(newFolderName, newFolderParent || null);
    if (ok) { setNewFolderName(""); setNewFolderParent(""); setNewFolderOpen(false); }
  };

  // ---- Add document (metadata-only, no file) --------------------------------
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<string>("Architectural");
  const [discipline, setDiscipline] = useState<string>("Architectural");

  const addDoc = async () => {
    const ok = await dm.addDocument(name, docType, discipline);
    if (ok) { setName(""); setAdding(false); }
  };

  // ---- Add revision -------------------------------------------------------
  const [revFor, setRevFor] = useState<string | null>(null);
  const [revLabel, setRevLabel] = useState("");
  const [revUrl, setRevUrl] = useState("");
  const addRevision = async (docId: string) => {
    const ok = await dm.addRevision(docId, revLabel, revUrl);
    if (ok) { setRevFor(null); setRevLabel(""); setRevUrl(""); }
  };

  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});

  const documentRow = (d: ProjectDocument, breadcrumb: string[]) => {
    const rs = dm.revsFor(d.id);
    const current = rs.find((r) => r.id === d.current_revision_id);
    const open = expandedDocs[d.id];
    const isDrawing = !!current?.file_path;
    const analysed = dm.analysedDocIds?.has(d.id) ?? false;
    const quantityCount = current ? dm.docQuantityCounts?.[d.id] : undefined;
    return (
      <Card key={d.id} className="overflow-hidden">
        {/* THE DRAWING IS THE CARD — a large, real first-page preview leads,
            not a filename row with an icon. Tapping it opens the in-app
            preview; non-drawings (no uploaded file yet) keep a plain, honest
            placeholder slot — there is nothing real to render a thumbnail
            from. This is a drawing gallery, not a file manager. */}
        {isDrawing ? (
          <DrawingThumbnail
            revisionId={current!.id}
            filePath={current!.file_path!}
            renderSize={640}
            className="w-full h-44 sm:h-52 rounded-none border-0 border-b"
            onClick={() => previewDrawing(current!.id, current!.file_path!, d.name)}
          />
        ) : (
          <div className="h-20 w-full bg-muted text-muted-foreground flex items-center justify-center border-b">
            <FileText className="h-6 w-6" />
          </div>
        )}
        <CardContent className="p-3 space-y-2.5">
          {breadcrumb.length > 0 && (
            <div className="text-[11px] text-muted-foreground truncate" data-testid="doc-breadcrumb">
              {breadcrumb.join(" / ")}
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold truncate">{d.name}</div>
              {/* Restrained caption — discipline · revision · truthful
                  analysis state, never more than one line of chrome under
                  the drawing itself. Real quantity count when a run exists
                  for this document; otherwise a plain, honest status. */}
              <div className="text-xs text-muted-foreground truncate">
                {[d.discipline, current?.label].filter(Boolean).join(" · ")}
                {isDrawing && (
                  <span className={cn(analysed && "text-emerald-600 dark:text-emerald-400")}>
                    {(d.discipline || current?.label) ? " · " : ""}
                    {analysed
                      ? (quantityCount != null ? `${quantityCount} quantit${quantityCount === 1 ? "y" : "ies"} ready` : "Analysed")
                      : "Not analysed yet"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {/* A direct, always-present affordance (not tucked in a menu) —
                  expanding details/revisions is browsing this drawing, not an
                  admin action. */}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpandedDocs((e) => ({ ...e, [d.id]: !e[d.id] }))} aria-label="Toggle revisions">
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
              {/* Secondary/admin actions behind one small menu — add a
                  revision, delete. Never four equal-weight buttons beside
                  the primary action below. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Document actions"><MoreVertical className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setRevFor(revFor === d.id ? null : d.id); setRevLabel(""); setRevUrl(""); }}>
                    <Plus className="h-4 w-4 mr-2" />Add revision
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => dm.deleteDocument(d)}>
                    <Trash2 className="h-4 w-4 mr-2" />Delete document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ONE dominant primary action — the whole point of uploading a
              drawing. Label/icon reflect REAL per-document analysis state
              (analysedDocIds, above), never a fixed string. */}
          {isDrawing && (
            <Button className="w-full" onClick={() => goGenerateFrom(d.name)}>
              {analysed
                ? <>Review quantities <ArrowRight className="h-4 w-4 ml-1.5" /></>
                : <>Generate quantities <ArrowRight className="h-4 w-4 ml-1.5" /></>}
            </Button>
          )}
          {!isDrawing && (
            <Button size="sm" variant="outline" onClick={() => { setRevFor(revFor === d.id ? null : d.id); setRevLabel(""); setRevUrl(""); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add a revision
            </Button>
          )}

          {open && d.doc_type && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{d.doc_type}</Badge>
              <span>added {d.created_at ? new Date(d.created_at).toLocaleString() : "—"}</span>
              <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />{dm.linkCounts?.[d.id] ?? 0} BOQ{(dm.linkCounts?.[d.id] ?? 0) === 1 ? "" : "s"}</span>
            </div>
          )}

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
                  {r.file_path && (
                    <Button
                      size="sm" variant="ghost" className="h-6 text-xs"
                      disabled={dm.openingRevId === r.id}
                      onClick={() => dm.openDrawing(r.id, r.file_path!)}
                    >
                      {dm.openingRevId === r.id ? "Opening…" : "Open"}
                    </Button>
                  )}
                  {r.id === d.current_revision_id ? (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />current</span>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => dm.setCurrentRevision(d.id, r.id)}>Set current</Button>
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
    const nodeDocs = dm.docsByFolder.get(node.id) ?? [];
    const breadcrumb = dm.folderBreadcrumb(node.id);
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

  const isEmpty = !dm.docs?.length && !dm.folders?.length && !adding && !newFolderOpen;

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
          <Button asChild variant="outline" disabled={dm.uploadingFolder}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />{dm.uploadingFolder ? "Uploading…" : "Upload Folder"}
              <input
                type="file"
                // @ts-expect-error non-standard attributes not in the DOM lib typings
                webkitdirectory="" directory="" multiple
                className="hidden" disabled={dm.uploadingFolder}
                onChange={(e) => { const fl = e.target.files; if (fl && fl.length) dm.uploadFolder(fl); e.currentTarget.value = ""; }}
              />
            </label>
          </Button>
          <Button asChild variant="outline" disabled={dm.uploading}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />{dm.uploading ? "Uploading…" : "Upload PDF"}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={dm.uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) dm.uploadPdf(f); e.currentTarget.value = ""; }} />
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
                  {dm.folderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={createFolder} disabled={dm.creatingFolder}>{dm.creatingFolder ? "Creating…" : "Create folder"}</Button>
            <Button variant="ghost" onClick={() => { setNewFolderOpen(false); setNewFolderName(""); setNewFolderParent(""); }} disabled={dm.creatingFolder}>Cancel</Button>
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
            <Button onClick={addDoc} disabled={dm.addingBusy}>{dm.addingBusy ? "Adding…" : "Add document"}</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setName(""); }} disabled={dm.addingBusy}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}

      {isEmpty && (
        <Card><CardContent className="p-10 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <div className="font-semibold text-sm">Start with a drawing</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Upload your architectural or construction PDF and Cunstruct will extract measurable quantities for review.
            </p>
          </div>
          <Button asChild disabled={dm.uploading}>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />{dm.uploading ? "Uploading…" : "Upload drawing"}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={dm.uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) dm.uploadPdf(f); e.currentTarget.value = ""; }} />
            </label>
          </Button>
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {dm.folderTree.map((node) => folderGroup(node, 0))}

        {dm.unfiledDocs.length > 0 && (
          <div className="space-y-2">
            {dm.folderTree.length > 0 && (
              <div className="flex items-center gap-2 text-sm font-medium py-1 text-muted-foreground">
                <FolderIcon className="h-4 w-4" />
                <span>Unfiled</span>
                <span className="text-xs font-normal">{dm.unfiledDocs.length} doc{dm.unfiledDocs.length === 1 ? "" : "s"}</span>
              </div>
            )}
            <div className="space-y-2">{dm.unfiledDocs.map((d) => documentRow(d, []))}</div>
          </div>
        )}
      </div>

      {/* In-app drawing preview — keeps the user inside Cunstruct instead of a
          new browser tab or a raw iframe (mobile browsers frequently fail to
          render a PDF inline in an iframe at all). Reuses PdfEvidenceViewer —
          the SAME pdf.js rendering/zoom/pan/page-nav infrastructure Review
          already uses — with no evidence and no claim selection, since this
          is a plain "look at the drawing" context, not a review context.
          PdfEvidenceViewer itself is untouched except for the mobile
          fit-to-page fix, which benefits this preview too. */}
      <Dialog open={!!previewing} onOpenChange={(o) => { if (!o) setPreviewing(null); }}>
        {/* min-w-0: DialogContent is `display:grid` with an auto-sized implicit
            track — without this, the PDF canvas's own intrinsic width (its
            native page size before the fit-to-page effect can shrink it) pulls
            this grid item, and so the whole dialog, wider than the viewport on
            a phone. Same fix, same cause, as ResolvedEvidenceViewer's Card on
            the Review split view (see its own min-w-0 comment). */}
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto min-w-0">
          <DialogHeader className="sr-only"><DialogTitle>{previewing?.name ?? "Drawing preview"}</DialogTitle></DialogHeader>
          {previewing && (
            <div className="min-w-0">
              <PdfEvidenceViewer
                fileUrl={previewing.url}
                source={{ document: previewing.name, evidence: [] }}
                documentName={previewing.name}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
