// DOCUMENT FOLDERS — pure helpers for the Project Documents folder tree.
//
// Cunstruct never prescribes a folder taxonomy; a folder is just a user-named,
// user-nested container. Everything here is pure (no Supabase, no DOM/File
// APIs) so the tree-building, breadcrumb, cycle-prevention, and
// folder-path-parsing logic can be tested directly.

import type { DocumentFolder } from "./projectDocs";

export interface FolderNode extends DocumentFolder {
  children: FolderNode[];
}

/** Build a nested tree from a flat folder list. A folder whose parent_id
 *  doesn't resolve within the set (missing, or not yet loaded) is treated as
 *  a root — never dropped silently. Sorted by `sort`, then name, at every level. */
export function buildFolderTree(folders: DocumentFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byOrder = (a: FolderNode, b: FolderNode) => a.sort - b.sort || a.name.localeCompare(b.name);
  const sortRecursive = (nodes: FolderNode[]) => {
    nodes.sort(byOrder);
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);
  return roots;
}

/** The folder names from root to `folderId`, e.g. ["Floor 2", "Plumbing"].
 *  Empty array for null/root. Guards against a cyclic parent chain (should
 *  never happen — the UI prevents it — but this must never hang). */
export function folderBreadcrumb(folderId: string | null, folders: DocumentFolder[]): string[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

export interface ParsedRelativePath {
  /** Folder names from root to the file's immediate parent, e.g. ["Floor 2", "Plumbing"]. */
  folderSegments: string[];
  fileName: string;
}

/** Split a `webkitRelativePath` (e.g. "Floor 2/Plumbing/Plan.pdf") into its
 *  folder segments and filename. Empty/blank segments are dropped so a stray
 *  leading/trailing slash never produces a blank-named folder. */
export function parseRelativePath(relativePath: string): ParsedRelativePath {
  const parts = relativePath.split("/").map((p) => p.trim()).filter(Boolean);
  const fileName = parts.pop() ?? relativePath;
  return { folderSegments: parts, fileName };
}

/** True for a file that looks like a PDF by type or extension — the same
 *  check the single-file upload path already applies, reused so folder
 *  upload silently skips non-PDF files it recursively encounters. */
export function looksLikePdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
