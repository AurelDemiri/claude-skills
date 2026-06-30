---
name: filament-v4-upgrade
description: Drive a full Filament v3->v4 + Tailwind v3->v4 upgrade on a Statik-shaped Laravel repo (Shield, statikbe/* packages, DDEV, Pint, Pest). Runs the interactive bootstrap pre-flight (filament/upgrade tooling, auth.json, blueprint+boost, vendor/bin/filament-v4, composer update), then launches the autonomous filament-v4-upgrade-run workflow for the breaking-change, tailwind, package-compat and verification phases. Use when asked to upgrade Filament to v4.
---

# Filament v4 upgrade — bootstrap + launch

This skill performs the **interactive bootstrap** in the main session (things a background
workflow cannot do: private-repo auth, MCP setup, restarting Claude Code), then launches the
autonomous `filament-v4-upgrade-run` workflow which drives the code phases.

**Each step below is idempotent — verify first, skip/confirm if already done (e.g. this repo may
already be on v4).** Create one todo per step.

## Pre-flight checklist

1. **Clean tree + dedicated branch.** Confirm `git status` is clean and you are on an upgrade branch
   (create `feature/filament-v4` if not). Refuse to proceed on a dirty tree or the default branch.
2. **Install the official upgrade tooling:** `ddev composer require filament/upgrade:"^4.0" -W --dev`.
3. **Relax internal deps.** In `composer.json`, temporarily remove/relax the `statikbe/*` (and any
   other internal/private) version constraints so the core bump can resolve. Record exactly what was
   relaxed — the workflow's package-compat phase re-adds them at v4 tags.
4. **auth.json.** Ensure `auth.json` holds the credentials for private/Composer repos (the `statikbe/*`
   Satis/GitHub tokens). If missing, help the user create it; never commit it.
5. **Dev tooling for the agents:** `ddev composer require --dev filament/blueprint laravel/boost`,
   then `ddev php artisan boost:install` (check `--help` for a non-interactive flag; otherwise guide
   the user through the prompts).
6. **Boost MCP gate (HARD STOP).** Ensure `.mcp.json` registers the Laravel Boost MCP server. Then
   **stop and ask the user to restart Claude Code** so the Boost MCP tools are live — the workflow's
   audit/verify subagents depend on `search-docs`. Do not continue until confirmed.
7. **Run the upgrade script:** `ddev php vendor/bin/filament-v4`. Then run the commands it prints —
   typically `ddev composer require filament/filament:"~4.0" -W --no-update` then `ddev composer update`.
   Confirm the app boots (`ddev php artisan about`).

## Launch

8. Launch the autonomous workflow for the breaking-change → tailwind → package-compat → verification
   phases (each gated on tests + pint + analyse + build + panel crawl, committed per green phase,
   never pushed):

   `Workflow({ name: "filament-v4-upgrade-run" })`

   It runs in the background; watch with `/workflows`. Optionally pass `args` to override repo shape
   for a non-PUBMUS repo (see `buildConfig` defaults in `.claude/workflows/_src/engine.mjs`:
   `ddev`, `panelProviders`, `themeCss`, `testDir`, `gate.*`, `packagePins`, `pintScope`).

## Notes
- Steps 2–7 are **main-session only** (private auth + MCP restart) — never attempt them inside the
  background workflow.
- The full pattern catalog the workflow applies lives in
  `.claude/workflows/filament-v4-upgrade-guide.md` (read at runtime by the agents).
- For polishing an already-near-done upgrade instead of a full one, run `filament-v4-polish`.
