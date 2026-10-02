// SHARE LINKS — staff-only management of a project's public share links
// (project_share_link). Normal authenticated supabase client throughout —
// staff RLS already covers every operation here; the public, unauthenticated
// READ path a share link enables lives entirely in the workspace-share Edge
// Function and never touches this table directly (see its own header
// comment and the migration's).
//
// Same convention as useDocumentManagement/useBoqManagement: useQuery for
// the list, plain async mutators for create/revoke, qc.invalidateQueries on
// success.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { generateShareToken, hashShareToken } from "@/lib/review/shareToken";

export interface ShareLinkRow {
  id: string;
  name: string;
  show_pricing: boolean;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
}

export interface CreateShareLinkParams {
  name: string;
  showPricing: boolean;
  /** ISO timestamp, or null/undefined for an indefinite link. */
  expiresAt?: string | null;
}

export function useShareLinks(projectId: string | undefined | null) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: links } = useQuery({
    queryKey: ["project-share-links", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_share_link")
        .select("id, name, show_pricing, created_at, expires_at, revoked_at, last_accessed_at")
        .eq("project_id", projectId!).order("created_at", { ascending: false });
      return (data ?? []) as ShareLinkRow[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-share-links", projectId] });

  /** Creates a new link and returns its RAW, one-time-visible token (the
   *  caller must display it immediately — only the hash is persisted, and it
   *  cannot be retrieved again afterward). Returns null on failure (a toast
   *  has already been shown). */
  const createLink = async (params: CreateShareLinkParams): Promise<string | null> => {
    if (!projectId) return null;
    if (!params.name.trim()) { toast.error("Give this link a name"); return null; }
    const rawToken = generateShareToken();
    const tokenHash = await hashShareToken(rawToken);
    const { error } = await supabase.from("project_share_link").insert({
      project_id: projectId,
      name: params.name,
      token_hash: tokenHash,
      show_pricing: params.showPricing,
      expires_at: params.expiresAt ?? null,
      created_by: user?.id,
    });
    if (error) { toast.error(error.message); return null; }
    invalidate();
    return rawToken;
  };

  const revokeLink = async (linkId: string): Promise<boolean> => {
    const { error } = await supabase.from("project_share_link")
      .update({ revoked_at: new Date().toISOString() }).eq("id", linkId);
    if (error) { toast.error(error.message); return false; }
    invalidate();
    return true;
  };

  return { links, createLink, revokeLink };
}
