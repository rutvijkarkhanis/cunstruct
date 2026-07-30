-- Seed BOQ checklists for the remaining material-heavy stages. Add-only,
-- guarded so it won't duplicate rows already present.

insert into public.boq_template (stage_id, item_name, match_keyword, unit, qty_formula, sort)
select s.id, v.item_name, v.match_keyword, v.unit, v.qty_formula::jsonb, v.sort
from (values
  -- Foundation
  ('Foundation', 'Cement',        'cement',    'bag', '{"per_sqft":0.4,"pack_size":1}', 1),
  ('Foundation', 'River Sand',    'sand',      'cft', '{"per_sqft":1.2}',               2),
  ('Foundation', 'Aggregate',     'aggregate', 'cft', '{"per_sqft":0.9}',               3),
  ('Foundation', 'TMT Steel',     'tmt',       'kg',  '{"per_sqft":2.5}',               4),

  -- RCC Structure
  ('RCC Structure', 'Cement',        'cement', 'bag',   '{"per_sqft":0.5,"pack_size":1}', 1),
  ('RCC Structure', 'TMT Steel',     'tmt',    'kg',    '{"per_sqft":3.5}',               2),
  ('RCC Structure', 'Aggregate',     'aggregate','cft', '{"per_sqft":1.3}',               3),
  ('RCC Structure', 'River Sand',    'sand',   'cft',   '{"per_sqft":1.0}',               4),
  ('RCC Structure', 'Binding Wire',  'binding','kg',    '{"per_sqft":0.02}',              5),
  ('RCC Structure', 'Shuttering Ply','ply',    'sheet', '{"per_sqft":0.05}',              6),

  -- Masonry
  ('Masonry', 'Bricks / Blocks', 'brick',  'pc',  '{"per_wall_sqft":1.0}',                2),
  ('Masonry', 'Cement',          'cement', 'bag', '{"per_wall_sqft":0.04,"pack_size":1}', 1),
  ('Masonry', 'River Sand',      'sand',   'cft', '{"per_wall_sqft":0.5}',                3),

  -- Plumbing Rough-In
  ('Plumbing Rough-In', 'CPVC Pipe',      'cpvc',    'm',  '{"per_bathroom":20}',  1),
  ('Plumbing Rough-In', 'Drainage Pipe',  'drainage','m',  '{"per_bathroom":10}',  2),
  ('Plumbing Rough-In', 'Pipe Fittings',  'fitting', 'pc', '{"per_bathroom":15}',  3),
  ('Plumbing Rough-In', 'Concealed Valve','valve',   'pc', '{"per_bathroom":3}',   4),

  -- Waterproofing
  ('Waterproofing', 'Waterproofing Compound', 'waterproof', 'kg',    '{"per_floor_sqft":0.05}', 1),
  ('Waterproofing', 'Waterproof Membrane',    'membrane',   'sq.ft', '{"per_floor_sqft":1.05}', 2),

  -- Plastering
  ('Plastering', 'Cement',     'cement', 'bag', '{"per_wall_sqft":0.025,"pack_size":1}', 1),
  ('Plastering', 'River Sand', 'sand',   'cft', '{"per_wall_sqft":0.5}',                 2),

  -- Ceiling Works
  ('Ceiling Works', 'Gypsum Board', 'gypsum',  'sq.ft', '{"per_floor_sqft":1.05}', 1),
  ('Ceiling Works', 'GI Channel',   'channel', 'm',     '{"per_floor_sqft":0.3}',  2),
  ('Ceiling Works', 'POP',          'pop',     'bag',   '{"per_floor_sqft":0.02,"pack_size":1}', 3),

  -- Doors & Windows
  ('Doors & Windows', 'Door Frame',      'frame',  'pc',  '{"per_room":1}', 1),
  ('Doors & Windows', 'Door Shutter',    'shutter','pc',  '{"per_room":1}', 2),
  ('Doors & Windows', 'Window',          'window', 'pc',  '{"per_room":1}', 3),
  ('Doors & Windows', 'Door Hardware',   'hinge',  'set', '{"per_room":1}', 4),

  -- Fixtures & Fittings
  ('Fixtures & Fittings', 'Wash Basin',    'basin',  'pc',  '{"per_bathroom":1}', 1),
  ('Fixtures & Fittings', 'WC / Toilet',   'closet', 'pc',  '{"per_bathroom":1}', 2),
  ('Fixtures & Fittings', 'CP Fittings',   'cp',     'set', '{"per_bathroom":1}', 3),
  ('Fixtures & Fittings', 'Ceiling Fan',   'fan',    'pc',  '{"per_room":1}',     4),
  ('Fixtures & Fittings', 'Light Fixtures','light',  'pc',  '{"per_room":2}',     5)
) as v(stage_name, item_name, match_keyword, unit, qty_formula, sort)
join public.stage_master s on s.name = v.stage_name
where not exists (select 1 from public.boq_template t where t.stage_id = s.id and t.item_name = v.item_name);
