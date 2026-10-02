# Agent workflow (this repository)

This repository **is** the software factory: a Claude Code plugin of skills, reviewer agents, hooks
and dependency-free Node scripts. This file governs work on the factory itself, for any agent tool.
`CLAUDE.md` imports it. The rulebook the factory writes into *other* repositories is
`templates/AGENTS.md`; change both together when a rule applies to both.

## Workflow

1. **Isolate.** Work in a fresh worktree on a branch from `origin/main`. Never commit to `main`.
2. **Change one layer at a time.** Skills (`skills/*/SKILL.md`), agents (`agents/`), hooks (`hooks/`),
   scripts (`scripts/`), templates and profiles. A behaviour change usually touches a skill *and*
   its script; keep them in the same pull request.
3. **Prove it.** `npm run check` must pass: lint, unit tests and the routing evals. A change to a
   skill's description must keep every trigger eval ranking that skill first. A change to a
   script needs a unit test in `tests/`. For runner changes, run the dispatch scenario test.
4. **Ship.** Open a PR describing what changed, the evidence (test output, eval report), risks
   and follow-ups. A human merges.

## Rules for this codebase

- **Scripts stay dependency-free** (Node >= 18.17, built-ins only) so the plugin runs anywhere
  without `npm install`. `scripts/floor-guard.mjs` imports nothing at all, because `factory-init`
  copies it into target repos for CI.
- **Hooks fail closed.** If a hook cannot parse its input or read the card, it asks (or denies when
  unattended); it never silently allows.
- **No network from scripts** except `gh` in `evidence-upload.mjs` and the git remote in `dispatch`
  and `ship`. Never send source, findings or secrets anywhere else.
- **Verdicts are bound to code.** Anything that records a pass (review, QA, checks) stores the
  `treeHash` it judged; never add a path that clears a gate without one.
- **Attribution.** Code or prose adapted from another project needs its licence to allow it and a
  line in `NOTICE.md`. Do not copy from repositories without a licence.
- Every skill follows the anatomy in `docs/skill-anatomy.md`: Overview, When to use, Process,
  Common rationalizations, Red flags, Verification. Keep each `SKILL.md` under about 400 lines;
  move detail into `references/`.

## Multi-agent rules

- One worktree and one branch per task; never touch another agent's worktree or uncommitted work.
- Before starting, skim open PRs (`gh pr list`, `gh pr diff <n> --name-only`) for overlap; on
  overlap, stop and ask.
- Never force-push `main`; on your own branch use only `--force-with-lease`.

## Writing for humans

Commit messages, PR text, docs, skill prose and comments: lead with the point, short sentences,
active voice, concrete names and numbers, no filler or hype. Skills are read by models *and* people;
write them as instructions a careful engineer would follow.

## Completing a task

1. `npm run check` passes.
2. If a skill changed, run its behavioral eval: `npm run evals:behavioral -- <skill>` (spends tokens).
3. Update `README.md` and `docs/` for any user-visible change.
4. Commit, rebase on `origin/main`, re-run `npm run check`, push, open the PR. Do not merge.

## Commands

| Purpose | Command |
| --- | --- |
| Lint (syntax + skill/agent structure) | `npm run lint` |
| Unit tests | `npm test` |
| Routing evals (free, deterministic) | `npm run evals` |
| Behavioral evals (spends tokens) | `npm run evals:behavioral -- <skill>` |
| Everything | `npm run check` |

## Layout

| Path | What it holds |
| --- | --- |
| `skills/` | The 7 pipeline skills plus `factory-init` |
| `agents/` | Reviewer subagents used by `review-gate` and `plan-review` |
| `hooks/` | Safety hooks: destructive-command guard, card scope fence, session briefing |
| `scripts/` | Runner, floor guard, checks, coverage, review records, evidence, learnings, init |
| `profiles/` | Stack profiles (TypeScript, Python, Swift) that fill commands into `CONSTRAINTS.md` |
| `templates/` | Files written into target repos: AGENTS.md, CLAUDE.md, CONSTRAINTS.md, DONE.md, card schema |
| `evals/` | Trigger/routing and behavioral evals for the skills |
| `tests/` | Unit and scenario tests for the scripts |
