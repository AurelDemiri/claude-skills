# Filament v4 upgrade workflows — how this was built

This directory holds the **Filament v3 → v4 upgrade automation**: a hand-tuned shared engine, two
generated entrypoint workflows, and the build tooling that keeps them in sync. The
[`filament-v4-upgrade` skill](../SKILL.md) wraps them for one-command use.

This README documents the **full lineage** — where the knowledge came from, how it became these
files, and how to change them safely. None of it was written from memory: every pattern, gotcha, and
schema is **evidence-based**, distilled from the commit history of a real, completed upgrade.

## What's in this directory

| File | Role |
|---|---|
| `_src/engine.mjs` | **Canonical source.** Hand-tuned orchestration: config, knowledge, schemas, pure helpers, agent stages. Never run directly. |
| `_src/filament-v4-upgrade.template.mjs` | Entrypoint template: meta + `// <engine:inline>` + the phased composition. |
| `_src/filament-v4-polish.template.mjs` | Entrypoint template: meta + `// <engine:inline>` + the single-pass composition. |
| `_assemble.mjs` | Inlines the engine body into each template → generated workflows. `--check` is the drift gate. |
| `_wfcheck.mjs` | Syntax-checks a generated workflow (the `node --check` equivalent for top-level-await/return scripts). |
| `_src/__tests__/*.mjs` | `node --test` suite: engine slot-marker invariants + assemble round-trip. |
| `filament-v4-upgrade.mjs` | **Generated** (do not edit). `meta.name: filament-v4-upgrade-run`. The full phased upgrade. |
| `filament-v4-polish.mjs` | **Generated** (do not edit). `meta.name: filament-v4-polish`. Single-pass audit/fix of a near-done upgrade. |
| `filament-v4-upgrade-guide.md` | The full before→after pattern catalog + gotcha catalog + package matrix the engine's `KNOWLEDGE` index points at. |
| `filament-v4-workflow-comparison.md` | Verdict doc comparing the two entrypoints + the run that used `polish`. |
| `ADOPTING.md` | How to vendor this bundle into a new target repo. |
| `RUNBOOK.md` | How to launch, watch, and troubleshoot an autonomous run. |

> The same bundle is **vendored** (with a genericized `buildConfig`) into target repos under their own
> `.claude/workflows/`. The copy here is the **golden source**.

## The lineage (real upgrade → reusable automation)

```
[1] Real Filament v3→v4 upgrade        (VLWPLA: feature/filament-v4 + post-merge fallout)
        │  ~448 non-merge commits of actual breaking-change fixes
        ▼
[2] Extractor  (deterministic triage → LLM classify/extract → spot-check → finalize)
        │  448 commits → 141 candidates → ~90 upgrade-related → 88 genericized knowledge cards
        ▼
[3] Synthesis  (cards → guide)
        │  filament-v4-upgrade-guide.md: pattern catalog + gotcha catalog + package matrix
        ▼
[4] Shared engine  (_src/engine.mjs — HAND-TUNED, card-derived slots AUTHORED)
        │  buildConfig · RULES · KNOWLEDGE · DIMENSIONS · FATAL_PATTERN_IDS · schemas · helpers · stages
        ▼
[5] Entrypoints  (templates + _assemble.mjs → generated workflows)
        │  filament-v4-upgrade.mjs (phased)   filament-v4-polish.mjs (single-pass)
        ▼
[6] Validation  (coverage critic + build gate)  ──┐ keeps [3]/[4]/[5] mutually consistent
        ▼                                          │
[7] Skill  (filament-v4-upgrade: interactive bootstrap → launches filament-v4-upgrade-run)
```

Stages [1]–[3] (and the validation scripts) live in the target repo's
`docs/filament-v4-upgrade-analysis*/` (the extractor is read-only against app code and only writes its
own analysis dir + the guide). Stages [4]–[7] are this golden bundle. The engine's card-derived slots
are the bridge: the cards justify them, the coverage critic proves they still match.

---

## [1] Source: a real, completed upgrade

The knowledge is mined from an actual Filament v3 → v4 + Tailwind v3 → v4 + Shield v3 → v4 migration on
a Statik-shaped Laravel app (Laravel 12 / PHP 8.3, multi-panel, `bezhansalleh/filament-shield` +
`spatie/laravel-permission`, several `statikbe/*` Filament packages, DDEV/Pint/Pest). The range mined
is the upgrade branch **plus** the post-merge fallout fixes on `develop` — because half the real
breaking-change knowledge surfaced as small runtime fixes *after* the keystone dependency bump.

