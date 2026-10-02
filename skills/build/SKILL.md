---
name: build
description: Implements one factory work card test-first inside its worktree. Records a failing test before writing code (RED evidence), makes it pass with the smallest change, refactors, runs the CONSTRAINTS.md task checks, and commits on the card branch. Debugs by root cause with a three-strike stop, fixes build and type errors with minimal diffs, and stays inside the card's allowed files. Use when implementing a card, fixing a bug from a card, or when a factory worker starts; also for "implement C-012", "build this card", "make the tests pass", or a failing build on a card branch.
---

# Build

## Overview

The worker's inner loop. A card is built one acceptance criterion at a time: prove the behaviour is
missing with a failing test, add the smallest code that makes it pass, clean up, commit. Every claim
of "it works" points at a test run. When something breaks, find the root cause before changing code.

## When to use

- A worker starts on a card (this is the first skill in the worker prompt).
- A card's tests or build fail and need fixing on the card branch.

**When not to use:** without a card (write one with `spec`); to review (use `review-gate`).

## Inputs and outputs

- Reads: the card, `.factory/plans/C-###.md`, `.factory/test-plans/C-###.md`, `CONSTRAINTS.md`, `AGENTS.md` commands, learnings.
- Writes: code and tests inside `files.allow`; commits on `factory/C-###`; in the run directory
  (`$FACTORY_RUN_DIR`): `red.md` (failing-test evidence), `decisions.md`, `checks-task.json`.
- Hands off to: `review-gate`.

## Process

0. **Set up the shell:** `export FACTORY_PLUGIN_ROOT=<plugin path from the session briefing>` unless it is already set (workers have it). Scripts live in `$FACTORY_PLUGIN_ROOT/scripts`. Outside a dispatched worker, also export `FACTORY_CARD=C-###`, `FACTORY_ROOT=<main checkout>` and `FACTORY_RUN_DIR=<main checkout>/.factory/runs/C-###`. Confirm you are in the card's worktree on
   `factory/C-###` (`git branch --show-current`) and `git status` is clean.
1. **Load context.** Read the card, its plan and test plan, the files in `files.allow`, and
   learnings: `node "$FACTORY_PLUGIN_ROOT/scripts/learn.mjs" search --files <paths> --query "<card topic>"`.
   Find the test command for this stack in `AGENTS.md` → *Commands*. Match the style of 2–3 nearby tests.
2. **For each behaviour in the test plan, in order:**
   1. **RED.** Write the test. Run *only that test* and confirm it fails **for the right reason**
      (an assertion about the missing behaviour, not an import error, typo or broken fixture).
      Append to `$FACTORY_RUN_DIR/red.md`: the test name, the command, and the failure excerpt.
   2. **GREEN.** Write the minimum code that makes it pass. Run it; then run the whole suite.
   3. **REFACTOR.** Remove duplication, improve names. The suite stays green.
   4. **Commit** the test and code together: `git add <files> && git commit -m "feat(C-###): <behaviour>"`.
      Stage files by name; never `git add -A`.
   For a bug card, use the **Prove-It pattern**: the first test reproduces the reported bug and
   fails before any fix.
3. **Run the task checks** until they pass:
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/check.mjs" --stage task
   ```
   `FAIL` must be fixed. `GAP` (tool not installed) is reported, not fixed, by you.
4. **When something fails that you do not understand,** debug by root cause (see
   `references/debugging.md`): reproduce, trace back from the symptom, check recent changes, state
   one testable hypothesis, confirm it with temporary logging before changing code.
   **Three-strike rule:** after 3 failed hypotheses, stop: write `status.json` with
   `state: "blocked"` and the three hypotheses.
5. **Build and type errors:** smallest diff that fixes the error (a type annotation, a null check,
   an import). No refactors, renames or "improvements" while the build is red.
6. **Before handing off:** `git status` clean, all behaviours in the test plan covered, `check.mjs
   --stage task` passing. Record durable learnings:
   `node "$FACTORY_PLUGIN_ROOT/scripts/learn.mjs" add --type pitfall --key <k> --insight "…" --files <paths> --skill build`.

## Brakes (stop and set the card blocked)

- 3 failed hypotheses on the same problem.
- The fix needs a file outside `files.allow` (the scope hook will deny the edit): record which file and why.
- The fix would touch more than 5 files, or change behaviour the card does not mention.
- A high-risk action not covered by the approved plan (auth, payments, deletion, migration, secrets, deploy).
- An acceptance criterion is ambiguous and the plan does not settle it.

To block: write `$FACTORY_RUN_DIR/status.json` as
`{"card":"C-###","state":"blocked","phase":"build","summary":"…","blockedReason":"…"}` and stop.

## Unattended mode

Never ask questions. For each choice the card does not settle, pick the option the plan recommends
(else the simplest reversible one), never a destructive one, and append a line to
`$FACTORY_RUN_DIR/decisions.md`: `- <decision> — chose <X> because <reason>`.

## Test quality

- Test behaviour through the public interface, not internal state.
- Prefer real implementations; mock only external services (network, payment, email, clock).
- One concept per test; descriptive names; Arrange–Act–Assert.
- Cover the edge cases in the test plan: null/empty, boundaries, invalid input, dependency failure, concurrency.
- Never weaken a test to get to green: no `.skip`, no deleted assertions, no suppression comments.
  The floor guard blocks these at review.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "I'll write the test after, it's faster" | A test written after the code tests the code you wrote, not the behaviour asked for. |
| "The test failed, good enough" | It must fail for the right reason. An import error is not RED evidence. |
| "Quick fix for now" | There is no "for now" in an unattended factory. Fix the root cause or block. |
| "Just add @ts-ignore / skip this flaky test" | That lowers the bar; the floor guard will block it and review will reject it. |
| "This other file needs a small tweak too" | Outside `files.allow` means outside the card. Block and record it. |
| "Run the suite again to be sure" | Re-running unchanged code adds nothing. Re-run after a change. |

## Red flags

- A commit with code and no test, or a test that never failed.
- `red.md` empty when the card is handed off.
- Many files changed for a small card.
- Repeated identical failures with no new hypothesis.

## Verification

- [ ] Every test-plan behaviour has a test that was seen failing (in `red.md`) and now passes
- [ ] Full suite green; `check.mjs --stage task` has no FAIL
- [ ] All changes inside `files.allow`; commits are per behaviour; tree clean
- [ ] Decisions logged; learnings recorded
