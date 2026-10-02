// WORKSPACE SHARE — the public, unauthenticated entry point for a project
// share link (see src/pages/PublicWorkspaceShare.tsx). The caller has no
// Supabase session at all (no JWT, no anon-role RLS path exists for any of
// projects/project_document/boq/boq_line/the project-drawings storage
// bucket) — this function is the ONLY place that reads this data on their
// behalf, using the service-role key, same admin-client pattern
// supabase/functions/whatsapp-webhook/index.ts already uses for its own
// unauthenticated external caller.
//
// Must be deployed with `verify_jwt` disabled
// (`supabase functions deploy workspace-share --no-verify-jwt`) since there
// is no Supabase JWT to verify.
//
// All actual request logic lives in the pure, dependency-injected
// handler.ts (importable into Vitest) — this file only: validates the
// token, builds narrow read-only closures from the admin client, dispatches,
// and performs the one permitted write (last_accessed_at bookkeeping).

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.22.4";
import { hashShareToken } from "../../../src/lib/review/shareToken.ts";
import {
  handleBootstrap, handleDrawingUrl, handleBoqLines, isLinkActive,
  type ShareReadDeps, type CommercialSpec,
} from "./handler.ts";

const DRAWINGS_BUCKET = "project-drawings";
const SIGNED_URL_TTL_SECONDS = 600;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const BodySchema = z.object({
  token: z.string().min(1),
  action: z.enum(["bootstrap", "drawing_url", "boq_lines"]),
  documentId: z.string().uuid().optional(),
  boqId: z.string().uuid().optional(),
});

// _cost_index_pct etc. are boq.spec's own on-disk keys (see
// WorkspaceBoqPanel.tsx's ActiveBoqCard) — mapped here, once, into the
// handler's spec-key-agnostic CommercialSpec shape, so handler.ts never has
// to know this storage detail.
function toCommercialSpec(spec: Record<string, unknown> | null | undefined): CommercialSpec {
  const s = spec ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    costIndexPct: num(s._cost_index_pct),
    contingencyPct: num(s._contingency_pct),
    overheadPct: num(s._overhead_pct),
    cessPct: num(s._cess_pct),
    gstPct: num(s._gst_pct),
  };
}

