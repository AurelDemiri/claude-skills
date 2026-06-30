# Filament v4 Upgrade Workflows — Comparison & Recommendation

_Comparison of the two multi-agent `Workflow` scripts in `.claude/workflows/`._

- **`filament-v4-polish.mjs`** — authored and **executed** in this session. Purpose: autonomously **audit → adversarially verify → fix → gate-verify** a *mostly-complete* v3→v4 upgrade.
- **`filament-v4-upgrade.js`** — pre-existing workflow, paired with the 78 KB `filament-v4-upgrade-guide.md` (the 29-pattern catalog). Purpose: drive a **full** v3→v4 upgrade from a v3 baseline, phase by phase.

**How this was evaluated:** two independent reviewers (one on **Opus 4.8**, one on **Sonnet 4.6**) reviewed both scripts against the same rubric, blind to each other. Their concrete claims were then fact-checked against the installed tooling (notably the Pint flag claim, which turned out to be a false positive — see Bugs §).

---

## TL;DR — Verdict

> **As a piece of software, `filament-v4-polish.mjs` is the better-engineered workflow — both reviewers agreed, with high confidence.** It is the only one of the two that actually exploits the orchestration engine (parallel fan-out, JSON-schema-validated hand-offs, dedup, adversarial verification, a gated self-heal loop). **`filament-v4-upgrade.js` is the better _document_:** it carries far richer domain knowledge (the full 29-pattern catalog, package matrix, Shield/permission/tenant specifics) and is written to be reused across repos — but as a _program_ it is six sequential `agent()` calls with no schemas, no fan-out, no in-code gating, and no recovery.

They also solve **different problems** (full upgrade vs. polishing a near-done one), so it is not a pure apples-to-apples contest. The recommendation (below) is to **keep `polish.mjs` as the engine and harvest `upgrade.js`'s catalog + reusability into it.**

> _"`upgrade.js` is the better document; `polish.mjs` is the better program."_ — Opus reviewer

---

## Dimension-by-dimension

| Dimension | Winner | Why |
|---|---|---|
| Phase structure & decomposition | **polish** | 7 fine-grained phases (inventory → audit → verify → plan → implement → gate → repair) vs. 6 coarse runbook phases |
| Parallelism strategy | **polish** | 14-way audit fan-out + a concurrent baseline gate; `upgrade.js` is 100% serial (6 `await`s in a row) |
| File-mutation safety | **polish** | Audit phase is explicitly read-only; mutation is a strict sequential `for…of` loop — zero clobber risk, no worktrees needed |
| Verification rigor | **polish** | Adversarial per-finding verifier (skeptical default) + cross-dimension dedup + severity gating; `upgrade.js` has no verification layer |
| Autonomy & self-healing | **polish** | Bounded 2-round repair loop that re-runs the *whole* gate; `upgrade.js` ends on red |
| Schema / structured output | **polish** | 6–7 JSON schemas drive every hand-off; `upgrade.js` returns untyped text it never inspects |
| Gate correctness (this repo) | **polish** | `ddev`-prefixed everywhere; `upgrade.js` has a bare-`pint` inconsistency in its gate prose |
| Robustness / null handling | **polish** | `.filter(Boolean)`, `?.`/`??` guards throughout; `upgrade.js` ignores all return values |
| **Domain knowledge / completeness** | **upgrade** | Full 29-pattern catalog + Shield/permission-v7/tenant/impersonate specifics verbatim; polish compresses to a ~25-item hint list and leans on the live docs tool |
| **Reusability / parameterization** | **upgrade** | Designed to be copied to any Statik repo + reads an external guide at runtime; polish is hardcoded to PUBMUS. **Neither uses `args`/`budget`.** |
| Scope fit | **tie** | Different jobs: full upgrade vs. polish of a near-done upgrade |

---

## Pros & Cons

### `filament-v4-polish.mjs`

