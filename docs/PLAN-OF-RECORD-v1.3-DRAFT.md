# Cunstruct execution plan: v1.3 — limited launch (DRAFT)

> **Status: DRAFT. Not in force.** [v1.2](PLAN-OF-RECORD-v1.2.md) remains the active plan until the
> owner signs §6. Nothing here changes any v1.2 status, and nothing here is evidence that a gate
> has passed.

| | |
|---|---|
| **Version** | v1.3 draft, 22 Oct 2026 |
| **Builds on** | v1.2 and its §10 closure snapshot (merged in PR #203, `main` @ `ec41c69`) |
| **Purpose** | Let the owner launch quickly to a small, named group of users, **without** relabelling the commercial release as achieved |

## 1. Two launches — never conflate them

- **Limited launch (new, this draft).**
  - Who: named users the owner invites.
  - How: assisted use.
  - What they get: every quantity and rate is a **working draft** that a qualified person checks
    before it is used in a tender, contract or order.
  - What is not claimed: no claim of accuracy, validation, IS 1200 compliance or official rates.
- **Commercial release (unchanged from v1.2 §6).** It still requires E1/E2/E3, D2-commercial, the
  B-series acceptance criteria, a live pilot and a signed release decision. It stays
  **NOT ACHIEVED; gate CLOSED**. A limited launch does not count towards it.

## 2. Why the limited launch carries real risk (stated, not waived)

- **E1/E2 not done:** quantities are not benchmarked on independent real drawing sets. Their error
  rate is unknown.
- **Rates are provisional:**
  - DSR 2023 rates come from the corrected repository seed (E3 partial).
  - The location cost index is unverified.
  - Tender blank-versus-zero rules are unverified.
- **Production smoke tests for R7 were partial:** Apply and the DSR-decision paths have local
  coverage only (V1/V2, accepted by the owner).

## 3. Limited-launch gate (all must hold before the owner signs §6)

| ID | Requirement | Evidence required | Status (22 Oct 2026) |
|---|---|---|---|
| L1 | The current `main` is the newest Production deployment, with no newer failure (= v1.2 R2) | Owner's check of the Vercel Production list, or Vercel read access | **DONE (22 Oct 2026)**: Vercel Production list read directly. Current `main` `ed09dc25d96a904100d9d46858a430f1efa30de8` is the newest Production deployment and is `READY` (`dpl_C6L7cWwj97tNjBuNeL6kWrNrUGuN`); no newer deployment appears above it. Recheck against the release commit before launch. [Deployment](https://vercel.com/whistleblower/cunstruct/C6L7cWwj97tNjBuNeL6kWrNrUGuN) |
| L2 | Change history is live in production (= v1.2 R7) | v1.2 §8, 21 Oct 2026 | **DONE** |
| L3 | Every export and the on-screen BOQ total say that quantities and rates are unvalidated drafts for a qualified person to check, in addition to the existing pending / "To be priced" markings | Code reference plus a test per export format | **IN REVIEW — PR #206**: shared disclaimer added to single and combined-project PDF builders, BOQ CSV, work-package CSV, Ops BOQ total and app BOQ subtotal. CSV disclaimer is appended to existing metadata rows so header and Amount formula positions remain stable; tests were reconciled. Vercel Preview for the latest PR #206 head `00cf7b2` is being rebuilt. Local Vitest/typecheck/lint have not been run in this session; do not mark DONE until those checks pass. [PR #206](https://github.com/rutvijkarkhanis/cunstruct/pull/206) |
| L4 | No UI, export or marketing copy claims accuracy, validation, IS 1200 compliance or official rates | Copy audit listing every hit and its fix | **DONE (22 Oct 2026, repository scope)**: PR #205 merged as `ed09dc25d96a904100d9d46858a430f1efa30de8`; “accurate quantities” is now “estimate quantities (a draft to check before ordering)”. The prior copy audit found no other unsupported claim in the checked repository paths. Marketing copy outside this repository is not covered. [PR #205](https://github.com/rutvijkarkhanis/cunstruct/pull/205) |
| L5 | No AI quantity is auto-accepted (v1.2 standing rule 2) | Test or code reference showing every AI quantity needs a human decision | **MET by code and tests (22 Oct, LOCAL)**: AI items are always created `PENDING_REVIEW` (`reviewQueue.ts` `buildReviewItems`, also used by the `ai-analysis` function); the only other writer of `review_status` is the human review action (`reviewStore.ts`); Apply refuses anything not VERIFIED/EDITED (`applyReview.ts` `classifyReviewItem`). No bulk or auto-verify path found. Review tests 90/90 |
| L6 | Each invited user accepts terms stating the draft nature of outputs and who is responsible for checking them | Owner-approved terms text (legal adviser) plus a record of acceptance | **OPEN**: owner and legal action |
| L7 | Rollback and support: a known previous Production deployment to roll back to; the launch adds no database migration; a named contact for incidents | Short runbook naming them | **IN REVIEW — PR #206**: runbook identifies the current Ready deployment and a previous Ready Production deployment as a rollback candidate, states no launch migration may be added, and records incident response steps. It still has placeholders for the named contact/method, and the rollback candidate must be re-confirmed before launch; L7 is not DONE. [Runbook](https://github.com/rutvijkarkhanis/cunstruct/blob/fix/v13-unvalidated-draft-gate/docs/limited-launch-rollback-support-runbook.md) |
| L8 | Owner's signed limited-launch decision (§6) | Verbatim signature below | **OPEN** |

L3 and L7 are in review under PR #206; L5 is met by the previously recorded local code/tests. L1 (deployment evidence) and L4 (repository copy fix) are now recorded above. L6 (user terms and acceptance record) and L8 (signature) remain owner/legal actions. L7 also requires a named incident contact and a pre-launch rollback-candidate check.

## 4. The evidence lane continues in parallel (option A)

The E1a intake procedure already exists:
- [E1-BENCHMARK-INTAKE-KIT.md](benchmarks/E1-BENCHMARK-INTAKE-KIT.md)
- [E1-FIRST-SET-HANDOUT.md](benchmarks/E1-FIRST-SET-HANDOUT.md), whose Parts 2 and 4 need legal
  review before sending

It covers permission, the SHA-256 register, extractor output hashed before any QS file is opened,
two independent QS sheets, adjudication, and in/out-of-contract tags.

E1a starts when the owner permits an existing qualifying set or supplies one. Until then E1a, E1
and E2 stay **BLOCKED**.

## 5. Unchanged

- All v1.2 statuses and the §10 closure counts: 7 done, 3 replaced, 4 deferred/parked,
  5 blocked/incomplete, 2 dropped.
- The standing rules in v1.2 §7.
- v1.0 and v1.1 (frozen).

## 6. Owner signature

Not signed. To put v1.3 in force, the owner records, verbatim:

> "I approve plan v1.3 and authorise a limited launch to named users once L1–L7 are met. Commercial
> release remains not achieved."

with the date. A signature given before L1–L7 are met approves the plan, not the launch.
