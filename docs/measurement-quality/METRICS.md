# Measurement metrics: definitions and denominators

Code: `src/lib/measurement-quality/metrics.ts` (computed) and `ledger.ts` (the per-item outcomes the metrics count).
Every metric is a count of named items, carries its own denominator, and states whether it is **end-to-end**
(over every reference dimension) or **conditional** (over the items that passed an earlier stage).
No single "overall accuracy" percentage is produced, on purpose.

The reference is a Gold Set record. On W976646 it is **developer-verified, not independently verified**.
Every figure computed against it inherits that limitation.

## Matching (which engine record belongs to a reference)
This is the nearest unused engine dimension that satisfies all of the following:
- it is on the same page;
- its parsed value equals the reference value;
- its text anchor is within 12 pt of the reference text centre.

References are matched in reference order, and each engine dimension is matched at most once.
This rule is a port of the historical scorer (`score2.py`), so the results can be compared item by item.

## Per-stage outcomes
Each stage gives every item exactly one outcome. Outcomes are mutually exclusive.

| stage | outcomes | rule |
|---|---|---|
| detection | found, missed | missed = no engine dimension matched |
| parse | correct, incorrect-value, incorrect-unit | value and unit must both equal the reference |
| line | correct, incorrect, multiple-plausible, none, no-reference | See the line rule below. |
| endpoints | correct-pair, wrong-pair, one-sided-match, one-sided-wrong, ambiguous, unresolved, not-attempted, no-reference | See the endpoint rule below. |
| association | correct, incorrect, ambiguous, unassociated, associated-unscored, not-attempted | See the association rule below. |
| overall | acceptable, hold, reject, missed | The engine's own decision. |
| final | correctly-accepted, incorrectly-accepted, correctly-held, unnecessarily-held, correctly-rejected, incorrectly-rejected, missed | See the final-outcome rule below. |

**Line.**
- `none` means the engine's line decision was not-found.
- `multiple-plausible` means the engine's line decision was ambiguous, even if the line it reported lies on the reference axis. That fact is kept separately in `line_on_reference_axis`.
- Otherwise the line is `correct` when both of its ends are within 0.5 pt of the reference line, measured across the line.
- Extent is judged by the endpoint stage, not here.

**Endpoints.**
- `correct-pair` means both span ends are within 1 pt of the reference endpoints along the line, and within 1 pt across it.
- A one-sided result is scored against the reference ends. It is never reported as a pair.

**Association.**
- Association is scored only when the endpoint pair is correct and the reference description can be read as two ends.
- Each end is either a named grid or a drawn edge.
- Otherwise the item is `associated-unscored`.

**Final outcome.** An item is **determined** when its reference status is `OK`, meaning the reference names one unambiguous answer.
- Accepted:
  - correctly-accepted: fully correct (parse, endpoint pair and association all correct) and determined.
  - incorrectly-accepted: any other accepted item.
- Held:
  - unnecessarily-held: the item is determined.
  - correctly-held: the item is not determined (CONFLICT, GEOMETRY-INCONSISTENT, NOT-DERIVABLE or ASSOCIATION-UNCERTAIN).
- Rejected: the same split, as incorrectly-rejected and correctly-rejected.
- "Unnecessarily held" makes no claim that the engine's evidence was right. The two operational metrics below separate held items whose evidence was correct from those where holding prevented an error.

## Metrics
| id | numerator | denominator | basis |
|---|---|---|---|
| detection.found / detection.missed | references found / missed | all references | end-to-end |
| detection.false_detections | **not measurable** | (none) | (none) |
| parse.correct / incorrect_value / incorrect_unit | as named | references found | conditional on detection |
| parse.unparseable_or_ambiguous | **not separately observable** | (none) | (none) |
| line.{correct,incorrect,multiple-plausible,none,no-reference} | as named | all references | end-to-end |
| endpoints.{…} | as named | all references | end-to-end |
| endpoints.correct-pair\|line-correct | correct pairs | items with a correct line | conditional |
| association.{…} | as named | all references | end-to-end |
| association.correct\|endpoints-correct | correct associations | items with a correct pair | conditional |
| decision.{acceptable,hold,reject,missed} | engine decision | all references | end-to-end |
| final.{…} | final outcome | all references | end-to-end |
| operational.automatic_acceptance_coverage | correctly-accepted | all references | end-to-end |
| operational.automatic_acceptance_coverage\|determined | correctly-accepted | determined references | conditional |
| operational.human_review_burden | held + rejected + missed | all references | end-to-end |
| operational.false_acceptances | incorrectly-accepted | accepted items | conditional (rate = n/accepted) |
| operational.missed_automation.evidence_correct | not accepted, determined, fully correct | all references | end-to-end |
| operational.missed_automation.evidence_incomplete | not accepted, determined, not fully correct | all references | end-to-end |

Notes on the rows marked as not measurable or not observable:
- **False detections are not measurable** because the Gold Set samples the drawing's dimensions; it is not exhaustive.
- **Unparseable or ambiguous values are not separately observable** because matching requires an equal parsed value, so a misread surfaces as `detection.missed`.

## Machine-checked accounting (`checkAccounting`)
These checks are enforced by `scripts/accuracy/mq/buildLedger.ts`, which exits non-zero on any violation, and by the unit tests.
- Every reference has exactly one row; there are no duplicate or unknown rows.
- No engine dimension is matched twice.
- Every stage has an outcome for every row.
- Each mutually exclusive group sums to its denominator, and no item is counted in two categories of one group.
- The parse categories sum to the detected count.
- Every accepted item passed every gate:
  - text detected, parsed, and unit established;
  - line found or chosen by endpoints, and a valid endpoint pair;
  - associated, with a consistent scale;
  - no cross-view conflict and no disagreeing chain total.
- Every held or rejected item carries a non-empty engine reason.
- Association is never scored correct without a correct pair.
- Every reference names a source file, its SHA-256, a page and a verification statement.
- An amended reference keeps its original value.
