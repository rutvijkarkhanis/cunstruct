# Independent review protocol

## Packages
Packages are built by `scripts/accuracy/mq/makeReviewPackages.ts` from a frozen run and its ledger, with a recorded seed.

| package | content | selection |
|---|---|---|
| A | every accepted measurement on the drawing | census |
| B | every Gold Set measurement the engine did not accept, held **and** rejected | census |
| C | held measurements outside the Gold Set | stratified sample; see below |
| D | rejected measurements outside the Gold Set | stratified sample; see below |

**Package C.**
- Primary stratum: the primary failure reason.
- Within each stratum, picks are spread across page, orientation, measured-element type and scale region.
- Allocation is proportional, with every stratum represented.

**Package D.**
- Stratified the same way over the principal rejection reasons.

No measurement appears in two packages; the generator checks this.

**Second reviewer.** A stratified subset of at least 30 items is drawn across packages A–D, using the same item IDs.

## Blinding
Reviewers receive one merged, shuffled set. They never see which package an item belongs to.

**Each item carries only:**
- a random ID (`RV-XXXXXX`);
- a uniform 600 × 600 pt crop at 200 dpi;
- a uniform 1600 × 1600 pt context view at 100 dpi;
- a neutral ring (26 pt radius, clear of the text) on the printed text;
- point rulers;
- the full page images and the original PDF.

The blind review app (`review-app.html`) reads only these items. It records clicked points in PDF points and exports complete answers only.

**Excluded from reviewer packages:**
- engine status, confidence, line, endpoints, terminators, association and explanations;
- developer verdicts and Gold Set annotations.

**Answer key.** The answer key (`SECRET-answer-key/`: mapping, engine records, developer context, sampling record) is written to a separate directory and must be stored apart from anything sent to reviewers. The evidence workbench shows engine evidence, so a reviewer must not use it before returning a blind review.

## Reviewers
- Reviewer 1 assesses every packaged item (all 116 acceptances and the rest).
- Reviewer 2 independently assesses the stratified subset.
- Neither may be the engine's developer, and neither may have seen its results.

## Scoring (`scripts/accuracy/mq/scoreReviews.ts`)
- **Ingest.** Responses are ingested from the CSV form or JSON and validated against `ReviewResponse`.
- **Verdict per item, from the reviewer's answers only:**
  - engine-confirmed: value, endpoints within 2 pt, element kind and named grid labels all match;
  - engine-disputed;
  - reviewer-ambiguous;
  - insufficient-evidence;
  - not-a-dimension.
- **Decision outcome per item:**
  - accepted-confirmed, accepted-error, accepted-unconfirmable;
  - held-unnecessarily, held-recoverable-engine-evidence-wrong, held-correctly;
  - rejected-correctly, rejected-recoverable.
- **Agreement.** Cohen's κ on the verdict. Disagreements are broken down by measurement type, view and scale region.
- **Adjudication.** Any key-field disagreement puts the item in `needs-adjudication`. Only a third person's `Adjudication` record resolves it, and that person must not be one of the item's reviewers. The engine's answer is never used.
- **Population statements for C and D** must be stratum-weighted, using the recorded inclusion probabilities. Unweighted rates describe the sample only.

## The historical 15-item developer sample
Its 13/15 "correct but held" result was hand-picked. It is shown as context only and is never used as a rate.

## Population estimates for packages C and D (`stratifiedEstimate` in reviewScoring.ts)

**Design.**
- Stratified simple random sampling, without replacement, within each stratum.
- Strata are primary failure reasons. Allocation is proportional, with every stratum represented.
- The seed and inclusion probabilities are recorded in `sampling.json`.

**Estimator.** T = Σ N_h·x_h/n_h. It is unbiased for the population count.

**Variance estimate.** Σ N_h²·(1 − n_h/N_h)·p_h(1 − p_h)/(n_h − 1). This is the unbiased design variance, with the finite-population correction.
- **One reviewed item in a stratum:** the variance is undefined.
- **All reviewed items positive, or all negative:** the variance is 0. That is a correct estimate, but it is not evidence of certainty.

**Normal-approximation interval.** Reported only when every reviewed stratum has at least 2 items and a sample share strictly between 0 and 1. Otherwise it is withheld, and the reason is stated. No pseudo-counts or epsilons are used.

**Exact interval (always reported).**
- Each reviewed stratum gets an exact hypergeometric interval at level α/H, where H is the number of reviewed strata (Bonferroni).
- Their sums form a simultaneous interval with coverage of at least 1 − α.
- It is conservative, and wide for small samples. With 1–5 reviewed items per stratum, it is the honest limit of what the sample shows.
- Example: 0 positives among 10 of 61 sampled is compatible with up to 17 of the 61 (95%).

**Strata with no resolved review.** Excluded and listed. Nothing is extrapolated to them.

**Not estimable from these samples.** Rates for sub-populations smaller than a stratum, and anything about other drawings.

**Earlier version.** It substituted (x + ½)/(n + 1) for all-or-none strata and ¼ for single-item strata. That had no design-based justification, and it was removed on 2026-10-31.
