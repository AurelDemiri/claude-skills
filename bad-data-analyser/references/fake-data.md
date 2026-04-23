# Fabrication Detection — Reference

This file covers the statistical machinery for catching fabricated, hand-typed, or generator-produced data. The tests are listed from most broadly useful to most specialised. The key thing to internalise is that **every one of these tests is a screening tool, not a proof**: a failed test says "investigate", not "this is fake". Confident phrasing in the final report should be reserved for combinations of signals that rule out innocent explanations.

## Table of contents

1. Benford's Law — theory and variants
2. When Benford's Law applies (and when it doesn't)
3. Conformity metrics: MAD, χ², Z-statistic
4. Last-digit tests
5. Human random-number-generation biases
6. Duplicate and repetition analysis
7. Timestamp regularity
8. Faker / Mockaroo / placeholder fingerprints
9. Sample-size rules of thumb
10. How to phrase findings honestly

---

## 1. Benford's Law — theory and variants

Benford's Law describes the distribution of leading digits in many naturally-occurring datasets. It is counter-intuitive: if you think digits should be uniform (each ~11.1%), Benford says otherwise.

### First-digit probabilities

P(first digit = d) = log₁₀(1 + 1/d)

| Digit | Benford P |
|---|---|
| 1 | 30.1% |
| 2 | 17.6% |
| 3 | 12.5% |
| 4 | 9.7% |
| 5 | 7.9% |
| 6 | 6.7% |
| 7 | 5.8% |
| 8 | 5.1% |
| 9 | 4.6% |

### Second-digit probabilities

Flatter than first-digit but still not uniform:

| Digit | Benford P |
|---|---|
| 0 | 12.0% |
| 1 | 11.4% |
| 2 | 10.9% |
| 3 | 10.4% |
| 4 | 10.0% |
| 5 | 9.7% |
| 6 | 9.3% |
| 7 | 9.0% |
| 8 | 8.8% |
| 9 | 8.5% |

### First-two digits

90 bins (10 through 99). P(first-two = d) = log₁₀(1 + 1/d). This is the most discriminating of the Benford tests but needs a lot of data — see sample-size rules below. It is particularly good at catching *duplicated* fabricated values: a human who uses the same round numbers repeatedly will produce a huge spike at a few specific two-digit combinations.

### Last-two digits

In naturally-occurring data, the *last* two digits should be approximately uniform (each combination at 1%). Deviation here catches two different things:

- **Rounding**: excess at `00`, `50`, `25`, `75` indicates numbers were rounded to the nearest dollar / half-dollar / quarter. Not fabrication per se, but a red flag for precision claims.
- **Fabrication**: humans generating "random" numbers produce last-two-digit distributions that are neither Benford nor uniform — they show strong over-representation of particular pairs and under-representation of repeated digits (e.g. `11`, `22`, `33`).

## 2. When Benford's Law applies (and when it doesn't)

This is the single most-abused area in "Benford fraud detection" write-ups. A Benford test on the wrong column will produce a confident-looking p-value and a meaningless result.

### Benford is expected to hold for data that:

