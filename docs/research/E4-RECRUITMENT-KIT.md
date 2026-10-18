# E4 recruitment kit: messages, consent draft and tracker

> **Status: ready for PO review. Nobody has been contacted and no interview has taken place.**
> - The information note and consent wording (§3) are a **draft for the PO's legal adviser**. They are not legally approved, and must not be used until they are.
> - Sending messages does **not** move plan item E4 forward. E4 is DONE only when 10–12 interviews are complete **and** the synthesis document exists (plan of record v1.0, E4).

This kit adds only what [E4-INTERVIEW-GUIDE.md](E4-INTERVIEW-GUIDE.md) lacks for recruiting. The guide stays the source of truth for the quota (§1.1), screener (§1.2), consent items (§1.3), incentive (§1.4), the interview script (§4), the note template (§5) and the synthesis (§6).

## 1. Four stages, never mixed

| Stage | Counts when | Evidence (kept where) |
|---|---|---|
| **Recruited** | The person passed the screener (guide §1.2) and agreed to an interview | Tracker row (`research-inputs/E4/tracker.csv`) |
| **Scheduled** | A date and time are agreed, and the information note (§3.1) was sent | Tracker row |
| **Interviewed** | The session took place **and** consent item 1 was given on the record **and** the notes (guide §5) were written within 24 hours | Notes file in `research-inputs/E4/P__/` |
| **Synthesised** | The interview is included in `docs/research/E4-SYNTHESIS.md` (guide §6), the only E4 file committed to Git | The synthesis document |

A recruited or scheduled person is **not** an interview. A drafted message is **not** recruitment. Only "interviewed" counts towards the plan's 10–12, and only "synthesised" completes E4.

## 2. Recruitment messages

Send to one person at a time, by email, WhatsApp or LinkedIn, through people you or the team know first. Never post a participant's details in a group. Fill the `[brackets]`; the incentive follows guide §1.4 (PO to confirm the amount).

### 2.1 Billing engineer / QS / estimator (small, mid-size or EPC contractor)

> Hello [name], I'm [your name] from [Cunstruct legal entity]. We're researching how BOQs and bids are prepared and checked in Indian construction firms, so that the tools we build fit how billing engineers actually work.
>
> Would you have **60 minutes** for a conversation, in English, Hindi or a mix, about a recent or current bid you worked on? We'd ask how you prepare and check it. You can hide anything confidential: no client names, rates or drawings are needed. As a thank-you we offer **₹[amount]** by UPI or gift voucher.
>
> Taking part is voluntary, and you can stop at any time. If you're interested, I'll ask 6–8 short questions (5 minutes) to check the fit and then send a short information note. Thank you!

### 2.2 Freelance BOQ preparer

> Hello [name], I'm [your name] from [Cunstruct legal entity]. We're researching how independent BOQ preparers work: how you take off quantities, check them and deliver them to clients.
>
> Would you have **60 minutes** to walk us through a recent job, hiding anything confidential? As a thank-you we offer **₹[amount]** by UPI or gift voucher. Taking part is voluntary. If you're interested, I'll ask a few short questions to check the fit and then send a short information note.

### 2.3 Contractor-owner or director who approves bids

> Hello [name], I'm [your name] from [Cunstruct legal entity]. We're researching how contracting firms check and approve bids and BOQs before they go out: who signs, what they look at, and what gives them confidence in the numbers.
>
> Could you spare **45–60 minutes** for a conversation? We won't ask for client names, rates or drawings. As a thank-you we'll share a summary of what we learn across firms [and/or **₹[amount]**]. Taking part is voluntary, and you can stop at any time.

### 2.4 Follow-up after a yes

> Thank you, [name]. A few quick questions to make sure the conversation is useful (about 5 minutes): [guide §1.2, S1–S8]. If it fits, I'll send a short note explaining how the conversation works and how notes are kept, and we can pick a time.

Do not promise free use of any product (guide §1.4: it biases the pricing answers). Do not mention Cunstruct's pricing ideas.

## 3. Information note and consent: DRAFT FOR LEGAL REVIEW

