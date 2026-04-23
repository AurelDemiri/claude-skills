# Interpretation Guide

This file is about *not* making mistakes when writing up what the tests found. The machinery in `fake-data.md` and `caps.md` will happily flag patterns. Turning a flag into a finding — or knowing when not to — is the hard part.

## The core principle

Every test in this skill produces a *statistic*. A statistic is not a conclusion. Turning a statistic into a conclusion requires three additional things:

1. **A plausible mechanism** — a story about *how* the data got this way.
2. **Ruling out innocent explanations** — why couldn't the pattern be an innocent property of this column?
3. **Enough data** that the test itself is reliable.

A finding that has all three is a HIGH-confidence report. A finding with only the statistic is LOW or not worth reporting.

## Common false-positive modes

### False positives for *capping*

- **A column that is naturally bounded.** A "star rating 1-5" column has a max of 5 and a big spike at 5 — that's not capping. Before flagging a spike at a ceiling, verify the ceiling matches a *storage* type, not a *semantic* one.
- **A column that is legitimately full of zeros.** Counts of rare events are usually zero. A column that is mostly zero is not automatically a null-sentinel issue.
- **A column that is legitimately full of `-1`.** Some conventions deliberately use `-1` as a valid value (e.g. "number of retries" where -1 means "infinite"). Ask before flagging.
- **A VARCHAR cap that isn't really a cap.** Country names in a `VARCHAR(255)` column will all be shorter than 255; an `md5` column will all be exactly 32 chars; a `uuid` column will all be 36 chars. Clustering at one length is not truncation unless the length *matches a known type cap* AND the contents look truncated (mid-word, mid-sentence).
- **Legacy data that's been migrated.** A column of 2-million-value INT32 IDs is not saturating; it's just a naturally-big ID space. Saturation requires a pileup *at* the cap value, not merely large values.

### False positives for *Benford*

- **Running Benford on the wrong column.** The single biggest source of bad Benford reports is someone running it on ages, ZIPs, or ratings. Always verify the column's semantic meaning before reporting a Benford finding.
- **Small samples.** With 100 values, even perfectly Benford data will show MAD values well above the "acceptable" cutoff roughly half the time by pure variance.
- **Bounded-domain data.** If all values are between 1 and 10, every value starts with 1 or 2-9 depending on the leading digit; the observed distribution can't be Benford by construction.
- **Well-behaved but non-Benford distributions.** A column of heights (natural Gaussian centred at 170 cm) will have ~100% of values starting with 1 or 2. That's not fraud.
- **Mixed-origin datasets.** A column that combines dollars and euros, or prices across years with different inflation, can produce complex first-digit patterns that look non-Benford but aren't fabrication.
- **Rounded data.** If all the values in a column are rounded to multiples of 100, the first-digit distribution is the first digit of the "hundreds" place, not the first digit of the whole number, and it won't match Benford.

### False positives for *fabrication*

- **Too few duplicates is not always fabrication.** A column of UUIDs is *supposed* to have zero duplicates. A column of primary keys is supposed to have zero duplicates. Before flagging under-duplication, check whether duplicates would be expected.
- **Too many duplicates is not always fabrication.** High-volume retailers have many customers buying the same item at the same price. Repeat transactions are normal.
- **Placeholder values from legitimate test data.** Development and staging environments are *full* of `example.com` and `John Doe`. Finding these in a data export is not evidence of fraud — it's evidence the export came from a dev environment, which is an entirely different problem.
- **Synthetic data presented as synthetic.** Faker fingerprints in a dataset explicitly labelled as synthetic are not a finding.

## Severity calibration

Use these rubrics. Err toward the lower severity when in doubt.

### HIGH

Report HIGH only when:
- The mechanism is clear (you can name the specific cap, or the specific fabrication pattern).
- The evidence is robust (many rows show the pattern, not a few).
- Innocent explanations have been actively considered and ruled out.

Example HIGH finding:
> The `transaction_amount` column contains 2,147 rows (3.1% of non-null values) with the value exactly 2,147,483,647. This matches the INT32 signed ceiling and is consistent with silent saturation at the database layer. Given that the column is labelled as a currency amount (nominal cap should be float or DECIMAL), the column type is incorrect and the true values at these rows are unrecoverable from this export. Recommended action: re-export with the source column widened to BIGINT or DECIMAL.

### MEDIUM

A MEDIUM finding has a suggestive pattern with a plausible benign explanation that needs external verification. The report should state what *would* turn it into HIGH.

