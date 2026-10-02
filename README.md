# software-factory

A Claude Code plugin that turns a request into merged, verified code through a fixed pipeline:
small work cards, parallel unattended workers in separate git worktrees, a quality bar enforced by
commands, and two human gates (approve the plan, merge the code).

```
spec → plan-review ──Gate 1──▶ dispatch ─▶ build ─▶ review-gate ─▶ qa-verify ─▶ ship ──Gate 2──▶ merged
          (human approves)      (N workers in parallel worktrees)                  (human merges)
```

Stack-agnostic: profiles for TypeScript/JavaScript, Python and Swift fill the right commands into the
quality bar. Web apps, APIs, CLIs and iOS apps are covered by `qa-verify`.

## Install

```bash
# In Claude Code
/plugin marketplace add imran-sayed-pro/software-factory
/plugin install software-factory@software-factory

# Or, while developing the factory itself
claude --plugin-dir /path/to/software-factory
```

Requirements: Node 18.17 or newer, git, and `claude` on the PATH for workers. Optional: `gh` (pull
requests and evidence upload), `ffmpeg` and `Xvfb` (recorded QA evidence on Linux).

## Quick start

In the repository you want the factory to work on:

1. **"Set up the software factory in this repo."** `factory-init` detects the stack and writes
   `CONSTRAINTS.md`, `DONE.md`, `AGENTS.md`, `CLAUDE.md` and `.factory/`. Review and commit them.
2. **"Spec this: <feature or bug>."** `spec` interviews you, writes `.factory/specs/S-001.md` and cuts
   draft cards `.factory/cards/C-###.json`.
3. **"Review the plan."** `plan-review` writes a plan and test plan per card, runs the reviews, and
   brings you only the real decisions. Your approval is **Gate 1**; cards become `ready`.
4. **"Start the workers."** `dispatch` runs one unattended worker per card (up to `workers.max`), in
   parallel where file scopes do not overlap. Each worker runs `build`, `review-gate` and `qa-verify`.
   Blocked or stalled workers become escalations for you to resolve.
5. **"Ship it."** `ship` re-verifies verdicts against the exact code, opens the pull request with the
   evidence, and stops. You merge: **Gate 2**.

## The skills

| Skill | What it does |
| --- | --- |
| `factory-init` | Sets a repo up: quality bar, rulebook, `.factory/` folders, floor guard for CI |
| `spec` | Idea → written spec → small, independent work cards |
| `plan-review` | Plans, test plans and reviews per card; Gate 1 |
| `dispatch` | Parallel workers in worktrees, stall/cost brakes, escalations, merge queue |
| `build` | One card, test-first, with recorded RED evidence |
| `review-gate` | Floor guard, checks, scope check, parallel reviewer agents; verdict bound to the code |
| `qa-verify` | Exercises the running software, writes a regression test, records evidence |
| `ship` | Pull request with evidence and rollback plan; Gate 2; deploy watch |

Reviewer agents in `agents/`: `code-reviewer`, `test-reviewer`, `silent-failure-hunter`,
`security-reviewer`, `red-team`. None has edit tools; they read code and run checks.

## How the bar is enforced

- **`CONSTRAINTS.md`** holds the quality bar as a table: each rule has a command and a stage
  (`task`, `review`, `CI`). `scripts/check.mjs` runs the table; a rule without a working command is
  reported as a gap, never as a pass.
- **Floor guard** (`scripts/floor-guard.mjs`, copied to `.factory/bin/` for CI) fails a diff that
  lowers the bar: skipped tests, removed assertions, suppression comments, stubs, deleted tests, or a
  loosened or removed rule in `CONSTRAINTS.md`.
- **Verdicts are bound to code.** Review and QA records store the git tree hash they judged. Any
  later change makes them `STALE`, and `ship` refuses stale verdicts.
- **Hooks** deny catastrophic shell commands, ask before destructive ones (deny when unattended),
  keep a worker's edits inside its card's `files.allow`, and protect the bar from workers.

## Running the workers

```bash
node "$PLUGIN/scripts/dispatch.mjs" plan          # what would start, and why others wait
node "$PLUGIN/scripts/dispatch.mjs" watch         # run until idle; exit 0 clear, 3 escalations, 4 awaiting merges
node "$PLUGIN/scripts/dispatch.mjs" status
node "$PLUGIN/scripts/dispatch.mjs" escalations
node "$PLUGIN/scripts/dispatch.mjs" resolve <escalation-id> --note "use banker's rounding"
```

Worker settings live in `.factory/config.json` (`workers.max`, `command`, `stallMinutes`,
`maxCostUsdPerCard`, `maxAttemptsPerCard`, `virtualDisplay`, `pricing`). The cost brake estimates
spend from token usage while a worker runs, priced by `workers.pricing`; set it to your model's rates. A dependency counts as satisfied only
once it is merged, and unmerged work keeps its files locked, so parallel cards never collide.

### What workers may run

A worker is `claude -p` with nobody to answer permission prompts, so it runs with an explicit
allowlist in `.factory/config.json` → `workers.allowedTools`. `factory-init` fills it from the stack
profile:
- the edit and search tools;
- git, node and basic file commands;
- the stack's tools (for example npm/npx/vitest, pytest/uv/ruff, or swift/xcodebuild);
- the programs named in `CONSTRAINTS.md`.

Shell wrappers that would allow anything (`bash -c`, `env`, `xargs`, `sudo`) are never on the list.
A command outside the list is denied, and the worker records it and escalates. Edit the list to
widen or narrow it. The guard hooks apply on top.

Claude Code also refuses commands containing shell variables (`$VAR`) or `VAR=value` prefixes, so
skills write paths out in full. Scripts work out the card from the `factory/C-###` branch.

### How a worker starts

Each worker is a fresh `claude -p` session in its card's worktree, started with:
- `--plugin-dir <plugin root>`, so the factory skills and safety hooks are always loaded, even when the
  plugin is not installed;
- `--add-dir <run dir>`, so it can write evidence and reports there;
- its inputs copied into `<run dir>/inputs/` (the card, plan, test plan and spec), so it never reads
  your main checkout;
- an environment without the parent Claude session's variables, so it gets its own session.

A worker that reports `done` without a current, passing review verdict (and QA verdict, when the card
has a QA surface) is escalated straight away, not merged.

## Repository layout

| Path | What it holds |
| --- | --- |
| `skills/` | The 7 pipeline skills plus `factory-init` |
| `agents/` | Reviewer subagents |
| `hooks/` | Destructive-command guard, card scope fence, session briefing |
| `scripts/` | Runner, floor guard, checks, coverage, review records, evidence, learnings, init |
| `profiles/` | TypeScript, Python and Swift stack profiles |
| `templates/` | Files written into target repos |
| `evals/` | Routing evals (free) and behavioral evals (spend tokens) |
| `tests/` | Unit and scenario tests |
| `docs/` | Skill anatomy |

## Developing the factory

Read `AGENTS.md` first. Then:

```bash
npm run check                          # lint + unit tests + routing evals (no dependencies to install)
npm run evals:behavioral -- build      # runs real Claude sessions against evals/fixtures; spends tokens
```

## Credits

Ideas and some code are adapted from ECC, gstack and agent-skills (all MIT). See `NOTICE.md`.

## Licence

MIT. See `LICENSE`.
