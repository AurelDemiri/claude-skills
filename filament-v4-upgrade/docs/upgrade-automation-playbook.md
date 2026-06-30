# Playbook: commit-mined upgrade automation

A reusable method for turning **one completed framework migration** into **automation that performs the
same migration on other repos**. The Filament v3 → v4 bundle in
[`.claude/workflows/`](../workflows/README.md) is the reference implementation; this doc is the
framework-agnostic recipe so the next big migration (Laravel major, Livewire major, a PHP bump, a
design-system swap) doesn't have to re-derive it.

## When this pays off

Use it when **all** of these hold:

- A large, mechanical-but-judgment-heavy migration with **many small breaking changes** (not one big
  rewrite).
- You have a **reference implementation**: at least one repo where the migration is *already done*, so
  its commit history encodes the real fixes.
- You'll do it **more than once** (multiple repos, or a long tail), so authoring reusable automation
  beats doing it by hand each time.

If the migration is a one-repo one-off, just do it by hand. The leverage here is *reuse* and
*evidence* (every rule traces to a real commit, not a blog post).

## The shape

```
completed migration (commits)  →  EXTRACT  →  knowledge cards  →  SYNTHESIZE  →  guide
                                                                       │
                                          AUTHOR engine (card-derived slots) ←──┘
                                                                       │
                                          templates + assembler  →  generated workflows
                                                                       │
                                                VALIDATE (coverage critic + build gate)
                                                                       │
                                                     wrap in a SKILL (bootstrap + launch)
                                                                       │
                                                  VENDOR into each target repo + run
```

Two halves: an **extractor** (history → knowledge) and a **shared-engine workflow + skill** (knowledge
→ applied changes). Keep them separate; the extractor is throwaway-per-mine, the engine is durable.

## Stage A — Triage (deterministic)

Turn the reference repo's history into a **candidate list**, deterministically, so it's reproducible
and auditable.

- **Pick the range carefully.** Include the migration branch **and the post-merge fallout** on the
  mainline. In practice ~half the real knowledge lands as small runtime fixes *after* the keystone
  dependency bump, not on the feature branch. Pin the range so re-mines are apples-to-apples.
- **Region-split + signal heuristics.** Treat commits introduced by the migration merge as candidates
  outright; treat every other in-range commit as a candidate only on a **subject-keyword** or
  **narrow-path** signal. Choose signals that are specific to the migration (config files, build
  config, the framework's dirs) and **deliberately exclude noisy ones** (lockfiles, broad app dirs
  touched by ordinary feature work) — they swamp you in false positives.
- Output an **audit log** (every commit + its bucket + why) plus the candidate list. Determinism here
  means the next person can reproduce your candidate set exactly.

## Stage B — Classify + extract (LLM, parallel, recall-guarded)

- **Classify** each candidate (`git show` → is-this-migration-related + category + rationale). Run it
  as a parallel agent fan-out; it's embarrassingly parallel.
- **Extract** a genericized **knowledge card** per related commit: Problem / Symptom / Fix
  (before → after) / Notes. **Genericization rule:** strip project-specific names (models, resources,
  domain words, ticket refs) but keep **framework / library / API names verbatim** — they're
  load-bearing and a paraphrase makes the card useless.
- **Recall guard.** Sample the *dropped* (`unrelated`) bucket and re-judge it blind. Confirm ~zero
  false-negatives. A heuristic with no recall check silently loses knowledge.

Expect roughly: many commits → a third or so candidates → most of those related → one card each, minus
test/doc/style companions. (Filament: 448 → 141 → ~90 → 88 cards.)

## Stage C — Synthesize the guide

Fold the cards into one **human-readable guide**: a numbered **pattern catalog** (each breaking change
before → after), a **gotcha catalog** (symptom → cause → fix), and a **pre-flight matrix** (package /
version moves, pins, forks, skips). This is the full detail the engine will *point at* rather than
inline. Generate it sectioned (parallel writers per area) and assemble deterministically.

## Stage D — Author the shared engine

Hand-write the orchestration; **don't generate it**. The engine holds:

- `buildConfig(args)` — repo-shape defaults + override (the only place per-repo specifics live).
- Shared prompt blocks: environment **rules** and a **knowledge index**.
- **Card-derived slots** (the bridge from cards to runtime), each wrapped in comment markers so tooling
  can locate them without touching hand-tuned code:
  - a **knowledge index** that *points at the guide* (`cfg.guide`), never inlines the big catalog;
  - **audit dimensions** the auditors fan out over, tagged by phase/group;
  - a **fatal set** — patterns to force-verify even at low severity.
