---
name: review-gate
description: The factory's merge gate for a card's code. Runs the floor guard (no skipped tests, suppressions, stubs or loosened constraints), the CONSTRAINTS.md review checks and a scope check, then fresh-context reviewer agents in parallel (code, tests, silent failures, security, red team). Reports only findings it can prove, auto-fixes mechanical issues, and records an APPROVE, WARN or BLOCK verdict bound to the exact code reviewed. Use after build, before merge, or when someone says "review this", "review the diff", "is this ready to merge", "run the gate", or "code review".
---

# Review gate

## Overview

The context that wrote the code does not grade it. This gate combines three independent checks:
mechanical (floor guard, constraint commands, scope), fresh-context reviewers that never saw the
build session, and a verdict recorded against the tree hash, so any later edit makes the verdict
stale. It applies even when the diff is small or pasted inline.

## When to use

- A worker finished `build` on a card.
- Any diff before it can be merged, including a human's.
- After fixes, to re-check (the old verdict is stale once the code changes).

**When not to use:** to review a plan (use `plan-review`); to test the running app (use `qa-verify`).

## Inputs and outputs

- Reads: the card and its plan/test plan, the diff against the base, `CONSTRAINTS.md`, `DONE.md`, learnings.
- Writes (run directory): `findings.json`, `review.json` (via `review-record.mjs`), `checks-review.json`.
- Hands off to: `qa-verify` (on APPROVE/WARN) or back to `build` (on BLOCK).

## Process

0. **Set up the shell:** `export FACTORY_PLUGIN_ROOT=<plugin path from the session briefing>` unless it is already set (workers have it). Scripts live in `$FACTORY_PLUGIN_ROOT/scripts`. Outside a dispatched worker, also export `FACTORY_CARD=C-###`, `FACTORY_ROOT=<main checkout>` and `FACTORY_RUN_DIR=<main checkout>/.factory/runs/C-###`. Work in the card's worktree with a clean tree.
1. **Mechanical checks** (any failure is a BLOCK finding, no reviewer needed):
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/floor-guard.mjs"              # skipped/deleted tests, suppressions, stubs, loosened bar
   node "$FACTORY_PLUGIN_ROOT/scripts/scope-check.mjs"              # every changed file inside files.allow
   node "$FACTORY_PLUGIN_ROOT/scripts/check.mjs" --stage review     # types, lint, tests, changed-line coverage, secrets, deps
   ```
   A `GAP` row (tool not installed) becomes a MEDIUM finding: "not assessed", never a pass.
2. **Size the review:** `git diff --stat $(git merge-base $FACTORY_BASE HEAD)`. Pick reviewers:

   | Agent | Runs when |
   | --- | --- |
   | `code-reviewer` | Always |
   | `test-reviewer` | Always |
   | `silent-failure-hunter` | Diff touches error handling, I/O, network, DB or async code (usually) |
   | `security-reviewer` | Card risk is high, or the diff touches auth, input handling, queries, files, secrets, payments, webhooks |
   | `red-team` | Diff over 200 lines, or any reviewer reports CRITICAL (runs second, sees the others' findings) |

3. **Dispatch reviewers in parallel**: one message, one Agent call each, `run_in_background: false`.
   Give each: the card (acceptance criteria and `files.allow`), the test plan, the base ref, and
   the instruction to read the diff and the surrounding code itself. **Do not pass your opinion of
   the code.** Each returns findings in the schema in `references/findings.md`.
4. **Merge findings.** Dedupe across reviewers; keep the highest severity. Apply the pre-report
   gate to every finding: drop anything that cannot cite a file and line, name a concrete failure
   (input → state → bad outcome), and survive a read of the surrounding code. HIGH and CRITICAL need
   all three, or they are demoted. **Zero findings is a valid result.**
5. **Fix-First** (adapted from gstack `/review`, MIT):
   - **AUTO-FIX** (apply, inside `files.allow`): dead code, unused variables, stale comments, magic
     numbers, missing input validation on an internal boundary, N+1 queries with an obvious batch.
   - **ASK** (a human or a re-plan decides): security, race conditions, design choices, fixes over
     20 lines, removing functionality, anything changing user-visible behaviour.
   Re-run step 1 after fixes. Commit fixes: `git commit -m "fix(C-###): review findings"`.
6. **Verdict:**
   - **BLOCK:** any CRITICAL, any mechanical failure, or an unresolved ASK that is HIGH.
   - **WARN:** HIGH findings acknowledged in `decisions.md` with a reason, nothing CRITICAL.
   - **APPROVE:** no CRITICAL or HIGH open.
   Write `findings.json` to the run directory, then bind the verdict to the tree:
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/review-record.mjs" write --kind review --verdict APPROVE \
     --summary "3 reviewers, 0 critical, 1 medium fixed" --findings "$FACTORY_RUN_DIR/findings.json"
   node "$FACTORY_PLUGIN_ROOT/scripts/review-record.mjs" verify --kind review   # must print CURRENT
   ```
7. **Cap: 3 review rounds.** Still BLOCK after 3 rounds → set the card blocked with the open findings.
8. Record recurring findings as learnings (`learn.mjs add --type pitfall --skill review-gate …`).

## Unattended mode

AUTO-FIX items: fix them. ASK items: if the fix is inside `files.allow`, under 20 lines and does not
change user-visible behaviour, fix it and log the decision; otherwise leave it open. An open HIGH ASK
item means BLOCK, so the card escalates to a human with the finding attached.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "I wrote it, I know it's right" | That is why a fresh context reviews it. |
| "The diff is tiny, skip the gate" | Small diffs break production too. Small diffs get small reviews, not none. |
| "Mark the missing tool as passed" | A gap is "not assessed". Reporting it as a pass hides a hole in the bar. |
| "Report everything to look thorough" | Unprovable findings waste the fixer's time and train people to ignore the gate. |
| "Approve now, fix later" | APPROVE means nothing CRITICAL or HIGH is open. Later never comes in an unattended factory. |

## Red flags

- A verdict without `review.json`, or `verify` printing STALE.
- Reviewers given the author's conclusions.
- CRITICAL findings with no line number or failure scenario.
- The floor guard or scope check skipped "because the tests pass".

## Verification

- [ ] Floor guard clean, scope check clean, `check.mjs --stage review` without FAIL
- [ ] Reviewers ran in parallel with fresh context; every reported finding cites file, line and failure
- [ ] Verdict follows the rules above; `review-record.mjs verify --kind review` prints CURRENT
- [ ] BLOCK after 3 rounds escalated with findings attached
