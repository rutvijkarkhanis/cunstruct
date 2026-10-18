# E4 discovery interview guide

**Plan item:** E4 *Discovery interviews* (owner: PO), in `docs/PLAN-OF-RECORD.md` v1.0 §2.
**Done when (quoted from the plan):** 10–12 contextual interviews done: billing engineers at small, mid-size and EPC contractors; freelance BOQ preparers; 2–3 contractor-owners. The report's questions are answered (how a BOQ is checked, who signs, locked BoQ files, percentage-rate bids, WhatsApp flow, sampling certificate).
**Evidence:** an interview synthesis document (template in §6).
**Feeds:** E5 (positioning, primary user, pricing hypothesis) and D3 (prototype test).

**Why these questions.** The research report (`reports/Cunstruct redesign first principles.md`, a local working file not in Git; sections "Risks, open questions and how to find out" and "Validation plan") found no first-hand practitioner evidence. It found no data on who signs bids in private firms, on WhatsApp's role in BOQ work, or on willingness to pay. It also flags that a sampling statement could confuse estimators. Treat every answer here as new evidence, not confirmation.

Labels: **Assumption** = a working choice to confirm in the first one or two interviews.

---

## 1. Recruitment

### 1.1 Quota (target 10–12)

| Segment | Target | Notes |
|---|---|---|
| Billing / QS engineer, small contractor | 2 | The owner may also do estimates |
| Billing / QS engineer, mid-size contractor | 2 | |
| Billing / QS engineer, EPC or large contractor | 2 | Likely uses ERP / SAP |
| Freelance BOQ preparer | 2–3 | The current alternative (≈ ₹8–10k, 1–5 days per building, per vendor and listing evidence cited in the report) |
| Contractor-owner who approves bids | 2–3 | Sign-off and payment questions |

Spread across government (e-tender) and private work. Include at least two people who have bid a percentage-rate tender in the last 12 months.

**Firm size: Assumption.** No size bands are given in the research. Suggested bands: small = under 25 staff, mid = 25–250, EPC/large = over 250 or a listed company. Record the actual headcount and annual turnover band as reported.

### 1.2 Screener (5 minutes, by phone or form)

| # | Question | Qualify if |
|---|---|---|
| S1 | What is your current role? | Billing engineer, QS, estimator, freelance BOQ preparer, or owner/director of a contracting firm |
| S2 | In the last 3 months, did you prepare, check or approve a BOQ or a bid for a building? | Yes |
| S3 | Roughly how many people work in your firm? | Fills a quota cell |
| S4 | Government tenders, private clients, or both? | Record; balance the mix |
| S5 | Have you quoted a percentage-rate tender in the last 12 months? | Record; at least 2 overall |
| S6 | Could we look together at a recent or current bid (screen share or in person), with anything confidential hidden? | Yes, or a partial yes (e.g. measurement sheet only) |
| S7 | Do you work for, or have you used, any construction estimating software company? Which? | Record. Exclude Cunstruct staff and contractors. |
| S8 | Preferred language for the conversation: English, Hindi, or a mix? | Record; match the interviewer |

### 1.3 Consent and recording

- Send a one-paragraph information note before the session. It says who is running the study, its purpose ("to understand how BOQs and bids are prepared and checked"), the length, the incentive, that taking part is voluntary, and how notes are stored.
- Read the consent at the start of the recording, and get a yes for each item separately:
  1. taking part;
  2. audio recording (the session goes ahead without it if declined);
  3. screen or photo capture of documents (default **no**; take notes instead);
  4. anonymised quotes in internal documents.
- Do not record client names, project names, rates or drawings unless the participant explicitly allows it. Blur or crop any captured image before storing it.
- Store recordings and notes outside Git, under `research-inputs/E4/` (ignored by `.gitignore`; checked by `scripts/benchmark/input-ignores.test.ts`), or off the repository machine entirely. Use participant codes (P01…), with the code-to-name key kept separately. Only the anonymised synthesis (§6) is committed, as `docs/research/E4-SYNTHESIS.md`. Delete recordings after synthesis (**Assumption:** within 90 days), unless the participant agreed otherwise.
- Have the PO's legal adviser review the information note and consent wording against India's Digital Personal Data Protection Act, 2023.

### 1.4 Incentive (Assumption)

No research source gives an interview honorarium for this audience. Suggestion: **₹1,000–2,000** (UPI or gift voucher) for 60 minutes, for engineers and freelancers. This is a judgement about respecting a working hour; it is not taken from the freelance BOQ price.

For contractor-owners, offer a summary of the findings instead of, or as well as, payment. Do not promise free use of any product, because that would bias the pricing answers. Record what each participant received.

---

## 2. Interviewer rules (neutral, non-leading)

