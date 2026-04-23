#!/usr/bin/env python3
"""
bad-data-analyser: forensic analysis of tabular data for signs of capping or fabrication.

Usage:
    python analyse.py <path-to-data> [--column NAME]... [--sample N] [--json] [--no-benford] [--no-caps] [--no-fabrication]

The script:
  1. Loads the data (csv, tsv, xlsx, parquet, json).
  2. Profiles every column (inferred type, range, N, uniques).
  3. Runs cap-saturation checks against the catalog in references/caps.md.
  4. Runs fabrication checks (Benford, last-digit, duplicates, Faker fingerprints).
  5. Prints a human-readable report (default) or JSON (--json).

No network calls; no external services; no mutations of the input file.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import warnings
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# Pandas emits a UserWarning every time it falls back to dateutil for datetime parsing.
# That is noise for our purposes — we intentionally parse heterogeneous date strings.
warnings.filterwarnings("ignore", message=".*Could not infer format.*", category=UserWarning)
warnings.filterwarnings("ignore", message=".*dateutil.*", category=UserWarning)

try:
    import pandas as pd
except ImportError:
    sys.stderr.write("pandas is required. Install with: pip install pandas\n")
    sys.exit(2)

# ---------- Known caps and sentinels ----------
# These are the values that pile up at column boundaries when a storage type
# has saturated. The `tolerance` field lets us catch off-by-one wrap artefacts.

INTEGER_CAPS: list[dict[str, Any]] = [
    {"value": 127,                      "name": "INT8 signed max (TINYINT)"},
    {"value": -128,                     "name": "INT8 signed min"},
    {"value": 255,                      "name": "UINT8 max / TINYTEXT byte limit"},
    {"value": 32767,                    "name": "INT16 signed max (SMALLINT)"},
    {"value": -32768,                   "name": "INT16 signed min"},
    {"value": 65535,                    "name": "UINT16 max / MySQL TEXT / row-size"},
    {"value": 8388607,                  "name": "MySQL MEDIUMINT signed max"},
    {"value": 16777215,                 "name": "MySQL MEDIUMINT unsigned / MEDIUMTEXT"},
    {"value": 2147483647,               "name": "INT32 signed max (INT)"},
    {"value": -2147483648,              "name": "INT32 signed min"},
    {"value": 4294967295,               "name": "UINT32 max / LONGTEXT / Y2106 epoch"},
    {"value": 9223372036854775807,      "name": "INT64 signed max (BIGINT)"},
    {"value": -9223372036854775808,     "name": "INT64 signed min"},
    {"value": 18446744073709551615,     "name": "UINT64 max"},
]

# Domain-level caps: values that aren't type ceilings per se, but are the downstream
# manifestation of an overflow in a *storage type* (e.g. MySQL TIME). Unlike INTEGER_CAPS,
# these fire on exact-value pileups regardless of the column's max — a report that
# extracts HOUR(SEC_TO_TIME(SUM(...))) from a TIME overflow emits the integer 838 while
# the column max may be much higher (unaffected rows).
#
# Each entry may carry:
#   value          — the pileup value to look for
#   name           — human description
#   name_hints     — substrings in the column name that strengthen the signal
#   min_hits       — minimum exact-match count to bother reporting
DOMAIN_CAPS: list[dict[str, Any]] = [
    {
        "value": 838,
        "name": "MySQL TIME hour cap (838:59:59 → HOUR() = 838)",
        "name_hints": ["hour", "uur", "uren", "duration", "duur", "tijd", "time", "total"],
        "min_hits": 3,
    },
]

# Sentinels that show up as deliberate "missing / unknown" codes (as opposed to caps).
NUMERIC_SENTINELS: list[dict[str, Any]] = [
    {"value": -1,        "name": "-1 'not found' / 'unknown' sentinel"},
    {"value": 9999,      "name": "9999 missing-value code"},
    {"value": 99999,     "name": "99999 missing-value code"},
    {"value": 999999,    "name": "999999 missing-value code"},
    {"value": 999,       "name": "999 missing-value code"},
    {"value": -99,       "name": "-99 scientific missing-value code"},
    {"value": -999,      "name": "-999 scientific missing-value code"},
    {"value": -9999,     "name": "-9999 scientific missing-value code"},
    {"value": 7777,      "name": "7777 NHANES-style missing code"},
    {"value": 8888,      "name": "8888 NHANES-style 'not applicable' code"},
]

# String-length caps that signal VARCHAR / TEXT truncation when many rows pin there.
STRING_LENGTH_CAPS: list[dict[str, Any]] = [
    {"value": 50,      "name": "50-char form cap"},
    {"value": 100,     "name": "100-char form cap"},
    {"value": 140,     "name": "140-char legacy Twitter cap"},
    {"value": 160,     "name": "160-char SMS cap"},
    {"value": 255,     "name": "VARCHAR(255) / CHAR / TINYTEXT"},
    {"value": 280,     "name": "280-char Twitter/X cap"},
    {"value": 500,     "name": "500-char form cap"},
    {"value": 1000,    "name": "1000-char form cap"},
    {"value": 2000,    "name": "Oracle VARCHAR2 legacy cap"},
    {"value": 2048,    "name": "URL practical cap"},
    {"value": 4000,    "name": "SQL Server NVARCHAR legacy cap"},
    {"value": 4096,    "name": "PATH_MAX / HTTP header cap"},
    {"value": 8000,    "name": "SQL Server VARCHAR legacy cap"},
    {"value": 16383,   "name": "MySQL VARCHAR utf8mb4 char cap"},
    {"value": 21844,   "name": "MySQL VARCHAR utf8 char cap"},
    {"value": 65535,   "name": "MySQL TEXT / row-size cap"},
]

# Dates that commonly appear as epoch/placeholder pileups.
DATE_SENTINELS: list[dict[str, Any]] = [
    {"value": "1970-01-01", "name": "Unix epoch zero (null stored as 0)"},
    {"value": "1900-01-01", "name": "SQL Server / Excel default floor"},
    {"value": "0001-01-01", "name": ".NET DateTime.MinValue"},
    {"value": "1000-01-01", "name": "MySQL DATETIME floor"},
    {"value": "1753-01-01", "name": "SQL Server datetime floor"},
    {"value": "1901-12-13", "name": "INT32 signed Unix underflow (Y2038 wrap)"},
    {"value": "2038-01-19", "name": "INT32 signed Unix overflow (Y2038)"},
    {"value": "2079-06-06", "name": "SQL Server smalldatetime max"},
    {"value": "2106-02-07", "name": "UINT32 Unix overflow (Y2106)"},
    {"value": "2099-12-31", "name": "SCD 'end of time' placeholder"},
    {"value": "2999-12-31", "name": "SCD 'end of time' placeholder"},
    {"value": "9999-12-31", "name": "MAX date placeholder"},
    {"value": "1900-02-29", "name": "Excel fictitious leap day (doesn't exist)"},
]

# Faker / placeholder fingerprints. Lowercase substring matches on string columns.
STRING_FINGERPRINTS: list[dict[str, str]] = [
    {"pattern": "@example.com",    "name": "RFC 2606 reserved test domain (example.com)"},
    {"pattern": "@example.org",    "name": "RFC 2606 reserved test domain (example.org)"},
    {"pattern": "@example.net",    "name": "RFC 2606 reserved test domain (example.net)"},
    {"pattern": "@test.com",       "name": "test.com placeholder domain"},
    {"pattern": "@test.test",      "name": "test.test placeholder domain"},
    {"pattern": "@mailinator.com", "name": "mailinator throwaway domain"},
    {"pattern": "@yopmail.com",    "name": "yopmail throwaway domain"},
    {"pattern": "@guerrillamail",  "name": "guerrillamail throwaway domain"},
    {"pattern": "lorem ipsum",     "name": "Lorem ipsum placeholder text"},
    {"pattern": "consectetur",     "name": "Lorem ipsum placeholder text"},
    {"pattern": "john doe",        "name": "John Doe placeholder name"},
    {"pattern": "jane doe",        "name": "Jane Doe placeholder name"},
    {"pattern": "test user",       "name": "'Test User' placeholder name"},
    {"pattern": "asdfasdf",        "name": "'asdf' keyboard-mash placeholder"},
    {"pattern": "555-01",          "name": "NANP reserved fictitious phone (555-01xx)"},
]

# Invalid US SSN area numbers (group of digits before the first hyphen).
INVALID_SSN_AREA_RE = re.compile(r"^\s*(000|666|9\d\d)[-\s]")
KNOWN_FAKE_SSNS = {"078-05-1120", "123-45-6789", "219-09-9999"}


# ---------- Benford tables ----------

def _benford_first_digit_probs() -> dict[int, float]:
    return {d: math.log10(1 + 1 / d) for d in range(1, 10)}


def _benford_second_digit_probs() -> dict[int, float]:
    # P(second digit = d) = sum over k in 1..9 of log10(1 + 1/(10k + d))
    return {
        d: sum(math.log10(1 + 1 / (10 * k + d)) for k in range(1, 10))
        for d in range(0, 10)
    }


BENFORD_1 = _benford_first_digit_probs()
BENFORD_2 = _benford_second_digit_probs()


# ---------- Data container ----------

@dataclass
class Finding:
    column: str
    category: str  # 'cap' | 'sentinel' | 'benford' | 'last_digit' | 'fingerprint' | 'duplicate' | 'timestamp'
    severity: str  # 'HIGH' | 'MEDIUM' | 'LOW'
    summary: str
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class ColumnProfile:
    name: str
    dtype: str
    inferred_semantic: str  # 'integer' | 'float' | 'string' | 'datetime' | 'boolean' | 'mixed'
    n_total: int
    n_non_null: int
    n_unique: int
    sample_values: list[Any]
    # Numeric-only fields:
    min_value: Any = None
    max_value: Any = None
    mean: Any = None
    median: Any = None
    stddev: Any = None
    # String-only fields:
    min_length: Any = None
    max_length: Any = None
    # Datetime-only fields:
    earliest: Any = None
    latest: Any = None


# ---------- Loading ----------

def load_data(path: str, sample: int | None = None) -> pd.DataFrame:
    """Load a tabular file, dispatching on extension."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    ext = p.suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(p, low_memory=False)
    elif ext == ".tsv":
        df = pd.read_csv(p, sep="\t", low_memory=False)
    elif ext in (".xlsx", ".xls", ".xlsm"):
        # Read every sheet and concatenate, tagging rows with their source sheet.
        # Defaulting to sheet 0 silently drops data in multi-sheet workbooks
        # (e.g. one sheet per region/month), which hides pileups that only
        # become visible when aggregated across sheets.
        sheets = pd.read_excel(p, sheet_name=None)
        if len(sheets) == 1:
            df = next(iter(sheets.values()))
        else:
            frames = []
            for sheet_name, sheet_df in sheets.items():
                sheet_df = sheet_df.copy()
                sheet_df.insert(0, "__sheet__", sheet_name)
                frames.append(sheet_df)
            df = pd.concat(frames, ignore_index=True, sort=False)
    elif ext == ".parquet":
        df = pd.read_parquet(p)
    elif ext in (".json", ".jsonl", ".ndjson"):
        try:
            df = pd.read_json(p, lines=ext in (".jsonl", ".ndjson"))
        except ValueError:
            # Try the other orientation
            df = pd.read_json(p, lines=ext == ".json")
    else:
        raise ValueError(f"Unsupported file extension: {ext}")
    if sample is not None and len(df) > sample:
        df = df.sample(n=sample, random_state=0).reset_index(drop=True)
    return df


