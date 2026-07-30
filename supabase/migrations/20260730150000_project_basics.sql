-- Project basics that drive smart BOQ suggestions. project_type, area_sqft and
-- floors already exist on projects; add the finish quality tier and the room
-- counts used to auto-generate the room list and tune quantities.
alter table public.projects
  add column if not exists quality_tier text not null default 'standard',
  add column if not exists bedrooms int not null default 0,
  add column if not exists bathrooms int not null default 0,
  add column if not exists kitchens int not null default 0;

-- Guard the tier to the three supported values (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_quality_tier_check'
  ) then
    alter table public.projects
      add constraint projects_quality_tier_check
      check (quality_tier in ('economy','standard','premium'));
  end if;
end $$;