**Pros**
- **Real orchestration.** 14 read-only audit specialists fan out concurrently with a baseline gate running alongside; only then does verification fan out. Exploits the concurrency cap for wall-clock gain.
- **Adversarial verification with skepticism as the default** kills audit false-positives before any code is touched; only medium+ findings pay for the expensive `effort:'high'` verifier, low/info pass through as planner notes.
- **Deterministic dedup in plain JS** (by `file::pattern::symbol`), escalating to the max severity seen — cheap, no agent needed.
- **Tight mutation discipline.** Everything that edits files runs sequentially on the shared tree; the planner is told to keep work-items file-disjoint. Correct application of "use worktree isolation only when parallel agents mutate."
- **Strong gate semantics.** `green` = AND of tests + pint + phpstan + build + crawl; the repair loop re-runs the *entire* gate, avoiding "fixed A, broke B, declared green."
- **DB-contention-aware by design** — only the baseline and final gate touch the DB, and they run alone.
- **Validated hand-offs end to end** — every inter-phase object is schema-checked, consumed null-safely.

**Cons**
- **Hardcoded to PUBMUS** (paths, project name, package pins). No `args`, no `budget` → not reusable without editing; the high-effort verify fan-out is token-uncapped.
- **The panel-crawl test is _authored inside_ the gate agent** — the first gate run both writes and runs `PanelCrawlTest.php`. A buggy generated test reads as a red gate, and the repair loop is then told to "fix the underlying code," not the test.
- **Severity triage happens _before_ verification** — a finding the audit under-rated as `low` skips the verifier and may be deferred; a mis-rated critical could slip the net.
- **`FILAMENT_V4_KNOWLEDGE` is a lossy compression** of the 29-pattern guide (folds Patterns 13/14, drops the Shield `buildPermissionKeyUsing`/separator pin, the spatie-v7 `->role()`→`whereHas` scope, the tenant set-team-restore wrapper, impersonate-v5 event rewiring).
- **No commit step** — leaves a large uncommitted tree (fine for a one-shot polish, weaker for reviewability).
- **Build freshness only checked at the final gate** — a build broken during Implement isn't caught until the end.

### `filament-v4-upgrade.js`

**Pros**
- **Excellent decomposition for a full upgrade:** deps → breaking → tailwind → compat → verify — the correct dependency order (you cannot fix breaking changes before composer resolves).
- **Outstanding, load-bearing domain content** — the prompts embed the full pattern catalog with exact API names, blade components, `fi-*` selectors, config keys, and Shield/permission/tenant/impersonate specifics, and forbid paraphrasing them.
- **Genuinely reusable & self-documenting** — meant to be copied to any Statik repo, reads an external guide at runtime, writes an audit scratch file consumed downstream, and has standing permission to *bootstrap missing gate tooling* (a story polish lacks).
- **Per-phase commit discipline** → reviewable commits, with an explicit "never push/PR" guardrail.
- **Acknowledges the partial-upgrade case** in prose (detect already-applied phases and verify rather than redo).

**Cons**
- **Barely a program.** Six `await agent()` calls in a row with no schema, no result inspection, no branching, no loop, no fan-out. All gating/verification/self-healing is *requested in prose* and left to the sub-agent's discretion — the orchestrator can't tell whether a phase actually went green.
- **Zero parallelism** — even the read-only, embarrassingly-parallel audit runs as one monolithic agent. Worst-case wall-clock.
- **Cross-phase channel is a file on the shared tree** (the audit scratch file) with no existence/freshness/schema check — a stale or unwritten file is consumed silently.
- **No null/death handling** — if an `agent()` returns `null` (died/skipped), nothing detects it; the next phase runs on whatever state the tree is in.
- **One overloaded agent applies all 29 patterns** in a single turn — later patterns are likely to be skipped or hallucinated, with no structured output to detect it.
- **No self-heal / no in-code gate enforcement** — a red gate just ends the run; nothing stops a later phase from mutating a broken tree.

---

## Bugs & risks (with verification status)

