---
name: ship
description: Takes finished factory cards to production. Re-verifies the review and QA verdicts against the exact code, checks the Definition of Done and docs, pushes the card branch, uploads the evidence recording, and opens a pull request that links every claim to proof. Then stops for Gate 2 (a human approves the merge); after the merge it marks the card merged, unlocks waiting cards, watches the deploy with a canary check, and rolls back on request. Use when cards are done, or when someone says "ship it", "open the PR", "merge the card", "deploy", "release C-012", or "watch the deploy".
---

# Ship (Gate 2)

## Overview

The last mile, in two halves. **Before the merge:** prove the branch still meets the bar on the
code as it now stands, and put the evidence in front of a human in one pull request. **After the
merge:** confirm production is healthy, and roll back fast if it is not. The merge itself is the
factory's second human gate: this skill never merges without an explicit human yes.

## When to use

- `dispatch` moved cards to `done` (verdicts current after the merge-queue rebase).
- A human approved a PR and wants it merged and watched.

**When not to use:** cards still `running` or `review` (finish `review-gate`/`qa-verify`); to change
the quality bar.

## Inputs and outputs

- Reads: card, run directory (`review.json`, `qa.json`, `qa/`, `decisions.md`, `handoff.md`), `DONE.md`, `AGENTS.md` (deploy section), `.factory/config.json`.
- Writes: pushed branch `factory/C-###`, a pull request, uploaded evidence, card status `merged`, `ship.json` in the run directory.

## Process: before the merge (per card, in dependency order)

0. **Scripts:** the commands below write `$FACTORY_PLUGIN_ROOT`; replace it with the absolute plugin path
   from the session briefing (or the worker prompt). Write paths out in full and run commands plainly:
   the permission check refuses commands containing shell variables, `VAR=value` prefixes or `env`. Scripts find the card from the
   `factory/C-###` branch; on any other branch pass `--card C-###`. The run directory is
   given in the worker prompt, otherwise `<main checkout>/.factory/runs/C-###`; write that path wherever
   this skill says `$FACTORY_RUN_DIR`.
   Steps 1–7 run in the card's worktree: `cd <main checkout>/.factory/worktrees/C-###`.
1. **Re-verify on the code as it stands now.** All must pass; any failure sends the card back:
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/review-record.mjs" verify --kind review   # CURRENT, APPROVE or WARN
   node "$FACTORY_PLUGIN_ROOT/scripts/review-record.mjs" verify --kind qa       # CURRENT, PASS (skip if qaSurface is none)
   node "$FACTORY_PLUGIN_ROOT/scripts/floor-guard.mjs"
   node "$FACTORY_PLUGIN_ROOT/scripts/scope-check.mjs"
   node "$FACTORY_PLUGIN_ROOT/scripts/check.mjs" --stage review
   ```
   A QA verdict of PARTIAL may ship only if the human accepts the untested items at Gate 2.
2. **Definition of Done:** walk every box in `DONE.md` and note evidence for each (a file, a test
   run, a link). Any unchecked box is listed in the PR as a known gap, or blocks the ship.
3. **Docs:** list what changed in the public surface (exported functions, routes, CLI flags, config
   keys, environment variables, user-visible behaviour). Each item needs reference docs at least;
   update docs inside `files.allow`, or list the gap in the PR. If the repo keeps a `CHANGELOG.md`,
   add an entry under *Unreleased*.
4. **Push the card branch:** `git push -u origin factory/C-###` (after a rebase of an already pushed
   branch: `--force-with-lease`, never `--force`, never the base branch).
5. **Upload evidence** (if the card has a recording):
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence-upload.mjs" "$FACTORY_RUN_DIR/qa/evidence"
   ```
   It prints Markdown with the video and report links (default: assets on a `factory-evidence`
   prerelease in this repo; `--adapter local` keeps everything local).
6. **Open the pull request** with `gh pr create --base <base> --head factory/C-### --title "<card title> (C-###)" --body-file <file>`.
   Body (plain language, every claim linked to proof): see `references/pr-body.md`. It must include
   the decisions the worker made unattended (`decisions.md`) and any WARN findings.
7. **Gate 2: STOP.** Give the human the PR link, the verdicts (review, QA), the evidence link, the
   DONE gaps and the risks. Merge only on an explicit "merge" / "approve" for *this* PR. High-risk
   cards need the human to confirm they reviewed the diff, not only the video.

## Process: after the human approves

8. **Merge** with the repo's merge method (`gh pr merge <n> --squash|--merge|--rebase`, as recorded in
   `AGENTS.md`). Then, **in the main checkout** (cards live there, not in the worktree), mark the card
   and release waiting work:
   ```bash
   cd "$FACTORY_ROOT" && git checkout <base> && git pull --ff-only
   node "$FACTORY_PLUGIN_ROOT/scripts/card.mjs" set C-### merged
   git add .factory/cards/C-###.json && git commit -m "chore: C-### merged"
   git push   # if the base branch is protected, push a branch and open a one-line PR instead
   node "$FACTORY_PLUGIN_ROOT/scripts/dispatch.mjs" tick
   ```
9. **Watch CI and the deploy.** `gh run list --branch <base> --limit 3` then `gh run watch <id>`.
   With no deploy configured in `AGENTS.md`, stop here and say so.
10. **Canary** (when a production URL and health check are configured): check the health endpoint
    and the pages or endpoints the card touched every 60 seconds for 10 minutes. Alert only on a
    problem seen in **2 consecutive checks** (a page or health check failing, new console errors,
    load time over 2× the pre-deploy baseline). On an alert, ask the human: investigate now, keep
    watching, or roll back.
11. **Rollback** (only on the human's choice): `git revert -m 1 <merge-sha>` for a merge commit (or
    `git revert <sha>` for a squash) on a new branch, open a PR titled `Revert C-###`, and treat it
    as a normal ship (it still needs Gate 2). Never `reset` or force-push the base branch.
12. **Close out:** write `$FACTORY_RUN_DIR/ship.json` (`{pr, mergedAt, deploy, canary, rollback}`),
    run `node "$FACTORY_PLUGIN_ROOT/scripts/dispatch.mjs" cleanup --merged`, and record learnings
    (`learn.mjs add --type operational --skill ship …`).

## Unattended mode

The pre-merge half (steps 1–6) may run unattended: it ends with an open PR and stops. Merging,
deploying and rolling back always need a human; the bash guard denies `gh pr merge` and pushes to
the base branch for unattended workers.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "The review passed yesterday" | Verdicts bind to a tree hash. If `verify` says STALE, the code changed: re-run the gate. |
| "The human is busy, merge it" | Gate 2 is the human's call. Open the PR and wait. |
| "Force-push to fix the history" | Only `--force-with-lease`, only on the card branch. |
| "One failed health check, roll back now" | Transient blips happen. Two consecutive failures is the signal, then ask. |
| "Skip the docs, it's an internal change" | If it changes a route, flag, config key or env var, someone needs to know. |

## Red flags

- A PR body with claims but no links to tests, records or recordings.
- `review.json` or `qa.json` STALE at ship time.
- A merge without a recorded human approval.
- A rollback done by resetting the base branch.

## Verification

- [ ] Review and QA verdicts CURRENT; floor guard, scope and review checks pass
- [ ] `DONE.md` walked; gaps listed in the PR
- [ ] PR open with evidence links, unattended decisions and risks
- [ ] Merged only after an explicit human approval; card set `merged`; waiting cards ticked
- [ ] Deploy and canary watched (or "no deploy configured" stated); `ship.json` written
