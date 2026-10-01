// SHARED DOCUMENT MANAGEMENT — the one implementation of project-document
// CRUD (folders, upload, delete, revisions), extracted verbatim from
// ProjectDocuments.tsx (Phase 11 Stage C2) so both the existing /documents
// page and the new Workspace source-management drawer consume the exact
// same persistence logic — never two independent implementations of the
// same mutations.
//
// Reuses the EXISTING data model unchanged: project_document,
// document_folder, document_revision, boq_document, analysis_run_source,
// analysis_run — and the existing drawingStorage.ts helpers for the actual
// file upload/delete/signed-URL calls. No new schema, no new document
// identity system.
//
// Every toast message, every confirm() prompt, and every query key below is
// copied unchanged from ProjectDocuments.tsx — this is an extraction, not a
// rewrite, so both consumers see byte-identical behavior.

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DOC_TYPES, DISCIPLINES, type ProjectDocument, type DocumentRevision, type DocumentFolder } from "@/lib/projectDocs";
import { validateDrawingFile, buildDrawingPath, uploadDrawing, deleteDrawing, signedDrawingUrl } from "@/lib/review/drawingStorage";
import { buildFolderTree, folderBreadcrumb, parseRelativePath, looksLikePdf, type FolderNode } from "@/lib/documentFolders";

export { DOC_TYPES, DISCIPLINES };
export type { ProjectDocument, DocumentRevision, DocumentFolder, FolderNode };

// Chrome/Edge/Safari/Firefox all support selecting a whole folder via the
// non-standard `webkitdirectory` input attribute — no library needed. Each
// resulting File carries `webkitRelativePath` (e.g. "Floor 2/Plan.pdf").
type FileWithRelativePath = File & { webkitRelativePath?: string };