> These texts restate guide §1.3. **The PO's legal adviser must review them against the Digital Personal Data Protection Act, 2023 before use**, including: the legal entity named as data fiduciary; the purpose; the retention period; how a participant withdraws consent and asks for deletion; the grievance contact; and whether the incentive affects anything. Until then they are not approved.

### 3.1 Information note (send before the session)

> **Research conversation: how BOQs and bids are prepared and checked**
>
> **Who:** [Cunstruct legal entity], [address]. Contact: [name, email, phone].
> **Why:** to understand how BOQs and bids are prepared, checked and approved, so that we design tools that fit real work. This is research, not a sales call.
> **What happens:** a 60-minute conversation, in person or by video, in English, Hindi or a mix. We may ask you to show a recent bid or measurement sheet, with anything confidential hidden.
> **Thank-you:** [₹ amount by UPI / gift voucher / a summary of findings].
> **Voluntary:** you can decline any question, stop at any time, and withdraw afterwards by writing to [contact]. Withdrawing has no consequence for you.
> **Your data:**
> - We ask for your consent separately for: taking part; an audio recording; any screen or photo capture of documents (off unless you agree); and using anonymised quotes in internal documents.
> - Notes and any recording are stored privately, never in a shared code repository, under a participant code (P01, P02 …). Your name and contact are kept separately from the notes.
> - Recordings are deleted within **[90]** days of our analysis, unless you agree otherwise. Notes are kept for **[period]**.
> - We will not record client names, project names, rates or drawings unless you explicitly allow it.
> - Anything we share outside the team is aggregated and does not identify you or your firm.
> **Questions or complaints:** [grievance contact].

### 3.2 Consent script (read at the start; one answer per item)

> Before we start, I'll ask four separate questions. You can say no to any of them except the first, and we'll still go ahead.
> 1. Do you agree to take part in this conversation? (Required.)
> 2. May we make an audio recording? If not, we'll take notes only.
> 3. May we take a screenshot or photo of any document you show us? (The default is no; we'll take notes instead.)
> 4. May we use quotes from this conversation, without your name or your firm's, in internal documents?

Record each answer in the tracker (§4) and at the top of the notes. If item 1 is no, do not hold the interview.

## 4. Tracker template

Copy this header into `research-inputs/E4/tracker.csv`. That folder is ignored by Git (checked by `scripts/benchmark/input-ignores.test.ts`). **Never put this file, or any copy with real rows, in the repository.** Keep the code-to-name key in a separate file, `research-inputs/E4/participant-key.csv` (`code,name,contact`), so the tracker itself holds no names.

```csv
code,segment,firm_size_band,gov_private,pct_rate_bid_12m,language,source,stage,recruited_on,scheduled_for,interviewed_on,consent_participate,consent_audio,consent_capture,consent_quotes,notes_written_on,synthesised,incentive_given,referral_from,remarks
```

- `segment`: `small` | `mid` | `epc` | `freelance` | `owner` (guide §1.1)
- `firm_size_band`: as stated by the participant; the suggested bands are under 25 / 25–250 / over 250 or listed (guide §1.1, an assumption)
- `stage`: `recruited` | `scheduled` | `interviewed` | `synthesised` | `declined` | `dropped`
- `consent_*`: `yes` | `no` | blank until asked
- `pct_rate_bid_12m`: `yes` | `no` (screener S5; at least 2 overall)

**Quota to fill (plan of record v1.0, E4; guide §1.1):**

| Segment | Target interviews |
|---|---|
| Billing / QS engineer, small contractor | 2 |
| Billing / QS engineer, mid-size contractor | 2 |
| Billing / QS engineer, EPC or large contractor | 2 |
| Freelance BOQ preparer | 2–3 |
| Contractor-owner who approves bids | 2–3 |
| **Total** | **10–12** |

Also: a spread of government and private work, and at least two people who bid a percentage-rate tender in the last 12 months.

## 5. After each interview

1. Write the notes (guide §5) within 24 hours, in `research-inputs/E4/P__/notes.md`. Mark interpretations `[I]`, separate from observations and exact quotes.
2. Set the tracker stage to `interviewed`, and record the date and the four consent answers.
3. Delete the recording within the agreed period after synthesis, and note the deletion in `remarks`.
4. Update the counts (never names) in [docs/EVIDENCE-STATUS.md](../EVIDENCE-STATUS.md).