Example MEDIUM finding:
> The `invoice_amount` first-digit distribution has a MAD of 0.027 against Benford's Law (nonconforming per Nigrini). This is *consistent* with fabrication, but could also arise from: (a) the dataset being filtered to a narrow range, (b) the amounts being quotas or budgets rather than organic transactions, or (c) mixed currencies without normalisation. To move this to a HIGH confidence finding, verify (1) the column covers at least two orders of magnitude, (2) the amounts are genuine transactions not approvals, and (3) currencies are uniform.

### LOW

A LOW finding is a pattern worth documenting but not worth acting on without more evidence.

Example LOW finding:
> The `created_at` column shows 2.1% of timestamps ending exactly at `:00:00` (expected under minute-precision source systems: 1.7%). The excess is marginal and could be explained by scheduled system events.

## Phrasing templates

Prefer these patterns when writing findings:

- **For capping**: "Column `X` shows [N rows / Y%] at value `V`. This matches [known cap name]. Consistent with [mechanism]. Recommended action: [fix]."
- **For fabrication**: "Column `X` [test result]. This is consistent with [hypothesis] but requires verifying [context] before concluding fabrication. Innocent explanations include: [list]."
- **For when you can't test**: "Column `X` is a candidate for [test] but has only [N] rows. At this sample size, [test] is not reliable (minimum ~[M] for meaningful results). Reserving judgement."
- **For clean columns**: "Column `X` was tested for [list] and shows no anomalies."

## Words to avoid

- "Fraud" — this is a legal conclusion, not a statistical one.
- "Proves" / "Proof" — statistical tests don't prove, they support.
- "Fake" without qualification — say "consistent with fabrication" or "shows synthetic markers".
- "Definitely" / "Certainly" — reserve for cap findings where the cap is literally at a storage ceiling and many rows are there.

## Words to use

- "Consistent with" / "Inconsistent with"
- "Suggestive of" / "Indicative of"
- "Deviates from expected distribution"
- "Shows markers of" / "Shows fingerprints of"
- "Would be explained by"
- "Could arise from" / "Is unlikely to arise from"

## The audience question

Before writing the final report, ask: who reads this?

- **An engineer** who needs to fix a pipeline wants the mechanism (the specific type cap, the specific truncation point) and the fix.
- **An auditor or compliance person** wants the statistical test, its strength, and its limits. They will escalate HIGH findings.
- **A non-technical stakeholder** wants plain-English conclusions and a concrete next step. They will act on HIGH findings and usually ignore LOW ones, which is the right behaviour.

Match the writeup to the reader. If unclear, default to the auditor style: evidence-forward, honest about limits, explicit about next steps.

## A worked example

Suppose the tests produce:

- `transaction_amount`: first-digit MAD = 0.034 (nonconforming), second-digit MAD = 0.021, 87% of values round to multiples of 10.
- `user_email`: 4.2% of addresses end in `@example.com`.
- `created_at`: 94 rows pinned at `1970-01-01 00:00:00`, remainder distributed over the last year.

A bad writeup:

> The data is fraudulent. Benford's Law is violated, the emails are fake, and the timestamps don't make sense.

A good writeup:

> **HIGH — `user_email` contains synthetic markers.** 4.2% of rows have addresses ending in `@example.com`, which is an RFC 2606 reserved domain and cannot belong to a real user. These rows are either test data mixed into production export, or deliberately synthetic. Recommendation: filter these rows before analysis, then investigate why they were included.
>
> **HIGH — `created_at` contains null-as-epoch placeholders.** 94 rows have the value `1970-01-01 00:00:00` (Unix zero). In context, these are almost certainly NULL values that were stored as 0 during a database migration or export. Recommendation: treat these as missing data, not as genuine creation times; this affects any analysis of "oldest customers" or "signup timing".
>
> **MEDIUM — `transaction_amount` shows non-Benford first-digit distribution combined with heavy rounding.** MAD against Benford first-digit is 0.034 (Nigrini: nonconforming). Additionally 87% of values are multiples of 10. Taken together, this is consistent with amounts being budgeted/estimated rather than measured, or with human data entry that rounded. It is *not* sufficient evidence of fabrication on its own. To strengthen or weaken this finding: (1) confirm whether these are booked transactions or estimates, (2) check whether rounding to $10 reflects a genuine business rule (e.g. gift-card denominations) or is anomalous.
>
> **No issues found** in columns: `user_id`, `country_code`, `last_login_ip` (all passed the relevant tests; note that Benford was not applied to `user_id` as ID columns are not Benford-appropriate).

This writeup gives the reader the information to decide, specifies what would change the conclusions, and refuses to over-claim.
