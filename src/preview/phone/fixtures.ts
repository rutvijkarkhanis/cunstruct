// ILLUSTRATIVE FIXTURES for the B10 phone surfaces. Not from any real project;
// the rupee range is not an estimate.

export interface SignOffFixture {
  project: string;
  summary: string;
  /** Illustrative ₹ range (low–high); not a project estimate. */
  lowInr: number;
  highInr: number;
  pendingLines: number;
  risks: string[];
}

export const PREVIEW_SIGNOFF: SignOffFixture = {
  project: "Demo G+1 house (fixture)",
  summary: "Substructure and plinth BOQ, 7 lines; 5 certified, 1 awaiting review, 1 with pending quantity.",
  lowInr: 3_820_000,
  highInr: 4_420_000,
  pendingLines: 1,
  risks: [
    "Reinforcement quantity for columns is pending; it is not in the range.",
    "Boundary-wall brickwork is not yet certified.",
    "Brickwork material coefficients are illustrative fixtures, not DAR.",
  ],
};

/** The measurement line the site-entry view writes rows for (fixture). */
export const PREVIEW_MEASURE_LINE = { id: "PL-01", item: "PCC 1:2:4 below footings (fixture)", unit: "cum" as const };
