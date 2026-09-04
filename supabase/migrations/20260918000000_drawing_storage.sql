-- DRAWING STORAGE — private bucket + file metadata for project drawings.
--
-- Lets a project drawing (PDF) be uploaded and rendered in the Review
-- Workstation. Reuses the existing project_document / document_revision model
-- (document_revision already has file_path, page_count, source='upload'); this
-- only ADDS file metadata columns and a PRIVATE storage bucket with RLS scoped to
-- the owning project. Additive, idempotent, non-destructive. Never makes a drawing
-- public and never changes a boq_line.

-- ── 1) File metadata on the existing revision row ────────────────────────────
alter table public.document_revision
  add column if not exists mime_type         text,
  add column if not exists file_size         bigint,
  add column if not exists original_filename text;

-- ── 2) Private storage bucket (PDF only, 50 MB cap) ──────────────────────────
-- public=false → objects are never served by a permanent public URL; access is
-- only via short-lived signed URLs gated by the RLS policies below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-drawings', 'project-drawings', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- ── 3) storage.objects RLS — path is "<project_id>/<doc_id>/<rev_id>.pdf" ─────
-- The first path segment is the project id; a user may touch an object only when
-- they are staff or own that project. This is enforced in the database, so a
-- browser cannot reach another project's drawing by guessing an id/path.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='project-drawings read') then
    create policy "project-drawings read" on storage.objects for select
      using (
        bucket_id = 'project-drawings' and (
          public.is_staff(auth.uid()) or exists (
            select 1 from public.projects p
            where p.id::text = (storage.foldername(name))[1] and p.owner_id = auth.uid()
          )
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='project-drawings insert') then
    create policy "project-drawings insert" on storage.objects for insert
      with check (
        bucket_id = 'project-drawings' and (
          public.is_staff(auth.uid()) or exists (
            select 1 from public.projects p
            where p.id::text = (storage.foldername(name))[1] and p.owner_id = auth.uid()
          )
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='project-drawings delete') then
    create policy "project-drawings delete" on storage.objects for delete
      using (
        bucket_id = 'project-drawings' and (
          public.is_staff(auth.uid()) or exists (
            select 1 from public.projects p
            where p.id::text = (storage.foldername(name))[1] and p.owner_id = auth.uid()
          )
        )
      );
  end if;
end $$;
