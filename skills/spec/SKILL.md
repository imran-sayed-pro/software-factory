---
name: spec
description: Turns an idea, feature request or bug report into a precise written spec and a set of small work cards the factory can build in parallel. Interviews one question at a time, challenges the premise, reads the code before proposing anything, then writes .factory/specs/S-###.md and .factory/cards/C-###.json with acceptance tests, allowed files, dependencies, size and risk. Use when someone says "spec this", "plan a feature", "break this down into tasks", "write up a ticket", "I want to build…", or hands over a vague request.
---

# Spec

## Overview

Ambiguity is the most expensive bug in a factory: ten parallel workers will build ten
interpretations. This skill removes it before any planning or code. It produces one spec and a set
of work cards, each small enough for one worker, with tests that define "done" and a fence of files
the worker may touch.

**HARD GATE:** no code, no scaffolding, no implementation. The output is a spec and cards.

## When to use

- A new feature, change, or bug report arrives, however vague.
- An existing spec needs to be split into cards.

**When not to use:** a card already exists and is approved (use `build` via `dispatch`); a
one-line fix you can describe in one acceptance criterion (write a single card directly with
`card.mjs new` and still validate it).

## Inputs and outputs

- Reads: the request, `AGENTS.md`, `CONSTRAINTS.md`, the code it touches, open PRs/issues, `.factory/specs/`, learnings.
- Writes: `.factory/specs/S-###.md` (from `.factory/templates/spec.md`) and `.factory/cards/C-###.json` (status `draft`).
- Hands off to: `plan-review`.

## Process

0. **Set up the shell:** `export FACTORY_PLUGIN_ROOT=<plugin path from the session briefing>` unless it is already set. Scripts live in `$FACTORY_PLUGIN_ROOT/scripts`.
1. **Gather context before asking anything.** Read `AGENTS.md`, `CONSTRAINTS.md`, the relevant code
   (Grep/Glob, `git log --oneline -20 -- <paths>`), existing specs, and prior learnings:
   `node "$FACTORY_PLUGIN_ROOT/scripts/learn.mjs" search --query "<topic words>"`.
   Never ask what you can read.
2. **Interview, one question at a time,** until you could explain the work to a stranger with no
   follow-up questions (about 95% confidence). Each question carries your best guess and a default,
   so "I don't know" still moves forward. Cover, in order:
   - **Why:** who has the problem, what it costs today, how we will know it is solved (a number).
   - **Premise:** is this the right problem? What happens if we do nothing? What already solves part of it?
   - **Scope:** what is in, what is explicitly out.
   - **Behaviour:** inputs, outputs, error cases, empty and large inputs, permissions, concurrency.
   - **Distribution and rollout:** how users get it; feature flag; migration; rollback.
3. **Challenge the premise.** Write the premises as numbered statements and get explicit agreement.
   If one is rejected, loop back.
4. **Generate alternatives (mandatory):** at least two approaches: a *minimal viable* (fewest files,
   ships fastest) and an *ideal* (best long-term). For each: effort (S/M/L), risk, what it reuses.
   Recommend one with a one-line reason. **STOP** until the human picks.
5. **Write the spec** from `.factory/templates/spec.md`. Quantify everything ("3 files", not
   "several"; "p95 < 200 ms", not "fast"). The *Current state* table must cite real files you read.
6. **Cut it into cards.** Read `references/card-cutting.md`, then for each card:
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/card.mjs" new --spec S-001 --title "Add password reset endpoint"
   ```
   and fill the card JSON: `description`, 1–5 `acceptance` criteria (each testable), `verification`
   (commands + `qaSurface`), `dependsOn`, `files.allow` (exact paths or narrow globs, *including
   the test files*), `size`, `risk` (+ `highRiskReasons`), `rollback`.
7. **Validate:** `node "$FACTORY_PLUGIN_ROOT/scripts/card.mjs" validate` must exit 0. Then
   `node "$FACTORY_PLUGIN_ROOT/scripts/dispatch.mjs" plan` shows the parallel lanes; if everything is
   serialised by file overlap, re-cut (shared contracts first, then parallel slices).
8. **Present** the spec summary and the card table (id, title, depends on, size, risk, lane) and
   confirm with the human. Cards stay `draft`; `plan-review` moves them to `ready` after Gate 1.
9. Record anything reusable you learned:
   `node "$FACTORY_PLUGIN_ROOT/scripts/learn.mjs" add --type architecture --key <k> --insight "…" --files <paths> --skill spec`.

## Unattended mode

`spec` needs a human for the interview and the approach choice. Unattended, it may only *re-cut* an
already-approved spec (e.g. split an oversized card) and must log each change in the spec's
decision table; it never invents requirements.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "The request is clear enough, skip the interview" | Clear to you. Ten workers will read it ten ways. Ask the cheapest question now. |
| "One big card is simpler" | Agents do their best work on S and M cards. XL cards stall, sprawl and fail review. |
| "I'll leave files.allow broad to be safe" | Broad scope serialises parallel work and lets a worker wander. Name the files. |
| "Tests go in a later card" | A card without its tests cannot prove it is done. Tests ship with the code they prove. |
| "Risk is low, it's just a small auth tweak" | Auth, payments, data deletion, migrations and secrets are high risk at any size. |

## Red flags

- A card title containing "and" (two cards), or more than 5 acceptance criteria.
- Acceptance criteria that cannot fail ("works well", "is clean").
- Two cards with overlapping `files.allow` and no dependency between them.
- A spec with no *Current state* evidence from the code.
- Proposing an implementation before the premise is agreed.

## Verification

- [ ] Premises written and agreed; an approach chosen by the human
- [ ] Spec quantified; current state cites files that exist
- [ ] `card.mjs validate` exits 0; no card is XL; every card lists its test files
- [ ] `dispatch.mjs plan` shows at least one parallel lane where the work allows it
- [ ] Cards left in `draft` for `plan-review`