export function useDocumentManagement(projectId: string | undefined | null) {
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

  const ids = useMemo(() => (docs ?? []).map((d) => d.id), [docs]);

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

  // Which documents Cunstruct has already produced a completed analysis for —
  // real data (a SUCCEEDED analysis_run_source row), never inferred/guessed.
  const { data: analysedDocIds } = useQuery({
    queryKey: ["document-analysed-ids", projectId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("analysis_run_source")
        .select("document_id").eq("status", "SUCCEEDED").in("document_id", ids);
      return new Set((data ?? []).map((r) => (r as { document_id: string | null }).document_id).filter(Boolean) as string[]);
    },
  });

  // How many quantities the most recent analysis run found for each document —
  // real, existing data (analysis_run.item_count), never a fabricated figure.
  const { data: docQuantityCounts } = useQuery({
    queryKey: ["document-quantity-counts", projectId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("analysis_run")
        .select("resolved_document_id, item_count, created_at").in("resolved_document_id", ids).order("created_at");
      const out: Record<string, number> = {};
      for (const r of (data ?? []) as { resolved_document_id: string | null; item_count: number | null }[]) {
        if (r.resolved_document_id) out[r.resolved_document_id] = r.item_count ?? 0;
      }
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

  // Flat list for a parent-folder picker, indented to show depth.
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

  // ---- Create folder ---------------------------------------------------------
  const [creatingFolder, setCreatingFolder] = useState(false);
  const createFolder = async (name: string, parentId: string | null): Promise<boolean> => {
    if (!projectId) return false;
    if (!name.trim()) { toast.error("Enter a folder name"); return false; }
    setCreatingFolder(true);
    try {
      const { error } = await supabase.from("document_folder")
        .insert({ project_id: projectId, name: name.trim(), parent_id: parentId || null });
      if (error) throw error;
      toast.success("Folder created");
      invalidateAll();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create folder");
      return false;
    } finally {
      setCreatingFolder(false);
    }
  };

  // ---- Add document (metadata-only, no file) --------------------------------
  const [addingBusy, setAddingBusy] = useState(false);
  const addDocument = async (name: string, docType: string, discipline: string): Promise<boolean> => {
    if (!projectId) return false;
    if (!name.trim()) { toast.error("Enter a document name"); return false; }
    setAddingBusy(true);
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
      invalidateAll();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add document");
      return false;
    } finally {
      setAddingBusy(false);
    }
  };

  // ---- Upload a PDF drawing (private storage) — shared by single-file and
  // folder upload, so both go through the exact same path. ----
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
      // name, in this folder or elsewhere.
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
  const uploadPdf = async (file: File): Promise<void> => {
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
      const cacheKey = `${parentId ?? "\0root"}${seg}`;
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

  const uploadFolder = async (fileList: FileList): Promise<void> => {
    if (!projectId) return;
    const all = Array.from(fileList) as FileWithRelativePath[];
    const pdfs = all.filter(looksLikePdf);
    if (pdfs.length === 0) {
      toast.error(all.length ? "No PDF files found in the selected folder" : "No files found");
      return;
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
  const deleteDocument = async (doc: ProjectDocument): Promise<void> => {
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
  const addRevision = async (docId: string, label: string, url: string): Promise<boolean> => {
    if (!label.trim()) { toast.error("Enter a revision label (e.g. Rev B)"); return false; }
    const { data, error } = await supabase.from("document_revision")
      .insert({ document_id: docId, label: label.trim(), source: url.trim() ? "url" : "paste", external_url: url.trim() || null, status: "draft" })
      .select("id").single();
    if (error) { toast.error(error.message); return false; }
    await supabase.from("project_document").update({ current_revision_id: (data as { id: string }).id }).eq("id", docId);
    invalidateAll();
    toast.success("Revision added and set current");
    return true;
  };

  const setCurrentRevision = async (docId: string, revId: string): Promise<void> => {
    const { error } = await supabase.from("project_document").update({ current_revision_id: revId }).eq("id", docId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
  };

  // ---- Open/preview a stored PDF revision -----------------------------------
  // The bucket is private; a fresh short-lived signed URL is requested on
  // every call (never cached/stored). signedDrawingUrl() never throws; it
  // resolves null on a missing object or a denied RLS check.
  const [openingRevId, setOpeningRevId] = useState<string | null>(null);
  const openDrawing = async (revId: string, path: string): Promise<void> => {
    setOpeningRevId(revId);
    try {
      const url = await signedDrawingUrl(path);
      if (!url) { toast.error("Could not open this drawing. It may be missing or you may not have access."); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningRevId(null);
    }
  };

  const [previewLoadingFor, setPreviewLoadingFor] = useState<string | null>(null);
  /** Resolves a signed URL for in-app preview — the caller decides how to
   *  display it (a dialog, as ProjectDocuments.tsx does, or anything else);
   *  this stays presentation-agnostic so Workspace and the Documents page
   *  can each show it their own way without a second resolution path. */
  const resolvePreviewUrl = async (revId: string, path: string): Promise<string | null> => {
    setPreviewLoadingFor(revId);
    try {
      const url = await signedDrawingUrl(path);
      if (!url) toast.error("Could not open this drawing. It may be missing or you may not have access.");
      return url;
    } finally {
      setPreviewLoadingFor(null);
    }
  };

  return {
    // data
    folders, docs, revs, linkCounts, analysedDocIds, docQuantityCounts,
    folderTree, docsByFolder, unfiledDocs, folderOptions,
    revsFor, folderBreadcrumb: (folderId: string | null) => folderBreadcrumb(folderId, folders ?? []),

    // mutation state
    creatingFolder, addingBusy, uploading, uploadingFolder, openingRevId, previewLoadingFor,

    // actions
    createFolder, addDocument, uploadPdf, uploadFolder, deleteDocument,
    addRevision, setCurrentRevision, openDrawing, resolvePreviewUrl,
  };
}

export type DocumentManagement = ReturnType<typeof useDocumentManagement>;