## [2] The extractor (commits → knowledge cards)

A multi-phase pipeline turns raw history into genericized, reusable cards. It is **deterministic where
it can be and LLM-driven where it must be**, with a recall guard:

1. **Enumerate + triage (deterministic — `_enumerate.sh` + `_assemble.py`).** Every non-merge commit
   in range is bucketed by region + signal. Branch-region commits (what the `feature/filament-v4`
   merge introduced) are all candidates; every other in-range commit becomes a candidate only on an
   upgrade **subject-keyword** or a **narrow upgrade-path** signal (theme CSS, tailwind/vite/postcss
   config, panel providers, `config/{filament,shield,permission}*`, `phpstan.neon*`). `app/Filament/**`
   and `composer.lock` are deliberately *not* signals (too many false positives). → `commit-triage.jsonl`,
   `_candidates.json`, `_unrelated_sample.json`.
2. **Classify + extract (LLM, parallel — a `Workflow` pipeline).** For each candidate: `git show`,
   classify (`is_upgrade_related` + category + confidence + rationale), and if upgrade-related distil a
   **genericized** knowledge card to `extracted/<hash>.md`. Genericization strips project names but
   keeps framework / Tailwind / Shield / package API names **verbatim** (they are load-bearing).
3. **Spot-check (recall guard).** A deterministic sample of the dropped `unrelated` bucket is
   re-examined blind to confirm there are no false-negatives.
4. **Finalize (deterministic — `_finalize.py`).** Merge LLM verdicts back into `commit-log.jsonl` and
   emit `run-summary.md` + stats.

