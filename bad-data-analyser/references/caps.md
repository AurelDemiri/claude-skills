# Data Caps and Sentinel Values — Reference

This is a catalog of known ceilings, floors, and "magic" values that commonly appear in datasets when something has gone wrong. The goal is not to memorise every number but to *recognise* them when they pile up at the boundary of a column.

**How to use this file:** when a column's `max()`, `min()`, or modal value is close to any number in this catalog, the column is a candidate for cap investigation. The strength of the signal scales with how many rows sit at the boundary. One row at 2,147,483,647 might be a coincidence. Four hundred rows at that exact value is almost certainly INT32 saturation.

## Table of contents

1. Signed/unsigned integer ceilings
2. Floating-point special values
3. String-length ceilings
4. Date / time / timestamp ceilings
5. Database-specific caps (MySQL, PostgreSQL, SQL Server, Oracle)
6. File-format and OS caps
7. Common sentinel and placeholder values

---

## 1. Integer ceilings

These are the values that numeric columns collide with most often. When a column pins large numbers of rows at exactly one of these, the source system has almost certainly silently saturated.

| Type | Signed min | Signed max | Unsigned max |
|---|---|---|---|
| 8-bit (TINYINT, byte) | -128 | 127 | 255 |
| 16-bit (SMALLINT, short) | -32,768 | 32,767 | 65,535 |
| 24-bit (MySQL MEDIUMINT) | -8,388,608 | 8,388,607 | 16,777,215 |
| 32-bit (INT, INTEGER) | -2,147,483,648 | 2,147,483,647 | 4,294,967,295 |
| 64-bit (BIGINT, long) | -9,223,372,036,854,775,808 | 9,223,372,036,854,775,807 | 18,446,744,073,709,551,615 |
| 128-bit | ±(2^127 - 1) | 2^127 - 1 | 2^128 - 1 (≈ 3.4e38) |

**Things to watch for:**

