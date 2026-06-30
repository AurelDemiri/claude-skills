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

Some skills bundle a `<skill>/workflows/` directory (reusable Workflow scripts +
their docs). Those install into a **project's** `.claude/workflows/`, not the global
`~/.claude/`, e.g.:

```
cp -R ~/Projects/claude-skills/filament-v4-upgrade/workflows/ \
      /path/to/project/.claude/workflows/
```

## Skills

- **bad-data-analyser** — forensic check of a dataset for capped/clipped or fabricated values (Benford, MySQL TIME cap, INT32 saturation, Faker fingerprints, …).
- **orchestrate-jira-issues** — take a batch of Jira issue keys through Analyze → Select → Implement → Report, running pre-analyzed issues as parallel workers in isolated git worktrees with a file-queue test-stick broker. Bundles the `jira-issue-worker` subagent (`agents/`).
- **filament-v4-upgrade** — drive a full Filament v3→v4 + Tailwind v3→v4 + Shield v3→v4 upgrade on a Statik-shaped Laravel repo: interactive bootstrap then an autonomous, gated multi-agent workflow. Bundles the shared-engine Workflow scripts (`workflows/`) and the methodology behind them (`docs/`, incl. the commit-mining → shared-engine playbook). See [`filament-v4-upgrade/workflows/README.md`](filament-v4-upgrade/workflows/README.md).