Headline shape of a run: **448 commits → 141 candidates → ~90 upgrade-related → 88 distinct cards.**
The pipeline is reproducible; see [Reproducing the extraction](#reproducing-the-extraction).

## [3] Synthesis (cards → guide)

`filament-v4-upgrade-guide.md` is regenerated from the cards: a **pattern catalog** (each breaking
change as a numbered before→after section), a **gotcha catalog** (symptom → cause → fix rows), and a
**pre-flight package matrix** (v3 → v4 target + pins/forks/skips). The guide is the *full detail*; the
engine's `KNOWLEDGE` slot is a thin **index that points at it** (`cfg.guide`) rather than inlining the
~80 KB catalog. The synthesis contract lives in
[`docs/filament-v4-upgrade/synthesis-recipe.md`](../docs/synthesis-recipe.md).

## [4] The shared engine (`_src/engine.mjs`)

The engine is **hand-tuned orchestration**, not generated. It is import-testable (its `export {…}`
block sits *after* the `// <engine:end>` marker, so `_assemble` inlines only the definitions while the
tests import the symbols). Everything between `// <engine:start>` / `// <engine:end>` is what gets
inlined into the entrypoints. Structure:

- **`buildConfig(args)`** — repo-shape defaults + override; no top-level reference to workflow globals,
  so it stays import-testable. The vendored copies genericize these defaults per target repo.
- **`RULES(cfg)`** — shared prompt block (DDEV/Pint/Pest conventions, read-only-against-app rules, etc.).
- **`KNOWLEDGE(cfg)`** *(card-derived slot)* — the breaking-change **index**; points at `cfg.guide` for
  the full catalog, so it never drifts from or duplicates the 80 KB guide.
- **`DIMENSIONS`** *(card-derived slot)* — the audit dimensions the auditors fan out over, each tagged
  `group: 'breaking' | 'tailwind' | 'packages' | 'verify'`.
- **`FATAL_PATTERN_IDS`** *(card-derived slot)* — the patterns that must be **force-verified even when
  an auditor reports them at low severity** (the silent / easy-to-under-rate, high-blast classes).
- **Schemas** — `INVENTORY / FINDINGS / VERDICT / GATE / PLAN / IMPL` (StructuredOutput contracts).
- **Pure helpers** — `severityRank`, `dedupe`, `routeForVerify` (the one place `FATAL_PATTERN_IDS` is
  consumed: `severityRank(f.severity) >= 2 || FATAL.has(f.patternId)` → adversarial verify).
- **Agent stages** — `inventory`, `baselineGate`, `auditFanOut`, `verifyFindings`, `planFrom`,
  `implementPlan`, `runGate`, `selfHeal`, `commitPhase`. Entrypoints compose these; the engine never
  decides control flow.

### The slot-marker contract

The three card-derived constants are wrapped in behaviour-neutral comment markers
(`// <knowledge:start>…<knowledge:end>`, `// <fatal:…>`, `// <dimensions:…>`) so synthesis and
validation can locate them **without touching the hand-tuned engine body**. These regions are
**AUTHORED, not regenerated** — a human curates them from the cards, and the coverage critic proves
they still cover every breaking-change class the cards surface. Design rationale is in
[`docs/filament-v4-upgrade/2026-06-25-extractor-shared-engine-design.md`](../docs/extractor-shared-engine-design.md).

## [5] The entrypoints (templates + `_assemble.mjs`)

Each `_src/*.template.mjs` is **meta + `// <engine:inline>` + a composition only**. `_assemble.mjs`
extracts the engine body (between the `engine:start/end` markers) and substitutes it for the
`// <engine:inline>` marker in every template, writing the self-contained generated `.mjs`. Running
`_assemble.mjs --check` is the **drift gate** (fails if a generated file is stale).

Two compositions ship:

| | `filament-v4-upgrade.mjs` (`filament-v4-upgrade-run`) | `filament-v4-polish.mjs` (`filament-v4-polish`) |
|---|---|---|
| Use when | Doing the full upgrade after the deps/rector bootstrap | Cleaning up a *mostly-complete* upgrade |
| Shape | **Phased**: Inventory+Baseline → Breaking changes → Tailwind v4 → Package compat → Verification → final gate | **Single-pass**: Inventory → Audit (all dimensions) → Verify → Plan → Implement → Verify Gate |
| Per unit of work | audit (phase's dimensions) → `routeForVerify` → `verifyFindings` → `planFrom` → `implementPlan` → `runGate` → `selfHeal` → **commit if green** | the same stages once, over all dimensions |
| Commits | one per green phase | at the end |

Both are gated, both self-heal, neither ever pushes. See
[`filament-v4-workflow-comparison.md`](./filament-v4-workflow-comparison.md) for the trade-offs.

## [6] Validation (keeps [3]/[4]/[5] honest)

- **Coverage critic** — `_coverage_critic.py` (deterministic precheck: slot markers present/ordered/
  non-empty, `FATAL_PATTERN_IDS` parse + no orphan ids, guide has the pattern catalog + a full
  `### Pattern N` set, card tally by phase/category) **plus** an agent semantic match (every
  breaking-change class is covered by a `KNOWLEDGE` line + a `DIMENSIONS[].focus` + a guide pattern;
  fatal classes have a `FATAL_PATTERN_IDS` id). A miss is **reported, not auto-fixed** — the slots are
  authored, so a human decides.
- **Build gate** (must be green):
  ```
  node .claude/workflows/_assemble.mjs --check
  node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-*.mjs
  node --test .claude/workflows/_src/__tests__/*.mjs
  ```

## [7] The skill

[`.claude/skills/filament-v4-upgrade/SKILL.md`](../SKILL.md) is the
one-command entry. A background workflow can't do private-repo auth, MCP setup, or restart Claude
Code, so the skill performs the **interactive bootstrap** in the main session (idempotently: `auth.json`
+ `packages.filamentphp.com`, `filament/upgrade` rector pass, `filament/blueprint` + Boost, the keystone
`composer update`, asset republish) and then **launches the `filament-v4-upgrade-run` workflow** for the
autonomous code phases.

---

## Modifying the bundle (the dev loop)

1. Edit `_src/engine.mjs` (logic/stages/schemas) or a `_src/*.template.mjs` (composition/meta). **Never
   edit the generated `filament-v4-*.mjs` directly** — `_assemble --check` will flag them stale.
2. Regenerate: `node .claude/workflows/_assemble.mjs`
3. Gate: `node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-*.mjs` then
   `node --test .claude/workflows/_src/__tests__/*.mjs`
4. If you touched a **card-derived slot** (`KNOWLEDGE` / `DIMENSIONS` / `FATAL_PATTERN_IDS`) or the
   guide, re-run the coverage critic and confirm no class lost coverage.

### Adding a breaking-change pattern (end-to-end)

When the upgrade surfaces a v4 break the bundle doesn't yet know, add it in this order so the coverage
critic stays green:

1. **Card (provenance).** If it came from a real commit, capture a genericized card (Problem / Symptom /
   Fix before→after / Notes) in the extractor's `extracted/` — project names stripped, framework API
   names verbatim. If you're adding it by hand, at least keep a one-paragraph rationale.
2. **Guide.** Add a `### Pattern N` section to `filament-v4-upgrade-guide.md` (before→after) and a row to
   the gotcha catalog (symptom → cause → fix). The guide is the *full detail*.
3. **`KNOWLEDGE` slot.** Add **one index line** naming the class — it points auditors at the guide, it
   does **not** inline the detail.
4. **`DIMENSIONS` slot.** Make sure some dimension's `focus` mentions it, under the right `group`
   (`breaking` / `tailwind` / `packages` / `verify`), so an auditor actually hunts for it.
5. **`FATAL_PATTERN_IDS`?** Only if it meets the bar below.
6. **Validate.** Re-run the coverage critic (every class needs KNOWLEDGE + DIMENSIONS + a guide pattern)
   and the build gate.

### The `FATAL_PATTERN_IDS` rule

`FATAL_PATTERN_IDS` is **not** "everything that crashes." Its only job (see `routeForVerify`) is to
**force adversarial verification even when an auditor reports a finding at low/info severity**:

```js
if (severityRank(f.severity) >= 2 || FATAL.has(f.patternId)) verify(f)
```

So add an id **only** for the *silent / easy-to-under-rate, high-blast-radius* classes — the ones an
auditor might wave through as `low`:

- **Add:** silent data loss/corruption (`hidden-disabled-dehydrate`, `richeditor-json-state`), and
  sweeping drift that looks cosmetic (`namespace-move`, `form-infolist-signature`, `static-property-types`).
- **Do NOT add:** loud crashers (`Class not found`, `RouteNotFoundException`, `InvalidFormatException`).
  An auditor already rates those `high`/`critical`, so they reach the verifier via the severity path —
  a FATAL id would be redundant. Keep the set small and deliberate.

When in doubt, ask: *"would a careless auditor score this `low`, even though it's actually critical?"* If
yes, it's a FATAL id. If it screams on its own, it isn't.

## Reproducing the extraction

The extractor (stages [1]–[3] + validation scripts) lives in the target repo's
`docs/filament-v4-upgrade-analysis*/`. To re-mine from scratch:

```
bash   docs/filament-v4-upgrade-analysis*/_enumerate.sh          # deterministic triage
python docs/filament-v4-upgrade-analysis*/_assemble.py           # → candidates + triage log
# Workflow: classify + extract (parallel) → extracted/<hash>.md cards
# Workflow: spot-check the unrelated bucket (recall guard)
python docs/filament-v4-upgrade-analysis*/_finalize.py           # → commit-log.jsonl + run-summary.md
# Workflow: synthesize the guide from the cards
python docs/filament-v4-upgrade-analysis*/_coverage_critic.py …  # validate slots vs cards
```

`run-summary.md` in that directory records the headline numbers and method for each run.

## See also

- [`ADOPTING.md`](./ADOPTING.md) — vendor this bundle into a new repo.
- [`RUNBOOK.md`](./RUNBOOK.md) — launch / watch / troubleshoot a run.
- [`filament-v4-upgrade-guide.md`](./filament-v4-upgrade-guide.md) — the catalog `KNOWLEDGE` indexes.
- [`filament-v4-workflow-comparison.md`](./filament-v4-workflow-comparison.md) — entrypoint trade-offs.
- [`docs/upgrade-automation-playbook.md`](../docs/upgrade-automation-playbook.md) — the framework-agnostic method behind this bundle.
- [`docs/filament-v4-upgrade/synthesis-recipe.md`](../docs/synthesis-recipe.md) — synthesis + coverage-critic contract.
- [`docs/filament-v4-upgrade/2026-06-25-extractor-shared-engine-design.md`](../docs/extractor-shared-engine-design.md) — design spec.
- [`docs/filament-v4-upgrade/2026-06-25-extractor-shared-engine-plan.md`](../docs/extractor-shared-engine-plan.md) — implementation plan.
- [`.claude/skills/filament-v4-upgrade/SKILL.md`](../SKILL.md) — the skill.