- **Their bid, not our idea.** Do not describe Cunstruct, AI or the redesign before §4 block G. If asked, say: "I'll tell you everything at the end; first I want to learn how you do it."
- Ask about **the last time** something happened, not what usually happens ("Last time you checked a BOQ, what did you look at first?").
- Do not suggest answers or name problems ("Is checking slow?"). Ask "Tell me about…", "Walk me through…", "What happened next?".
- When they name a pain, ask for the cost: time lost, money lost, or who noticed.
- Silence is fine. Count to five before the next question.
- Write down exact words for key quotes. Mark your own interpretations as `[I]`.
- Watch what they do in their files as much as what they say.

### Hindi-friendly phrasing notes

**Assumption:** most participants will mix English trade terms into Hindi. Confirm this in the first interviews and adjust.

- Keep trade terms in English: *BOQ, measurement sheet, abstract, rate analysis, DSR, cost index, RA bill, tender, percentage, GST, sign*.
- Use plain, spoken Hindi, not formal (*shuddh*) Hindi. Examples:
  - "Pichhli baar BOQ check kaise kiya tha? Shuru se dikhaiye." (Last time, how did you check the BOQ? Show me from the start.)
  - "Isko final kaun karta hai? Sign kaun karta hai?" (Who finalises this? Who signs?)
  - "Usme kitna time laga?" (How long did that take?)
  - "Koi galti pakdi gayi thi kabhi? Kya hua tha?" (Was a mistake ever caught? What happened?)
  - "Drawing aapke paas kaise aati hai? WhatsApp pe, email pe?" (How do drawings reach you? On WhatsApp, on email?)
- Avoid *sahi/galat* framings that sound like a test of their competence ("Aapka BOQ galat tha?"). Ask about the work, not the person: "BOQ mein baad mein kya badla?" (What changed in the BOQ later?)
- Do not translate the sampling card (block G) on the spot. Use a pre-agreed Hindi version and read both.

---

## 3. Materials checklist

- [ ] Consent script (§1.3)
- [ ] This guide, printed, with the note template (§5)
- [ ] Sampling card (block G), printed in English and Hindi
- [ ] Pricing card (block H), with the three options in a fixed random order per participant
- [ ] Incentive details

---

## 4. Script: 60-minute contextual inquiry on a live or recent bid

Timings are guides. If time runs short, keep blocks B, C, F and G.

**A. Open (0–5 min)**
- Introductions; consent (§1.3); start the recording if allowed.
- "There are no right answers. I'm here to learn how you work, using a real bid you've done."

**B. Context and the bid (5–12 min)**
- "Tell me about your role, and what a normal week looks like."
- "Which bid or BOQ can we look at today? What was the job, who was the client, and when was it due?"
- "Where did the drawings come from, and in what form: PDF, DWG, paper, scans?"

**C. Making and checking the BOQ (12–25 min): time, tools, errors**
- "Walk me through what you did, from receiving the drawings to sending the BOQ. Open the files you used."
- "Which tools did you use at each step?" (Watch for Excel, AutoCAD, other software, a calculator, paper.)
- "How long did each part take, roughly?"
- **How a BOQ is checked:** "Once it was done, how was it checked? By you, or someone else? What did they look at first? What did they not look at?"
- "Tell me about the last mistake that was found in a BOQ: who found it, when, and what did it cost?"
- "Has an item ever been missed altogether? How was that found?"
- **Rates:** "How did you put rates on it? Which schedule or edition? How did you apply the cost index? How did you treat GST? Where did rates for items not in the schedule come from?"

**D. Sign-off (25–33 min)**
- **Who signs:** "Who approved this bid or BOQ before it went out? What did they look at? How long did they spend?"
- "What do they need to see before they will sign?"
- **What would make them sign:** "Has anyone ever refused to sign, or sent it back? Why?"
- "If someone else had prepared the quantities, what would you need before you put your name on them?"

**E. E-tender files and percentage-rate bids (33–41 min)**
- **Locked BoQ files:** "Show me, or describe, the last department BoQ file you filled. How did you move your rates into it? What went wrong, or nearly went wrong?"
- "Blank or zero for items you don't quote: how do you decide?"
- **Percentage-rate:** "In the last percentage-rate tender, how did you decide the percentage? Did you check the department's quantities against the drawings? If yes, how; if no, why not?"
- "Has a department quantity ever turned out very different on site? What happened?"

**F. WhatsApp: drawings and orders (41–48 min)**
- "On this job, how did drawings and revisions reach you? Show me the chat if you can."
- "How do you know which drawing is the latest?"
- "After award, how do material orders go out, and to whom? What is in the message: a BOQ extract, a photo, a voice note?"
- "Who on the team does not use a computer at all for this?"

**G. Sampling certificate (48–54 min)**
- Show the card without explanation:

  > **BOQ check summary.** All items above ₹50,000 checked one by one (42 items). Of the remaining 310 items, 30 were picked at random and checked against the drawings. Estimated remaining error in the total: **± ₹1.2 lakh** (95 % confidence).

  (The figures are illustrative only; they are not from any real project.)
