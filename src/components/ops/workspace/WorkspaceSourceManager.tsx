// WORKSPACE SOURCE MANAGER — Phase 11 Stage C2.
//
// The contextual drawer behind the Sources rail's "+ Add source" affordance.
// Consumes the SAME useDocumentManagement hook as the existing Documents
// page (/ops/projects/:id/documents) — this is not a second document CRUD
// implementation, it is the one shared persistence logic presented as a
// drawer instead of a full page. Rename is intentionally absent here: no
// rename capability exists anywhere in Cunstruct today (see
// useDocumentManagement.ts) and this drawer doesn't invent one.
//
// Opening/closing this drawer is local UI state owned by ProjectWorkspace —
// it never touches the ?document=&page=&mode=&boq= URL state, so the
// drawing underneath is exactly as the user left it when they close it.

import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, ChevronDown, ChevronRight, FileText, Folder as FolderIcon,
  FolderOpen, FolderPlus, Plus, Settings, Trash2, Upload,
} from "lucide-react";
import { useDocumentManagement, type ProjectDocument, type FolderNode } from "@/hooks/useDocumentManagement";

export interface WorkspaceSourceManagerProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
}

export default function WorkspaceSourceManager({
  projectId, open, onOpenChange, activeDocumentId, onSelectDocument,
}: WorkspaceSourceManagerProps) {
  const dm = useDocumentManagement(projectId);

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (id: string) => setExpandedFolders((e) => ({ ...e, [id]: !(e[id] ?? true) }));

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string>("");
  const createFolder = async () => {
    const ok = await dm.createFolder(newFolderName, newFolderParent || null);
    if (ok) { setNewFolderName(""); setNewFolderParent(""); setNewFolderOpen(false); }
  };

  const [revFor, setRevFor] = useState<string | null>(null);
  const [revLabel, setRevLabel] = useState("");
  const [revUrl, setRevUrl] = useState("");
  const addRevision = async (docId: string) => {
    const ok = await dm.addRevision(docId, revLabel, revUrl);
    if (ok) { setRevFor(null); setRevLabel(""); setRevUrl(""); }
  };

  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});

  const documentRow = (d: ProjectDocument) => {
    const rs = dm.revsFor(d.id);
    const current = rs.find((r) => r.id === d.current_revision_id);
    const detailsOpen = expandedDocs[d.id];
    const active = d.id === activeDocumentId;
    return (
      <div key={d.id} className="rounded-sm border" data-testid={`source-manager-doc-${d.id}`}>
        <div className={cn("flex items-center gap-1 px-2 py-1.5", active && "bg-primary/10")}>
          <button
            type="button"
            className="flex-1 flex items-center gap-1.5 text-left text-xs min-w-0"
            onClick={() => { onSelectDocument(d.id); onOpenChange(false); }}
          >
            <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{d.name}</span>
            {current?.label && <span className="text-muted-foreground shrink-0">{current.label}</span>}
          </button>
          <Button
            size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0"
            onClick={() => setExpandedDocs((e) => ({ ...e, [d.id]: !e[d.id] }))}
            aria-label="Toggle revisions"
          >
            {detailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 text-destructive"
            onClick={() => dm.deleteDocument(d)}
            aria-label={`Delete ${d.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {detailsOpen && (
          <div className="px-2 pb-2 pt-1 space-y-1.5 border-t">
            {rs.map((r) => (
              <div key={r.id} className="flex items-center gap-1.5 text-xs">
                <Badge variant={r.id === d.current_revision_id ? "default" : "outline"} className="text-[10px]">{r.label}</Badge>
                {r.id === d.current_revision_id ? (
                  <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5">
                    <CheckCircle2 className="h-3 w-3" />current
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => dm.setCurrentRevision(d.id, r.id)}>
                    Set current
                  </Button>
                )}
              </div>
            ))}
            {revFor === d.id ? (
              <div className="flex flex-wrap items-end gap-1.5 pt-1">
                <Input value={revLabel} onChange={(e) => setRevLabel(e.target.value)} placeholder="Rev B" className="h-7 w-20 text-xs" />
                <Input value={revUrl} onChange={(e) => setRevUrl(e.target.value)} placeholder="https://… (optional)" className="h-7 w-32 text-xs" />
                <Button size="sm" className="h-7 text-xs" onClick={() => addRevision(d.id)}>Add</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRevFor(null)}>Cancel</Button>
              </div>
            ) : (
              <Button
                size="sm" variant="outline" className="h-6 text-[10px]"
                onClick={() => { setRevFor(d.id); setRevLabel(""); setRevUrl(""); }}
              >
                <Plus className="h-3 w-3 mr-1" />Add revision
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const folderGroup = (node: FolderNode, depth: number) => {
    const isOpen = expandedFolders[node.id] ?? true;
    const nodeDocs = dm.docsByFolder.get(node.id) ?? [];
    return (
      <div key={node.id} style={{ marginLeft: depth * 12 }} className="space-y-1.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium py-1 w-full text-left"
          onClick={() => toggleFolder(node.id)}
          data-testid={`source-manager-folder-${node.id}`}
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 text-amber-600" /> : <FolderIcon className="h-3.5 w-3.5 text-amber-600" />}
          <span>{node.name}</span>
          <span className="text-[10px] text-muted-foreground font-normal">{nodeDocs.length}</span>
        </button>
        {isOpen && (
          <div className="space-y-1.5 pl-1">
            {nodeDocs.map((d) => documentRow(d))}
            {node.children.map((child) => folderGroup(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="px-4 py-3 border-b text-left space-y-0.5">
          <SheetTitle className="text-sm">Manage sources</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Upload, organize, and remove the drawings and documents this project's Workspace draws from.
          </p>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setNewFolderOpen((v) => !v)}>
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" />New folder
          </Button>
          <Button size="sm" asChild variant="outline" disabled={dm.uploadingFolder}>
            <label className="cursor-pointer">
              <Upload className="h-3.5 w-3.5 mr-1.5" />{dm.uploadingFolder ? "Uploading…" : "Upload folder"}
              <input
                type="file"
                // @ts-expect-error non-standard attributes not in the DOM lib typings
                webkitdirectory="" directory="" multiple
                className="hidden" disabled={dm.uploadingFolder}
                onChange={(e) => { const fl = e.target.files; if (fl && fl.length) dm.uploadFolder(fl); e.currentTarget.value = ""; }}
              />
            </label>
          </Button>
          <Button size="sm" asChild variant="outline" disabled={dm.uploading}>
            <label className="cursor-pointer">
              <Upload className="h-3.5 w-3.5 mr-1.5" />{dm.uploading ? "Uploading…" : "Upload PDF"}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={dm.uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) dm.uploadPdf(f); e.currentTarget.value = ""; }} />
            </label>
          </Button>
        </div>

        {newFolderOpen && (
          <div className="px-4 py-3 border-b space-y-2">
            <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name, e.g. Floor 2" className="h-8 text-xs" />
            <Select value={newFolderParent || "__root__"} onValueChange={(v) => setNewFolderParent(v === "__root__" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">— Top level —</SelectItem>
                {dm.folderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={createFolder} disabled={dm.creatingFolder}>
                {dm.creatingFolder ? "Creating…" : "Create"}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setNewFolderOpen(false); setNewFolderName(""); setNewFolderParent(""); }}
                disabled={dm.creatingFolder}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {!dm.docs?.length && !dm.folders?.length && (
            <p className="text-xs text-muted-foreground text-center py-6">No documents yet — upload a PDF to get started.</p>
          )}
          {dm.folderTree.map((node) => folderGroup(node, 0))}
          {dm.unfiledDocs.length > 0 && (
            <div className="space-y-1.5">
              {dm.folderTree.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground py-1">
                  <FolderIcon className="h-3.5 w-3.5" /><span>Unfiled</span>
                </div>
              )}
              <div className="space-y-1.5">{dm.unfiledDocs.map((d) => documentRow(d))}</div>
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t">
          <Link
            to={`/ops/projects/${projectId}/documents`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" />Open full Documents page
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
