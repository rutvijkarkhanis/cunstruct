# Measurement engine: release levels and scorecard

This document defines the release levels. Every numerical target below is a **proposal requiring owner approval**. None is an industry standard. They are chosen so that each gate can be checked from the tooling that exists: the ledger and metrics, the dataset manifests, the review scorer, and the evidence contract.

A level is reached only when every criterion is met, and each criterion is shown by a named artefact.

## Level 1: Experimental
| criterion | evidence |
|---|---|
| Engine runs reproducibly on development drawings | freeze manifest; identical output hashes on repeated runs |
| Every measurement records its evidence and stage decisions | measurement-evidence v1 export, 0 contract failures |
| No production quantities are created | contract test: no product import; the production bundle contains no engine code |

**Status (2026-10-31): MET, on W976646 only.**

## Level 2: Internal reviewer-assisted
| criterion | evidence |
|---|---|
| Measurements can be inspected stage by stage | evidence workbench, functional check passed |
| Reviewer decisions are recorded, attributed and exported separately from engine output | workbench annotations; blind review responses; submission register |
| Unverified results are excluded from BOQ generation | `downstreamEligibility` and adapter tests: unverified means not eligible; adapter output has quantity null and no pricing fields |
| The review process runs as documented | at least one completed review cycle (locked submissions and a scorer report) |

**Status: infrastructure READY. Operation NOT YET demonstrated:** no real review cycle has been completed.

## Level 3: Limited production pilot
| criterion | proposed target (owner approval needed) | evidence |
|---|---|---|
| Independent precision demonstrated | Zero accepted-measurement errors among at least 150 independently reviewed acceptances per vector validation dataset. With 0 of 150 errors, the 95% Wilson upper bound on the error share is about 2.5% (3.84 / (150 + 3.84)). Any confirmed error triggers a root-cause review before the gate can pass. | scorer report, package A census |
| Cross-project validation completed | At least 2 native-vector datasets besides the development set, from at least 2 different exporters or drafting conventions. Each runs once with the frozen engine, and its result is recorded before any change of role. | validation run records; dataset manifests with role history |
| Reviewer agreement adequate | Raw agreement and Cohen's κ are reported on at least 30 doubly reviewed items. κ ≥ 0.6 is proposed. That is "substantial" in the Landis & Koch convention, a widely quoted convention and not a standard. Every disagreement is adjudicated. | scorer report |
| Coverage useful | Proposed: at least 30% of reference dimensions correctly accepted in each validation dataset, reported with its denominator. W976646 today: 38/73, development data only. | ledger metrics |
| Human review remains mandatory | Every engine result enters the Review Workstation as PENDING_REVIEW. None is applied without a person. | adapter contract tests |
| Traceable evidence for every accepted measurement | 100%: source hash, page, coordinates, stage decisions and engine fingerprint | evidence v1 export |
| No ambiguous measurement becomes a BOQ item automatically | Enforced by test. Ambiguous associations need the reviewer to name the element. | `evidenceContract.test.ts` |
| Known conflicts held | 100% of reference conflicts and inconsistencies held | ledger `final.correctly-held` versus reference statuses |

**Status: NOT MET.** The blockers:
- no independent review has been done;
- no second vector dataset is available (C-01/C-02 missing);
- the only scored data is development data.

## Level 4: Broad production
| criterion | proposed target (owner approval needed) |
|---|---|
| Multiple independent datasets | At least 5 native-vector validation datasets with independent reference annotations. At least one is a frozen holdout evaluated once at release. |
| Different exporters and conventions | At least 3 CAD sources (for example AutoCAD, Revit, ArchiCAD). Ticks, arrowheads and dots all represented. Mixed-scale sheets included. |
| Sufficient independent references | At least 500 independently reviewed acceptances pooled. With 0 errors, the 95% Wilson upper bound is about 0.8%. Any error is reported with its root cause. |
| Precision and coverage | The upper bound on accepted-error share is at most 1% pooled, and no single dataset's bound exceeds the Level 3 target. Coverage is reported per dataset, and none is below the approved floor. |
| Conflict handling proven | Cross-view and chain conflicts are held 100% on every dataset that contains them. A raster dataset never enters the vector path. |
| Review and audit trail | Append-only review events. Reviewer identity on every decision. Adjudication records. Exportable audit log (see PRODUCTION-REVIEW-UI-SPEC.md). |
| Safe downstream integration | Only independently verified evidence reaches the existing review workflow. Pricing and BOQ creation stay human-initiated, and their contract tests pass unchanged. |

**Status: NOT MET.**

## How a level is claimed
1. Run the validation runner on each dataset with the frozen engine. Lock the reviewer submissions and run the scorer.
2. Write a release record listing each criterion, its value with denominator, and the artefact hash.
3. The owner signs off. Developer review is never presented as independent verification, and one dataset never establishes generalization.