- "In your own words, what does this tell you?" Record exactly. Do not correct them.
- "Would this be useful to you? To your boss? To a client or department? Why or why not?"
- "What would you want to see on it, or remove from it?"
- "How do you show a client today that a BOQ is reliable?"

**H. Willingness to pay (54–58 min)**
- "What did you, or your firm, spend on the last BOQ you outsourced, or on estimating software? Who decided?"
- Show the pricing card (three options, in this participant's random order): **per BOQ prepared**; **per bid check** (checking a tender's quantities against its drawings); **a margin on materials ordered through the service**.
- "Which of these would your firm be most likely to agree to? Which never? Why?"
- "For the bid we looked at today, what amount would have felt reasonable for each?" Record the figure they say. Do not suggest one.

**I. Close (58–60 min)**
- "Is there anything I should have asked?" "Who else should I talk to?"
- Now explain Cunstruct briefly, if asked. Confirm the incentive. Stop the recording.

---

## 5. Note-taking template (one per interview; fill within 24 hours)

```
Participant: P__   Date: ______   Interviewer: ______   Note-taker: ______
Segment: [small | mid | EPC | freelance | owner]   Gov / private / both: ____
Language: ____   Recording: Y / N   Screen or photo capture allowed: Y / N
Bid discussed: type ______  value band ______  due ______  (no client name)

| Time | Block | Observation / exact quote ("…") | [I] interpretation | Artefact seen |
|------|-------|----------------------------------|--------------------|---------------|
|      |       |                                  |                    |               |

Tools seen:                     Time per step (as stated):
Last error caught (what / who / cost):
Rate basis (DSR edition, cost index, GST handling, market rates):
Signer(s) and what they need:
Locked BoQ / percentage-rate practice:
WhatsApp use (drawings, revisions, orders):
Sampling card, their own words:
Pricing: spend today ____; most likely ____; never ____; amounts said ____
Top 3 surprises:
Follow-ups / referrals:
```

---

## 6. Synthesis template (the E4 evidence document)

Write counts as "n of N" (never percentages at this sample size). Quote exact words. Keep "no evidence" visible; do not fill gaps with assumptions.

### 6.1 Participants

| P | Segment | Firm size (as stated) | Gov / private | Language | Bid type discussed |
|---|---|---|---|---|---|

### 6.2 Answers to the plan's questions

| Question | What we saw (n of N) | Key quotes (P#) | Variation by segment | Confidence (high / medium / low) |
|---|---|---|---|---|
| How a BOQ is checked today | | | | |
| Who signs, and what would make them sign | | | | |
| Locked e-tender BoQ files | | | | |
| Percentage-rate bids | | | | |
| How drawings and orders move on WhatsApp | | | | |
| Would a sampling certificate mean anything (to them; to clients) | | | | |
| Time, tools and errors | | | | |
| Rates: DSR edition, cost index, GST | | | | |
| Willingness to pay | | | | |

### 6.3 Inputs to E5 (positioning decision)

| E5 decision | Options (from the plan) | Evidence for each (P#) | Evidence against (P#) | E4 leaning, or "no evidence" |
|---|---|---|---|---|
| Positioning | "AI take-off" vs "assisted measurement sheet" | | | |
| Primary user | billing engineer / freelance preparer / contractor-owner / other | | | |
| Pricing hypothesis | per BOQ / per bid check / material margin | | | |

E5 also needs E2's benchmark results. This table does not decide E5 on its own.

### 6.4 Design hypotheses for D3

Mark each **supported**, **contradicted** or **no evidence**, with participant codes. Add any new hypotheses at the end.

| # | Hypothesis (from the redesign research) | Status | Evidence (P#, quote) | Implication for the D3 set-up |
|---|---|---|---|---|
| H1 | Checkers already prioritise by money, so a money-at-risk queue matches how they check | | | Task framing for condition (b) |
| H2 | Seeing the drawing region next to a quantity is how they would verify it | | | Evidence-first display |
| H3 | Correcting a figure by typing over it is natural | | | Correction interaction |
| H4 | The sampling statement is understood and is seen as useful by the signer or the client | | | Whether condition (c)'s sign-off sheet needs rewording |
| H5 | Missed items (omissions) are a real, costly failure they look for | | | Weight of seeded omissions |
| H6 | The person who signs is not the person who measures | | | Who participates in D3; phone sign-off (B10) |
| H7 | Filling locked department BoQ files is a real pain point | | | Priority of B8 |
| H8 | Checking department quantities in percentage-rate tenders is valued | | | "Bid check" mode and pricing |
| H9 | Drawings, revisions and orders move mainly on WhatsApp | | | B10, B11 |

### 6.5 Recruiting notes for D3

The plan says 6–8 billing engineers per condition. List the participants willing to join D3, and anything learned about realistic tasks and realistic seeded errors (for example the kinds of mistakes they reported in block C).

### 6.6 Limitations

The sample size and its skew (segments, regions, languages), interviewer effects, and which answers are self-reported versus observed in their files.
