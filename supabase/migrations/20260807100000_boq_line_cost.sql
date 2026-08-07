-- "Make" (margin) control: capture the estimator's own execution cost per unit
-- alongside the quoted rate, so the BOQ shows make = quote − cost per line and
-- overall — the lever for big projects.

alter table public.boq_line
  add column if not exists cost numeric;
