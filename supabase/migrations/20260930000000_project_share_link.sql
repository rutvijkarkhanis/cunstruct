-- PROJECT SHARE LINK — a public, unauthenticated, read-only link into ONE
-- project's Workspace view (Sources + drawing canvas + BOQ panel), for an
-- external reviewer with no Cunstruct login. Nothing in this schema has ever
-- granted anonymous access before — every existing table uses exactly the
-- staff/owner RLS pattern below, with no anon-role policy anywhere. That
-- pattern is kept unchanged here too: this table's OWN rows are never read
-- by an anonymous caller. The public read path goes entirely through the
-- workspace-share Edge Function (service-role key, like whatsapp-webhook),
-- which validates the token server-side and never exposes this table or any
-- other directly to the browser. See src/lib/review/shareToken.ts for the
-- token generation/hashing this table's token_hash column is built from.
--
-- Only a SHA-256 hash of the share token is ever stored (token_hash), never
-- the raw token — the same discipline as a password-reset token. The raw
-- token is shown to the staff member who created it exactly once, in the
-- management UI, and is never retrievable again afterward; losing it means
-- revoking the link and creating a new one.
--
-- Purely additive. `on delete cascade` from projects means deleting a
-- project cleans up its share links automatically.

create table if not exists public.project_share_link (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  name              text not null,
  token_hash        text not null unique,
  -- Whether the shared BOQ panel includes rate/amount/Subtotal/Grand Total
  -- figures, or only description/unit/qty. Per-link, not per-project, so a
  -- staff member can create one priced link and one unpriced link for the
  -- same project without affecting each other.
  show_pricing      boolean not null default true,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  -- null = indefinite. Enforced by the edge function (isLinkActive), not by
  -- a DB constraint — the row stays readable to staff after expiry so it
  -- still shows up (greyed out) in the management list.
  expires_at        timestamptz,
  -- null = active. Set once, never cleared — a revoked link's token is dead
  -- forever; staff create a new link rather than un-revoking.
  revoked_at        timestamptz,
  -- Best-effort bookkeeping only, written by the edge function on a
  -- successful validation. Never consulted by any access-control check.
  last_accessed_at  timestamptz
);

create index if not exists project_share_link_project_idx on public.project_share_link (project_id);

-- ── RLS — identical shape to every other project-scoped table in this
-- schema (document_folder, project_document, boq, ...): staff manage
-- everything, an owner can read their own project's rows. No anon policy —
-- see the header comment above for why that's deliberate. ──────────────────
alter table public.project_share_link enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_share_link' and policyname='project_share_link staff manage') then
    create policy "project_share_link staff manage" on public.project_share_link for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_share_link' and policyname='project_share_link owner read') then
    create policy "project_share_link owner read" on public.project_share_link for select
      using (exists (select 1 from public.projects p where p.id = project_share_link.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
