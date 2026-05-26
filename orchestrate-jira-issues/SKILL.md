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

Dispatch one analyzer subagent **per issue key in parallel** (single message, multiple `Agent` calls). Each analyzer:

1. Fetches the issue via `mcp__claude_ai_Atlassian__getJiraIssue`.
2. Reads any linked Helpscout / Confluence / remote links.
3. Greps the repo for symbols / files mentioned in the issue.
4. Returns a JSON block with this exact shape:

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
| `low` | Vague, missing info, or requires guessing user intent |
| `not_implementable` | Needs human input, dangerous, or requires Jira write access |

Analyzers must use **read-only tools only** — no edits, no branches, no commits. Limit each to 4-5 minutes of work.

### Phase 2: Select

Present the analyzed issues to the user with `AskUserQuestion` (`multiSelect: true`). Sort options high → low confidence. Format each option:

- **label**: `<KEY>: <one-line title>`
- **description**: `<confidence bucket> — <confidence_reason>`

Filter out `not_implementable` from the question entirely; mention them in your preamble text instead so the user knows you saw them.

Recommend the high-confidence ones in your preamble, e.g.: "Recommended: VLWPLA-123, VLWPLA-126. Medium-confidence ones are also offered; skip the low-confidence ones unless you want a triage attempt."

### Phase 3: Implement

For each selected issue:

#### 3a. Worktree setup (sequential, fast)

```bash
git worktree add ../worktrees/<KEY> -b <KEY>-impl
mkdir -p ../worktrees/<KEY>/.claude/plans
```

The `.claude/` directory is gitignored project-wide. Confirm by checking `.gitignore` includes `.claude/` or `/.claude` before dispatching workers. If it doesn't, add it to the repo's `.gitignore` in the worktree only — do NOT commit that change yet; it goes in with the worker's first commit if relevant.

#### 3b. Set up the test-stick file queue (once, in the main repo)

```bash
mkdir -p .claude/orchestrator/{lock-requests,lock-grants,lock-releases,lock-queue,lock-log}
```

Start the watcher in the background and attach `Monitor`:

```bash
# Watcher: emits REQUEST: <id> and RELEASE: <id> events
while true; do
  for f in .claude/orchestrator/lock-requests/*.json; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .json)
    mv "$f" .claude/orchestrator/lock-queue/"$id".json 2>/dev/null \
      && echo "REQUEST: $id"
  done
  for f in .claude/orchestrator/lock-releases/*.release; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .release)
    echo "RELEASE: $id"
    mv "$f" .claude/orchestrator/lock-log/"$id".release 2>/dev/null
  done
  sleep 2
done
```

Run via `Bash` with `run_in_background: true`. Attach `Monitor` to that shell ID with a pattern like `^(REQUEST|RELEASE): `. End the loop by echoing `ALL_DONE` to a sentinel file and having Monitor's `until` match `^ALL_DONE$`.

#### 3c. Dispatch workers in parallel

In a single message, call `Agent` once per selected issue with:
- `subagent_type: "jira-issue-worker"`
- `run_in_background: true`
- A self-contained prompt (the worker won't see this conversation) that includes:
  - The Jira key
  - The absolute worktree path
  - The absolute paths of `lock-requests/`, `lock-grants/`, `lock-releases/`
  - The full pre-approved scope from Phase 1 analysis (title, summary, scope_files, risks)
  - Branch name and commit-message prefix (`<KEY>: `)
  - The stick rule: must acquire before running `ddev` or Chrome DevTools MCP; must release when done

See `test-gate-protocol.md` for the exact worker prompt template.

#### 3d. Broker the stick while workers run

You will now receive two streams of notifications:

1. **Monitor** stream — `REQUEST: <id>` and `RELEASE: <id>` events.
2. **Background agent** notifications — worker completion.

Maintain a single state variable: `current_holder` (worker_id+seq or `None`).

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

Repeat per issue. At the end, list the next manual steps:
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
- **Forgetting to gitignore `.claude/`.** The orchestrator queue and worker plans are not committable.
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
