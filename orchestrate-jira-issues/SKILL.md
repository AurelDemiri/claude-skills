---
name: orchestrate-jira-issues
description: Use when the user provides one or more Jira issue keys (e.g. "VLWPLA-123 VLWPLA-456", "orchestrate these tickets", "process these issues in parallel", "work on these Jira issues") and wants them analyzed, triaged by implementation confidence, and implemented in parallel git worktrees without further user input during execution. Triggers on requests that combine multiple issue keys with verbs like orchestrate, process, work on, implement, parallelize, triage, dispatch. The skill is read-only against Jira and never pushes branches or opens PRs on its own.
---

# Orchestrate Jira Issues

## Overview

Take a batch of Jira issue keys and run them through four phases: **Analyze → Select → Implement → Report**. The main agent is the orchestrator and the DDEV / test-execution broker. Worker subagents run autonomously in isolated git worktrees and request tests via a file-queue, so the orchestrator's context stays small.

Workers do not ask the user questions. Plans are pre-approved. The orchestrator interacts with the user exactly twice: once at the start (selection) and once at the end (report).

## Required reading

Before starting, read these skills (they govern your behavior, not the worker's):

- `superpowers:dispatching-parallel-agents` — parallel work patterns
- `superpowers:using-git-worktrees` — worktree creation discipline
- `superpowers:verification-before-completion` — evidence before claims
- This skill's `test-gate-protocol.md` — request/response contract

## Hard rules

1. **Jira is read-only.** Never create, edit, comment on, or transition issues. Use MCP Atlassian's `get*`, `search*`, and `lookup*` tools only.
2. **No PRs, no pushes.** Workers commit to local worktree branches. Do not run `git push`, `bkt pr create`, or `gh pr create`.
3. **Treat Jira "AI-generated" / "Technische hint" sections as hypotheses.** Workers must verify them against the code.
4. **You broker the test-stick.** DDEV is one shared instance; all workers point at it. Workers run their own `ddev` and Chrome DevTools MCP calls, but only while they hold the stick (serializes DB state, Chrome session, queue). You grant/queue acquire requests, run Chrome cleanup between holders (DDEV stays up — no stop/start), and force-release if a worker dies holding it.
5. **Workers cannot ask the user anything.** If a worker hits an unresolvable ambiguity, it commits what it has, writes a `BLOCKED:` note in its plan file, and exits.

## The four phases

### Phase 1: Analyze

Dispatch one `jira-issue-analyzer` subagent **per issue key in parallel** (single message, multiple `Agent` calls, `subagent_type: "jira-issue-analyzer"`). That subagent definition carries the full analyzer contract — read-only tools, the workflow, the JSON schema, the confidence buckets, the "return ONLY JSON" rule. So the per-dispatch prompt stays tiny:

- The Jira key.
- The working directory (the main repo path).
- A one-line reminder: "Follow your analyzer instructions; return only the JSON assessment."

Each analyzer fetches the issue, reads linked Helpscout / Confluence / remote links, greps the repo for referenced symbols, verifies any "Technische hint" against the code, and returns a JSON block with this shape (the authoritative copy of this schema and the buckets lives in `agents/jira-issue-analyzer.md` — keep the two in sync if you change either):

```json
{
  "key": "VLWPLA-123",
  "title": "...",
  "summary": "2-3 sentence problem statement in plain English",
  "scope_files": ["app/Foo.php", "..."],
  "confidence": "high" | "medium" | "low" | "not_implementable",
  "confidence_reason": "one sentence",
  "risks": ["..."],
  "hint_verified": true | false | "no hint present"
}
```

**Confidence buckets:**

| Bucket | When to use |
|---|---|
| `high` | Clear scope, code path identified, low blast radius, hint (if any) verified or not needed |
| `medium` | Scope clear but multiple touchpoints, or hint unverified but plausible |
| `low` | Vague, missing info, security-sensitive without a clear safe fix, or requires guessing user intent |
| `not_implementable` | Needs human input, depends on unseeable production data, dangerous, or requires Jira write access |

Using the dedicated subagent (rather than `general-purpose`) keeps each analyzer's discovery work — file reads, grep output, reasoning — out of your transcript; you receive only the JSON.

### Phase 2: Select

Present the analyzed issues to the user with `AskUserQuestion` (`multiSelect: true`). Sort options high → low confidence. Format each option:

- **label**: `<KEY>: <one-line title>`
- **description**: `<confidence bucket> — <confidence_reason>`

Filter out `not_implementable` from the question entirely; mention them in your preamble text instead so the user knows you saw them.

Recommend the high-confidence ones in your preamble, e.g.: "Recommended: VLWPLA-123, VLWPLA-126. Medium-confidence ones are also offered; skip the low-confidence ones unless you want a triage attempt."

**If the user selects zero issues:** skip Phase 3 entirely. Do not create worktrees, do not set up `.claude/orchestrator/`, do not start the watcher — there are no workers to broker for. Go straight to a one-paragraph Phase 4 report: "No issues selected. Reviewed: [list]. Skipped because: [confidence reasons]. No worktrees created, no code changes." Then stop.

### Phase 3: Implement

For each selected issue:

#### 3a. Worktree setup (sequential, fast)

```bash
git worktree add ../worktrees/<KEY> -b <KEY>-impl
mkdir -p ../worktrees/<KEY>/.claude/plans
```

The orchestrator queue (`.claude/orchestrator/`) and worker plans (`.claude/plans/`) must not become git noise. Don't assume `.claude/` is gitignored project-wide — in this repo only specific sub-paths are (`.claude/settings.local.json`, `/.claude/worktrees`, `/.claude/projects`), so `.claude/orchestrator/` and `.claude/plans/` would otherwise show as untracked. Rather than editing the tracked `.gitignore` (which would itself be a committable change), add them to `.git/info/exclude` — a per-clone ignore list that is never committed:

```bash
printf '%s\n' '.claude/orchestrator/' '.claude/plans/' >> .git/info/exclude
```

Do this in the main repo (for the orchestrator queue) and in each worktree (for that worker's plan dir). `git worktree` gives each worktree its own `.git/info/exclude`, so apply it per worktree.

**Detect the DDEV mount once.** DDEV mounts the `approot` it was started in — almost always the main repo, NOT the worktrees. Workers that run `ddev php artisan test` from a worktree will execute the main repo's code unless told otherwise (see `test-gate-protocol.md` → "Shared-DDEV reality"). Determine which case applies and pass the answer into every worker's dispatch prompt:

```bash
ddev describe -j 2>/dev/null | jq -r '.raw.approot'
```

If that path equals a worker's worktree path, put `DDEV_MOUNT_MATCHES_WORKTREE: true` in its prompt. Otherwise (the normal case) put `DDEV_MOUNT_MATCHES_WORKTREE: false` plus the mounted main-repo path, so the worker uses copy-test-restore.

#### 3b. Set up the test-stick file queue (once, in the main repo)

First **archive any leftover state** from a previous run. Stale grant files or a stale `SENTINEL_ALL_DONE` will make the watcher replay old requests or exit immediately. Archive rather than delete — the prior `lock-log/` is a real audit trail and a wedged run's queue is useful for post-mortem:

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE=.claude/orchestrator/archive/${TS}
for d in lock-requests lock-grants lock-queue lock-releases lock-log; do
  if [ -d ".claude/orchestrator/$d" ] && [ -n "$(ls -A ".claude/orchestrator/$d" 2>/dev/null)" ]; then
    mkdir -p "$ARCHIVE/$d"
    mv .claude/orchestrator/$d/* "$ARCHIVE/$d/" 2>/dev/null || true
  fi
done
mv .claude/orchestrator/SENTINEL_ALL_DONE "$ARCHIVE/" 2>/dev/null || true
mkdir -p .claude/orchestrator/{lock-requests,lock-grants,lock-releases,lock-queue,lock-log}
```

The `archive/` subdir is never auto-cleaned — that's a manual housekeeping decision for the user.

Start the watcher in the background. Wrap it in `bash -c '...'` with `shopt -s nullglob` — `Monitor`'s shell treats an unmatched glob as a literal (zsh `nomatch` style), so a bare `for f in dir/*.json` over an empty dir would error. The loop also checks a sentinel at the top so it can terminate cleanly:

```bash
bash -c '
  shopt -s nullglob
  cd /abs/path/to/main-repo
  while true; do
    if [ -f .claude/orchestrator/SENTINEL_ALL_DONE ]; then
      echo "ALL_DONE"; break
    fi
    for f in .claude/orchestrator/lock-requests/*.json; do
      id=$(basename "$f" .json)
      mv "$f" .claude/orchestrator/lock-queue/"$id".json 2>/dev/null && echo "REQUEST: $id"
    done
    for f in .claude/orchestrator/lock-releases/*.release; do
      id=$(basename "$f" .release)
      echo "RELEASE: $id"
      mv "$f" .claude/orchestrator/lock-log/"$id".release 2>/dev/null
    done
    sleep 2
  done
'
```

Run via `Bash` with `run_in_background: true`; the response gives you the output-file path. Then attach `Monitor` to that file:

```text
Monitor command:  tail -f <bash-output-file> | grep -E --line-buffered "^(REQUEST|RELEASE|ALL_DONE)"
timeout_ms:       3600000
persistent:       false
```

To terminate when all workers are done: `echo "DONE" > .claude/orchestrator/SENTINEL_ALL_DONE`. The watcher prints `ALL_DONE` and exits, and Monitor stops on that line.

#### 3c. Dispatch workers in parallel

In a single message, call `Agent` once per selected issue with `subagent_type: "jira-issue-worker"` and `run_in_background: true`. The `jira-issue-worker` definition already carries the cardinal rules (stay in worktree, acquire-before-ddev, Jira read-only, no pushes, verify hints, the `timeout: 600000` requirement on blocking Bash calls). So the dispatch prompt only needs the issue-specific context. Use this template, filling every `{placeholder}`:

```text
Implement Jira issue {KEY} autonomously. Your plan is pre-approved — do not seek confirmation. On unresolvable ambiguity, commit what you have, append a `BLOCKED:` line to your plan, and exit.

# Issue
Key: {KEY}
Title: {TITLE}
Summary (from analysis): {SUMMARY}
Pre-approved scope_files: {SCOPE_FILES}
Known risks: {RISKS}
Hint status: {HINT_VERIFIED}  (treat any Jira "Technische hint" as a hypothesis — verify against code)

# Workspace
Worktree (work ONLY here): {WORKTREE_PATH}
Branch: {KEY}-impl   Commit prefix: "{KEY}: "
Base branch: {BASE_BRANCH}
Plan doc to write before any code: {WORKTREE_PATH}/.claude/plans/{KEY}.md

# Test-stick (see your agent instructions + the protocol)
Lock dirs (absolute):
  requests: {MAIN_REPO}/.claude/orchestrator/lock-requests/
  grants:   {MAIN_REPO}/.claude/orchestrator/lock-grants/
  releases: {MAIN_REPO}/.claude/orchestrator/lock-releases/
Acquire the stick before ANY ddev/Chrome call; release when your TDD cycle is done. Pass timeout:600000 on every Bash call that blocks on a grant file.

# DDEV mount
DDEV_MOUNT_MATCHES_WORKTREE: {true|false}
Mounted main-repo path: {MAIN_REPO}
If false, use the copy-test-restore pattern from the protocol (mirror changed files into {MAIN_REPO}, test, restore, verify main repo is clean before releasing).

# Done when
Return a single ≤200-word summary: outcome, commits, tests added/kept/dropped with rationale, final test result (PASS/FAIL/NOT RUN), your confidence, residual risks, plan-doc path.
```

#### 3d. Broker the stick while workers run

You will now receive two streams of notifications:

1. **Monitor** stream — `REQUEST: <id>` and `RELEASE: <id>` events.
2. **Background agent** notifications — worker completion.

Maintain a single state variable: `current_holder` (worker_id+seq or `None`).

**Single-worker fast path:** if only one issue was selected in Phase 2, there is no contention — every grant is unconditional and immediate. You can skip reading `lock-queue/` to "see who's next" (you know it's empty) and skip Chrome cleanup between that worker's successive acquires (the only previous holder is itself, which released cleanly). Keep following the protocol otherwise — still write each grant file and read each release receipt — because the file-queue is the audit trail and you don't want the worker's prompt or your own logic to diverge between single- and multi-worker runs.

**On `REQUEST: <id>`:**

1. If `current_holder` is None → grant immediately (see grant step below).
2. Otherwise → leave in `lock-queue/`; it will be picked up on next release.

**On `RELEASE: <id>`:**

1. Read the release receipt from `lock-log/<id>.release`. Note `exit_state` and `left_running`.
2. Clear `current_holder`.
3. Pick the oldest entry in `lock-queue/` (if any). Grant it.

**Grant step (issuing the stick):**

1. Inspect the request and the previous holder's release.
2. Run cleanup as needed (DDEV is shared and stays up; do NOT stop/start it):
   - Previous holder had `purpose: browser` or `exit_state: "dirty"` → `mcp__chrome-devtools-mcp__list_pages` + `close_page` on any orphans, and as a backstop `pkill -f 'Google Chrome.*--remote-debugging' 2>/dev/null || true`.
   - Otherwise no cleanup needed.
3. Write `lock-grants/<id>.lock` with cleanup notes (see protocol schema).
4. Set `current_holder = <id>`.
5. Append `lock-log/<id>.granted` for audit.

**On background-agent completion (worker finished entirely):**

If that worker still appears to hold the stick (no release file ever arrived), force-release: close all Chrome pages, clear `current_holder`, grant the next queued request. DDEV stays up regardless.

When all workers have completed, echo `ALL_DONE` to the watcher's sentinel file and let Monitor exit.

**You do not run tests.** Workers run their own `ddev` and DevTools commands in their own worktree while holding the stick. You only broker.

### Phase 4: Report

Build a single report for the user:

```
## VLWPLA-123: <title>
- Worktree: /abs/path/to/worktrees/VLWPLA-123
- Branch: VLWPLA-123-impl
- Commits: 3 (`git log --oneline VLWPLA-123-impl ^develop`)
- Tests added: 2 (Pest, see tests/Feature/...)
- Tests removed/kept: <list with rationale>
- Final test run: PASS / FAIL / NOT RUN
- Worker confidence in result: high/medium/low
- Open questions / residual risks: ...
- Plan doc: .claude/plans/VLWPLA-123.md (inside worktree)
```

Repeat per issue. Then, if any issues were NOT implemented, account for them explicitly so nothing looks like it silently fell through:

```
### Not implemented this run

- VLWPLA-XXX: <confidence bucket> — <why skipped (user deselected / triaged out)>
- VLWPLA-YYY: not_implementable — <analyzer's reason; filtered before selection>
```

Omit this section entirely if every analyzed issue was implemented (don't print "None"). Include `not_implementable` issues that you filtered out of the Phase 2 question before the user saw them — the user should know you considered them.

At the end, list the next manual steps:
- "Review each worktree's diff."
- "When ready, run `bkt pr create` yourself (per memory rule)."
- "Run `git worktree remove <path>` once merged."

**Do not auto-clean worktrees.** The user inspects them.

## Watcher / Monitor failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Monitor times out before any worker finishes | Watcher script not emitting events | Check the watcher's bash shell is still alive; restart if not |
| Two workers think they hold the stick | Watcher race or duplicate grant | Force-release both; have them re-acquire with `seq+1` |
| Worker blocks forever on a grant file | You never granted (queue oversight) or watcher missed the request | `ls .claude/orchestrator/lock-queue/` to find it; grant manually |
| Worker's tests fail with DB-state surprises | Previous holder left fixture data; tests assumed empty DB | Workers should refresh their own DB (`RefreshDatabase` trait) and not depend on cross-session state |
| Worker exits without releasing the stick | Crash, timeout, or buggy worker | On its completion notification, force-release with aggressive cleanup |

## Worker contract summary (full version in test-gate-protocol.md)

Workers receive a fully self-contained prompt. They MUST:

- Use the `jira-issue-worker` subagent type.
- Work only inside their assigned worktree path.
- Write the plan to `<worktree>/.claude/plans/<KEY>.md` before any code changes.
- Acquire the test-stick before any `ddev` command or Chrome DevTools MCP call. Release when done.
- Commit with `<KEY>: <message>` prefix per local convention.
- Verify Jira "Technische hint" claims against the code before acting on them.
- Be ruthless about test value: prefer one regression test that captures the bug over five speculative unit tests.
- On unresolvable ambiguity, leave a `BLOCKED:` line in the plan and exit cleanly.

## Common mistakes

- **Letting workers run `ddev` without holding the stick.** DDEV is shared. Two workers running `ddev php artisan test` simultaneously will trample each other's DB state and queue. The acquire-before-touch rule must be in every worker prompt.
- **Assuming `ddev` in a worktree runs the worktree's code.** It runs the mounted main repo's code (see the DDEV-mount detection in 3a). A worker's new test file in the worktree is invisible to the container until copy-test-restore mirrors it into the mount. Always set `DDEV_MOUNT_MATCHES_WORKTREE` in the dispatch prompt.
- **Keeping orchestrator scratch out of git via the tracked `.gitignore`.** Editing `.gitignore` is itself a committable change. Use `.git/info/exclude` (per-clone, never committed) for `.claude/orchestrator/` and `.claude/plans/` instead.
- **Auto-pushing branches.** Violates `feedback_no_pr_without_consent.md`. Stop at local commit.
- **Treating Jira hints as facts.** Hint sections are hypotheses (per `feedback_verify_jira_descriptions.md`); workers verify against code first.
- **Skipping the report.** The user's only window into worker decisions is the final report. Include rationale for kept/dropped tests.
- **Running the analyzer phase serially.** Always parallel — `Agent` calls in a single message.
- **Running tests yourself "to verify."** You're the broker, not the runner. Workers test inside their own worktrees while holding the stick. You never run `ddev` at all — the cleanup between holders is Chrome-only because DDEV is shared and stays up.

## Trigger phrases (CSO)

- "orchestrate VLWPLA-123 VLWPLA-456"
- "work on these tickets in parallel"
- "process these Jira issues"
- "triage and implement these issues"
- "dispatch agents for these issues"
- "parallelize work across these tickets"
- Any message containing 2+ Jira issue keys + an implementation verb