### Confirmed
- **`upgrade.js` — silent `null` propagation.** Phases are sequential in *time* but not *conditionally*. If the audit/deps agent dies (`null`) or leaves the tree unresolved, later phases run blind and the workflow still returns a partial object with no error signal.
- **`upgrade.js` — re-runs `php artisan filament:upgrade` in the verify phase.** Phase 1 already ran it; a second Rector pass over migrated code can double-transform or revert manual fixes.
- **`upgrade.js` — single agent applies all 29 patterns.** Context-window pressure makes late-pattern coverage unreliable; no schema to catch the gap.
- **`polish.mjs` — panel-crawl test authored inside the gate.** A buggy generated test → red gate → repair loop chases a non-existent app bug. _Fix: make crawl-test creation an Implement work-item; the gate only runs it._
- **`polish.mjs` — triage-before-verify.** Severity split uses the *audit's* severity, so an under-rated critical can bypass the adversarial verifier and be deferred.
- **`polish.mjs` — null-plan → silent zero-work.** If the planner agent dies, the implement loop iterates an empty list and the run "succeeds" doing nothing, with no log line.

### Minor / nuance
- **`upgrade.js` — bare `vendor/bin/pint` in gate prose** (not `ddev`-prefixed, unlike its other commands). It's instruction text an agent would likely self-correct on a DDEV repo, not executed code — so a low-severity inconsistency rather than a hard break.
- **`polish.mjs` — 15-way concurrent fan-out** (14 audits + baseline) can exceed the `~min(16, cores-2)` cap on low-core machines, serializing and inflating wall-clock. Not a correctness issue.
- **`polish.mjs` — dedup key lowercases the file path** — a latent cross-platform (case-sensitive FS) merge risk; harmless on this macOS/DDEV stack.

### ❌ False positive (corrected during verification)
- **"`vendor/bin/pint --format agent` is an invalid flag"** (raised by the Sonnet reviewer) is **wrong.** Installed Pint **1.29.3 accepts `--format agent`** and emits machine-readable JSON (`{"tool":"pint","result":"passed"}`). It is in fact a *sophisticated* choice in `upgrade.js` — agent-parseable gate output — not a bug. _This is a good reminder to fact-check reviewer findings against the actual toolchain._

---

## Recommendation

**Ship `polish.mjs` as the engine; harvest the best of `upgrade.js` into it.** Concretely, the highest-value merge:

1. **Move panel-crawl-test _authoring_ out of the gate** into a dedicated Implement work-item, so the gate only *executes* it (removes the misattributed-failure risk).
2. **Verify before triage** — route any finding whose *pattern* maps to a fatal/data-loss class (namespace move, signature change, hidden+disabled dehydration, RichEditor JSON state) to the adversarial verifier regardless of the audit's severity; or let the planner, not a pre-filter, decide deferral.
3. **Guard the null-plan path** — if the planner returns null/empty, `log()` it loudly and either bail with `planFailed: true` or enter repair mode, instead of silently doing nothing.
4. **Parameterize via `args` + accept a `budget`** — lift PUBMUS specifics (project name, panel provider path, theme paths, package pins) into config, and cap the high-effort verify/repair fan-out. This closes the one dimension where `upgrade.js` clearly wins.
5. **Fold in the full 29-pattern catalog** (the load-bearing specifics the compressed hint-list lost) — even for a polish pass these are the highest-impact, hardest-to-rediscover items.
6. **Add per-phase/final commit + throw-guards** around the keystone single-agent calls (inventory, plan, gate) so a thrown agent degrades gracefully instead of aborting the run.

For a **from-scratch** upgrade, keep `upgrade.js`'s phase spine (deps → breaking → tailwind → compat → verify) — but re-implement it with `polish.mjs`'s engineering (schemas, fan-out for the read-only audit, in-code gating, self-heal).

---

## Outcome of the run that used `polish.mjs`

For reference, the executed run produced: 4 confirmed fixes (a real `<x-filament::widget>` 500-bug, the Bolt exporter enum-label fix, a Tailwind v4 selector re-anchor, broad render + panel-crawl coverage), and a verified-green gate (PHPStan clean, 109 Pest tests passing, scoped Pint clean, build OK). The repo-wide Pint reformat it initially produced was reverted to preserve `git blame`, and the Pint gate was re-scoped to the upgrade-owned surface (`tests/Feature/Filament/` + `app/Vendor/`).
