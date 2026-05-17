ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);

DROP POLICY IF EXISTS "Owner inserts own project" ON public.projects;
CREATE POLICY "Owner inserts own project"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);
