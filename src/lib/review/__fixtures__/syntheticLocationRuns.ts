// SYNTHETIC LOCATION RUNS — three invented, already-"audited" LOCATION runs
// for the multi-run benchmark scorer. They keep the situations real runs
// produce (a known classification error, a known material error, repeated
// labels, cross-floor pairs, coverage misses, a different scope-hint
// convention) but every size, material and note is invented: they describe
// no real drawing. Test-only.

import type { ExpectedObservation, LocationBenchmarkRun } from "../benchmarkTypes";

export const SYNTHETIC_APARTMENT_RUN: ExpectedObservation[] = [
  {"id": "ground-living-obs", "observationType": "room_or_space", "mark": "Living", "scopeHint": "Ground Floor", "attributes": {"dimension": "45'1\"x47'11\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "ground-dining-obs", "observationType": "room_or_space", "mark": "Dining", "scopeHint": "Ground Floor", "attributes": {"dimension": "24'5\"x51'7\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "ground-lift-obs", "observationType": "equipment", "mark": "Lift", "scopeHint": "Ground Floor", "attributes": {"dimension": "21'x4'9\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "stilt-main-entrance-obs", "observationType": "opening", "mark": "Main Entrance", "scopeHint": "Stilt Floor", "attributes": {"dimension": "51'1\" wide"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "stilt-maid-room-1-obs", "observationType": "room_or_space", "mark": "Maid Room-1", "scopeHint": "Stilt Floor", "attributes": {"dimension": "40'9\"x4'6\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1, "graded": true, "gap": {"category": "A_EXTRACTION_FAILURE", "note": "Synthetic: the run classified this observation as \"fixture\"; the reference says \"room_or_space\"."}},
  {"id": "stilt-security-gate-obs", "observationType": "other_construction_fact", "mark": "Security Gate", "scopeHint": "Stilt Floor", "attributes": {"dimension": "19' wide"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "ground-main-entrance-dim-obs", "observationType": "dimension_annotation", "mark": "Main Entrance", "scopeHint": "Ground Floor", "attributes": {"dimension": "4'9\" wide"}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "stilt-car-parking-obs", "observationType": "structural_element", "mark": "Car Parking", "scopeHint": "Stilt Floor", "attributes": {"dimension": "13'11\"x54'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "ground-gym-obs", "observationType": "room_or_space", "mark": "Gym", "scopeHint": "Ground Floor", "attributes": {"dimension": "51'6\"x53'7\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
];
export const SYNTHETIC_APARTMENT_RUN_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [{"a": "stilt-main-entrance-obs", "b": "ground-main-entrance-dim-obs"}];

export const SYNTHETIC_SECOND_FLOOR_RUN: ExpectedObservation[] = [
  {"id": "secondfloor-dining-obs", "observationType": "room_or_space", "mark": "Dining", "scopeHint": "Second Floor", "attributes": {"dimension": "32'7\"x51'11\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-master-bedroom-obs", "observationType": "room_or_space", "mark": "Master Bedroom", "scopeHint": "Second Floor", "attributes": {"dimension": "15'9\"x17'6\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-kitchen-obs", "observationType": "room_or_space", "mark": "Kitchen", "scopeHint": "Second Floor", "attributes": {"dimension": "11'1\"x36'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-guest-bedroom-obs", "observationType": "room_or_space", "mark": "Guest Bedroom", "scopeHint": "Second Floor", "attributes": {"dimension": "49'9\"x34'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-media-room-obs", "observationType": "room_or_space", "mark": "Media Room", "scopeHint": "Second Floor", "attributes": {"dimension": "51'2\"x19'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-living-obs", "observationType": "room_or_space", "mark": "Living", "scopeHint": "Second Floor", "attributes": {"dimension": "32'7\"x51'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-w1-obs", "observationType": "opening", "mark": "W1", "scopeHint": "Second Floor", "attributes": {"dimension": "40'x40'6\"", "specification": "Aluminium"}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "secondfloor-d1-obs", "observationType": "opening", "mark": "D1", "scopeHint": "Second Floor", "attributes": {"dimension": "6'9\"x21'0\"", "material": "Stone"}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2, "graded": true, "gap": {"category": "A_EXTRACTION_FAILURE", "note": "Synthetic: the run reported material \"Wood\"; the reference material is \"Stone\"."}},
  {"id": "secondfloor-pooja-obs", "observationType": "room_or_space", "mark": "Pooja", "scopeHint": "Second Floor", "attributes": {"dimension": "4'1\"x38'7\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-lift-obs", "observationType": "equipment", "mark": "Lift", "scopeHint": "Second Floor", "attributes": {"dimension": "21'x4'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-utility-obs", "observationType": "room_or_space", "mark": "Utility", "scopeHint": "Second Floor", "attributes": {"dimension": "36'1\"x36'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-wet-kitchen-obs", "observationType": "room_or_space", "mark": "Wet Kitchen", "scopeHint": "Second Floor", "attributes": {"dimension": "19'9\"x38'4\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-storage-obs", "observationType": "room_or_space", "mark": "Storage", "scopeHint": "Second Floor", "attributes": {"dimension": "40'1\"x4'6\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-children-bedroom-1-obs", "observationType": "room_or_space", "mark": "Children Bedroom-1", "scopeHint": "Second Floor", "attributes": {"dimension": "49'9\"x36'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-children-bedroom-2-obs", "observationType": "room_or_space", "mark": "Children Bedroom-2", "scopeHint": "Second Floor", "attributes": {"dimension": "51'6\"x53'7\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-great-room-obs", "observationType": "room_or_space", "mark": "Great Room", "scopeHint": "Second Floor", "attributes": {"dimension": "9'4\"x49'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-wic-obs", "observationType": "room_or_space", "mark": "W.I.C", "scopeHint": "Second Floor", "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-wr-obs", "observationType": "room_or_space", "mark": "W.R", "scopeHint": "Second Floor", "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "secondfloor-dress-obs", "observationType": "room_or_space", "mark": "Dress", "scopeHint": "Second Floor", "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
];
export const SYNTHETIC_SECOND_FLOOR_RUN_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [];

export const SYNTHETIC_THIRD_RUN: ExpectedObservation[] = [
  {"id": "thirdrun-firstfloor-dining-obs", "observationType": "room_or_space", "mark": "Dining", "scopeHint": "First Floor", "attributes": {"dimension": "32'7\"x51'11\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-master-bedroom-obs", "observationType": "room_or_space", "mark": "Master Bedroom", "scopeHint": "First Floor", "attributes": {"dimension": "15'9\"x17'6\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-guest-bedroom-obs", "observationType": "room_or_space", "mark": "Guest Bedroom", "scopeHint": "First Floor", "attributes": {"dimension": "49'9\"x34'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-media-room-obs", "observationType": "room_or_space", "mark": "Media Room", "scopeHint": "First Floor", "attributes": {"dimension": "51'2\"x19'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-living-obs", "observationType": "room_or_space", "mark": "Living", "scopeHint": "First Floor", "attributes": {"dimension": "32'7\"x51'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-pooja-obs", "observationType": "room_or_space", "mark": "Pooja", "scopeHint": "First Floor", "attributes": {"dimension": "4'1\"x38'7\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-lift-obs", "observationType": "room_or_space", "mark": "Lift", "scopeHint": "First Floor", "attributes": {"dimension": "21'x4'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-children-bedroom-2-obs", "observationType": "room_or_space", "mark": "Children Bedroom-2", "scopeHint": "First Floor", "attributes": {"dimension": "51'6\"x53'7\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-great-room-obs", "observationType": "room_or_space", "mark": "Great Room", "scopeHint": "First Floor", "attributes": {"dimension": "9'4\"x49'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-children-bedroom-1-obs", "observationType": "room_or_space", "mark": "Children Bedroom-1", "scopeHint": "First Floor", "attributes": {"dimension": "49'9\"x36'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-locker-room-obs", "observationType": "room_or_space", "mark": "Locker Room", "scopeHint": "First Floor", "attributes": {"dimension": "49'9\"x40'"}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-wet-kitchen-obs", "observationType": "room_or_space", "mark": "Wet Kitchen", "scopeHint": "First Floor", "attributes": {"dimension": "19'9\"x38'4\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-firstfloor-utility-obs", "observationType": "room_or_space", "mark": "Utility", "scopeHint": "First Floor", "attributes": {"dimension": "36'1\"x36'9\""}, "sourcePage": "p.1 (synthetic)", "expectedPage": 1},
  {"id": "thirdrun-secondfloor-dining-obs", "observationType": "room_or_space", "mark": "Dining", "scopeHint": "Second Floor", "attributes": {"dimension": "32'7\"x51'11\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-master-bedroom-obs", "observationType": "room_or_space", "mark": "Master Bedroom", "scopeHint": "Second Floor", "attributes": {"dimension": "15'9\"x17'6\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-kitchen-obs", "observationType": "room_or_space", "mark": "Kitchen", "scopeHint": "Second Floor", "attributes": {"dimension": "11'1\"x36'"}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-guest-bedroom-obs", "observationType": "room_or_space", "mark": "Guest Bedroom", "scopeHint": "Second Floor", "attributes": {"dimension": "49'9\"x34'"}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-media-room-obs", "observationType": "room_or_space", "mark": "Media Room", "scopeHint": "Second Floor", "attributes": {"dimension": "51'2\"x19'9\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-living-obs", "observationType": "room_or_space", "mark": "Living", "scopeHint": "Second Floor", "attributes": {"dimension": "32'7\"x51'9\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-pooja-obs", "observationType": "room_or_space", "mark": "Pooja", "scopeHint": "Second Floor", "attributes": {"dimension": "4'1\"x38'7\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-lift-obs", "observationType": "room_or_space", "mark": "Lift", "scopeHint": "Second Floor", "attributes": {"dimension": "21'x4'9\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-children-bedroom-2-obs", "observationType": "room_or_space", "mark": "Children Bedroom-2", "scopeHint": "Second Floor", "attributes": {"dimension": "51'6\"x53'7\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-great-room-obs", "observationType": "room_or_space", "mark": "Great Room", "scopeHint": "Second Floor", "attributes": {"dimension": "9'4\"x49'"}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-children-bedroom-1-obs", "observationType": "room_or_space", "mark": "Children Bedroom-1", "scopeHint": "Second Floor", "attributes": {"dimension": "49'9\"x36'9\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-wet-kitchen-obs", "observationType": "room_or_space", "mark": "Wet Kitchen", "scopeHint": "Second Floor", "attributes": {"dimension": "19'9\"x38'4\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
  {"id": "thirdrun-secondfloor-utility-obs", "observationType": "room_or_space", "mark": "Utility", "scopeHint": "Second Floor", "attributes": {"dimension": "36'1\"x36'9\""}, "sourcePage": "p.2 (synthetic)", "expectedPage": 2},
];
export const SYNTHETIC_THIRD_RUN_DISTINCTNESS_PAIRS: { a: string; b: string }[] = [{"a": "thirdrun-firstfloor-dining-obs", "b": "thirdrun-secondfloor-dining-obs"}, {"a": "thirdrun-firstfloor-master-bedroom-obs", "b": "thirdrun-secondfloor-master-bedroom-obs"}, {"a": "thirdrun-firstfloor-guest-bedroom-obs", "b": "thirdrun-secondfloor-guest-bedroom-obs"}, {"a": "thirdrun-firstfloor-media-room-obs", "b": "thirdrun-secondfloor-media-room-obs"}, {"a": "thirdrun-firstfloor-living-obs", "b": "thirdrun-secondfloor-living-obs"}, {"a": "thirdrun-firstfloor-pooja-obs", "b": "thirdrun-secondfloor-pooja-obs"}, {"a": "thirdrun-firstfloor-lift-obs", "b": "thirdrun-secondfloor-lift-obs"}, {"a": "thirdrun-firstfloor-children-bedroom-2-obs", "b": "thirdrun-secondfloor-children-bedroom-2-obs"}, {"a": "thirdrun-firstfloor-great-room-obs", "b": "thirdrun-secondfloor-great-room-obs"}, {"a": "thirdrun-firstfloor-children-bedroom-1-obs", "b": "thirdrun-secondfloor-children-bedroom-1-obs"}, {"a": "thirdrun-firstfloor-wet-kitchen-obs", "b": "thirdrun-secondfloor-wet-kitchen-obs"}, {"a": "thirdrun-firstfloor-utility-obs", "b": "thirdrun-secondfloor-utility-obs"}];

export const SYNTHETIC_LOCATION_RUNS: LocationBenchmarkRun[] = [
  { id: "apartment-run-a", title: "Synthetic apartment — run A (stilt + ground floor)", documentDescription: "Synthetic two-sheet plan: p.1 Stilt Floor, p.2 Ground Floor. Invented values.", expectedObservations: SYNTHETIC_APARTMENT_RUN, distinctnessPairs: SYNTHETIC_APARTMENT_RUN_DISTINCTNESS_PAIRS },
  { id: "second-floor-run-b", title: "Synthetic apartment — run B (second floor plan)", documentDescription: "Synthetic sheet: p.1 Second Floor plan with an opening schedule. Invented values.", expectedObservations: SYNTHETIC_SECOND_FLOOR_RUN, distinctnessPairs: SYNTHETIC_SECOND_FLOOR_RUN_DISTINCTNESS_PAIRS },
  { id: "two-floor-run-c", title: "Synthetic apartment — run C (first and second floor plans)", documentDescription: "Synthetic two-sheet plan: p.1 First Floor, p.2 Second Floor. Invented values.", expectedObservations: SYNTHETIC_THIRD_RUN, distinctnessPairs: SYNTHETIC_THIRD_RUN_DISTINCTNESS_PAIRS },
];