- **Spans multiple orders of magnitude.** A dataset ranging from 10 to 10,000,000 is well-suited. A dataset ranging from 50 to 150 is not (every number starts with 1).
- **Is the result of a **multiplicative** or **compounding** process** — prices, revenues, populations, distances, physical quantities, scientific measurements, stock prices, areas.
- **Contains accounting, financial, or transactional amounts.** This is where Benford-based fraud detection was developed (Nigrini's work at tax authorities).
- **Has enough observations.** Below ~300 values Benford is very noisy; below ~100 it's useless.

### Benford is **not** expected to hold — don't run it on:

- **ID columns, ZIP codes, phone numbers, account numbers.** These have structure that overrides Benford.
- **Ages, heights, weights.** These occupy too narrow a range (one or two orders of magnitude) and are clustered by biology.
- **Test scores, percentages, ratios bounded to [0, 1] or [0, 100].** Same reason.
- **Columns with an inherent minimum or maximum.** If values cannot be below 100 or above 999, Benford cannot hold.
- **Counts from small samples** (e.g. "number of children" is usually 0-4 — no order-of-magnitude span).
- **Data drawn from a narrow distribution** — a column whose standard deviation is much smaller than its mean won't cover enough of the digit space for Benford to make sense.

A good rule: if the column's ratio max/min is less than about 10, don't bother with Benford. If max/min is less than 100, be very cautious.

### Generalised Benford's Law

When the underlying data is not multiplicative but the log-range is moderate, the "Generalised Benford's Law" gives tighter predictions tuned to the observed range. It matters mostly for academic work; for practical fraud screening the classical first-digit test plus a last-two-digit test is usually sufficient.

## 3. Conformity metrics

### Mean Absolute Deviation (MAD)

For each digit d in 1-9, let F_d be the observed frequency and E_d the Benford-expected frequency. Then:

MAD = (1/9) · Σ |F_d − E_d|

Nigrini's empirical cutoffs for first-digit MAD:

| MAD | Interpretation |
|---|---|
| 0.000 – 0.006 | Close conformity |
| 0.006 – 0.012 | Acceptable conformity |
| 0.012 – 0.015 | Marginally acceptable |
| > 0.015 | Nonconformity |

For the first-two-digits test, the cutoffs are tighter:

| MAD | Interpretation |
|---|---|
| 0.0000 – 0.0012 | Close conformity |
| 0.0012 – 0.0018 | Acceptable |
| 0.0018 – 0.0022 | Marginal |
| > 0.0022 | Nonconformity |

**Why MAD and not χ² for this purpose:** with tens of thousands of rows, χ² will reject Benford for almost any real dataset because the test is oversensitive with large N. MAD does not scale with sample size and therefore gives a more interpretable result in practice. However, MAD has no formal distribution, so it does not give a p-value — it's a rule of thumb calibrated by Nigrini against known fraudulent and known clean datasets.

### χ² test

χ² = Σ (O_d − E_d)² / E_d

For 9 bins (first-digit) there are 8 degrees of freedom; critical value at α = 0.05 is 15.51, at α = 0.01 is 20.09. Use χ² when N is moderate (a few hundred to a few thousand); avoid it above ~10,000 rows because it becomes oversensitive.

### Z-statistic for individual digits

For each digit, the standardised deviation is:

Z_d = (|O_d − E_d| − 1/(2N)) / sqrt(E_d · (1 − E_d) / N)

where the 1/(2N) is a continuity correction. |Z_d| > 1.96 indicates that specific digit deviates at α = 0.05. This is useful for identifying *which* digits are anomalous — e.g. "the digit 5 is massively over-represented in this column's first-digit distribution".

### Mantissa arc test

A more sensitive test for Benford conformity. Compute the fractional part of log₁₀(x) for each value; map to a unit circle; compute the resultant length. Under Benford the mantissas are uniform on [0, 1), so the resultant is short. Under non-Benford (especially duplicated values) the resultant is long. Rarely needed for practical work but worth knowing the name.

## 4. Last-digit tests

The last digit of a naturally-occurring measurement or count should be approximately uniform — each of 0-9 appears ~10% of the time. Deviations flag two different problems:

- **Rounding bias.** In manually recorded data (especially medical and survey), the last digit clusters at 0 and 5, and sometimes 2 and 8. Blood pressure is the textbook case: blood-pressure readings recorded on paper charts cluster so heavily at multiples of 10 that changing the hypertension cutoff from "≥ 140" to "> 140" can halve the apparent prevalence of hypertension, purely because of terminal-digit preference at 140. Documented across >28,000 measurements.
- **Fabrication bias.** Humans asked to generate "random" digits tend to *under*-produce 0 and *over*-produce 7. So a column with an elevated 7-count in the last-digit position is suspect for human fabrication.

### Expected frequencies

Under the null of uniformity: each digit = 10%, standard error per digit ≈ sqrt(0.09/N). For N = 1000, SE ≈ 1 percentage point; anything outside 7-13% for a single digit is worth investigating.

## 5. Human random-number-generation biases

Decades of psychology research — Chapanis 1953, Wagenaar 1972, Loetscher & Brugger 2007, Towse et al. 2014 — converge on a consistent profile of how humans fail to produce randomness. These patterns help distinguish a human fabricator from a script fabricator.

### Biases humans exhibit when generating "random" numbers:

1. **Under-repetition.** Humans avoid producing adjacent identical digits (77, 33) because repetition feels "not random". Real random sequences have these ~10% of the time; human sequences have them far less.
2. **Over-alternation.** Humans produce too many "switches" between low and high digits. The autocorrelation at lag 1 of human-random sequences is negative when it should be zero.
3. **Small-number preference.** When asked to pick a random digit 1-9, humans pick small numbers more often than large ones. 1, 2, and 3 are over-represented; 8 and 9 are under-represented.
4. **Over-selection of 7.** In a last-digit context humans over-select 7 because it "feels random" (non-round, non-adjacent, prime).
5. **Under-selection of 0 and 5.** Paradoxically the opposite of the rounding bias in honestly-recorded data — when *fabricating*, humans avoid digits they associate with roundness.
6. **Cycling.** Humans tend to cycle through available digits faster than randomness would — they produce every digit 1-9 in ~12-15 steps on average, when true randomness takes ~25 steps to hit all nine with high probability (see coupon collector's problem).
7. **Over-use of alternating patterns.** Sequences like `1-9-1-9-1-9` get over-produced because they "look random" but aren't.

### Practical implication

For a column suspected of containing human fabrication:

- Count the fraction of adjacent digit-pair repeats in its first-digit stream. Expect ~11.1% (= 1/9) under Benford; significantly below that is a fabrication tell.
- Count the over-representation of 7 in the last digit. Expect 10%; significantly above is a tell.
- Compare the distribution of first digits to Benford. A human-fabricated column will typically look *flatter* than Benford (too uniform) and also will over-weight small digits (closer to Benford than uniform, but still flatter).
- Look for "anti-rounding": in honest data, rounding shows at multiples of 10, 25, 100. In *fabricated* data, the opposite — a suspicious *absence* of round numbers can also be a signal.

## 6. Duplicate and repetition analysis

### Number-duplication test

Count the frequency of each distinct value in the column. In real transactional data, *some* duplication is expected (two $9.99 purchases, two $50 invoices) but the distribution of frequencies is usually long-tailed — a few very common values and a long tail of unique-or-rare ones.

Flags:

- A column of 10,000 supposedly-real transaction amounts with only 200 distinct values. Either the data was fabricated from a small menu, or the column represents a categorical variable that was misinterpreted as numeric.
- A "natural" column (like a sum or an average) with a disproportionate spike at one specific value (`99.00`, `150.00`, `1000.00`) — the fabricator's favourite round number.
- **Duplicate rows:** identical entries across many columns for supposedly different records. More than a couple of fully-identical rows in a dataset of a few thousand is a strong fabrication / copy-paste signal.

### Relative size factor (RSF)

For each grouping key (e.g. vendor), compute max(value) / second-max(value). An RSF much greater than 1 indicates one huge outlier against typical values — a classic fraud signal in audit work (e.g. a vendor whose largest invoice is 50× their next-largest). Not specific to fabrication, but useful alongside it.

## 7. Timestamp regularity

Timestamps have their own fabrication signatures.

Flags worth investigating:

- **Excess `:00` seconds.** If a fraction much greater than 1/60 of timestamps end in `:00`, either the data has 1-minute precision (innocent) or rows were fabricated at whole-minute marks. Same test applies to `:00:00` for hour-precision fabrication.
- **Excess whole hours.** A peak of events at exactly `09:00`, `12:00`, `17:00` in supposedly continuous activity data is either scheduled-job output or fabricated.
- **Missing weekends / holidays** in a column that should show weekend activity (login times, sales). A fabricator who used `rand(MIN_DATE, MAX_DATE)` will create weekends; a fabricator who filled in "recent dates" by hand typically will not.
- **Uniform hour distribution.** Most human activity has a strong diurnal pattern — a flat distribution across the 24-hour clock is suspicious.
- **Perfectly sequential IDs with non-sequential timestamps** or vice versa.
- **Date-only values with synthetic times of `00:00:00`** — indicates a date column was widened to a datetime with zeros appended. Not fabrication, but a precision-loss flag worth mentioning.
- **Future dates** in columns that should only be past.
- **Dates before a known-impossible epoch** (e.g. signup dates before the product launched).

## 8. Faker / Mockaroo / placeholder fingerprints

Synthetic-data libraries leave specific fingerprints. When a column of "real users" contains any of these, the column is synthetic (or mixed with synthetic):

### Faker (Python / Ruby / JavaScript) fingerprints

- **Email domains**: `@example.com`, `@example.org`, `@example.net`, `@test.com` appear as a large fraction of emails in Faker output by default.
- **Names**: Faker draws from fixed name lists, so given enough rows the distribution of first names in Faker data differs from the actual US Census or other locale distribution. Ten different "Christophes" and no "Michaels" in a supposedly-US dataset is a Faker tell.
- **Addresses**: Faker generates plausible-sounding but often nonsense streets (`"5479 William Way, East Sonnyhaven, LA 63637"`). ZIP codes are drawn from the pool of real ZIPs, but city-state-ZIP combinations are frequently invalid together.
- **Phone numbers**: Faker phone numbers are generated by regex and will not validate against real carrier ranges. They often use `555` prefixes or other reserved ranges.
- **Lorem ipsum**: Faker's `lorem` provider produces classical Lorem Ipsum. Its presence in supposedly-user-generated comments is a dead giveaway.
- **Extra-decimal floats**: Faker generates numbers with full float precision where real entry would have 2 decimal places. A mix of `149.99` and `149.99314159265` in a "price" column indicates synthetic values.

### Mockaroo fingerprints

- Very plausible-looking outputs with careful coherence (name matches gender, email matches name), but often: generated names drawn from a small set, identical ISO country codes in "City" fields, and very uniform age/date distributions.

### Detection heuristic

Scan every string column for the exact substrings: `example.com`, `example.org`, `example.net`, `test.com`, `mailinator.com`, `yopmail.com`, `lorem ipsum`, `consectetur`, `John Doe`, `Jane Doe`, `555-01`. Count the fraction of rows containing any of these. Over 0.1% of rows with any of these markers is strong evidence of synthetic injection.

### ChatGPT / LLM-generated text fingerprints (when the dataset claims to be user-written)

- Overuse of "delve", "navigate", "landscape", "tapestry", "realm", "elevate", "unleash", "bolster", "robust", "seamless" in corporate copy.
- Paragraphs that open with "In today's fast-paced world..." or "It's important to note that..."
- Em-dashes (—) appearing in text supposedly typed by users who would use hyphens.
- Perfect grammar in comments that should have typos and casual language.
- Lists of exactly 3 items. Lots of parallel structure.
- Not diagnostic on their own; useful as supporting evidence.

## 9. Sample-size rules of thumb

Running any of these tests on too little data produces a confidently-wrong result. Minimums:

- **First-digit Benford:** at least 300 values, ideally 1000+.
- **Second-digit Benford:** at least 500, ideally 2000+.
- **First-two-digits Benford:** at least 1000, ideally 10,000+ (there are 90 bins, each needs ~10+ expected observations for the tests to work).
- **Last-two-digits uniformity:** at least 500, ideally 5000+.
- **Duplicate analysis:** useful from ~100 rows; stronger as N grows.
- **Terminal-digit preference on measurement data:** at least 500.

Below these sizes, *report what you saw but not the test statistic*. "Among 80 values the first digit 1 appeared 40 times, more than twice Benford's prediction" is an honest observation. "The MAD was 0.042, indicating nonconformity" is not honest with only 80 values.

## 10. How to phrase findings honestly

This is not boilerplate; it is the whole point of the skill. The reports this skill produces can be used to make decisions about firing people, rejecting manuscripts, or canceling contracts. Misphrased findings are dangerous.

**Good phrasing:**

- "First-digit distribution deviates substantially from Benford (MAD 0.038, which Nigrini classifies as nonconforming). This is consistent with fabrication or with a column that should not have been Benford-tested. Verify: does this column span multiple orders of magnitude and arise from a multiplicative process?"
- "487 of 12,318 rows (3.9%) have a `total_amount` of exactly 2,147,483,647. This is the INT32 ceiling and is consistent with silent saturation at the database layer. The real values are at least that large, but their true magnitudes are unrecoverable from this export."
- "Excess at `:00` seconds (14% of timestamps, vs. expected 1.7%). Either the source system has minute precision despite storing seconds, or these rows were entered by hand."

**Bad phrasing:**

- "The data is fake." (Not what a failed Benford test proves.)
- "Fraud detected." (Not a conclusion a statistical test can draw.)
- "No issues found." (When the tests you ran couldn't have found issues given the sample size.)

When uncertain, defer to the user's domain knowledge: "This pattern is suspicious. Before concluding anything, can you confirm what this column represents and roughly how it was generated?"

---

## Quick-reference decision table

| Symptom | Most likely cause | Next step |
|---|---|---|
| Big spike at 2,147,483,647 | INT32 saturation | Reconcile with source system; widen type |
| Big spike at 255 / 65535 | Smaller-int saturation | Same |
| String-length spike at 255 | VARCHAR(255) truncation | Re-export from source with wider type |
| Dates at 1970-01-01 | NULL stored as Unix 0 | Treat as missing; don't average |
| Dates at 2038-01-19 / 1901-12-13 | Y2038 overflow | Migrate TIMESTAMP to DATETIME |
| MySQL TIME at ±838:59:59 | Duration too large for TIME | Use INT seconds or INTERVAL |
| Benford MAD > 0.015 (first digit) | Possible fabrication OR wrong test | Check if column is Benford-appropriate |
| Last digit heavy at 0 and 5 | Human rounding | Trust the order of magnitude, not the precision |
| Last digit heavy at 7 | Human "random" fabrication | Investigate author of data |
| Too few duplicates | Fabrication by rule-based script | Check for Faker/Mockaroo fingerprints |
| Too many identical rows | Copy-paste fabrication | Inspect the duplicates directly |
| `example.com` emails | Synthetic data | Filter them out or reject the dataset |
| SSNs starting 000/666/9xx | Invalid by SSA rules | These are fabricated |
| Phone 555-01xx | NANP fictitious range | Fabricated |
