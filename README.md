# claude-skills

Personal skills for [Claude Code](https://docs.claude.com/en/docs/claude-code/).

Each subdirectory is a self-contained skill. To use them locally, clone into
`~/.claude/skills/` (or symlink individual skills there).

Some skills bundle their own subagent definitions under `<skill>/agents/`. Those
must be symlinked into `~/.claude/agents/` for the skill to dispatch them, e.g.:

```
ln -s ~/Projects/claude-skills/orchestrate-jira-issues/agents/jira-issue-worker.md \
      ~/.claude/agents/jira-issue-worker.md
```

## Skills

- **bad-data-analyser** — forensic check of a dataset for capped/clipped or fabricated values (Benford, MySQL TIME cap, INT32 saturation, Faker fingerprints, …).
- **orchestrate-jira-issues** — take a batch of Jira issue keys through Analyze → Select → Implement → Report, running pre-analyzed issues as parallel workers in isolated git worktrees with a file-queue test-stick broker. Bundles the `jira-issue-worker` subagent (`agents/`).
