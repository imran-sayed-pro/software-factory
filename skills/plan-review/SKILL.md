---
name: plan-review
description: Reviews a spec's draft work cards before any code is written. Writes a plan and a test plan per card, runs product, engineering and design passes plus a fresh-context adversarial review, decides routine questions with fixed principles, and brings only taste calls and direction changes to a human at Gate 1. Approved cards become ready for dispatch. Use after spec, when someone says "review the plan", "approve the cards", "is this plan ready", "run the plan review", or before starting parallel work.
---

# Plan review (Gate 1)

## Overview

Planning mistakes are cheapest to fix here and most expensive to fix after ten workers have built
on them. This skill turns each draft card into an approved plan and test plan, answers the routine
questions itself, and asks the human only what needs human judgment. It is the first of the
factory's two human gates.

## When to use

- After `spec` produced draft cards.
- A card was re-scoped or re-cut and needs re-approval.

**When not to use:** to review code (use `review-gate`); to write the spec (use `spec`).

## Inputs and outputs

- Reads: `.factory/specs/S-###.md`, draft cards, `AGENTS.md`, `CONSTRAINTS.md`, `DONE.md`, the code the cards touch, learnings.
- Writes: `.factory/plans/C-###.md` and `.factory/test-plans/C-###.md` (from `.factory/templates/`); card status `draft` → `ready` after approval.
- Hands off to: `dispatch`.

## Decision principles

Answer intermediate questions with these instead of asking (adapted from gstack `/autoplan`, MIT):

1. **Choose completeness:** cover the edge cases; AI-written code makes the complete version cheap.
2. **Fix the blast radius:** include small fixes in files the card already touches (under ~5 files, no new infrastructure).
3. **Pragmatic:** of two equivalent options, the cleaner one, decided quickly.
4. **DRY:** reject anything that duplicates existing code; reuse it.
5. **Explicit over clever:** the 10-line obvious version beats the 200-line abstraction.
6. **Bias to action:** flag concerns, do not block on them.

Classify every decision: **mechanical** (one right answer: decide silently), **taste** (reasonable
people differ: decide, then show at the gate), **challenge** (you and the adversarial reviewer both
want to change the human's stated direction: never decide; ask at the gate).

## Process

0. **Set up the shell:** `export FACTORY_PLUGIN_ROOT=<plugin path from the session briefing>` unless it is already set (workers have it). Scripts live in `$FACTORY_PLUGIN_ROOT/scripts`.
1. **Load context.** The spec, every draft card, `CONSTRAINTS.md`, `DONE.md`, the files in each
   card's `files.allow`, and learnings for those files:
   `node "$FACTORY_PLUGIN_ROOT/scripts/learn.mjs" search --files <comma-separated paths>`.
2. **Per card, write the plan** (`.factory/plans/C-###.md`): approach in 2–4 sentences; steps that
   each leave the system working, each naming its files and the test written first; risks.
3. **Per card, write the test plan** (`.factory/test-plans/C-###.md`): every acceptance criterion
   becomes a behaviour to prove at a stated level (unit / integration / e2e); edge and error cases
   (null/empty, boundaries, invalid input, dependency failure, concurrency, large data, special
   characters); the QA surface and the critical paths to record as evidence.
4. **Run the passes**, recording findings in the plan's *Decisions* table:
   - **Product:** is the card the smallest thing that delivers the value? Anything missing that users will hit on day one?
   - **Engineering:** architecture fit, data flow, error handling, migrations, observability,
     performance, security. Does the card stay inside its files? Is anything already solved in the codebase?
   - **Design** (only when the card has a UI): states (loading, empty, error), accessibility, responsive, consistency with the design system.
   - **Testability:** can every acceptance criterion fail? Is each covered in the test plan?
5. **Adversarial review (fresh context).** For each M/L or high-risk card, dispatch the `red-team`
   agent with the **artifact and the contract only**: the plan + test plan, and the card's
   acceptance criteria and `CONSTRAINTS.md`. Do **not** pass your conclusions. Prompt:
   > Adversarial review. Find what is wrong with this plan. Look for unstated assumptions, missing
   > edge cases, hidden coupling, ways the acceptance criteria could pass while the feature is broken,
   > and conflicts with the constraints. Do not validate or summarise. List issues with evidence, or
   > state that you found none after a thorough check.
   Run reviewers for independent cards in parallel (one message, `run_in_background: false`).
   Reconcile each finding: accept (amend the plan), reject (one-line reason), or escalate as a
   challenge. **Cap: 3 rounds per card.**
6. **Re-validate the cards** after amendments:
   `node "$FACTORY_PLUGIN_ROOT/scripts/card.mjs" validate`.
7. **Gate 1: present one approval screen**, then **STOP**:
   - Per card: title, size, risk, lane (from `dispatch.mjs plan`), one-line approach.
   - Decisions made: counts of mechanical / taste / challenge.
   - **Taste decisions** with what you chose and why.
   - **Challenges** (direction changes): original direction, proposed change, reasoning, cost of being wrong.
   - **High-risk cards**, each needing an explicit yes.
   Accept only an unambiguous approval ("approve", "go", "yes"). "Looks fine I guess" is not approval.
8. **On approval:** set each approved card ready and commit the plans:
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/card.mjs" set C-001 ready
   git add .factory/plans .factory/test-plans .factory/cards && git commit -m "plan: approve S-001 cards"
   ```
   Cards the human rejected go back to `spec` for re-cutting.

## Unattended mode

Gate 1 is a human gate. Unattended, this skill may prepare plans, test plans and the approval screen
(write it to `.factory/specs/S-###-gate1.md`) and then stop with `blocked: awaiting Gate 1`. It never
sets a card to `ready`.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "The spec already covers it, skip the test plan" | The test plan is what QA and review check against. No test plan, no definition of done. |
| "I'll just ask the human about each choice" | Twenty questions is a planning failure. Decide mechanical ones; batch taste ones at the gate. |
| "The reviewer agreed with me, so it's fine" | You gave it your conclusion. Give it the artifact and contract only. |
| "Approval was implied" | Gate 1 needs an explicit yes, and a separate yes for each high-risk card. |

## Red flags

- A plan step with no file and no test named.
- An acceptance criterion with no matching behaviour in the test plan.
- Cards set to `ready` without a recorded approval.
- More than 3 adversarial rounds on one card (the card is probably mis-scoped: send it back to `spec`).

## Verification

- [ ] Every card has a plan and a test plan; every acceptance criterion maps to a test
- [ ] Adversarial review ran on every M/L and high-risk card with artifact + contract only
- [ ] `card.mjs validate` exits 0 after amendments
- [ ] Explicit human approval recorded; high-risk cards approved individually
- [ ] Approved cards are `ready`; plans committed