function buildDeps(): ShareReadDeps {
  return {
    async getProject(projectId) {
      const { data } = await admin.from("projects").select("id, name").eq("id", projectId).maybeSingle();
      return data ? { id: data.id as string, name: data.name as string } : null;
    },

    async listDocuments(projectId) {
      const { data: docs } = await admin.from("project_document")
        .select("id, name, doc_type, discipline, status, current_revision_id")
        .eq("project_id", projectId);
      const revIds = (docs ?? []).map((d) => d.current_revision_id).filter((id): id is string => !!id);
      const { data: revs } = revIds.length
        ? await admin.from("document_revision").select("id, page_count").in("id", revIds)
        : { data: [] as { id: string; page_count: number | null }[] };
      const pageCountById = new Map((revs ?? []).map((r) => [r.id as string, r.page_count as number | null]));
      return (docs ?? []).map((d) => ({
        id: d.id as string,
        name: d.name as string,
        docType: (d.doc_type as string | null) ?? null,
        discipline: (d.discipline as string | null) ?? null,
        status: (d.status as string | null) ?? "uploaded",
        pageCount: d.current_revision_id ? pageCountById.get(d.current_revision_id as string) ?? null : null,
      }));
    },

    async listScopes(projectId) {
      const { data } = await admin.from("project_scope")
        .select("id, name, kind, sort").eq("project_id", projectId).order("sort");
      return (data ?? []).map((s) => ({ id: s.id as string, name: s.name as string, kind: s.kind as string, sort: s.sort as number }));
    },

    async listBoqs(projectId) {
      const { data: boqs } = await admin.from("boq")
        .select("id, name, scope_id").eq("project_id", projectId).order("sort").order("created_at");
      const rows = boqs ?? [];
      const counts: Record<string, number> = {};
      await Promise.all(rows.map(async (b) => {
        const { count } = await admin.from("boq_line").select("id", { count: "exact", head: true }).eq("boq_id", b.id as string);
        counts[b.id as string] = count ?? 0;
      }));
      return rows.map((b) => ({
        id: b.id as string, name: b.name as string, scopeId: (b.scope_id as string | null) ?? null,
        lineCount: counts[b.id as string] ?? 0,
      }));
    },

    // Scoped to projectId in the query itself — a documentId from another
    // project simply matches no row here, which is exactly the "null = not
    // found in this project" contract handler.ts relies on.
    async getDocumentForProject(projectId, documentId) {
      const { data: doc } = await admin.from("project_document")
        .select("id, name, current_revision_id").eq("id", documentId).eq("project_id", projectId).maybeSingle();
      if (!doc) return null;
      if (!doc.current_revision_id) return { name: doc.name as string, filePath: null, pageTitles: null };
      const { data: rev } = await admin.from("document_revision")
        .select("file_path, page_titles").eq("id", doc.current_revision_id as string).maybeSingle();
      return {
        name: doc.name as string,
        filePath: (rev?.file_path as string | undefined) ?? null,
        pageTitles: (rev?.page_titles as Record<string, string> | null | undefined) ?? null,
      };
    },

    async createSignedUrl(filePath) {
      const { data, error } = await admin.storage.from(DRAWINGS_BUCKET).createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },

    // Scoped to projectId in the query itself, same as getDocumentForProject.
    async getBoqForProject(projectId, boqId) {
      const { data } = await admin.from("boq").select("id, name, spec").eq("id", boqId).eq("project_id", projectId).maybeSingle();
      if (!data) return null;
      return { id: data.id as string, name: data.name as string, spec: toCommercialSpec(data.spec as Record<string, unknown> | null) };
    },

    // Independently re-verifies the boq belongs to projectId — a SECOND,
    // separate check of the same invariant getBoqForProject already applied
    // in handleBoqLines moments earlier (handler.ts never calls this
    // without having checked first), so a future refactor that skipped or
    // mis-ordered that first check still can't leak another project's BOQ
    // lines through this path. A mismatch returns [] (handleBoqLines then
    // reports it the same honest way as a genuinely empty BOQ — see its own
    // "This BOQ has no line items yet." case), never another project's rows.
    async listBoqLines(projectId, boqId) {
      const { data: boq } = await admin.from("boq").select("id").eq("id", boqId).eq("project_id", projectId).maybeSingle();
      if (!boq) return [];
      const { data } = await admin.from("boq_line")
        .select("id, description, unit, qty, included, section, sort, dsr_rate, custom_rate")
        .eq("boq_id", boqId).order("sort");
      return (data ?? []).map((l) => ({
        id: l.id as string,
        description: (l.description as string | null) ?? null,
        unit: (l.unit as string | null) ?? null,
        qty: l.qty as number,
        included: l.included as boolean,
        section: (l.section as string | null) ?? null,
        sort: l.sort as number,
        dsrRate: (l.dsr_rate as number | null) ?? null,
        customRate: (l.custom_rate as number | null) ?? null,
      }));
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: parsed.error.flatten().fieldErrors }, 400);
  const input = parsed.data;

  const tokenHash = await hashShareToken(input.token);
  const { data: link } = await admin.from("project_share_link")
    .select("id, project_id, show_pricing, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  // A single generic response for "missing", "revoked", and "expired" alike
  // — never distinguishing which, so a caller can't use the error to
  // fingerprint whether a guessed token ever existed.
  if (!link || !isLinkActive({ revoked_at: link.revoked_at as string | null, expires_at: link.expires_at as string | null }, Date.now())) {
    return json({ ok: false, error: "This link is no longer available." }, 404);
  }

  const projectId = link.project_id as string;
  const deps = buildDeps();

  let result;
  switch (input.action) {
    case "bootstrap":
      result = await handleBootstrap({ projectId }, deps);
      break;
    case "drawing_url":
      result = await handleDrawingUrl({ projectId, documentId: input.documentId }, deps);
      break;
    case "boq_lines":
      result = await handleBoqLines({ projectId, boqId: input.boqId, showPricing: link.show_pricing as boolean }, deps);
      break;
  }

  // The ONE write in this entire function — best-effort bookkeeping only,
  // never consulted by any access-control check. A failure here never
  // affects the response already computed above.
  try {
    await admin.from("project_share_link").update({ last_accessed_at: new Date().toISOString() }).eq("id", link.id as string);
  } catch {
    // best-effort — nothing to do
  }

  return json(result.body, result.status);
});