# ---------- Profiling ----------

def infer_semantic(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_float_dtype(series):
        return "float"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    # Try to parse as datetime
    non_null = series.dropna().astype(str).head(50)
    if len(non_null) >= 5:
        parsed = pd.to_datetime(non_null, errors="coerce", utc=False)
        if parsed.notna().mean() > 0.8:
            return "datetime"
    # Try to parse as numeric
    if len(non_null) >= 5:
        coerced = pd.to_numeric(non_null, errors="coerce")
        if coerced.notna().mean() > 0.8:
            # Check if all integers
            if coerced.dropna().apply(lambda x: float(x).is_integer()).all():
                return "integer"
            return "float"
    return "string"


def profile_column(series: pd.Series) -> ColumnProfile:
    semantic = infer_semantic(series)
    non_null = series.dropna()
    prof = ColumnProfile(
        name=str(series.name),
        dtype=str(series.dtype),
        inferred_semantic=semantic,
        n_total=len(series),
        n_non_null=len(non_null),
        n_unique=non_null.nunique(),
        sample_values=non_null.head(5).tolist(),
    )
    if semantic in ("integer", "float"):
        numeric = pd.to_numeric(series, errors="coerce").dropna()
        if len(numeric) > 0:
            prof.min_value = float(numeric.min())
            prof.max_value = float(numeric.max())
            prof.mean = float(numeric.mean())
            prof.median = float(numeric.median())
            prof.stddev = float(numeric.std()) if len(numeric) > 1 else 0.0
    elif semantic == "string":
        lengths = non_null.astype(str).str.len()
        if len(lengths) > 0:
            prof.min_length = int(lengths.min())
            prof.max_length = int(lengths.max())
    elif semantic == "datetime":
        parsed = pd.to_datetime(series, errors="coerce").dropna()
        if len(parsed) > 0:
            prof.earliest = str(parsed.min())
            prof.latest = str(parsed.max())
    return prof


# ---------- Cap checks ----------

def check_numeric_caps(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if len(numeric) < 10:
        return findings
    n = len(numeric)

    # Exact-match cap detection. The core rule: a cap is only a cap if the column's
    # extreme reaches it. Without this check, every sequentially-numbered column would
    # trigger on 127 and 255 simply because those values appear as normal IDs.
    counter = Counter(numeric.tolist())
    col_max = float(numeric.max())
    col_min = float(numeric.min())

    for cap in INTEGER_CAPS:
        v = cap["value"]
        # Distinguish positive ceilings (max should touch them) from negative floors
        # (min should touch them). Use a small relative tolerance to catch off-by-one
        # wrap artefacts around the boundary.
        if v > 0:
            reached = abs(col_max - v) <= max(2, abs(v) * 1e-6)
        elif v < 0:
            reached = abs(col_min - v) <= max(2, abs(v) * 1e-6)
        else:
            continue

        if not reached:
            continue

        # Count exact matches and near-matches (±1) — these together are the saturation signal.
        # Note: Python treats int and float with the same value as equal dict keys
        # (hash(838) == hash(838.0)), so we look each value up once, not twice.
        hits_exact = counter.get(v, 0)
        hits_near = sum(counter.get(v + d, 0) for d in (-1, 1))
        total = hits_exact + hits_near
        if total == 0:
            continue

        frac = total / n
        # Severity scales with how much of the column piled up at the ceiling.
        # Even a single row pinned at a storage maximum is noteworthy (the max of a
        # natural distribution doesn't normally land precisely on a type ceiling);
        # large fractions are near-certain saturation.
        if frac >= 0.01:
            severity = "HIGH"
        elif hits_exact >= 5 or frac >= 0.001:
            severity = "MEDIUM"
        else:
            severity = "LOW"
        findings.append(Finding(
            column=profile.name,
            category="cap",
            severity=severity,
            summary=(
                f"{total} rows ({frac:.2%}) at or adjacent to {v} "
                f"({cap['name']}) — consistent with type saturation."
            ),
            detail={
                "cap_value": v,
                "cap_name": cap["name"],
                "exact_matches": hits_exact,
                "near_matches": hits_near,
                "fraction_of_column": round(frac, 6),
                "column_max": col_max,
                "column_min": col_min,
            },
        ))

    # Sentinel detection (separate from caps: these are semantic placeholders, not overflow).
    for sent in NUMERIC_SENTINELS:
        v = sent["value"]
        hits = counter.get(v, 0) + counter.get(float(v), 0)
        if hits == 0:
            continue
        frac = hits / n
        # Sentinels are only interesting if they're a significant fraction or count.
        if hits < 3 and frac < 0.01:
            continue
        severity = "MEDIUM" if frac >= 0.02 else "LOW"
        findings.append(Finding(
            column=profile.name,
            category="sentinel",
            severity=severity,
            summary=(
                f"{hits} rows ({frac:.2%}) at value {v} "
                f"({sent['name']}) — likely missing/unknown placeholder, not a real value."
            ),
            detail={
                "sentinel_value": v,
                "sentinel_name": sent["name"],
                "count": hits,
                "fraction_of_column": round(frac, 6),
            },
        ))

    return findings


def check_string_length_caps(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    non_null = series.dropna().astype(str)
    if len(non_null) < 10:
        return findings
    lengths = non_null.str.len()
    n = len(lengths)
    max_len = int(lengths.max())
    length_counter = Counter(lengths.tolist())

    # A string-length cap only applies when the column's longest string is AT the cap.
    # Without this check, any column of varied-length text will incidentally have some
    # rows at 100, 140, 255 chars and get spuriously flagged.
    for cap in STRING_LENGTH_CAPS:
        v = cap["value"]
        if max_len != v:
            continue
        hits = length_counter.get(v, 0)
        if hits == 0:
            continue
        frac = hits / n
        # Skip fixed-length fields (UUIDs, hashes) where ALL values are this length —
        # that's a schema, not a truncation.
        if hits == n:
            continue
        # Check whether the pinned strings end mid-word — the smoking gun for truncation.
        pinned = non_null[lengths == v]
        mid_word_frac = 0.0
        if len(pinned) > 0:
            sample = pinned.head(50)
            mid_word_frac = float(sample.str.match(r".*[A-Za-z0-9]$").mean())
        if frac >= 0.02:
            severity = "HIGH" if mid_word_frac >= 0.5 else "MEDIUM"
        elif frac >= 0.005 or hits >= 5:
            severity = "MEDIUM" if mid_word_frac >= 0.5 else "LOW"
        else:
            continue
        findings.append(Finding(
            column=profile.name,
            category="cap",
            severity=severity,
            summary=(
                f"{hits} rows ({frac:.2%}) have string length exactly {v} "
                f"({cap['name']}) — consistent with {cap['name']} truncation."
            ),
            detail={
                "cap_length": v,
                "cap_name": cap["name"],
                "count": hits,
                "fraction_of_column": round(frac, 6),
                "mid_word_termination_fraction": round(mid_word_frac, 3),
                "example_values": pinned.head(3).tolist(),
            },
        ))
    return findings


def check_date_sentinels(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    parsed = pd.to_datetime(series, errors="coerce").dropna()
    if len(parsed) < 10:
        return findings
    n = len(parsed)
    # Group by date (ignoring time component).
    date_only = parsed.dt.date.astype(str)
    counter = Counter(date_only.tolist())
    for sent in DATE_SENTINELS:
        v = sent["value"]
        hits = counter.get(v, 0)
        if hits == 0:
            continue
        frac = hits / n
        if hits < 3 and frac < 0.005:
            continue
        if frac >= 0.02:
            severity = "HIGH"
        elif frac >= 0.005:
            severity = "MEDIUM"
        else:
            severity = "LOW"
        findings.append(Finding(
            column=profile.name,
            category="cap" if "overflow" in sent["name"].lower() or "epoch" in sent["name"].lower() else "sentinel",
            severity=severity,
            summary=(
                f"{hits} rows ({frac:.2%}) at date {v} "
                f"({sent['name']})."
            ),
            detail={
                "date_value": v,
                "sentinel_name": sent["name"],
                "count": hits,
                "fraction_of_column": round(frac, 6),
            },
        ))
    # Check for MySQL TIME cap specifically - values at or near ±838:59:59 stored as
    # strings. The integer-form manifestation (838 returned by HOUR(SEC_TO_TIME(...)))
    # is handled by check_domain_caps on the numeric series.
    raw = series.dropna().astype(str)
    time_pattern = re.compile(r"^-?8[34]\d:\d\d:\d\d$")
    time_hits = raw.str.match(time_pattern).sum()
    if time_hits > 0:
        frac = time_hits / len(raw)
        findings.append(Finding(
            column=profile.name,
            category="cap",
            severity="HIGH" if frac > 0.01 else "MEDIUM",
            summary=(
                f"{time_hits} rows ({frac:.2%}) appear to be at or near MySQL TIME's ±838:59:59 cap. "
                f"Consistent with storing a duration longer than the TIME type can hold."
            ),
            detail={"count": int(time_hits), "fraction_of_column": round(float(frac), 6)},
        ))
    return findings


def check_domain_caps(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    """Pileup-based check against DOMAIN_CAPS.

    Unlike check_numeric_caps, this fires even when col.max is well above the cap
    value — the scenario where a type overflow is extracted into a downstream field
    (e.g. HOUR(SEC_TO_TIME(SUM(…))) = 838 when the underlying MySQL TIME saturated)
    and only *some* rows hit the ceiling. Relies on (a) a notable pileup at the
    exact cap value, and optionally (b) a column name that hints at the domain.
    """
    findings: list[Finding] = []
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if len(numeric) < 10:
        return findings
    n = len(numeric)
    counter = Counter(numeric.tolist())
    col_name_lower = str(profile.name).lower()

    for cap in DOMAIN_CAPS:
        v = cap["value"]
        min_hits = int(cap.get("min_hits", 3))
        # Python hashes 838 == 838.0, so Counter stores them under one key.
        # Looking up both int and float forms would double-count.
        hits = counter.get(v, 0)
        if hits < min_hits:
            continue
        frac = hits / n
        name_match = any(h in col_name_lower for h in cap.get("name_hints", []))
        # Require either a name hint or a meaningful fraction of the column to
        # avoid flagging coincidental repeats (e.g. a count column that legitimately
        # has a few 838s).
        if not name_match and frac < 0.01:
            continue
        # Severity: scales with pileup strength and whether the column name
        # corroborates the hypothesis.
        if frac >= 0.05 or (name_match and frac >= 0.02):
            severity = "HIGH"
        elif frac >= 0.02 or hits >= 5:
            severity = "MEDIUM"
        else:
            severity = "LOW"
        findings.append(Finding(
            column=profile.name,
            category="cap",
            severity=severity,
            summary=(
                f"{hits} rows ({frac:.2%}) at exact value {v} "
                f"({cap['name']})"
                f"{' — column name suggests duration/hours' if name_match else ''}."
            ),
            detail={
                "cap_value": v,
                "cap_name": cap["name"],
                "exact_matches": hits,
                "fraction_of_column": round(frac, 6),
                "column_name_matched_hint": name_match,
                "column_max": float(numeric.max()),
            },
        ))
    return findings


# ---------- Benford ----------

def first_digit(x: float) -> int | None:
    if x == 0 or not math.isfinite(x):
        return None
    s = f"{abs(x):.15g}"
    for ch in s:
        if ch.isdigit() and ch != "0":
            return int(ch)
    return None


def second_digit(x: float) -> int | None:
    if x == 0 or not math.isfinite(x):
        return None
    s = f"{abs(x):.15g}"
    seen_nonzero = False
    for ch in s:
        if not ch.isdigit():
            continue
        if not seen_nonzero:
            if ch != "0":
                seen_nonzero = True
            continue
        return int(ch)
    return None


def last_digit(x: float) -> int | None:
    if not math.isfinite(x):
        return None
    # Integer part's last digit.
    n = int(abs(round(x)))
    return n % 10


def mad_score(observed_counts: dict[int, int], expected_probs: dict[int, float], total: int) -> float:
    if total == 0:
        return 0.0
    return sum(abs(observed_counts.get(d, 0) / total - p) for d, p in expected_probs.items()) / len(expected_probs)


def nigrini_label(mad: float, test: str) -> str:
    # First-digit cutoffs per Nigrini.
    if test == "first":
        if mad <= 0.006: return "close conformity"
        if mad <= 0.012: return "acceptable conformity"
        if mad <= 0.015: return "marginal"
        return "nonconforming"
    # Second-digit cutoffs (looser than first-digit but same order of magnitude).
    if test == "second":
        if mad <= 0.008: return "close conformity"
        if mad <= 0.012: return "acceptable conformity"
        if mad <= 0.017: return "marginal"
        return "nonconforming"
    # First-two-digits cutoffs per Nigrini (tighter).
    if test == "first-two":
        if mad <= 0.0012: return "close conformity"
        if mad <= 0.0018: return "acceptable conformity"
        if mad <= 0.0022: return "marginal"
        return "nonconforming"
    return "unknown"


def benford_appropriate(series: pd.Series, profile: ColumnProfile) -> tuple[bool, str]:
    """Conservative check: is Benford's Law even expected to hold for this column?

    Returns (appropriate, reason_if_not).
    """
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    positives = numeric[numeric > 0]
    if len(positives) < 300:
        return False, f"only {len(positives)} positive values (Benford needs ~300+ to be meaningful)"
    mn, mx = positives.min(), positives.max()
    if mn <= 0 or mx <= 0:
        return False, "no positive values"
    ratio = mx / mn
    if ratio < 10:
        return False, f"range spans less than one order of magnitude (max/min = {ratio:.1f})"
    # Column names that obviously aren't Benford-appropriate.
    lname = profile.name.lower()
    bad_names = ("id", "zip", "postcode", "postal", "age", "year", "rating", "score",
                 "percent", "pct", "ratio", "phone", "ssn")
    if any(bn in lname for bn in bad_names):
        return False, f"column name suggests non-Benford semantics ('{profile.name}')"
    return True, ""


def check_benford(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    appropriate, reason = benford_appropriate(series, profile)
    if not appropriate:
        # Emit a NOTE so the report makes clear we didn't run the test.
        findings.append(Finding(
            column=profile.name,
            category="benford",
            severity="LOW",
            summary=f"Benford's Law not applied: {reason}.",
            detail={"skipped": True, "reason": reason},
        ))
        return findings

    numeric = pd.to_numeric(series, errors="coerce").dropna()
    positives = numeric[numeric > 0]
    n_pos = len(positives)

    # First-digit test.
    first_digits = [d for d in positives.map(first_digit) if d is not None]
    fd_counter = Counter(first_digits)
    fd_mad = mad_score(fd_counter, BENFORD_1, len(first_digits))
    fd_label = nigrini_label(fd_mad, "first")

    severity = {
        "close conformity": "LOW",
        "acceptable conformity": "LOW",
        "marginal": "MEDIUM",
        "nonconforming": "HIGH",
    }[fd_label]
    # Dampen severity if sample is borderline-small.
    if n_pos < 1000 and severity == "HIGH":
        severity = "MEDIUM"

    # Most over-represented digit
    observed_pct = {d: fd_counter.get(d, 0) / len(first_digits) for d in range(1, 10)}
    deltas = {d: observed_pct[d] - BENFORD_1[d] for d in range(1, 10)}
    worst_over = max(deltas, key=lambda d: deltas[d])
    worst_under = min(deltas, key=lambda d: deltas[d])

    findings.append(Finding(
        column=profile.name,
        category="benford",
        severity=severity if fd_label not in ("close conformity", "acceptable conformity") else "LOW",
        summary=(
            f"Benford first-digit MAD = {fd_mad:.4f} → {fd_label}. "
            f"Over-represented: digit {worst_over} ({observed_pct[worst_over]:.1%} vs Benford {BENFORD_1[worst_over]:.1%}). "
            f"Under-represented: digit {worst_under} ({observed_pct[worst_under]:.1%} vs Benford {BENFORD_1[worst_under]:.1%})."
        ),
        detail={
            "test": "benford_first_digit",
            "mad": round(fd_mad, 5),
            "nigrini_label": fd_label,
            "n_values": n_pos,
            "observed_pct": {str(k): round(v, 4) for k, v in observed_pct.items()},
            "expected_pct": {str(k): round(v, 4) for k, v in BENFORD_1.items()},
        },
    ))

    # Second-digit test (needs more data).
    if n_pos >= 500:
        second_digits = [d for d in positives.map(second_digit) if d is not None]
        if len(second_digits) >= 500:
            sd_counter = Counter(second_digits)
            sd_mad = mad_score(sd_counter, BENFORD_2, len(second_digits))
            sd_label = nigrini_label(sd_mad, "second")
            sd_severity = {
                "close conformity": "LOW",
                "acceptable conformity": "LOW",
                "marginal": "MEDIUM",
                "nonconforming": "HIGH" if n_pos >= 2000 else "MEDIUM",
            }[sd_label]
            findings.append(Finding(
                column=profile.name,
                category="benford",
                severity=sd_severity if sd_label not in ("close conformity", "acceptable conformity") else "LOW",
                summary=f"Benford second-digit MAD = {sd_mad:.4f} → {sd_label}.",
                detail={
                    "test": "benford_second_digit",
                    "mad": round(sd_mad, 5),
                    "nigrini_label": sd_label,
                    "n_values": len(second_digits),
                },
            ))

    return findings


def check_last_digit_uniformity(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    """Last digit of integers should be approximately uniform (10% each)."""
    findings: list[Finding] = []
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    # Only meaningful for columns where values span a reasonable range and aren't flags.
    if len(numeric) < 500:
        return findings
    if numeric.nunique() < 30:
        return findings
    if numeric.max() - numeric.min() < 100:
        return findings
    last_digits = [d for d in numeric.map(last_digit) if d is not None]
    n = len(last_digits)
    if n == 0:
        return findings
    counter = Counter(last_digits)
    observed = {d: counter.get(d, 0) / n for d in range(10)}
    expected = 0.1
    # Deviation per digit.
    deltas = {d: observed[d] - expected for d in range(10)}

    # Notable-rounding signal: excess at 0 and 5.
    round_excess = (observed[0] - expected) + (observed[5] - expected)
    # Notable-fabrication signal: excess at 7, deficit at 0.
    seven_excess = observed[7] - expected
    zero_deficit = expected - observed[0]

    if round_excess > 0.10 and observed[0] > 0.15:
        severity = "HIGH" if observed[0] > 0.3 else "MEDIUM"
        findings.append(Finding(
            column=profile.name,
            category="last_digit",
            severity=severity,
            summary=(
                f"Last digit 0 appears in {observed[0]:.1%} and 5 in {observed[5]:.1%} "
                f"(expected ~10% each). Consistent with rounding in recording, not fabrication; "
                f"reduces confidence in sub-ten precision of values."
            ),
            detail={
                "test": "last_digit_rounding",
                "observed_pct": {str(k): round(v, 4) for k, v in observed.items()},
                "n_values": n,
            },
        ))
    elif seven_excess > 0.02 and zero_deficit > 0.015:
        findings.append(Finding(
            column=profile.name,
            category="last_digit",
            severity="MEDIUM",
            summary=(
                f"Last digit 7 is over-represented ({observed[7]:.1%}, expected 10%) "
                f"while 0 is under-represented ({observed[0]:.1%}). This pattern matches "
                f"human 'random' number fabrication (people pick 7 because it feels random, and "
                f"avoid 0 because it feels round)."
            ),
            detail={
                "test": "last_digit_human_fabrication",
                "observed_pct": {str(k): round(v, 4) for k, v in observed.items()},
                "n_values": n,
            },
        ))
    else:
        # No notable deviation: report as clean.
        max_abs_delta = max(abs(v) for v in deltas.values())
        if max_abs_delta < 0.02:
            findings.append(Finding(
                column=profile.name,
                category="last_digit",
                severity="LOW",
                summary=f"Last-digit distribution is close to uniform (max deviation {max_abs_delta:.1%}). No rounding or fabrication signal.",
                detail={
                    "test": "last_digit_uniformity",
                    "observed_pct": {str(k): round(v, 4) for k, v in observed.items()},
                    "n_values": n,
                    "clean": True,
                },
            ))

    return findings


# ---------- Fingerprints ----------

def check_string_fingerprints(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    non_null = series.dropna().astype(str)
    if len(non_null) == 0:
        return findings
    n = len(non_null)
    lower = non_null.str.lower()
    hit_summary: dict[str, dict[str, Any]] = {}
    for fp in STRING_FINGERPRINTS:
        mask = lower.str.contains(re.escape(fp["pattern"]), regex=True, na=False)
        hits = int(mask.sum())
        if hits > 0:
            hit_summary[fp["pattern"]] = {
                "name": fp["name"],
                "count": hits,
                "fraction": hits / n,
                "examples": non_null[mask].head(3).tolist(),
            }
    if hit_summary:
        total_hits = sum(h["count"] for h in hit_summary.values())
        total_frac = total_hits / n
        severity = "HIGH" if total_frac >= 0.001 else "MEDIUM"
        findings.append(Finding(
            column=profile.name,
            category="fingerprint",
            severity=severity,
            summary=(
                f"Found {total_hits} synthetic-data fingerprints ({total_frac:.2%} of rows): "
                + ", ".join(sorted(hit_summary.keys()))
                + ". These substrings are reserved for testing/fiction and do not appear in real production data."
            ),
            detail={"fingerprints": hit_summary, "n_total": n},
        ))

    # SSN-specific checks.
    ssn_pattern = re.compile(r"^\s*\d{3}[-\s]?\d{2}[-\s]?\d{4}\s*$")
    ssn_mask = non_null.str.match(ssn_pattern, na=False)
    if ssn_mask.sum() >= 10:  # column looks SSN-like
        ssn_vals = non_null[ssn_mask]
        invalid_area = ssn_vals.str.match(INVALID_SSN_AREA_RE, na=False).sum()
        well_known = ssn_vals.isin(KNOWN_FAKE_SSNS).sum()
        bad_total = int(invalid_area + well_known)
        if bad_total > 0:
            findings.append(Finding(
                column=profile.name,
                category="fingerprint",
                severity="HIGH",
                summary=(
                    f"{bad_total} invalid or well-known-fake SSN values "
                    f"(area 000/666/9xx or values like 123-45-6789)."
                ),
                detail={
                    "invalid_area_count": int(invalid_area),
                    "known_fake_count": int(well_known),
                },
            ))

    return findings


# ---------- Duplicates ----------

def check_duplicates(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    non_null = series.dropna()
    n = len(non_null)
    if n < 200:
        return findings
    # A single value dominating the column.
    counts = non_null.value_counts()
    top_value = counts.index[0]
    top_count = int(counts.iloc[0])
    top_frac = top_count / n
    # Flag only if the domination is surprising for a column of this nominal type.
    # (For ID-like columns, domination is always surprising. For flag columns, it's not.)
    if profile.inferred_semantic in ("integer", "float", "string") and profile.n_unique > 20:
        if top_frac > 0.10 and top_frac < 0.95:
            # Special-case: the dominant value is already flagged as a sentinel/cap, don't double-report.
            already_flagged_values = set()
            findings.append(Finding(
                column=profile.name,
                category="duplicate",
                severity="MEDIUM" if top_frac > 0.25 else "LOW",
                summary=(
                    f"Single value {top_value!r} accounts for {top_frac:.1%} ({top_count} of {n}) "
                    f"of this column. Investigate whether this is a placeholder, a default, or an "
                    f"artefact rather than a genuine value."
                ),
                detail={
                    "dominant_value": str(top_value),
                    "count": top_count,
                    "fraction": round(top_frac, 4),
                },
            ))
    return findings


# ---------- Timestamp regularity ----------

def check_timestamp_regularity(series: pd.Series, profile: ColumnProfile) -> list[Finding]:
    findings: list[Finding] = []
    parsed = pd.to_datetime(series, errors="coerce").dropna()
    n = len(parsed)
    if n < 100:
        return findings
    # Check for zero-seconds fraction.
    zero_sec = (parsed.dt.second == 0).mean()
    # If the original resolution is minute-level, zero-seconds is expected to be 100%.
    # If it's second-level (non-zero seconds present), the expected fraction is ~1.67%.
    if 0.04 <= zero_sec < 0.95:
        findings.append(Finding(
            column=profile.name,
            category="timestamp",
            severity="MEDIUM" if zero_sec > 0.20 else "LOW",
            summary=(
                f"{zero_sec:.1%} of timestamps have :00 seconds (expected ~1.67% for second-precision data). "
                f"Suggests mixed-precision source or partial manual entry."
            ),
            detail={"zero_seconds_fraction": round(float(zero_sec), 4), "n_values": n},
        ))
    # Zero-microsecond / zero-millisecond check.
    if parsed.dt.microsecond.sum() == 0 and (parsed.dt.second != 0).any():
        # Expected if the source has second precision; no finding.
        pass
    # Missing weekends check: only run for columns spanning >= 4 weeks.
    span_days = (parsed.max() - parsed.min()).days
    if span_days >= 28:
        weekend_frac = parsed.dt.dayofweek.isin([5, 6]).mean()
        if weekend_frac < 0.05:
            findings.append(Finding(
                column=profile.name,
                category="timestamp",
                severity="MEDIUM",
                summary=(
                    f"Only {weekend_frac:.1%} of timestamps fall on weekends "
                    f"(expected ~28.6% for uniform distribution). Either this is business-hours data "
                    f"(innocent) or fabricated data that didn't model weekends."
                ),
                detail={"weekend_fraction": round(float(weekend_frac), 4), "span_days": span_days},
            ))
    return findings


# ---------- Orchestration ----------

def analyse_column(series: pd.Series, options: dict[str, bool]) -> tuple[ColumnProfile, list[Finding]]:
    profile = profile_column(series)
    findings: list[Finding] = []
    if options["caps"]:
        if profile.inferred_semantic in ("integer", "float"):
            findings.extend(check_numeric_caps(series, profile))
            findings.extend(check_domain_caps(series, profile))
        elif profile.inferred_semantic == "string":
            findings.extend(check_string_length_caps(series, profile))
            # Strings that happen to be numeric (e.g. mixed columns) should still get
            # the domain-cap pileup check — hours are sometimes exported as text.
            findings.extend(check_domain_caps(series, profile))
        elif profile.inferred_semantic == "datetime":
            findings.extend(check_date_sentinels(series, profile))
    if options["fabrication"]:
        if profile.inferred_semantic in ("integer", "float"):
            if options["benford"]:
                findings.extend(check_benford(series, profile))
            findings.extend(check_last_digit_uniformity(series, profile))
            findings.extend(check_duplicates(series, profile))
        elif profile.inferred_semantic == "string":
            findings.extend(check_string_fingerprints(series, profile))
            findings.extend(check_duplicates(series, profile))
        elif profile.inferred_semantic == "datetime":
            findings.extend(check_timestamp_regularity(series, profile))
    return profile, findings


# ---------- Reporting ----------

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


def render_text_report(
    path: str,
    profiles: list[ColumnProfile],
    all_findings: list[Finding],
    df_shape: tuple[int, int],
) -> str:
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append("BAD DATA ANALYSER — REPORT")
    lines.append("=" * 72)
    lines.append(f"File:       {path}")
    lines.append(f"Shape:      {df_shape[0]} rows × {df_shape[1]} columns")
    lines.append("")

    # Sort findings by severity then column.
    sorted_findings = sorted(
        all_findings,
        key=lambda f: (SEVERITY_ORDER.get(f.severity, 99), f.column, f.category),
    )

    # Top-level summary.
    by_sev: dict[str, int] = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in all_findings:
        # Don't count LOW "skipped Benford" and clean-column notices as real findings.
        if f.severity == "LOW" and f.detail.get("skipped") or f.detail.get("clean"):
            continue
        by_sev[f.severity] = by_sev.get(f.severity, 0) + 1

    lines.append("SUMMARY")
    lines.append("-" * 72)
    lines.append(f"  HIGH-severity findings:   {by_sev['HIGH']}")
    lines.append(f"  MEDIUM-severity findings: {by_sev['MEDIUM']}")
    lines.append(f"  LOW-severity findings:    {by_sev['LOW']}")
    lines.append("")

    # Group findings by column.
    per_column: dict[str, list[Finding]] = {}
    for f in sorted_findings:
        per_column.setdefault(f.column, []).append(f)

    lines.append("FINDINGS BY COLUMN")
    lines.append("=" * 72)
    for profile in profiles:
        cfs = per_column.get(profile.name, [])
        # Decide what we print: if there are any non-trivial findings, print the column.
        nontrivial = [f for f in cfs if not (f.detail.get("skipped") or f.detail.get("clean"))]
        if not nontrivial and not cfs:
            continue
        lines.append("")
        lines.append(f"Column: {profile.name}")
        lines.append(f"  semantic type: {profile.inferred_semantic} (pandas dtype: {profile.dtype})")
        lines.append(f"  rows: {profile.n_non_null} non-null of {profile.n_total}, {profile.n_unique} unique")
        if profile.inferred_semantic in ("integer", "float"):
            lines.append(
                f"  range: min={profile.min_value!r}  max={profile.max_value!r}  "
                f"mean={profile.mean:.4g}  stddev={profile.stddev:.4g}"
                if profile.mean is not None else "  range: (no numeric values)"
            )
        elif profile.inferred_semantic == "string":
            lines.append(f"  length: min={profile.min_length}  max={profile.max_length}")
        elif profile.inferred_semantic == "datetime":
            lines.append(f"  range: {profile.earliest}  →  {profile.latest}")
        for f in cfs:
            marker = {"HIGH": "[!]", "MEDIUM": "[*]", "LOW": "[ ]"}[f.severity]
            lines.append(f"  {marker} {f.severity:<6} {f.category:<12} {f.summary}")

    # Columns with nothing to report.
    clean_columns = [p.name for p in profiles if p.name not in per_column or all(
        f.detail.get("skipped") or f.detail.get("clean") for f in per_column[p.name]
    )]
    if clean_columns:
        lines.append("")
        lines.append("COLUMNS WITH NO ANOMALIES FOUND")
        lines.append("-" * 72)
        # Wrap nicely.
        line = "  "
        for c in clean_columns:
            if len(line) + len(c) + 2 > 72:
                lines.append(line)
                line = "  "
            line += c + ", "
        if line.strip():
            lines.append(line.rstrip(", "))

    lines.append("")
    lines.append("=" * 72)
    lines.append("Notes:")
    lines.append("  - A finding is not a conclusion; it is a starting point for investigation.")
    lines.append("  - Cap findings (rows pinned at a type ceiling) are nearly always real issues.")
    lines.append("  - Benford findings require verifying the column is Benford-appropriate.")
    lines.append("  - See references/interpretation.md for how to phrase findings honestly.")
    lines.append("=" * 72)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Forensic bad-data analyser.")
    parser.add_argument("path", help="Path to data file (csv, tsv, xlsx, parquet, json).")
    parser.add_argument("--column", action="append", help="Limit to this column (repeatable).")
    parser.add_argument("--sample", type=int, default=None, help="Randomly subsample to N rows.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text report.")
    parser.add_argument("--no-benford", action="store_true", help="Skip Benford tests.")
    parser.add_argument("--no-caps", action="store_true", help="Skip cap checks.")
    parser.add_argument("--no-fabrication", action="store_true", help="Skip fabrication checks.")
    args = parser.parse_args()

    options = {
        "benford": not args.no_benford,
        "caps": not args.no_caps,
        "fabrication": not args.no_fabrication,
    }

    try:
        df = load_data(args.path, sample=args.sample)
    except Exception as e:
        sys.stderr.write(f"Error loading data: {e}\n")
        return 2

    columns = args.column if args.column else list(df.columns)
    missing = [c for c in columns if c not in df.columns]
    if missing:
        sys.stderr.write(f"Columns not found in data: {missing}\n")
        return 2

    profiles: list[ColumnProfile] = []
    all_findings: list[Finding] = []
    for col in columns:
        profile, findings = analyse_column(df[col], options)
        profiles.append(profile)
        all_findings.extend(findings)

    if args.json:
        output = {
            "file": args.path,
            "shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
            "profiles": [asdict(p) for p in profiles],
            "findings": [asdict(f) for f in all_findings],
        }
        print(json.dumps(output, indent=2, default=str))
    else:
        print(render_text_report(args.path, profiles, all_findings, df.shape))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