- StructuredOutput **schemas** for each stage, **pure helpers** (severity ranking, dedupe, verify
  routing), and **agent stages** (inventory, baseline, audit, verify, plan, implement, gate, self-heal,
  commit).

**The slots are AUTHORED, not regenerated.** A human curates them from the cards; a critic (Stage F)
proves they stay complete. This keeps the hand-tuned engine stable while the knowledge evolves.

## Stage E — Entrypoints (templates + assembler)

Each entrypoint is **meta + an inline marker + a composition only**. An assembler inlines the engine
body into every template and writes self-contained, generated workflow files; an `--check` mode is the
**drift gate**. Ship more than one composition when the use cases differ (e.g. a *phased, commit-per-
phase* full run vs. a *single-pass* cleanup of an already-near-done migration).

## Stage F — Validate (keeps C/D/E consistent)

- **Coverage critic:** a deterministic precheck (slot markers present/ordered, fatal ids parse with no
  orphans, guide has the catalog) **plus** an agent semantic match (every breaking-change class is
  covered by a knowledge line + a dimension + a guide pattern; fatal classes have a fatal id). On a
  miss it **reports, it doesn't auto-fix** — the slots are authored.
- **Build gate:** assemble `--check`, syntax-check the generated workflows, run the unit tests.

## Stage G — Wrap in a skill

A skill does the **interactive bootstrap** the background workflow can't (private-repo auth, MCP setup,
restarting the agent host, the keystone dependency bump) and then **launches the workflow**. Keep the
bootstrap idempotent (verify-then-skip each step).

## Transferable design principles

- **Deterministic where you can, LLM where you must, recall-guarded always.** The triage is code; the
  judgment is agents; a blind re-check of the dropped bucket catches the heuristic's misses.
- **Mine the fallout, not just the branch.** The post-merge tail is where the subtle knowledge hides.
- **Genericize, but keep API names verbatim.** The card must be reusable across repos yet still name
  the exact class/method/selector to change.
- **Index, don't inline.** Keep the big catalog in a guide; the engine points at it. Prompts stay
  small; the catalog can grow without bloating every agent.
- **Author the slots; validate with a critic.** Don't auto-regenerate hand-tuned orchestration. Let a
  critic prove the authored knowledge still covers every mined class.
- **"Fatal" means *force-verify*, not *crashes*.** Reserve the fatal set for the silent/under-rated
  high-blast classes an auditor would wave through; loud crashers already route via severity.
- **Gate and commit per phase; never push.** Auditable history, easy single-phase revert, human owns
  the merge.
- **Vendor + override, don't fork per repo.** One golden bundle; per-repo specifics live only in
  `buildConfig`.
- **It reproduces.** Because the triage is deterministic, a re-mine of the same range reproduces the
  candidate set (Filament re-run: identical count, 96%+ identical set), so the method is trustworthy,
  not a one-shot.

## What to adapt per framework

| Knob | Adapt to the target migration |
|---|---|
| Triage signals | the new framework's config files, dirs, subject keywords; exclude that ecosystem's noisy paths |
| Card categories / phases | the migration's natural axes (e.g. breaking-API / styling / package-compat / verification) |
| Audit dimensions | how you want to slice the audit surface for that framework |
| Fatal taxonomy | which classes are *silently* catastrophic in that framework |
| Gate commands + repo shape | `buildConfig` (test/format/analyse/build commands, dirs, prefixes) |

## Cost & effort

Mining is the cheap part (parallel, deterministic-led). Authoring + curating the engine slots and the
guide is the real work, and it's **one-time per framework** — amortized across every repo you then run
it on. Per-repo runs are minutes to tens of minutes and single-digit-to-low-tens of dollars (see the
[runbook](../workflows/RUNBOOK.md)).

## Reference implementation

Filament v3 → v4: the bundle in [`.claude/workflows/`](../workflows/README.md) (engine, two
entrypoints, guide, validation, skill). The extractor scripts + per-run `run-summary.md` live in the
mined repo's `docs/filament-v4-upgrade-analysis*/`. The
[synthesis recipe](./synthesis-recipe.md) and
[design spec](./extractor-shared-engine-design.md) are the detailed
Filament-specific versions of Stages C–F.
