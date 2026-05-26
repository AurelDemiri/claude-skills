# Test-Stick Protocol

The contract between orchestrator (main agent) and `jira-issue-worker` subagents for exclusive access to the shared test environment (DDEV, Chrome DevTools MCP).

## Mental model: the stick

Only one worker holds the "test-stick" at a time. While you hold it, you may run tests against the shared DDEV instance and control the Chrome DevTools MCP browser. When you're done, you release it, and the orchestrator hands it to the next waiting worker.

The orchestrator does NOT run tests for you. It is purely the broker.

**DDEV is one shared instance.** All workers point at the same DDEV project (same database, same web container, same ports). The stick serializes test runs so they don't trample each other's database state, fixture data, queue, or Chrome session. DDEV does NOT get stopped/started between holders.

## Shared-DDEV reality: the worktree is NOT mounted

This is the single most important thing to understand, and it's easy to get wrong.

DDEV mounts the **main repo** — the `approot` from `.ddev/config.yaml`, which is the directory where `ddev start` was first run (e.g. `/Users/bigmac/Projects/VLWPLA`). It does **not** mount your worktree at `../worktrees/<KEY>`. So when you `cd` into your worktree and run `ddev php artisan test`, the container executes the **main repo's** copy of the code, not the files you just edited in the worktree. A new test file that exists only in your worktree is **invisible** to the container and will report as "no tests found".

The orchestrator tells you in your dispatch prompt whether this applies via `DDEV_MOUNT_MATCHES_WORKTREE: true|false`:

- **`true`** (rare — DDEV was started inside the worktree, or mounts are configured per-worktree): run `ddev php artisan test` directly from your worktree. Nothing special.
- **`false`** (the normal case): use the **copy-test-restore** pattern below.

### Copy-test-restore (the supported pattern when the mount is the main repo)

While holding the stick, mirror your changed files into the main repo, run the test there, then restore the main repo to its original state before releasing:

```bash
MAIN=/Users/bigmac/Projects/VLWPLA          # the mounted approot (from your dispatch prompt)
WORKTREE="$(pwd)"
BACKUP=$(mktemp -d)

# Files you changed relative to the base branch (tracked) — add untracked test files explicitly if needed
CHANGED=$(git diff --name-only develop; git ls-files --others --exclude-standard)

# Back up main's versions, copy your worktree versions in
for f in $CHANGED; do
  if [ -f "$MAIN/$f" ]; then
    mkdir -p "$BACKUP/$(dirname "$f")"; cp "$MAIN/$f" "$BACKUP/$f"
  else
    echo "$f" >> "$BACKUP/.new_in_main"        # track files that must be removed on restore
  fi
  mkdir -p "$MAIN/$(dirname "$f")"; cp "$WORKTREE/$f" "$MAIN/$f"
done

# Run the test against the mounted main repo
( cd "$MAIN" && ddev php artisan test --compact --filter=YourFilter )
TEST_EXIT=$?

# Restore main to its original state
for f in $CHANGED; do
  if [ -f "$BACKUP/$f" ]; then cp "$BACKUP/$f" "$MAIN/$f"; fi
done
while IFS= read -r f; do rm -f "$MAIN/$f"; done < "$BACKUP/.new_in_main" 2>/dev/null
rm -rf "$BACKUP"

# Sanity check: main repo must be clean again
( cd "$MAIN" && git status --porcelain )       # expect empty output
```

**Why this is safe:** the stick guarantees only one worker is mutating the main repo at a time. Without the stick this pattern is forbidden — two workers copying into the same main repo would overwrite each other's test files and produce garbage results.

**Restore is not optional.** If for any reason you cannot restore the main repo to a clean `git status` (a copy failed, you were interrupted, the test left artifacts), set `exit_state: "dirty"` in your release receipt so the orchestrator runs aggressive cleanup and warns the next holder. A dirty main repo silently breaks the next worker's test run. Verify `git status --porcelain` on the main repo is empty before you release; if it isn't, restore the offending paths with `git -C "$MAIN" checkout -- <path>` (tracked) or `rm` (untracked), then re-check.

## Directory layout

Inside the project repo (gitignored, the orchestrator creates these at start of Phase 3):

```
.claude/orchestrator/
├── lock-requests/   # worker writes an acquire request here
├── lock-grants/     # orchestrator writes a grant file here (worker watches it)
├── lock-releases/   # worker writes a release receipt here
├── lock-queue/      # orchestrator parks pending requests here while another holds the stick
└── lock-log/        # append-only audit log
```

The orchestrator maintains a single in-memory "current holder" (worker_id or None). The protocol survives orchestrator restarts because grant files persist on disk — on resume, the orchestrator scans the dirs and reconstructs state.

**Timestamps.** Every timestamp in every JSON file below (`requested_at`, `granted_at`, `released_at`) is produced by `date -u +%FT%TZ` — UTC, ISO 8601, e.g. `2026-05-18T10:30:00Z`. Both sides generate them this way; do not hand-format timestamps, on either the worker or orchestrator side.

