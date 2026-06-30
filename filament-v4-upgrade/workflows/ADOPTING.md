# Adopting the Filament v4 upgrade bundle in a new repo

This bundle was authored in PUBMUS (the golden source) and is meant to be **vendored** into any
Statik-shaped Laravel repo you want to upgrade. The breaking-change knowledge is framework-level, so
you almost never touch it — adoption is mostly **pointing `buildConfig` at the new repo's shape** and
re-running the build gate.

See [`README.md`](./README.md) for how the bundle is built; this doc is the adopt-it-here checklist.

## 0. Prerequisites in the target repo

- Filament **v3** today (this drives v3 → v4), Laravel 11/12, PHP 8.3.
- A test runner (Pest expected), a formatter (Pint expected), a frontend build (Vite/yarn).
- DDEV is assumed by default but optional (set `ddev: ''` to drop the prefix — see below).
- A clean git tree on a dedicated upgrade branch.

## 1. Copy the bundle

Copy the whole `.claude/workflows/` bundle and the skill into the target repo:

```
.claude/workflows/
  _src/engine.mjs
  _src/filament-v4-upgrade.template.mjs
  _src/filament-v4-polish.template.mjs
  _src/__tests__/assemble.test.mjs
  _src/__tests__/engine.test.mjs
  _assemble.mjs
  _wfcheck.mjs
  filament-v4-upgrade.mjs              # generated (regenerate in step 4)
  filament-v4-polish.mjs               # generated (regenerate in step 4)
  filament-v4-upgrade-guide.md         # the knowledge catalog — reuse as-is
.claude/skills/filament-v4-upgrade/
  SKILL.md
```

The **guide is repo-agnostic** (project names already stripped). Reuse it verbatim. Only re-mine the
knowledge if the target repo has a materially different package set or you hit v4.x changes the guide
predates — see [step 7](#7-optional-re-mine-knowledge-for-this-repo).

## 2. Set `buildConfig` for the new repo

The engine reads its repo shape from `buildConfig(args)` in `_src/engine.mjs`. Two ways to set it:

- **Per-run (non-invasive, recommended for a one-off):** pass overrides as `args` at launch:
  `Workflow({ name: "filament-v4-upgrade-run", args: { projectName: "acme", themeCss: [...] } })`.
  `args` is shallow-merged over the defaults (`Object.assign(defaults, args)`).
- **Permanent (recommended for a vendored copy you'll keep):** edit the defaults in `buildConfig`,
  then regenerate (step 4). This bakes the repo shape into the generated workflows.

Fields, and what to set them to:

| Field | What it is | Set to |
|---|---|---|
| `projectName` | label used in prompts/commits | the repo's short name |
| `ddev` | command prefix for php/composer/artisan/yarn | `'ddev'`, or `''` if not DDEV |
| `panelProviders` | panel provider file(s) | every `app/Providers/Filament/*PanelProvider.php` |
| `filamentRoot` | where Filament code lives | usually `app/Filament` |
| `themeCss` | custom panel theme CSS entry/entries | e.g. `resources/css/filament/<panel>/theme.css` per panel |
| `frontendCss` | non-panel app CSS | e.g. `resources/css/app.css` |
| `vendoredOverrides` | classes that shadow vendor classes (latent `class.notFound` risk) | your override dirs, or `[]` |
| `testDir` | where the upgrade's tests live | e.g. `tests/Feature/Filament` |
| `gate.test` / `.pint` / `.analyse` / `.build` / `.buildFallback` | the green-gate commands | match the repo's tooling (prefix-aware) |
| `guide` | path the `KNOWLEDGE` index points at | keep `.claude/workflows/filament-v4-upgrade-guide.md` |
| `packagePins` | exact version pins for tricky packages | `{}` unless you know pins (see the guide's matrix) |
| `pintScope` | the **only** paths Pint may reformat | the upgrade-owned surface (e.g. `tests/Feature/Filament app/Vendor`) — never repo-wide |
| `maxRepairRounds` | self-heal attempts per phase | `2` is sane |
| `verifyReserveTokens` | per-finding budget reserve before deferring to the planner | leave default unless tuning cost |

> **`pintScope` matters.** A repo-wide Pint reformat blows up `git blame`. Keep it scoped to what the
> upgrade actually touches. (This bit a real run — see the runbook.)

## 3. Confirm the gate commands actually work in this repo

Before generating, sanity-check each `gate.*` command runs (even if it currently fails — you just
need the command itself to be correct): `ddev php artisan test --compact`, `ddev php vendor/bin/pint --test`,
`ddev composer analyse`, `ddev yarn build`. Fix any that don't exist (e.g. analyse script name, npm vs yarn).

## 4. Regenerate and pass the build gate

```
node .claude/workflows/_assemble.mjs
node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-*.mjs
node --test .claude/workflows/_src/__tests__/*.mjs
```

All three must be green. `_assemble.mjs --check` should then report "all generated workflows are up to
date". If you set `buildConfig` via `args` instead of editing defaults, the generated files don't
change — that's fine.

## 5. Adjust the skill for this repo

`.claude/skills/filament-v4-upgrade/SKILL.md` drives the **interactive bootstrap**. Most of it is
repo-shaped; review these steps for the target:

- Branch name (defaults to `feature/filament-v4`).
- Which internal/private deps to relax for the core bump (the `statikbe/*` list is PUBMUS-specific —
  replace with this repo's private packages), and the matching `auth.json` credentials.
- The Boost MCP restart gate (step 6) is universal — keep it.
- If you set `buildConfig` via `args`, note in the launch step which overrides to pass.

## 6. First run

Do the bootstrap (skill steps 1–7), then launch `filament-v4-upgrade-run`. Supervise it with the
[operator runbook](./RUNBOOK.md). For a repo that's *already mostly upgraded*, run `filament-v4-polish`
instead.

## 7. Optional: re-mine knowledge for this repo

Only if the target repo's upgrade surfaces patterns the shipped guide doesn't cover (very different
package set, or a newer Filament v4.x with new fallout). Run the extractor against this repo's own
completed-upgrade history, then re-synthesize the guide and re-author the engine slots. The method is
the [upgrade-automation playbook](../docs/upgrade-automation-playbook.md); the extractor scripts and
their `run-summary.md` live in the source repo's `docs/filament-v4-upgrade-analysis*/`.

## What you do NOT change

- The **pattern catalog / gotchas** in the guide (framework-level, not repo-level).
- The engine's **stages, schemas, and pure helpers** — they're repo-agnostic.
- The **slot contents** (`KNOWLEDGE` / `DIMENSIONS` / `FATAL_PATTERN_IDS`) unless you re-mine (step 7).
  If you do touch them, re-run the coverage critic (see README → Modifying the bundle).
