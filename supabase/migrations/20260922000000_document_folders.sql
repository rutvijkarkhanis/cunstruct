-- DOCUMENT FOLDERS — user-created organizational containers for project documents.
--
-- Cunstruct never prescribes a folder structure (no Architectural/Structural/
-- Electrical taxonomy baked in). A folder is just a free-named, user-created
-- container a project owner/staff member can nest arbitrarily deep, mirroring
-- whatever filing structure they already use outside Cunstruct.
--
-- Purely additive: existing project_document rows get folder_id = null
-- ("Unfiled"), and every existing query/pipeline that reads project_document
-- by id (evidence resolution, analysis, review, apply-to-BOQ) is unaffected —
-- none of them read folder_id. Storage paths are keyed by document/revision id
-- already, never by name or folder, so this has zero storage implications.

create table if not exists public.document_folder (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  -- Self-reference for nesting. on delete cascade: removing a folder removes
  -- its subfolders too (documents inside are only unfiled, never deleted —
  -- see project_document.folder_id below).
  parent_id   uuid references public.document_folder(id) on delete cascade,
  name        text not null,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists document_folder_project_idx on public.document_folder (project_id);
create index if not exists document_folder_parent_idx on public.document_folder (parent_id);

-- Nullable: null = "Unfiled" (project root). Deleting a folder never deletes
-- the documents inside it — they fall back to Unfiled.
alter table public.project_document
  add column if not exists folder_id uuid references public.document_folder(id) on delete set null;
create index if not exists project_document_folder_idx on public.project_document (folder_id);

-- ── RLS — identical shape to project_document's existing policy ─────────────
alter table public.document_folder enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_folder' and policyname='document_folder staff manage') then
    create policy "document_folder staff manage" on public.document_folder for all
      using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='document_folder' and policyname='document_folder owner read') then
    create policy "document_folder owner read" on public.document_folder for select
      using (exists (select 1 from public.projects p where p.id = document_folder.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
