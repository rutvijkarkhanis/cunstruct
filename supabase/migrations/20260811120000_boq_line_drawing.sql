-- Structured drawing-summary provenance carried onto each BOQ line so the
-- location, per-room breakdown, operator basis word (Counted/Measured/Derived/
-- Assumed) and Works-vs-Equipment scope survive all the way into the BOQ screen,
-- PDF and Excel — not just the coarse `basis` enum. Shape:
--   { "basis": "Counted", "location": "Living / TV area", "scope": "works",
--     "rooms": [ { "location": "Bedroom 1", "qty": 4 }, ... ] }

alter table public.boq_line
  add column if not exists drawing jsonb;