- **INT32 is the single most common cap in real systems.** A primary-key column or auto-increment sequence that has accumulated rows for several years will hit 2,147,483,647 and either error out or (in MySQL's default non-strict mode) silently stop incrementing. See the Crunchy Data piece on the 2.1-billion ceiling in Postgres.
- **MySQL historically clamped on overflow rather than erroring** — inserting a 19-digit number into a `BIGINT` column silently stores the maximum value for the type. This means datasets exported from old MySQL servers can contain phantom 2,147,483,647 entries that were originally much larger.
- **The sign bit is its own problem.** When a 32-bit signed int overflows it wraps to `-2,147,483,648`, not to zero. So a "negative" value in a column that should never be negative (e.g. a count, a file size, an elapsed duration) is a strong overflow signal. Values near `-2147483648`, `-128`, `-32768` in a column that should be non-negative are almost always overflow artefacts.
- **Java's `int` is always 32-bit signed** regardless of platform, so the same cap appears in Java-exported data.
- **Watch for off-by-one.** Some systems cap at max − 1 or max + 1 depending on how the overflow is handled. Treat ±2 around the ceiling as "at the ceiling".

## 2. Floating-point special values

- **NaN** (not-a-number). Often appears as `NaN`, `nan`, or an empty string after CSV export. Any arithmetic with NaN propagates.
- **+Inf / -Inf.** Result of division by zero or overflow in float math. In CSV they show up as `inf`, `Infinity`, `1.#INF`, or `-1.#INF`.
- **Float32 max: ±3.4028235 × 10^38.** Saturation here is less common than integer saturation but shows up in scientific/embedded data.
- **Float64 max: ±1.7976931348623157 × 10^308.**
- **0.1 + 0.2 = 0.30000000000000004.** This and similar artefacts (values ending in long strings like `...000000004` or `...999999996`) indicate data was produced by float arithmetic rather than typed by a human or derived symbolically. Not evidence of fabrication, but useful for fingerprinting the source.
- **Subnormal values** (very close to zero but not quite zero) are a sign of underflow in scientific data.
- **Negative zero** (`-0.0`) is distinct from `0.0` in IEEE 754 but usually not meaningful — its appearance often signals an unusual code path.

## 3. String-length ceilings

These show up as columns where a surprising fraction of strings are *exactly* the cap length. For a hit to be meaningful, the column should contain free-text of variable natural length (names, addresses, comments); columns holding inherently-fixed strings (country codes, hex hashes) are expected to cluster at one length.

| Cap | Origin |
|---|---|
| 255 | MySQL VARCHAR pre-5.0.3, CHAR max, TINYTEXT, most filesystem filename limits (NTFS, ext4), Twitter username |
| 280 | Current Twitter/X tweet limit (was 140 pre-2017) |
| 500 | Common HTML textarea default in older CMS |
| 2,000 | Common URL-length practical cap; Oracle VARCHAR2 default in older versions |
| 2,048 | Common browser URL cap, also IE historical limit was 2,083 |
| 4,000 | SQL Server NVARCHAR(MAX) historical threshold |
| 4,096 | Linux `PATH_MAX`, common HTTP header cap |
| 8,000 | SQL Server VARCHAR max before moving to VARCHAR(MAX) |
| 16,383 | MySQL VARCHAR max characters in utf8mb4 (65,535 bytes ÷ 4) |
| 21,844 | MySQL VARCHAR max characters in utf8 (65,535 bytes ÷ 3) |
| 65,535 | MySQL TEXT, row-size cap for a single VARCHAR |
| 16,777,215 | MySQL MEDIUMTEXT (2^24 − 1) |
| 4,294,967,295 | MySQL LONGTEXT (2^32 − 1) |

**Classic truncation tells:**

- Strings at exactly the cap length, *ending mid-word*. A column of 255-character strings that all break in the middle of a word is VARCHAR(255) truncation.
- A population of strings with lengths uniformly distributed *below* the cap, plus a dense spike *at* the cap — clearest visible as a histogram.
- Multi-byte character sets make this more confusing: a VARCHAR(255) storing UTF-8 can hold from 63 characters (all 4-byte emoji) to 255 characters (all ASCII). So the saturated length in character counts may not be exactly 255; it may be lower if the column contains accented or non-Latin text.

## 4. Date / time / timestamp ceilings

Date columns collide with ceilings far more often than people expect, because dates are stored in at least a dozen different internal representations and many of them have quiet limits.

### Unix epoch caps

- **32-bit signed Unix time:** latest representable second is 2,147,483,647 = **2038-01-19 03:14:07 UTC**. Overflow wraps to **1901-12-13 20:45:52 UTC** (= −2,147,483,648).
- **32-bit unsigned Unix time:** latest representable second is 4,294,967,295 = **2106-02-07 06:28:15 UTC**.
- **Epoch-zero pileups:** seeing lots of rows at `1970-01-01 00:00:00 UTC` or at the integer `0` almost always means a null or unset timestamp was stored as zero. This is its own kind of silent data loss.

### MySQL

- **`TIMESTAMP`**: range `1970-01-01 00:00:01` to `2038-01-19 03:14:07`. Internally a 32-bit signed Unix time. This is the **single most dangerous date type** in the wild — Y2038 is not theoretical, it's a property of every `TIMESTAMP` column that hasn't been migrated to `DATETIME`.
- **`DATETIME`**: range `1000-01-01 00:00:00` to `9999-12-31 23:59:59`. Pileups at `1000-01-01` or `9999-12-31` are classic "invalid date" sentinels.
- **`DATE`**: `1000-01-01` to `9999-12-31`.
- **`TIME`**: `-838:59:59` to `838:59:59`. This is *hours*, not clock time. The cap exists because the field is stored as seconds in a 24-bit signed integer: ± (838·3600 + 59·60 + 59) ≈ ± 2^23. A column in a "TIME" field with large numbers of rows at `838:59:59` almost certainly means someone stored a day-count or elapsed duration (e.g. "hours since account creation") in a type that can't hold it.
- **`YEAR`**: 1901–2155 (or 0000 for "zero year"); two-digit years 00–69 map to 2000–2069, 70–99 map to 1970–1999.

### PostgreSQL

- **`timestamp` / `timestamptz`**: 4713 BC to 294276 AD, microsecond precision. Effectively uncapped for any real-world use.
- **`date`**: 4713 BC to 5874897 AD.
- **`time`**: 00:00:00 to 24:00:00. Note the *inclusive* upper bound — some systems reject `24:00:00` and some accept it; this is a real interop hazard.
- **`interval`**: ±178,000,000 years.

### SQL Server

- **`datetime`** (legacy): 1753-01-01 to 9999-12-31, 3.33 ms precision (so seconds aren't really seconds). The 1753 floor exists because of the Gregorian calendar transition.
- **`smalldatetime`**: 1900-01-01 to 2079-06-06, minute precision. The 2079-06-06 cap catches people out in long-lived systems.
- **`datetime2`**: 0001-01-01 to 9999-12-31.
- **`date`**: 0001-01-01 to 9999-12-31.

### Oracle

- **`DATE`**: 4712 BC to 9999 AD, second precision.
- **`TIMESTAMP`**: similar range, fractional seconds up to 9 digits.

### Excel

- **1900 date system (default on Windows):** serial 1 = 1900-01-01, serial 2958465 = 9999-12-31. *1900 is incorrectly treated as a leap year* because early Lotus 1-2-3 had that bug and Excel copied it for compatibility — so `1900-02-29` is a valid Excel date even though it never existed. Dates before 1900-03-01 have off-by-one serial numbers.
- **1904 date system (Mac legacy, still an option):** serial 0 = 1904-01-01. A column where all dates are ~4 years off from expected is usually 1904/1900 confusion on import.
- **Powers-of-10 date serials:** serial 1 = 1900-01-01, serial 36526 = 2000-01-01, serial 44196 = 2021-01-01. When numbers in these ranges show up where dates were expected, someone exported dates as numbers.

### JavaScript

- **`Date`**: ±8,640,000,000,000,000 ms around the epoch (±100,000,000 days). Beyond that, dates become `Invalid Date`.
- **`Date.now()` precision** has been clamped to 1-2 ms in browsers since 2018 (Spectre mitigation), so sub-millisecond timestamps in client-side exports are suspect.

### Java

- Legacy `java.util.Date` is a 64-bit `long` of milliseconds since epoch — effectively uncapped for normal use but wraps similarly to Unix time for 32-bit-signed representations in older APIs.

### Epoch "placeholder" values to watch for

- `1970-01-01 00:00:00` (Unix zero) — overwhelmingly means "null imported as zero".
- `1900-01-01 00:00:00` (SQL Server / Excel default) — same, but for .NET / Microsoft stacks.
- `0001-01-01 00:00:00` (.NET `DateTime.MinValue`) — same, .NET stack.
- `9999-12-31` — placeholder for "end of time" or "no end date" in slowly-changing-dimension schemas.
- `2099-12-31`, `2999-12-31` — same idea, less standardised.

## 5. Database-specific caps you should know

### MySQL-specific

- **Row size cap of 65,535 bytes** shared across all columns in a row. Wide tables sometimes hit this silently at schema-design time and end up with truncated columns.
- **`TIME(6)` microsecond support** only from 5.6.4 onwards.
- **`DECIMAL` max precision** is 65 digits.
- **MySQL silently clamps on `INSERT` overflow in non-strict SQL mode** — this is the reason a surprising fraction of MySQL databases in the wild contain 2,147,483,647 entries that the application never intended.

### PostgreSQL-specific

- **`serial` = INT4**, `bigserial` = INT8. A table created with `serial` that grows past 2.1 billion rows will start erroring on insert with `nextval: reached maximum value of sequence`.
- **`numeric` (= `decimal`)** is effectively unbounded in precision (up to 131,072 digits before the decimal point) — exports of `numeric` columns into typed systems are a common capping scenario.

### SQL Server-specific

- **`money` / `smallmoney`**: these exist and have bizarrely tight bounds (`money` is ±922 quadrillion, but only 4 digits of precision after the decimal). Avoid; but if you see them in a schema, check for boundary pileups.
- **`int` defaults to 32-bit signed** same as elsewhere.

### Oracle-specific

- **`NUMBER(p,s)`** is the main numeric type; precision is up to 38 digits.
- **`VARCHAR2(4000)`** was the historical cap — still common in the wild.

## 6. File-format and OS caps

- **CSV:** no inherent cap, but Excel will only load **1,048,576 rows × 16,384 columns** (2^20 × 2^14 since Excel 2007). A CSV that has been opened and re-saved in Excel will be truncated at row 1,048,576 with no warning beyond a dialog the user probably clicked past.
- **XLSX:** same 1,048,576 × 16,384 limit.
- **JSON:** no inherent cap, but many parsers silently lose precision on integers beyond 2^53 (the `Number.MAX_SAFE_INTEGER` of JavaScript). Integer IDs exported via JavaScript tooling can be corrupted in the last few digits without any warning.
- **Parquet:** type-dependent; the usual integer and string caps apply per-column.

## 7. Common sentinel and placeholder values

These are values that *replace* real data rather than representing it — they appear when a system needed to record something but didn't have it.

### Numeric sentinels

- **`-1`** — "not found", "unknown", "unset". By far the most common integer sentinel. When a column's minimum is exactly `-1` and the rest of the distribution is non-negative, the `-1`s are probably not real.
- **`0`** where 0 is nonsensical — e.g. `height_cm = 0`, `age = 0`, `price = 0.00` for a paid product. Treat as sentinel.
- **`99`, `999`, `9999`, `99999`** — common "missing" or "unknown" encodings in legacy survey data. `9999` for "unknown year" is very common.
- **`7777`, `8888`, `9998`** — specific missing-value codes in some survey standards (NHANES and similar).
- **`127`, `255`, `32767`, `65535`** — both the signed/unsigned cap for integer types *and* the "maxed out" sentinel. Ambiguous on sight; investigate.
- **`-99`, `-999`** — "missing" sentinels in scientific/meteorological data.
- **`MAX_INT`, `MIN_INT`** — explicit "undefined" markers.

### String sentinels

- `NULL`, `null`, `None`, `NONE`, `N/A`, `NA`, `n/a`, `nil`, `-` — variants of nothing.
- Empty string `""` vs NULL — separate in SQL, often conflated on import/export. Both can be sentinels.
- `Unknown`, `Unspecified`, `TBD`, `To be determined`, `TBC`, `Pending`, `?`, `???`.
- `xxx`, `xxxx`, `asdf`, `test`, `aaa`, `zzz` — manual "I have to fill this in" values.
- Whitespace-only strings.

### Email / contact sentinels

- `@example.com`, `@example.org`, `@example.net` — RFC 2606 reserved test domains; *no real user will ever have one of these addresses*.
- `@test.com`, `@test.test`, `@mailinator.com`, `@yopmail.com`, `@guerrillamail.com` — throwaway and placeholder domains.
- `noreply@`, `donotreply@`, `admin@example.com` — system addresses.
- `test@test.com`, `a@a.com`, `a@b.c` — placeholder typed by humans.

### Phone sentinels

- **`555-0100` through `555-0199`** (North American Numbering Plan) — officially reserved for fictional use since 1994. No legitimate North American phone number is in this range.
- The older `555-xxxx` convention is mostly released for real assignment now, but still dominant as a "fake phone" pattern in fabricated data.
- `000-0000`, `111-1111`, `123-4567`, `1234567890`, `+1 (555) 555-5555` — manual placeholders.
- UK `020 7946 0xxx` — reserved for drama by Ofcom.
- Australia `1800 000 000` patterns — reserved by ACMA.

### SSN (US) sentinels

- `000-xx-xxxx`, `666-xx-xxxx`, `900-xx-xxxx` through `999-xx-xxxx` — **never validly assigned**. Any SSN with one of these area numbers is fake.
- `xxx-00-xxxx`, `xxx-xx-0000` — never validly assigned (the group and serial portions are never all zero).
- **`078-05-1120`** — the "Woolworth wallet SSN" printed on sample cards in 1938 and subsequently used by tens of thousands of people. Still appears in datasets.
- `123-45-6789` — the stock "example" SSN.
- `219-09-9999` — a known demonstrated-fraud number (Hilda Schrader Whitcher's).

### IP / network sentinels

- `0.0.0.0`, `127.0.0.1`, `255.255.255.255` — special-purpose addresses, not real users.
- `192.168.x.x`, `10.x.x.x`, `172.16.x.x`-`172.31.x.x` — private address ranges, should not appear as public user IPs.
- `169.254.x.x` — link-local; appears when DHCP failed.
- `::1`, `fe80::...` — IPv6 local/link-local.

### Name sentinels

- `John Doe`, `Jane Doe`, `John Smith`, `Jane Smith`, `Test User`, `Admin`, `First Last`, `Foo Bar`, `Alice Bob` — almost always fabricated.
- Names identical to the application they're registered to (`Google User`, `Salesforce Admin`).
- All-uppercase or all-lowercase names in systems that proper-case by default — suggests manual entry of placeholder data.

### Address sentinels

- `123 Main St`, `1 Infinite Loop`, `742 Evergreen Terrace`, `221B Baker Street` — placeholders or addresses of famous fictional/real-but-recognisable locations.
- `Anytown`, `Somewhere`, `Nowhere` as city.
- Same street address repeated many times in an otherwise-diverse dataset.

### Text / free-form sentinels

- `Lorem ipsum dolor sit amet, consectetur...` and variants — the placeholder text from typesetting. Real user text almost never starts "Lorem ipsum".
- Text that is exactly 50, 100, 200, or 500 characters — suggests a hand-written form limit was hit *and* the user padded to reach the limit.
- Long strings of a single character (`aaaaaa...`, `......`).

### UUID sentinels

- `00000000-0000-0000-0000-000000000000` — the "nil UUID".
- `ffffffff-ffff-ffff-ffff-ffffffffffff` — the "max UUID".
- UUIDs that don't conform to a version byte (the third group's first hex digit should be 1–8 for v1–v8).

---

When in doubt, remember the workflow: **profile first, test second, interpret third**. Most cap findings are visible in the profile itself — a min/max that matches the table above, with a conspicuous number of rows at the boundary, is the whole finding.
