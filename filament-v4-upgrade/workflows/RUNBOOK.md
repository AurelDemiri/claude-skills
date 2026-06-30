# Operator runbook — supervising a Filament v4 upgrade run

The upgrade workflows are autonomous but **gated and supervised**. This is the human's guide to
launching one, watching it, and handling the ways it can go sideways. For how the bundle is built see
[`README.md`](./README.md); for adopting it in a new repo see [`ADOPTING.md`](./ADOPTING.md).

## Before you launch

The workflow runs in a background, non-interactive context. It **cannot** do private-repo auth, MCP
setup, or restart Claude Code. Do the [skill](../SKILL.md) bootstrap first
(clean branch, `filament/upgrade`, relax internal deps + `auth.json`, Boost MCP installed **and Claude
Code restarted**, run `vendor/bin/filament-v4`, app boots). The audit/verify subagents depend on the
Boost `search-docs` MCP tool — if the restart wasn't done, findings degrade silently. Don't skip it.

## Launch

```
Workflow({ name: "filament-v4-upgrade-run" })                       # full upgrade
Workflow({ name: "filament-v4-polish" })                           # near-done cleanup
Workflow({ name: "filament-v4-upgrade-run", args: { ...overrides } })   # non-PUBMUS repo
```

`args` shallow-merges over `buildConfig` defaults. It returns immediately with a run id and streams in
the background.

## Watch it

- `/workflows` — live progress tree (phases → agents).
- The `log()` narrator lines report per-phase counts (`breaking-changes: N to verify`, gate results,
  `gate NOT green … not committing`).
- Transcript dir (printed at launch) holds each agent's full transcript if you need to dig in.

## What a run actually does

`filament-v4-upgrade-run` walks five phases; each non-inventory phase runs one **cycle**:

```
auditFanOut(phase dimensions) → dedupe → routeForVerify → verifyFindings (adversarial)
  → planFrom → implementPlan → runGate → selfHeal (≤ maxRepairRounds) → commit IF gate green
```

- **Gating:** a phase commits only when its gate (tests + Pint + analyse + build, plus a panel crawl
  in verification) is green. A red phase logs `… gate NOT green after N repair rounds — not committing`
  and moves on. **One commit per green phase. It never pushes.**
- **routeForVerify:** every medium+ finding, plus any `FATAL_PATTERN_IDS` finding even at low severity,
  goes to an adversarial verifier (default stance: skepticism) before it's allowed into the plan.
- **selfHeal:** up to `cfg.maxRepairRounds` (default 2) attempts to fix a red gate before giving up.

`filament-v4-polish` is the same stages once, over **all** dimensions, committing at the end — for a
repo that's already mostly on v4.

## Resuming after a kill / pause / script edit

Workflows are resumable. Stop the current run first (`TaskStop`), then relaunch with the run id:

```
Workflow({ scriptPath: ".claude/workflows/filament-v4-upgrade.mjs", resumeFromRunId: "wf_…" })
```

The longest unchanged prefix of agent calls returns cached results instantly; the first changed/new
call and everything after it runs live. Same script + same inputs → full cache hit (cheap to resume).

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| A phase logs `gate NOT green … not committing` | Real failures self-heal couldn't fix in `maxRepairRounds` | Inspect that phase's confirmed findings + the gate output; fix by hand, or bump `maxRepairRounds` and re-run just that phase via resume. The phase made **no commit**, so nothing to unwind. |
| Pint wants to reform the whole repo / `git blame` churn | `pintScope` too broad | Set `pintScope` to the upgrade-owned surface only (e.g. `tests/Feature/Filament app/Vendor`). A real run produced a repo-wide reformat that had to be reverted and re-scoped. |
| Findings look thin / generic; verifiers can't confirm API | Boost MCP `search-docs` not live in the run | The restart gate (bootstrap step 6) wasn't satisfied. Restart Claude Code, confirm the MCP tool resolves, re-run. |
| A confirmed finding is actually a false positive | Adversarial verify let it through | Verifiers default to skepticism, but they're not infallible. Review the per-phase commit diff; revert the bad hunk; if a pattern repeats, tighten the relevant card/guide section. |
| Verification phase keeps failing on one resource | A pattern the guide doesn't cover, or a genuinely broken resource | Read the finding's `recommendedFix`/`testStrategy`; fix manually; consider adding a pattern (README → extending the knowledge). |
| Some findings silently "deferred" | Per-finding token budget (`verifyReserveTokens`) exhausted | They're handed to the planner as notes, logged — not lost. Increase the reserve only if you're hitting it and have budget. |

## Reviewing & reverting

Each green phase is **one commit** (`commitPhase`), so the history is auditable phase-by-phase:

```
git log --oneline                 # one commit per green phase
git show <phase-commit>           # review what that phase changed
git revert <phase-commit>         # undo a single phase cleanly
```

After the run: review every phase commit, run the full gate **yourself** once
(`ddev php artisan test --compact`, scoped Pint, `composer analyse`, build), exercise the admin UI,
then decide to push. **The workflow never pushes — that's your call.**

## Cost & runtime expectations

A run scales with **resources × audit dimensions × findings**, so there's no fixed number. Calibration
points from real multi-agent runs on this codebase:

- The `polish` run that's documented produced **4 confirmed fixes** and a verified-green gate
  (PHPStan clean, **109 Pest tests** passing, scoped Pint clean, build OK).
- For order-of-magnitude on agent fan-out/tokens: the *knowledge-extractor* runs (a comparable
  multi-agent Filament workflow) ranged from ~24 agents / ~0.5M tokens / ~40s for a small pass to
  ~237 agents / ~6M tokens / ~12 min for the big classify+extract pass.

Budget on the order of **single-digit dollars to low-tens** and **minutes to tens of minutes** per
run, more for large multi-panel repos. If you set a turn token target, the engine respects
`verifyReserveTokens` and defers overflow to planner notes rather than hard-failing.

## See also

- [`README.md`](./README.md) — how the bundle is built + the dev loop.
- [`ADOPTING.md`](./ADOPTING.md) — vendoring into a new repo.
- [`filament-v4-workflow-comparison.md`](./filament-v4-workflow-comparison.md) — upgrade-run vs polish, and a real run's outcome.
- [`../skills/filament-v4-upgrade/SKILL.md`](../SKILL.md) — the bootstrap the run assumes.