## Acquire request: `lock-requests/<worker-id>-<seq>.json`

Worker writes atomically (`.tmp` then `mv`):

```json
{
  "worker_id": "VLWPLA-123",
  "seq": 1,
  "purpose": "ddev_test" | "browser" | "ddev_general",
  "worktree_path": "/abs/path/to/worktrees/VLWPLA-123",
  "rationale": "Run the new attendance regression test (Pest, single file).",
  "requested_at": "2026-05-18T10:30:00Z"
}
```

**Required:** `worker_id`, `seq`, `purpose`, `worktree_path`, `rationale`.

`purpose` exists so the orchestrator can decide what cleanup to run between holders (see below).

## Grant file: `lock-grants/<worker-id>-<seq>.lock`

Orchestrator writes when the stick is granted:

```json
{
  "worker_id": "VLWPLA-123",
  "seq": 1,
  "granted_at": "2026-05-18T10:30:05Z",
  "previous_holder": "VLWPLA-456",
  "cleanup_performed": [
    "killed 1 orphan chrome process",
    "closed 2 leftover chrome-devtools-mcp pages"
  ],
  "chrome_state": "no_pages_open",
  "note": "DDEV is up and shared. Test against the mounted main repo (copy-test-restore if your worktree isn't the mount). Release when done."
}
```

The presence of the file = granted. The worker reads it for cleanup context.

## Release receipt: `lock-releases/<worker-id>-<seq>.release`

Worker writes when done with the stick:

```json
{
  "worker_id": "VLWPLA-123",
  "seq": 1,
  "released_at": "2026-05-18T10:32:18Z",
  "chrome_pages_open": 0,
  "db_state": "migrated" | "refreshed" | "untouched" | "unknown",
  "exit_state": "clean" | "dirty",
  "note": "ran 1 pest test, no chrome pages, db refreshed via RefreshDatabase trait."
}
```

`exit_state: "dirty"` warns the orchestrator that aggressive cleanup is needed before next grant. `db_state` is informational — workers expect to migrate/refresh as their tests need; nothing is preserved between holders.

## Worker-side: acquire + work + release (single bundled bash call)

The most token-efficient pattern: bundle the entire cycle into one Bash call.

> **⚠️ MUST pass `timeout: 600000` (10 min) on any Bash call that blocks on a grant file.** The Bash tool defaults to 2 minutes; without the override, the `until` loop will be killed mid-wait and the worker will think the orchestrator never granted. This applies whether the worker bundles acquire+work+release or splits them into separate Bash calls — every blocking call gets `timeout: 600000`.

```bash
# Inside the worktree
KEY=VLWPLA-123
SEQ=1
REQ=.claude/orchestrator/lock-requests/${KEY}-${SEQ}.json
GRANT=.claude/orchestrator/lock-grants/${KEY}-${SEQ}.lock
REL=.claude/orchestrator/lock-releases/${KEY}-${SEQ}.release

# 1. Write request
cat > ${REQ}.tmp <<JSON
{
  "worker_id": "${KEY}",
  "seq": ${SEQ},
  "purpose": "ddev_test",
  "worktree_path": "$(pwd)",
  "rationale": "Run attendance regression test",
  "requested_at": "$(date -u +%FT%TZ)"
}
JSON
mv ${REQ}.tmp ${REQ}

# 2. Wait for the stick
until [ -f ${GRANT} ]; do sleep 3; done
cat ${GRANT}  # so output is visible

# 3. Do the work (worker now holds the stick — DDEV is already up and shared)
ddev php artisan test --compact --filter=AttendanceTest
TEST_EXIT=$?
# (worker decides what else to do, may run multiple commands)

# 4. Release
cat > ${REL}.tmp <<JSON
{
  "worker_id": "${KEY}",
  "seq": ${SEQ},
  "released_at": "$(date -u +%FT%TZ)",
  "chrome_pages_open": 0,
  "db_state": "refreshed",
  "exit_state": "clean",
  "note": "ran 1 pest test against shared DDEV; no chrome pages"
}
JSON
mv ${REL}.tmp ${REL}

exit ${TEST_EXIT}
```

Or split into separate Bash calls if the worker needs to inspect output between steps (still set `timeout: 600000` on the blocking call). The bundled form is cheapest.

## Orchestrator-side: brokerage loop

After dispatching all workers in background, run a watcher background script:

```bash
# Watcher: prints events to stdout when files appear
while true; do
  for f in .claude/orchestrator/lock-requests/*.json; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .json)
    mv "$f" .claude/orchestrator/lock-queue/${id}.json 2>/dev/null \
      && echo "REQUEST: $id"
  done
  for f in .claude/orchestrator/lock-releases/*.release; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .release)
    echo "RELEASE: $id"
    mv "$f" .claude/orchestrator/lock-log/${id}.release 2>/dev/null
  done
  sleep 2
done
```

