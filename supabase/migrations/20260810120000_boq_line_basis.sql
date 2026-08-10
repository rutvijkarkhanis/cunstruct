-- Quantity provenance on each BOQ line, so the final BOQ can explain where every
-- number came from: DRAWING_INPUT (counted/stated on a drawing), DRAWING_DERIVED
-- (calculated from drawing measurements), DSR_AOR (construction coefficients), or
-- HEURISTIC (archetype / built-up-area assumption). Set at generation time from
-- the questionnaire + the operator's drawing summary (boq.spec._drawing).

alter table public.boq_line
  add column if not exists basis      text,   -- QtyBasis; null = manual / unknown
  add column if not exists basis_note text;   -- e.g. "8×6A + 2×16A sockets, living room"
