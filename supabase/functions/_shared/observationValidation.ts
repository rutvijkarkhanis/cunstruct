// Re-exports the EXISTING, already-tested observation parser for use from the
// ai-analysis edge function — deliberately NOT a second implementation, same
// pattern as analysisValidation.ts. observationSchemaV1.ts is pure (no
// browser API, no Supabase import) and uses relative, explicit-extension
// imports internally so it resolves unmodified under Deno as well as Vite/Vitest.
export { parseObservationsV1, OBSERVATION_TYPES, type ObservationV1, type ObservationType } from "../../../src/lib/review/observationSchemaV1.ts";
