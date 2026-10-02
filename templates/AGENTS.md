# Agent workflow

This repository is built by the **software factory**. This file is the rulebook for every agent
that works here, whatever tool runs it (Claude Code, Codex, Cursor, others). `CLAUDE.md` imports
it and adds only Claude-specific notes. Keep the repo-specific sections at the bottom current.

Stack profile: `{{profile}}` · Base branch: `{{base}}`

## Workflow

Every piece of work moves through the same beats, each backed by a factory skill.
A human decides at exactly two gates; everything between them may run unattended.

1. **Spec: `spec`.** Interview until the work is precise, challenge the premise, then write
   `.factory/specs/S-###.md` and break it into work cards in `.factory/cards/C-###.json`.
   Each card: acceptance tests, allowed files, dependencies, size (XS to L), risk, rollback.
2. **Plan: `plan-review`.** Review each card from product, engineering and design angles;
   write `.factory/plans/C-###.md` and `.factory/test-plans/C-###.md`.
   **Gate 1: a human approves the plan**, then cards move to `ready`.
3. **Dispatch: `dispatch`.** One git worktree and one worker per card, in parallel only when
   file scopes do not overlap. Stalls, overruns, blocked workers and conflicts escalate to a human.
4. **Build: `build`.** Test first: record a failing test (RED) before writing code, make it pass
   with the smallest change (GREEN), refactor, commit on the card branch. Debug by root cause.
5. **Review: `review-gate`.** Floor guard and `CONSTRAINTS.md` checks, then fresh-context
   reviewers in parallel. Verdict APPROVE, WARN or BLOCK, bound to the exact code reviewed.
6. **Prove: `qa-verify`.** Exercise the running software. Every bug gets a regression test that
   fails before the fix. User-facing changes get a recorded, annotated evidence run.
7. **Ship: `ship`.** Re-verify, open the PR with evidence, then **Gate 2: a human approves the
   merge**. After merge: deploy, watch, roll back if needed.

## Quality bar

- `CONSTRAINTS.md` is the bar, with a command behind every rule. Read it before writing code.
  **Never weaken it to make a change pass.** Loosening it is its own pull request, reviewed by a human.
- `DONE.md` is the Definition of Done. A card is done only when its acceptance criteria are met
  and every item in `DONE.md` holds.
- Evidence over claims: every statement that something works points to a test run, a review
  record, a QA report or a recording.

## Multi-agent rules

- Never commit directly to `{{base}}`. One worktree and one branch (`factory/C-###`) per card.
  Never touch another card's worktree, branch or uncommitted work.
- Stay inside the card's `files.allow`. If the work needs another file, stop, record why in
  `decisions.md`, and mark the card blocked so it can be re-scoped.
- Unattended workers never ask questions: they choose the recommended option, never a
  destructive or irreversible one, and log every such choice in `decisions.md`.
- Never force-push `{{base}}`. On your own card branch use only `--force-with-lease`.
- Never merge a PR or push to `{{base}}`: that is Gate 2.
- Resolve lockfile conflicts by regenerating the lockfile, never by hand-merging it.
- Worktrees share the machine: confirm a dev-server port answers *your* process
  (`lsof -i :<port>` or `ss -ltnp`) before trusting it, and never experiment on a shared database.
- Stop and escalate instead of guessing when: three hypotheses have failed, a fix needs more files
  than allowed, an action is high-risk (auth, payments, data deletion, migrations, secrets,
  deploys), or a decision is not covered by the card.

## Writing for humans

Anything a person will read (commit messages, PR titles and bodies, docs, code comments, the final
report) is written plainly:

- Lead with the result. Short sentences, active voice, concrete numbers and file paths.
- No filler, hedging, hype or chatbot phrases ("I'd be happy to", "robust", "seamless", "leverage").
- Claims link to evidence. Unknowns are stated as unknowns.
- Edit only text you wrote or changed.

## Completing a card

1. Keep changes limited to the card.
2. Run the checks: `node <factory>/scripts/check.mjs --stage task` (the commands below).
3. Run `review-gate` until the verdict is APPROVE or WARN and is bound to the current tree.
4. Run `qa-verify` for the card's QA surface; upload evidence for user-facing changes.
5. Commit with a clear message; write `handoff.md` and `status.json` in the run directory.
6. `ship` rebases onto the latest `{{base}}`, re-runs the checks, pushes the card branch, and
   opens the PR with what changed, how it was proven (with links), risks and follow-ups.
7. Stop. A human merges (Gate 2). Keep the worktree until the PR is merged or closed.

## Skill sources

| Skill | Purpose | Built from (MIT, see the factory's NOTICE.md) |
| --- | --- | --- |
| `spec` | Spec and work cards | gstack `/spec`, `/office-hours`; agent-skills `interview-me`, task sizing; ECC RFC decomposition |
| `plan-review` | Plan, test plan, Gate 1 | gstack `/autoplan`, `/plan-eng-review`; agent-skills `doubt-driven-development` |
| `dispatch` | Parallel workers | ECC worktree orchestration and loop-operator; gstack spawned mode and version queue |
| `build` | Test-first implementation | ECC `tdd-guide`, `build-error-resolver`; gstack `/investigate`; agent-skills `/build auto` |
| `review-gate` | Merge gate | ECC `code-reviewer`; gstack `/review`; agent-skills `constraint-driven-development` |
| `qa-verify` | Runtime proof | gstack `/qa`, `/ios-qa`; evidence-recording idea from michaelshimeles/skills |
| `ship` | PR, Gate 2, deploy, canary | gstack `/ship`, `/land-and-deploy`, `/canary`; agent-skills Definition of Done |

## Repo-specific

Fill these in once and keep them current; workers rely on them.

### Commands

| Purpose | Command |
| --- | --- |
| Install | `{{install}}` |
| Type check | `{{typecheck}}` |
| Lint | `{{lint}}` |
| Test | `{{test}}` |
| Coverage (writes lcov) | `{{coverage}}` |
| Build | `{{build}}` |
| End-to-end | `{{e2e}}` |
| Floor guard | `node .factory/bin/floor-guard.mjs` |

### Hard invariants

- _Security and architecture rules that must never break (fill in)._

### Environment quick reference

- _Ports, env vars, test accounts, seed data, feature flags (fill in)._

### Local test infrastructure

- _Stubs, fixtures, fake services (fill in)._

### Cannot be tested locally

- _Flows that need production services or real devices, and how they are covered instead (fill in)._
