# Synthesis recipe — emitting the upgrade engine + entrypoints

The VLWPLA `chore/filament-v4-upgrade-extractor` pipeline mines the real upgrade commit history into
88 knowledge cards, then SYNTHESISES deliverables. Previously synthesis emitted one thin serial
driver (`filament-v4-upgrade.js`). It must now emit the **shared-engine shape** described here.

## Target output shape

1. `.claude/workflows/_src/engine.mjs` — canonical source (NEVER run directly), between
   `// <engine:start>` / `// <engine:end>` markers:
   - `buildConfig(args)` — repo-shape defaults + override; **no top-level reference to workflow
     globals** (so it stays import-testable).
   - `RULES(cfg)`, `KNOWLEDGE(cfg)` — shared prompt blocks. `KNOWLEDGE` is an INDEX of breaking-change
     classes that POINTS at the full guide (`cfg.guide`); it must NOT inline the 78 KB catalog.
   - `DIMENSIONS` — audit dimensions, each tagged `group: 'breaking'|'tailwind'|'packages'|'verify'`.
   - Schemas (`INVENTORY/FINDINGS/VERDICT/GATE/PLAN/IMPL`) + pure helpers (`severityRank`, `dedupe`,
     `routeForVerify`) + agent-driven stages (`inventory`, `baselineGate`, `auditFanOut`,
     `verifyFindings`, `planFrom`, `implementPlan`, `runGate`, `selfHeal`, `commitPhase`).
   - **Slot markers (card-derived regions).** `engine.mjs` wraps its card-derived constants in
     behavior-neutral comment markers so synthesis/validation can locate them without touching the
     hand-tuned engine body: `// <knowledge:start>`/`// <knowledge:end>` around `KNOWLEDGE(cfg)`,
     `// <fatal:start>`/`// <fatal:end>` around `FATAL_PATTERN_IDS`, `// <dimensions:start>`/
     `// <dimensions:end>` around `DIMENSIONS`. These regions are AUTHORED, not regenerated — the
     coverage critic validates them against the cards.
2. Two `.claude/workflows/_src/*.template.mjs` — meta + `// <engine:inline>` + a composition only.
3. `.claude/workflows/_assemble.mjs` — inlines the engine into each template; `--check` is the drift gate.
4. Generated `.claude/workflows/filament-v4-{upgrade,polish}.mjs`.

## Invariants synthesis MUST preserve (the 6 comparison-doc fixes)

1. Panel-crawl test is AUTHORED as a plan work item; `runGate` only RUNS it.
2. `routeForVerify` sends a finding to adversarial verify on severity≥medium OR
   `patternId ∈ FATAL_PATTERN_IDS` (namespace-move, form-infolist-signature, static-property-types,
   hidden-disabled-dehydrate, richeditor-json-state).
3. `planFrom` returns null on an empty plan; entrypoints must log + skip implement (no silent zero-work).
4. `buildConfig(args)` + `budget`-capped `verifyFindings` (defer overflow to planner notes, logged).
5. Full catalog reached via the `cfg.guide` pointer in `KNOWLEDGE`, not inlined.
6. Per-green-phase commit in the full entrypoint + null/throw-safe keystone calls; never push.

## Coverage critic (validation, not generation)

Synthesis regenerates ONLY `filament-v4-upgrade-guide.md` from the 88 cards. The in-engine slots
(`KNOWLEDGE`, `DIMENSIONS`, `FATAL_PATTERN_IDS`) stay authored; the coverage critic validates them:

1. **Deterministic precheck** (`_coverage_critic.py`): markers present/ordered/non-empty;
   `FATAL_PATTERN_IDS` parses + non-empty + no orphan id (each fatal id referenced elsewhere in
   `engine.mjs`); guide has the `(pattern catalog)` section and the full `### Pattern N` set; tallies
   cards by `phase`/`category`.
2. **Agent semantic match**: for every breaking-change CLASS across the cards, confirm a `KNOWLEDGE`
   line + a `DIMENSIONS[].focus` mention + a guide pattern section cover it, and that fatal classes
   have a `FATAL_PATTERN_IDS` id + guide pattern. A miss does NOT auto-edit the engine — it FAILS the
   gate naming the card hash, class, and missing slot, for a human to author.

## Build / validation gate

After guide regen + coverage critic, synthesis must pass (repo root):
`node .claude/workflows/_assemble.mjs` then `--check`;
`node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-*.mjs`;
`node --test .claude/workflows/_src/__tests__/*.mjs`.
Only a green gate reports success.

## How cards map

- Each knowledge card's framework/Tailwind/Shield API names → the GUIDE (full detail) and a one-line
  entry in the `KNOWLEDGE` index. Cards tagged `phase:` map to a `DIMENSIONS[].group`.
- No edits to app code; synthesis only writes the workflow sources + guide.

(Authored in PUBMUS; the VLWPLA extractor branch is updated separately to emit this shape.)
