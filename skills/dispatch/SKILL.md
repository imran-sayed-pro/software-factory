---
name: dispatch
description: Runs the factory's parallel workers. Starts one git worktree and one unattended Claude worker per ready card, runs cards in parallel only when their file scopes do not overlap, watches for stalls, overruns, cost and blocked workers, escalates to a human, and moves finished cards through a merge queue (rebase, re-check, verdicts carried forward). Use after plan-review approves cards, or when someone says "start the workers", "run the cards in parallel", "dispatch the approved cards", "dispatch", "what's the factory doing", "check on the workers", or "process the merge queue".
---

# Dispatch

## Overview

`dispatch` is the orchestrator. It owns the board, never the code. Each card runs in its own git
worktree (`.factory/worktrees/C-###`, branch `factory/C-###`) with its own headless worker, its own
virtual display for QA recording, and its own run directory (`.factory/runs/C-###`). Workers never
talk to each other; they hand off through files. The orchestrator is flat: it starts workers and
reads their results, and workers never start other workers.

## When to use

- Cards are `ready` (approved at Gate 1).
- To check on running work, handle escalations, or process finished cards through the merge queue.

**When not to use:** to do a card's work yourself (that is the worker's `build` skill); to merge
(that is `ship`, after Gate 2).

## Inputs and outputs

- Reads: `.factory/config.json`, cards, worker `status.json` and `worker.log`, review/QA records.
- Writes: `.factory/board.json`, `.factory/runs/escalations.jsonl`, card status, worktrees and branches.
- Hands off to: `ship` for cards in `done`.

## Process

0. **Scripts:** the commands below write `$FACTORY_PLUGIN_ROOT`; replace it with the absolute plugin path
   from the session briefing (or the worker prompt). Write paths out in full and run commands plainly:
   the permission check refuses commands containing shell variables, `VAR=value` prefixes or `env`.
   Run from the main checkout, never from a worktree.
1. **Preflight.**
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/card.mjs" validate
   node "$FACTORY_PLUGIN_ROOT/scripts/dispatch.mjs" plan
   ```
   `plan` prints the dependency order, what would start now, and what waits and why (dependency
   not merged, or file overlap with unmerged work). Check `git status` is clean on the base branch
   and the base is up to date (`git pull --ff-only`). Confirm the worker command in
   `.factory/config.json` (`workers.command`) and the limits: `max` workers, `stallMinutes`,
   `maxMinutesPerCard`, `maxCostUsdPerCard`, `maxAttemptsPerCard`. The cost brake is an estimate from
   token usage priced by `workers.pricing`; set those prices to your model's rates.
2. **Start and watch.**
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/dispatch.mjs" watch --interval 60
   ```
   `watch` starts launchable cards, refreshes every interval, escalates, starts the next wave as
   capacity frees, and when nothing can move runs the merge queue. Exit codes: `0` all clear,
   `3` open escalations, `4` waiting on human merges or file locks. For a single step use `tick`;
   for a snapshot use `status`.
3. **Escalations** (`dispatch.mjs escalations`). Each one names the card, the kind and the evidence.
   Handle them with the human:

   | Kind | Meaning | Typical action |
   | --- | --- | --- |
   | `blocked` | The worker stopped on a brake or an uncovered decision | Read `decisions.md` and `status.json`; answer, re-scope the card (`spec`), or archive it |
   | `crashed` | Worker exited without a status | Read `worker.log`; fix the environment; set the card `ready` to retry (attempt limit applies) |
   | `stalled` / `overtime` / `cost` | No output, too long, or over budget | Usually the card is too big: split it |
   | `conflict` | Rebase onto the base conflicts | Resolve in the worktree, or re-cut cards so scopes do not overlap |
   | `re-review` | Rebase changed the card's diff | Re-run `review-gate` (and `qa-verify`) in the worktree |
   | `queue` | Verdict missing/stale or checks failed after rebase | Re-run the failing gate in the worktree |

   Close each with `dispatch.mjs resolve <id> --note "…"`. To retry a card:
   `card.mjs set C-### ready`, then `dispatch.mjs tick`.
4. **Merge queue** (`dispatch.mjs queue`, also run by `watch`): for each card in `review`, in
   dependency order, it requires a current APPROVE/WARN review (and a PASS QA when the card has a
   QA surface), rebases onto the latest base, re-runs `check.mjs --stage review` and the floor
   guard, and carries the verdicts forward only if the card's patch is unchanged. Passing cards
   become `done`: ready for `ship`.
5. **Report to the human:** cards done (ready for Gate 2), running, waiting (and on what), open
   escalations. Then hand `done` cards to `ship`.
6. **After merges:** `card.mjs set C-### merged` happens in `ship`; then `dispatch.mjs tick` starts
   the cards that were waiting on them. Clean up merged worktrees with `dispatch.mjs cleanup --merged`.

## Parallelism rules

- Two cards run at the same time only if their `files.allow` cannot touch the same file.
- A dependency is met only when the depended-on card is **merged**, because workers branch from the base.
- Unmerged work (running, review, done) keeps its files locked.
- Start with 3 workers; raise `workers.max` only when escalations stay under 10% of cards.
- Never run two dispatchers: commands take a lock (`.factory/dispatch.lock`).

## Unattended mode

`watch` itself is safe to run unattended: it never merges, never pushes the base branch, and stops
with exit 3 or 4 when a human is needed. Escalations wait in `escalations.jsonl`.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "Overlap is small, start both" | Overlapping workers produce conflicts that cost more than the parallelism saved. |
| "The worker is probably still thinking" | No log output for `stallMinutes` means it is stuck. Kill, read the log, re-scope. |
| "Just bump the attempt limit" | Two failed attempts mean the card is wrong, not unlucky. Re-cut it. |
| "Start the dependent card from the other branch" | Stacked branches hide unreviewed code in a new card. Merge first. |

## Red flags

- Running `dispatch` from inside a worktree.
- Raising `max` while escalations are piling up.
- A card retried without anyone reading its `worker.log` and `decisions.md`.
- Editing a worker's worktree by hand while it is running.

## Verification

- [ ] `plan` reviewed before starting; base branch clean and current
- [ ] Every escalation resolved with a note
- [ ] Merge queue run; `done` cards have current verdicts after rebase
- [ ] Merged worktrees cleaned up
