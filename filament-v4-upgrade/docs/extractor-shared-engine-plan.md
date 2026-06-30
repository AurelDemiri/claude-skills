# Extractor Shared-Engine Emission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VLWPLA Filament-v4 upgrade extractor's synthesis step emit the shared-engine workflow shape (vendored from the PUBMUS golden) instead of the old thin serial driver.

**Architecture:** PUBMUS `.claude/workflows/` is the golden source of truth. We add behavior-neutral slot markers to its `engine.mjs`, then vendor the whole scaffold (engine + templates + `_assemble.mjs` + `_wfcheck.mjs` + `__tests__/`) into VLWPLA's extractor with genericized `buildConfig` defaults. The extractor's agent-driven synthesis stops authoring a thin driver and instead: regenerates the guide from the 88 cards, runs a coverage critic (`_coverage_critic.py` deterministic precheck + agent semantic match), and runs the build/validation gate.

**Tech Stack:** Node 22 (ESM `.mjs`, `node --test`), Python 3 (extractor harness), git. No app code, no new dependencies.

## Global Constraints

_Every task's requirements implicitly include this section._

- **No app code changes** in either repo; only workflow sources, the extractor pipeline, and docs.
- **No push, no PR** by any task or any emitted workflow.
- Gate commands stay **ddev-prefixed**; Pint is **always scoped** (never repo-wide reformat — preserve `git blame`).
- Slot markers are **pure comment lines** (no runtime effect on the inlined engine body).
- **PUBMUS golden = source of truth.** The VLWPLA `engine.mjs` is a vendored copy whose ONLY delta is genericized `buildConfig` defaults (overridable via workflow `args`) + a provenance comment.
- Fatal pattern ids (verbatim): `namespace-move`, `form-infolist-signature`, `static-property-types`, `hidden-disabled-dehydrate`, `richeditor-json-state`.
- `DIMENSIONS[].group` values (verbatim): `breaking` | `tailwind` | `packages` | `verify`.
- Run node tests with the **`*.mjs` glob**: `node --test .claude/workflows/_src/__tests__/*.mjs` (Node 22 directory-discovery nit).
- Card frontmatter fields are `category` + `phase` only (no fine-grained patternId). The guide identifies patterns by `### Pattern N - Title` headings, not by fatal slug strings — so slug→pattern mapping is **semantic (agent's job)**, never asserted by the deterministic precheck.

---

## File Structure

**PUBMUS (this repo, cwd `/Users/bigmac/Projects/PUBMUS`):**
- Modify `.claude/workflows/_src/engine.mjs` — add 3 slot-marker pairs (knowledge / fatal / dimensions).
- Modify `.claude/workflows/_src/__tests__/engine.test.mjs` — add a marker-presence test.
- Regenerate `.claude/workflows/filament-v4-upgrade.mjs` + `filament-v4-polish.mjs` (via `_assemble.mjs`).
- Modify `docs/filament-v4-upgrade/synthesis-recipe.md` — document marker contract + coverage critic + build gate.

**VLWPLA (cwd = a worktree of branch `chore/filament-v4-upgrade-extractor`; see Phase B preamble):**
- Create `.claude/workflows/_src/engine.mjs` (vendored + genericized), `_src/filament-v4-upgrade.template.mjs`, `_src/filament-v4-polish.template.mjs`, `_src/__tests__/assemble.test.mjs`, `_src/__tests__/engine.test.mjs`, `_assemble.mjs`, `_wfcheck.mjs`.
- Create (generated) `.claude/workflows/filament-v4-upgrade.mjs`, `filament-v4-polish.mjs`.
- Delete `.claude/workflows/filament-v4-upgrade.js` and `docs/filament-v4-upgrade-analysis/filament-v4-upgrade.workflow.js`.
- Create `docs/filament-v4-upgrade-analysis/_coverage_critic.py` + `docs/filament-v4-upgrade-analysis/_coverage_critic_test.py`.
- Create `docs/filament-v4-upgrade-analysis/synthesis-recipe.md` (ported).
- Modify `docs/filament-v4-upgrade-analysis/_finalize.py` + `docs/filament-v4-upgrade-analysis/run-summary.md` (deliverable prose).

---

# Phase A — PUBMUS golden (source of truth)

### Task A1: Add slot markers to the golden engine + marker-presence test

**Files:**
- Modify: `.claude/workflows/_src/engine.mjs`
- Test: `.claude/workflows/_src/__tests__/engine.test.mjs`
- Regenerate: `.claude/workflows/filament-v4-upgrade.mjs`, `.claude/workflows/filament-v4-polish.mjs`

**Interfaces:**
- Produces: the comment markers `// <knowledge:start>`/`// <knowledge:end>`, `// <fatal:start>`/`// <fatal:end>`, `// <dimensions:start>`/`// <dimensions:end>` wrapping the `KNOWLEDGE` function, `FATAL_PATTERN_IDS`, and `DIMENSIONS` declarations respectively. The coverage critic (Task B3) consumes these.

- [ ] **Step 1: Write the failing test** — add to the end of `.claude/workflows/_src/__tests__/engine.test.mjs`:

```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ENGINE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../engine.mjs'),
  'utf8',
)

test('engine.mjs carries ordered, non-empty knowledge slot markers', () => {
  for (const slot of ['knowledge', 'fatal', 'dimensions']) {
    const open = `// <${slot}:start>`
    const close = `// <${slot}:end>`
    const s = ENGINE_SRC.indexOf(open)
    const e = ENGINE_SRC.indexOf(close)
    assert.ok(s !== -1, `${open} present`)
    assert.ok(e !== -1, `${close} present`)
    assert.ok(e > s, `${close} comes after ${open}`)
    assert.ok(ENGINE_SRC.slice(s + open.length, e).trim().length > 0, `${slot} slot non-empty`)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/workflows/_src/__tests__/engine.test.mjs`
Expected: the new test FAILS (`// <knowledge:start> present` assertion fails, indexOf returns -1). The 6 pre-existing tests still pass.

- [ ] **Step 3: Add the `knowledge` start marker.** Edit `.claude/workflows/_src/engine.mjs`:

old:
```js
function KNOWLEDGE(cfg) {
```
new:
```js
// <knowledge:start>
function KNOWLEDGE(cfg) {
```

- [ ] **Step 4: Add the `knowledge` end + `fatal` pair + `dimensions` start markers.** In the same file, replace the block from the close of `KNOWLEDGE` through the opening of `DIMENSIONS`:

old:
```js
}

const FATAL_PATTERN_IDS = [
  'namespace-move', 'form-infolist-signature', 'static-property-types',
  'hidden-disabled-dehydrate', 'richeditor-json-state',
]

const DIMENSIONS = [
```
new:
```js
}
// <knowledge:end>

// <fatal:start>
const FATAL_PATTERN_IDS = [
  'namespace-move', 'form-infolist-signature', 'static-property-types',
  'hidden-disabled-dehydrate', 'richeditor-json-state',
]
// <fatal:end>

// <dimensions:start>
const DIMENSIONS = [
```

- [ ] **Step 5: Add the `dimensions` end marker.** In the same file, the `DIMENSIONS` array closes immediately before `const INVENTORY_SCHEMA`:

old:
```js
]

const INVENTORY_SCHEMA = {
```
new:
```js
]
// <dimensions:end>

const INVENTORY_SCHEMA = {
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test .claude/workflows/_src/__tests__/engine.test.mjs`
Expected: all 7 tests PASS.

- [ ] **Step 7: Regenerate the workflows and confirm the full gate is green**

Run:
```bash
node .claude/workflows/_assemble.mjs
node .claude/workflows/_assemble.mjs --check
node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-upgrade.mjs .claude/workflows/filament-v4-polish.mjs
node --test .claude/workflows/_src/__tests__/*.mjs
```
Expected: `assembled filament-v4-upgrade.mjs` + `assembled filament-v4-polish.mjs`; then `all generated workflows are up to date`; then `SYNTAX OK` for both; then all tests pass. (The only diff in the generated `.mjs` is the inlined marker comments.)

- [ ] **Step 8: Commit**

```bash
git add .claude/workflows/_src/engine.mjs .claude/workflows/_src/__tests__/engine.test.mjs .claude/workflows/filament-v4-upgrade.mjs .claude/workflows/filament-v4-polish.mjs
git commit -m "feat(filament-workflow): add card-derived slot markers to golden engine"
```

---

### Task A2: Document the marker contract + coverage critic + build gate in the recipe

**Files:**
- Modify: `docs/filament-v4-upgrade/synthesis-recipe.md`

**Interfaces:**
- Consumes: the marker names from Task A1.
- Produces: the canonical recipe text Task B4 ports into VLWPLA.

- [ ] **Step 1: Add a "Slot markers" subsection** under the "Target output shape" section of `docs/filament-v4-upgrade/synthesis-recipe.md`. Insert this text after the numbered list item describing `engine.mjs`:

```markdown
   - **Slot markers (card-derived regions).** `engine.mjs` wraps its card-derived constants in
     behavior-neutral comment markers so synthesis/validation can locate them without touching the
     hand-tuned engine body: `// <knowledge:start>`/`// <knowledge:end>` around `KNOWLEDGE(cfg)`,
     `// <fatal:start>`/`// <fatal:end>` around `FATAL_PATTERN_IDS`, `// <dimensions:start>`/
     `// <dimensions:end>` around `DIMENSIONS`. These regions are AUTHORED, not regenerated — the
     coverage critic validates them against the cards.
```

- [ ] **Step 2: Add a "Coverage critic" section.** Append this section after "Invariants synthesis MUST preserve":

```markdown
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
```

- [ ] **Step 3: Verify the recipe reads coherently**

Run: `grep -nE "Slot markers|Coverage critic|Build / validation gate" docs/filament-v4-upgrade/synthesis-recipe.md`
Expected: all three headings/anchors present.

- [ ] **Step 4: Commit**

```bash
git add docs/filament-v4-upgrade/synthesis-recipe.md
git commit -m "docs(filament-workflow): recipe documents slot markers, coverage critic, build gate"
```

---

# Phase B — VLWPLA extractor

**Execution preamble (do once before Task B1):** Phase B runs against branch
`chore/filament-v4-upgrade-extractor` in `/Users/bigmac/Projects/VLWPLA` (its working tree is on
`develop`). Create an isolated worktree and use it as cwd for all Phase B tasks:

```bash
git -C /Users/bigmac/Projects/VLWPLA worktree add ../VLWPLA-extractor chore/filament-v4-upgrade-extractor
cd /Users/bigmac/Projects/VLWPLA-extractor
```
All Phase B paths are relative to this worktree root. (If the executor uses superpowers:using-git-worktrees, honor its worktree instead.)

### Task B1: Vendor the scaffold with genericized buildConfig + provenance

**Files:**
- Create: `.claude/workflows/_src/engine.mjs`, `_src/filament-v4-upgrade.template.mjs`, `_src/filament-v4-polish.template.mjs`, `_src/__tests__/assemble.test.mjs`, `_src/__tests__/engine.test.mjs`, `_assemble.mjs`, `_wfcheck.mjs`
- Create (generated): `.claude/workflows/filament-v4-upgrade.mjs`, `.claude/workflows/filament-v4-polish.mjs`

**Interfaces:**
- Consumes: the marker'd golden from Task A1 (must be committed in PUBMUS first).
- Produces: a vendored `buildConfig(args)` with Statik-generic defaults; the assembled workflow bundle the coverage critic (B3) and gate validate.

- [ ] **Step 1: Copy the scaffold verbatim from the PUBMUS golden**

```bash
GOLD=/Users/bigmac/Projects/PUBMUS/.claude/workflows
mkdir -p .claude/workflows/_src/__tests__
cp "$GOLD/_src/engine.mjs" .claude/workflows/_src/engine.mjs
cp "$GOLD/_src/filament-v4-upgrade.template.mjs" .claude/workflows/_src/
cp "$GOLD/_src/filament-v4-polish.template.mjs" .claude/workflows/_src/
cp "$GOLD/_src/__tests__/assemble.test.mjs" .claude/workflows/_src/__tests__/
cp "$GOLD/_src/__tests__/engine.test.mjs" .claude/workflows/_src/__tests__/
cp "$GOLD/_assemble.mjs" .claude/workflows/_assemble.mjs
cp "$GOLD/_wfcheck.mjs" .claude/workflows/_wfcheck.mjs
```

- [ ] **Step 2: Capture the golden provenance sha**

Run: `git -C /Users/bigmac/Projects/PUBMUS log -1 --format=%h -- .claude/workflows/_src/engine.mjs`
Note the short sha (call it `<GOLD_SHA>`); use it verbatim in Step 3's provenance comment.

- [ ] **Step 3: Genericize the vendored `buildConfig` + add provenance.** Edit `.claude/workflows/_src/engine.mjs`.

First, insert the provenance comment immediately after line 4 (before `// <engine:start>`):
```js
// VENDORED from PUBMUS .claude/workflows/_src/engine.mjs @ <GOLD_SHA>.
// Only delta from golden: genericized buildConfig defaults (override via workflow args).
```

Then replace the whole `buildConfig` function body's default literals:

old:
```js
  return Object.assign({
    projectName: 'pubmus',
    ddev: 'ddev',
    panelProviders: ['app/Providers/Filament/AdminPanelProvider.php'],
    filamentRoot: 'app/Filament',
    themeCss: ['resources/css/filament/admin/theme.css'],
    frontendCss: ['resources/css/app.css'],
    vendoredOverrides: ['app/Vendor/LaraZeus/Bolt'],
    testDir: 'tests/Feature/Filament',
```
new:
```js
  return Object.assign({
    projectName: 'app',
    ddev: 'ddev',
    panelProviders: ['app/Providers/Filament/AdminPanelProvider.php'],
    filamentRoot: 'app/Filament',
    themeCss: ['resources/css/filament/admin/theme.css'],
    frontendCss: ['resources/css/app.css'],
    vendoredOverrides: [],
    testDir: 'tests/Feature/Filament',
```

And the Pint scope (drop the PUBMUS-only `app/Vendor` path):

old:
```js
    pintScope: 'tests/Feature/Filament app/Vendor',
```
new:
```js
    pintScope: 'tests/Feature/Filament app',
```

(`Object.assign({...}, a)` already lets workflow `args` override every field; only the defaults change.)

- [ ] **Step 4: Assemble and run the full gate**

```bash
node .claude/workflows/_assemble.mjs
node .claude/workflows/_assemble.mjs --check
node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-upgrade.mjs .claude/workflows/filament-v4-polish.mjs
node --test .claude/workflows/_src/__tests__/*.mjs
```
Expected: both workflows assembled; `all generated workflows are up to date`; `SYNTAX OK` for both; all 7 tests pass (the golden `buildConfig` test only asserts overrides + the `ddev` default, both still hold with the generic `projectName`).

- [ ] **Step 5: Commit**

```bash
git add .claude/workflows/_src .claude/workflows/_assemble.mjs .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-upgrade.mjs .claude/workflows/filament-v4-polish.mjs
git commit -m "feat(extractor): vendor shared-engine workflow scaffold (generic defaults)"
```

---

### Task B2: Delete the thin serial driver (both copies)

**Files:**
- Delete: `.claude/workflows/filament-v4-upgrade.js`
- Delete: `docs/filament-v4-upgrade-analysis/filament-v4-upgrade.workflow.js`

- [ ] **Step 1: Confirm the replacements exist before deleting**

Run: `ls .claude/workflows/filament-v4-upgrade.mjs .claude/workflows/filament-v4-polish.mjs`
Expected: both generated workflows listed (proves Task B1 succeeded). Do NOT proceed if either is missing.

- [ ] **Step 2: Remove both thin-driver files**

```bash
git rm .claude/workflows/filament-v4-upgrade.js
git rm docs/filament-v4-upgrade-analysis/filament-v4-upgrade.workflow.js
```

- [ ] **Step 3: Verify no references to the old driver remain**

Run: `grep -rn "filament-v4-upgrade.workflow.js\|filament-v4-upgrade\.js" .claude docs/filament-v4-upgrade-analysis || echo "no stale references"`
Expected: only matches inside `run-summary.md`/`_finalize.py` (handled in Task B5), or `no stale references`.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(extractor): remove superseded thin serial driver"
```

---

### Task B3: Add the deterministic coverage-critic precheck + its test

**Files:**
- Create: `docs/filament-v4-upgrade-analysis/_coverage_critic.py`
- Test: `docs/filament-v4-upgrade-analysis/_coverage_critic_test.py`

**Interfaces:**
- Consumes: `.claude/workflows/_src/engine.mjs` (with markers), `.claude/workflows/filament-v4-upgrade-guide.md`, `docs/filament-v4-upgrade-analysis/extracted/*.md`.
- Produces: exit 0 + a JSON report (`fatal_ids`, `guide_pattern_count`, `card_count`, `cards_by_phase`, `cards_by_category`, slot sizes) on structural pass; exit 1 + a named `COVERAGE-CRITIC FAIL:` message on a hard structural break.

- [ ] **Step 1: Write the failing test** — create `docs/filament-v4-upgrade-analysis/_coverage_critic_test.py`:

```python
"""Tests for _coverage_critic.py. Run: python3 docs/filament-v4-upgrade-analysis/_coverage_critic_test.py"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CRITIC = os.path.join(HERE, "_coverage_critic.py")
ENGINE = os.path.join(HERE, "../../.claude/workflows/_src/engine.mjs")
GUIDE = os.path.join(HERE, "../../.claude/workflows/filament-v4-upgrade-guide.md")
CARDS = os.path.join(HERE, "extracted")


def run(engine_path):
    return subprocess.run(
        [sys.executable, CRITIC, "--engine", engine_path, "--guide", GUIDE, "--cards", CARDS],
        capture_output=True, text=True,
    )


def main():
    # 1. real bundle passes (exit 0)
    r = run(ENGINE)
    assert r.returncode == 0, f"expected OK on real bundle, got {r.returncode}\n{r.stderr}"
    assert "COVERAGE-CRITIC OK" in r.stdout
    print("PASS: real bundle structural-OK")

    # 2. tampered engine (missing a fatal end-marker) fails (exit 1, names the slot)
    src = open(ENGINE, encoding="utf-8").read()
    tampered = src.replace("// <fatal:end>", "", 1)
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(tampered)
        tmp = f.name
    try:
        r = run(tmp)
        assert r.returncode == 1, f"expected FAIL on tampered engine, got {r.returncode}"
        assert "fatal" in r.stderr.lower(), f"expected the fatal slot named, got: {r.stderr}"
        print("PASS: tampered engine fails and names the slot")
    finally:
        os.unlink(tmp)

    print("ALL COVERAGE-CRITIC TESTS PASS")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 docs/filament-v4-upgrade-analysis/_coverage_critic_test.py`
Expected: FAILS — the critic does not exist yet (`subprocess` cannot find `_coverage_critic.py`; raises / non-zero, or the import-of-missing-file surfaces). 

- [ ] **Step 3: Write the critic** — create `docs/filament-v4-upgrade-analysis/_coverage_critic.py`:

```python
#!/usr/bin/env python3
"""Coverage critic (deterministic precheck) for the Filament v4 shared-engine bundle.

Validates STRUCTURAL invariants of the vendored engine's card-derived slots and tallies the
knowledge cards. It does NOT judge semantic coverage (slug<->pattern-title mapping is fuzzy and is
the synthesis agent's job); it fails only on hard structural / internal-consistency breaks and
prints a card tally + parsed slots for the agent to reason over.

Exit 0 = structural invariants hold (agent still must confirm semantic coverage).
Exit 1 = a hard structural break; the message names the gap.

Usage:
  python3 _coverage_critic.py \\
    --engine ../../.claude/workflows/_src/engine.mjs \\
    --guide  ../../.claude/workflows/filament-v4-upgrade-guide.md \\
    --cards  extracted
"""
import argparse
import json
import os
import re
import sys

MARKERS = [
    ("knowledge", "// <knowledge:start>", "// <knowledge:end>"),
    ("fatal", "// <fatal:start>", "// <fatal:end>"),
    ("dimensions", "// <dimensions:start>", "// <dimensions:end>"),
]


def fail(msg):
    print(f"COVERAGE-CRITIC FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def extract_region(src, start, end, name):
    i = src.find(start)
    j = src.find(end)
    if i == -1 or j == -1 or j < i:
        fail(f"missing or misordered {name} markers ({start} .. {end}) in engine.mjs")
    region = src[i + len(start):j].strip()
    if not region:
        fail(f"{name} slot is empty between its markers")
    return region


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--guide", required=True)
    ap.add_argument("--cards", required=True)
    args = ap.parse_args()

    engine = open(args.engine, encoding="utf-8").read()
    regions = {name: extract_region(engine, start, end, name) for name, start, end in MARKERS}

    # FATAL_PATTERN_IDS: parse + non-empty + no orphan (each id referenced outside its own slot).
    fatal_ids = re.findall(r"'([a-z0-9-]+)'", regions["fatal"])
    if not fatal_ids:
        fail("FATAL_PATTERN_IDS slot has no parseable ids")
    engine_minus_fatal = engine.replace(regions["fatal"], "", 1)
    for fid in fatal_ids:
        if fid not in engine_minus_fatal:
            fail(f"fatal id '{fid}' appears only in FATAL_PATTERN_IDS, nowhere else in engine.mjs (orphan)")

    # Guide sanity: pattern-catalog section + a real set of '### Pattern N' headings.
    guide = open(args.guide, encoding="utf-8").read()
    if "(pattern catalog)" not in guide:
        fail("guide is missing the '(pattern catalog)' Phase 2 section")
    pattern_headings = re.findall(r"(?m)^### Pattern \d+", guide)
    if len(pattern_headings) < 10:
        fail(f"guide has only {len(pattern_headings)} '### Pattern N' headings; expected the full catalog")

    # Card tally by phase + category (the agent maps these to DIMENSIONS groups).
    card_files = sorted(f for f in os.listdir(args.cards) if f.endswith(".md"))
    if not card_files:
        fail(f"no extracted/*.md cards found under {args.cards}")
    tally_phase, tally_cat = {}, {}
    for f in card_files:
        head = open(os.path.join(args.cards, f), encoding="utf-8").read().split("\n---", 1)[0]
        ph = re.search(r"(?m)^phase:\s*(\S+)", head)
        cat = re.search(r"(?m)^category:\s*(\S+)", head)
        if ph:
            tally_phase[ph.group(1)] = tally_phase.get(ph.group(1), 0) + 1
        if cat:
            tally_cat[cat.group(1)] = tally_cat.get(cat.group(1), 0) + 1

    report = {
        "fatal_ids": fatal_ids,
        "guide_pattern_count": len(pattern_headings),
        "card_count": len(card_files),
        "cards_by_phase": tally_phase,
        "cards_by_category": tally_cat,
        "knowledge_slot_chars": len(regions["knowledge"]),
        "dimensions_slot_chars": len(regions["dimensions"]),
    }
    print("COVERAGE-CRITIC OK (structural). Agent must confirm semantic coverage from:")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 docs/filament-v4-upgrade-analysis/_coverage_critic_test.py`
Expected: `PASS: real bundle structural-OK`, `PASS: tampered engine fails and names the slot`, `ALL COVERAGE-CRITIC TESTS PASS`.

- [ ] **Step 5: Sanity-run the critic directly and read the report**

Run (from the worktree root):
```bash
python3 docs/filament-v4-upgrade-analysis/_coverage_critic.py \
  --engine .claude/workflows/_src/engine.mjs \
  --guide .claude/workflows/filament-v4-upgrade-guide.md \
  --cards docs/filament-v4-upgrade-analysis/extracted
```
Expected: `COVERAGE-CRITIC OK` + a JSON report showing `fatal_ids` (the 5), `card_count: 88`, and `cards_by_phase`/`cards_by_category` tallies.

- [ ] **Step 6: Commit**

```bash
git add docs/filament-v4-upgrade-analysis/_coverage_critic.py docs/filament-v4-upgrade-analysis/_coverage_critic_test.py
git commit -m "feat(extractor): coverage-critic precheck for the shared-engine slots"
```

---

### Task B4: Port the synthesis recipe into the extractor

**Files:**
- Create: `docs/filament-v4-upgrade-analysis/synthesis-recipe.md`

**Interfaces:**
- Consumes: the updated PUBMUS recipe from Task A2.
- Produces: the in-extractor synthesis spec (self-contained instructions for the synthesis step).

- [ ] **Step 1: Copy the updated recipe in**

```bash
cp /Users/bigmac/Projects/PUBMUS/docs/filament-v4-upgrade/synthesis-recipe.md \
   docs/filament-v4-upgrade-analysis/synthesis-recipe.md
```

- [ ] **Step 2: Localize the provenance note.** Edit `docs/filament-v4-upgrade-analysis/synthesis-recipe.md`.

old:
```markdown
(Authored in PUBMUS; the VLWPLA extractor branch is updated separately to emit this shape.)
```
new:
```markdown
(In-extractor copy. Synthesis runs from this directory: it regenerates `filament-v4-upgrade-guide.md`
from `extracted/*.md`, runs `_coverage_critic.py` + the agent semantic match, then the build gate. The
engine/templates/tooling under `.claude/workflows/` are a vendored fixture from the PUBMUS golden — do
NOT regenerate them here; only fill the guide and validate the slots.)
```

- [ ] **Step 3: Verify the recipe is self-contained**

Run: `grep -nE "Coverage critic|_coverage_critic|Build / validation gate|In-extractor copy" docs/filament-v4-upgrade-analysis/synthesis-recipe.md`
Expected: all four present.

- [ ] **Step 4: Commit**

```bash
git add docs/filament-v4-upgrade-analysis/synthesis-recipe.md
git commit -m "docs(extractor): port synthesis recipe (shared-engine + coverage critic)"
```

---

### Task B5: Update the deliverable prose in `_finalize.py` and `run-summary.md`

**Files:**
- Modify: `docs/filament-v4-upgrade-analysis/_finalize.py` (lines ~105-106)
- Modify: `docs/filament-v4-upgrade-analysis/run-summary.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: corrected deliverable descriptions (no "thin workflow"), so future `_finalize.py` runs and the committed run-summary describe the shared-engine bundle.

- [ ] **Step 1: Fix the deliverable list in `_finalize.py`.** Edit `docs/filament-v4-upgrade-analysis/_finalize.py`.

old:
```python
lines.append(f"- Thin workflow: `filament-v4-upgrade.workflow.js`")
```
new:
```python
lines.append("- Workflow bundle (shared-engine shape): `.claude/workflows/_src/engine.mjs` + the two "
             "`*.template.mjs`, inlined by `_assemble.mjs` into generated `filament-v4-{upgrade,polish}.mjs`; "
             "validated by `_assemble.mjs --check`, `_wfcheck.mjs`, and `node --test`.")
```

- [ ] **Step 2: Fix the `run-summary.md` deliverables + method prose.** Edit `docs/filament-v4-upgrade-analysis/run-summary.md`.

old:
```markdown
- Thin workflow: `filament-v4-upgrade.workflow.js`
```
new:
```markdown
- Workflow bundle (shared-engine shape): `.claude/workflows/_src/engine.mjs` + the two `*.template.mjs`, inlined by `_assemble.mjs` into generated `filament-v4-{upgrade,polish}.mjs`; validated by `_assemble.mjs --check`, `_wfcheck.mjs`, and `node --test`.
```

Then update the synthesis method sentence:

old:
```markdown
**Synthesis + completeness critic.** All cards + the existing project upgrade docs were folded into
the generic guide and the thin driver workflow, then a critic re-checked that every card's knowledge
is represented.
```
new:
```markdown
**Synthesis + coverage critic.** All cards + the existing project upgrade docs were folded into the
generic guide. The workflow itself is the vendored shared-engine bundle (not regenerated); a coverage
critic (`_coverage_critic.py` precheck + agent semantic match) re-checks that every card's breaking-change
class is represented across the guide + the engine's KNOWLEDGE/DIMENSIONS/FATAL slots.
```

- [ ] **Step 3: Verify no "thin" deliverable language survives**

Run: `grep -rni "thin workflow\|thin driver\|filament-v4-upgrade.workflow.js" docs/filament-v4-upgrade-analysis/_finalize.py docs/filament-v4-upgrade-analysis/run-summary.md || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add docs/filament-v4-upgrade-analysis/_finalize.py docs/filament-v4-upgrade-analysis/run-summary.md
git commit -m "docs(extractor): describe shared-engine bundle + coverage critic in run outputs"
```

---

## Final acceptance check (run in the VLWPLA worktree)

- [ ] `node .claude/workflows/_assemble.mjs --check` → `all generated workflows are up to date`
- [ ] `node .claude/workflows/_wfcheck.mjs .claude/workflows/filament-v4-*.mjs` → `SYNTAX OK` for both
- [ ] `node --test .claude/workflows/_src/__tests__/*.mjs` → all tests pass
- [ ] `python3 docs/filament-v4-upgrade-analysis/_coverage_critic_test.py` → all tests pass
- [ ] `ls .claude/workflows/filament-v4-upgrade.js docs/filament-v4-upgrade-analysis/filament-v4-upgrade.workflow.js 2>&1` → both **absent**
- [ ] `grep -nE "'pubmus'|app/Vendor/LaraZeus" .claude/workflows/_src/engine.mjs || echo "generic defaults confirmed"` → `generic defaults confirmed` (no PUBMUS-specific literal defaults survive in the vendored copy)
- [ ] `git -C /Users/bigmac/Projects/PUBMUS show HEAD~1:.claude/workflows/_src/engine.mjs | grep -c "knowledge:start"` (after Phase A) → the PUBMUS golden carries the markers
- [ ] Remove the temporary worktree when done: `cd /Users/bigmac/Projects/VLWPLA && git worktree remove ../VLWPLA-extractor`
