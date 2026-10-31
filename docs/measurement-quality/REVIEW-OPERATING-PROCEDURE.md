# Independent review: operating procedure

Roles: **coordinator** (prepares and distributes packages, locks submissions, runs the scorer), **Reviewer 1**, **Reviewer 2** and **Adjudicator**.

- The engine developer may act as coordinator only for mechanical steps: copying files, recording hashes, running scripts.
- The engine developer may not review, may not adjudicate, and may not change any reviewer result.
- **No developer may silently override a reviewer result.**

## 0. Coordinator: before distribution
1. Choose the three people. None of them may have developed or tuned the engine, or seen its output for this drawing.
2. Record their codes in `COORDINATOR/roster.json`. The default codes are R1, R2 and ADJ, and they are already written into the packages.
   - The names-to-codes mapping is kept by the coordinator only.
   - To use other codes, regenerate the packages with `--r1-id/--r2-id/--adj-id`.
3. Run the package audit:
   ```bash
   python3 -I scripts/accuracy/mq/audit_review_packages.py <review dir> <drawing.pdf>
   ```
   Every check must pass.
4. Send each reviewer **only** their own folder: `reviewer-1/` or `reviewer-2/`.
   - Never send `SECRET-answer-key/`, `COORDINATOR/`, the evidence workbench or any engine output.
   - Send Reviewer 2's folder separately. It contains no Reviewer 1 material.

## 1. Reviewer 1
- Complete all assigned cases: 196 in the current package.
- Work independently. Do not discuss answers with Reviewer 2 before both have submitted.
- Record ambiguity rather than guessing. Record insufficient evidence separately from a measurement you think is wrong.
- Submit the app's exported JSON, or the completed CSV.

## 2. Reviewer 2
- Complete the assigned 36 cases independently, to the same instructions and standards.
- Reviewer 2 never sees Reviewer 1's answers. The package was built before any answer existed, and it contains none.

## 3. Coordinator: locking submissions
When a reviewer submits:
1. Record the file in `COORDINATOR/submissions.json`: `reviewer_id`, `file` name, `sha256` (`sha256sum <file>`) and `locked_at`.
2. Store the file read-only: `chmod a-w`.
3. Never edit a submitted file. A correction is a new file with its own entry. The scorer refuses a file whose hash differs from its register entry.
4. Ingest:
   ```bash
   npx vite-node --root . scripts/accuracy/mq/scoreReviews.ts --key SECRET-answer-key/answer-key.json --sampling SECRET-answer-key/sampling.json \
     --roster COORDINATOR/roster.json --responses <r1 file>,<r2 file> --register COORDINATOR/submissions.json --out <private dir>
   ```
   The scorer rejects:
   - unknown reviewer codes;
   - items not assigned to that reviewer;
   - duplicate answers.

   It lists unanswered assigned items as missing; it never fills them. Return missing items to the reviewer.

## 4. Adjudicator
- Starts only after **both** submissions are locked. The scorer refuses adjudication input otherwise, and writes `adjudication-packet.csv` only then.
- Sees both reviewers' answers for the disagreeing items only. Sees no engine output, no answer key and no developer opinion.
- For each item, records a final decision in the same response format. The record also carries `adjudicates` (the two reviewer codes) and a **note** with the reasoning.
- The adjudicator must not be one of the item's reviewers.
- The original reviewer answers are preserved unchanged. The adjudication is a separate record.

## 5. Results
- Reported results come only from the scorer's `INDEPENDENT-EVALUATION-REPORT.md` over locked submissions.
- Items still awaiting adjudication are excluded and counted as such.
- **Packages C and D are samples.** Population statements must use the scorer's stratum-weighted estimates and intervals.
- **One drawing set.** Report "independently reviewed on W976646", never "generalizes".
- Pipeline tests with synthetic responses are always labelled SYNTHETIC. They must never be quoted as results.