Attach `Monitor` to that shell. Handle each event:

**On `REQUEST: <id>`:**

1. Read `.claude/orchestrator/lock-queue/<id>.json`.
2. If no current holder, **grant immediately** (skip to step 4).
3. Otherwise, leave it in `lock-queue/`. It will be picked up when the current holder releases.
4. **Grant:**
   - Determine cleanup needed based on previous holder's `exit_state` and `purpose`:
     - Previous purpose `browser` OR `exit_state: "dirty"` → close any leftover Chrome DevTools MCP pages (`mcp__chrome-devtools-mcp__list_pages` then `close_page` for each) and as a backstop `pkill -f 'Google Chrome.*--remote-debugging' 2>/dev/null || true`.
     - DDEV is shared — **do not** stop/start it. Leave it running.
     - If the new request's `purpose` involves database work and the previous holder also did DB work, no cleanup is needed beyond what test isolation traits (`RefreshDatabase`) already provide.
   - Write `lock-grants/<id>.lock` with cleanup notes.
   - Set current holder = `<id>`.
   - Append to `lock-log/<id>.granted` for audit.

**On `RELEASE: <id>`:**

1. Read the release file (now moved to `lock-log/`).
2. Clear current holder.
3. Check `lock-queue/` for waiting requests. If any, grant the oldest one (repeat the grant step).

**On background-agent completion notification** (a worker finished entirely):

1. Note the worker is done. If it still appears to hold the stick (no release file ever appeared), force-release: kill its DDEV, kill any Chrome it left, treat as `dirty` for the next holder.

When all workers have completed, kill the watcher and proceed to Phase 4 (report).

## Cleanup commands cheat-sheet

```bash
# Chrome (via MCP, preferred): close all open pages
# Use mcp__chrome-devtools-mcp__list_pages, then close_page for each

# Chrome (Mac, backstop): kill any chrome started by DevTools MCP
pkill -f 'Google Chrome.*--remote-debugging' 2>/dev/null || true
```

DDEV stays up — no `ddev stop` / `ddev poweroff` between holders. The whole point of the shared instance is that you don't pay startup cost on every transition.

## When NOT to release

The worker should NOT release after every single command. If a worker plans to run a failing test, then implement the fix, then re-run the test — that's all one stick-holding session. Release happens once at the end of the TDD cycle.

Hold the stick for ~minutes at a time, not seconds. Long enough to do useful work; not so long that other workers starve.

**Anti-pattern (do not do this):**

```
acquire → ddev php artisan test --filter=X (fails) → release
acquire → edit one file → ddev php artisan test --filter=X (still fails) → release
acquire → edit again → ddev php artisan test --filter=X (passes) → release
```

That's three acquires for one TDD cycle. With other workers waiting, each of those releases handed the stick away and made you re-queue behind them for no reason — and each grant cost the orchestrator a cleanup decision. The editing between test runs needs no stick (you edit files in your worktree, which never touches DDEV or Chrome), so there was never a reason to let go.

**Correct pattern:** acquire once, run the whole red → green → refactor loop (and the copy-test-restore dance, if applicable) inside that single hold, release once.

Release only when:
- You've finished all the DDEV/browser work for this milestone — e.g. the test passes, you've committed, and the next thing on your plan is reading or editing files.
- You expect a long pause before your next DDEV call (more than ~5 minutes of thinking or reading).

If a worker discovers it needs much more time than expected (e.g., a slow integration test that takes 5 min), it should still hold; the orchestrator handles waiting in `lock-queue/`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Worker waits forever on grant | Orchestrator stuck or didn't see the request | Check `lock-queue/` and `lock-grants/` manually. If a previous holder crashed without releasing, force-release. |
| Two workers think they hold the stick | Watcher race or grant file written twice | Workers must check `lock-grants/<their-id>.lock` exists *and* `lock-log/` has no later grants. If conflict, both should release and re-request with `seq+1`. |
| Chrome leaks between workers | Cleanup not triggered | Always run Chrome cleanup before granting to any worker whose previous holder had `purpose: browser`. |
| DDEV port collision | Previous holder left a different project running | Run `ddev poweroff` (global) as cleanup before grant if previous worktree ≠ new worktree. |
| Worker process killed mid-hold | Crash, timeout | On its completion notification, orchestrator treats as `exit_state: "dirty"` and force-cleans Chrome. |
| Worker's tests interfered with another worker's DB state | Two holders' database expectations conflicted | Workers should use `RefreshDatabase` / equivalent to start from a known state each session. Don't depend on database state surviving a release. |

## Why this design (token economics)

- Worker's whole acquire-work-release is **one bash call** in the common case. Minimal tool-call overhead.
- Orchestrator sees only small JSON files per event. No test output flowing through the orchestrator's context.
- Worker keeps its own test output in its own context where it's needed for debugging — no double-encoding.
- Audit trail is on disk (`lock-log/`), not in orchestrator's transcript.
