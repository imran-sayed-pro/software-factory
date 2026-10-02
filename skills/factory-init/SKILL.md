---
name: factory-init
description: Sets a repository up for the software factory. Detects the stack, writes CONSTRAINTS.md (the quality bar with a command per rule), DONE.md, AGENTS.md and CLAUDE.md, and the .factory/ folders for specs, cards, plans and runs. Use when starting to use the factory in a repo, when someone says "set up the factory", "bootstrap the factory", "initialize the software factory", or when CONSTRAINTS.md or .factory/config.json is missing.
---

# Factory init

## Overview

Prepares a repository so the other factory skills can run: a written quality bar
(`CONSTRAINTS.md`), a fixed Definition of Done (`DONE.md`), the agent rulebook (`AGENTS.md`,
imported by `CLAUDE.md`), runtime config, and the `.factory/` folders. It is idempotent: re-running
refreshes the factory-owned parts and never overwrites a human's edits.

## When to use

- First use of the factory in a repo, or `.factory/config.json` / `CONSTRAINTS.md` is missing.
- The stack changed (a new language added) and the commands need refreshing.

**When not to use:** to *change* the quality bar for a feature (that is a separate human-reviewed
pull request, never part of feature work).

## Inputs and outputs

- Reads: repo markers (`package.json`, `pyproject.toml`, `Package.swift`, …), the plugin's `profiles/` and `templates/`.
- Writes: `CONSTRAINTS.md`, `DONE.md`, `AGENTS.md`, `CLAUDE.md`, `.factory/{config.json,cards,specs,plans,test-plans,templates,bin/floor-guard.mjs,.gitignore}`.

## Process

0. **Set up the shell:** `export FACTORY_PLUGIN_ROOT=<plugin path from the session briefing>`. The
   session briefing prints it even in a repo that is not set up yet.
1. **Detect before you ask.** Run a dry run and read what it found:
   ```bash
   node "${FACTORY_PLUGIN_ROOT}/scripts/factory-init.mjs" --dry-run
   ```
   If no stack is detected, ask which profile applies (`typescript`, `python`, `swift`) and pass
   `--profile`. If several are detected, the first is primary; mention the others.
2. **Run it:** `node "${FACTORY_PLUGIN_ROOT}/scripts/factory-init.mjs" [--profile <p>] [--base <branch>]`.
   Use `--force` only to regenerate `CONSTRAINTS.md`/`DONE.md`; it backs up the old file under `.factory/backups/`.
3. **Measure the starting point.** Run the checks once and record reality:
   ```bash
   node "${FACTORY_PLUGIN_ROOT}/scripts/check.mjs" --stage all
   ```
   - `FAIL` rows on a fresh setup mean the repo does not meet the default bar today. Do not lower
     the bar silently: either fix the cause, or (with the human) move that row to the
     **Measured, not yet enforced** ratchet table at today's value.
   - `GAP` rows mean a tool is missing. Offer the install command; if the human declines, leave the
     row marked `(not yet installed)` so every review reports the gap.
   - Run the coverage command and write today's project coverage into the ratchet table.
4. **Fill the repo-specific sections** at the bottom of `AGENTS.md` (commands are pre-filled; ask
   for invariants, environment, test infrastructure, untestable flows). Keep answers short.
5. **Review with the human** (`CONSTRAINTS.md` especially), then commit:
   `git add CONSTRAINTS.md DONE.md AGENTS.md CLAUDE.md .factory && git commit -m "chore: set up software factory"`.
6. **CI (recommended):** add a job that runs `node .factory/bin/floor-guard.mjs --base origin/<base>` on pull requests.

## Unattended mode

Do not run setup unattended: the quality bar needs a human. If `FACTORY_UNATTENDED=1` and the repo
is not initialised, write `status.json` with `state: "blocked"` and reason "factory not initialised".

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "We'll add constraints once the code settles" | Code settles around whatever was allowed while it moved. |
| "80% coverage is impossible here, drop the row" | Then record today's number as a ratchet. Deleting the row removes the bar for everyone. |
| "The tool isn't installed, remove that rule" | Mark it `(not yet installed)`; a visible gap beats an invisible one. |
| "I'll fill AGENTS.md later" | Workers read it on every card. Empty sections mean guessed ports and wrong test commands. |

## Red flags

- A row in `CONSTRAINTS.md` with a number but no command.
- Thresholds lowered during setup without the human agreeing.
- `CONSTRAINTS.md` committed together with feature code.

## Verification

- [ ] `node .factory/bin/floor-guard.mjs` exits 0 on a clean tree
- [ ] `check.mjs --stage task` runs; every FAIL is fixed or moved to a ratchet with the human's OK
- [ ] Today's coverage recorded in the ratchet table
- [ ] `CLAUDE.md` starts with `@AGENTS.md`; repo-specific sections in `AGENTS.md` are filled in
- [ ] Setup committed on its own, separate from any feature
