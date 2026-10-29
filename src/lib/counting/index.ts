// Drawing instance-counting engine — see docs/drawing-instance-counting.md.
export * from "./contract";
export { countInstances, COUNTING_THRESHOLDS } from "./engine";
export { sheetFromPdfExtraction, scheduleFromAnalysis, toCanonicalSheet, validateInput, pointsPerUnit, type SourceSpace } from "./normalize";
export { toCountingPayloads, type CountingPayloads } from "./toContracts";
export { parseTag, canonicalMark, CATEGORY_PROFILES } from "./categories";
export { findDoorSwings, groupDoorSymbols } from "./doorSwings";
