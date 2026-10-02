---
name: qa-verify
description: Proves a factory card works in the running software, not just in unit tests. Exercises the card's QA surface (browser, API, CLI, iOS simulator), writes a regression test that fails before every bug fix, and records an annotated evidence video with a report and manifest for user-facing changes, checked frame by frame by an independent reviewer. Records a PASS, FAIL or PARTIAL verdict bound to the code. Use after review-gate, or when someone says "QA this", "test it in the browser", "prove it works", "record a demo of the fix", "verify the feature", or "capture evidence".
---

# QA verify

## Overview

Unit tests prove the code agrees with itself. This skill proves the product behaves: it drives the
real thing, captures what happened, and turns every bug it finds into a regression test before
fixing it. For user-facing changes it produces a recording with each check labelled on screen, so a
human at the merge gate can watch two minutes instead of reading the diff.

## When to use

- After `review-gate` approves a card whose `verification.qaSurface` is not `none`.
- To verify a bug fix end to end, or to capture before/after proof.

**When not to use:** `qaSurface: none` (pure internals: the review gate's test review covers it);
production monitoring after deploy (that is `ship`'s canary step).

## Inputs and outputs

- Reads: the card, its test plan (*QA surface* and *critical paths*), `AGENTS.md` (ports, env, test accounts).
- Writes (run directory `qa/`): `qa/report.md`, `qa/exploration-NNN.md`, an evidence session
  (`qa/evidence/` with `evidence.mp4`, `report.md`, `manifest.json`, `frames/`), regression tests in
  `files.allow`, and `qa.json` (via `review-record.mjs`).
- Hands off to: `ship` (on PASS), back to `build` (on FAIL).

## Process

0. **Scripts:** the commands below write `$FACTORY_PLUGIN_ROOT`; replace it with the absolute plugin path
   from the session briefing (or the worker prompt). Write paths out in full and run commands plainly:
   the permission check refuses commands containing shell variables, `VAR=value` prefixes or `env`. Scripts find the card from the
   `factory/C-###` branch; on any other branch pass `--card C-###`. The run directory is
   given in the worker prompt, otherwise `<main checkout>/.factory/runs/C-###`; write that path wherever
   this skill says `$FACTORY_RUN_DIR`.
   Clean worktree; `review-gate` verdict CURRENT.
1. **Pick the surface and set up** (commands per surface in `references/surfaces.md`):
   - Start the app from *your* worktree and confirm the port answers *your* process
     (`ss -ltnp "sport = :<port>"`, then `ps -p <pid> -o args=` shows your worktree path). Workers share machines.
   - Use synthetic test data and accounts from `AGENTS.md`. Never production data; never real credentials in chat or on screen.
2. **Baseline:** walk every critical path in the test plan, plus the obvious neighbours of the
   change. Explore with intent: after each probe write a short `qa/exploration-NNN.md` (what you
   tried, expected, happened, what you try next). For browser targets capture console errors and
   failed network requests on each page.
3. **For each bug found** (in severity order):
   1. Reproduce it reliably.
   2. Write a **regression test that fails** because of the bug (unit or integration where possible;
      end-to-end only for real boundary bugs). Record the failing run in `red.md`.
   3. Fix the cause inside `files.allow` (outside it: block the card with the evidence).
   4. Re-run the test and re-check in the running app. Commit test and fix together.
   **Brake:** every 5 fixes, compute risk: +15% per reverted fix, +5% per fix touching more than 3
   files, +20% for touching unrelated files. Over 20%, or more than 30 fixes: stop and block.
4. **Record evidence** for every user-facing acceptance criterion (browser and iOS surfaces; for
   API/CLI see step 5). Read `references/evidence.md`, then:
   ```bash
   E="$FACTORY_RUN_DIR/qa/evidence"
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" doctor
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" start --output "$E" --title "C-###: <what is verified>" \
     --commit "$(git rev-parse HEAD)" --branch "$(git branch --show-current)" --environment "<browser, OS, URL>"
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" annotate "$E" --type setup --message "Signed in as test user, on /settings"
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" annotate "$E" --type test_start --message "It should save the new email on submit"
   #   ...drive the app on screen (headed browser on $DISPLAY), let the UI settle, LOOK, then:
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" annotate "$E" --type assertion --result passed --message "Saved banner shown"
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" stop "$E"
   node "$FACTORY_PLUGIN_ROOT/scripts/evidence.mjs" frames "$E"
   ```
   Then replace the `CAVEATS_PENDING` line in `$E/report.md` with real caveats or "None".
5. **API, CLI and non-visual changes** still need evidence: a scripted probe saved as
   `qa/probe-output.txt` (exact commands, expected vs actual, status codes, measured numbers before/after).
6. **Independent frame check** (recorded runs): dispatch a fresh subagent with *only* the frames
   (`$E/frames/*.png`), `$E/frames/index.json` and the card's acceptance criteria. Ask: "For each
   frame, does the screen show the asserted state? Answer per frame: confirmed, contradicted, or
   cannot tell, with what you see." Any *contradicted* frame makes the verdict FAIL; *cannot tell*
   makes it PARTIAL until re-recorded.
7. **Write `qa/report.md`** (template in `references/surfaces.md`): surface, environment, critical
   paths and results, bugs found with regression tests and fixes, evidence links, untested items with reasons.
8. **Verdict**, then bind it to the code:
   - **PASS:** every critical path passed, frame check confirmed, no open bugs.
   - **PARTIAL:** something could not be tested (say why); a human decides at Gate 2.
   - **FAIL:** an acceptance criterion fails or a frame contradicts its assertion.
   ```bash
   node "$FACTORY_PLUGIN_ROOT/scripts/review-record.mjs" write --kind qa --verdict PASS --summary "4 paths, 1 bug fixed with regression test"
   ```
   Fixes made here changed the code, so re-run `review-gate` on the new tree before handing off.

## Unattended mode

No questions. Untestable items (no test account, external service down) are marked `untested` with
the reason, never skipped silently and never marked passed. Never sign in with real credentials;
never submit forms that act on real accounts or send real email or payments.

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "Unit tests pass, so it works" | Integration, config and UI bugs live between the units. Exercise the product. |
| "I'll fix it, then add a test" | A test written after the fix never failed; it proves nothing. |
| "The recording is optional" | For user-facing changes it is what the human at Gate 2 looks at. |
| "I saw it pass" | The timestamp records when you asserted, not whether it was true. Look first; the frame check will look too. |
| "Mark it passed, the flow needs a real account" | Mark it untested with the reason. A false pass is worse than a gap. |

## Red flags

- A recording made with `--source test` (synthetic pattern) presented as proof; the uploader refuses it.
- Assertions annotated faster than the UI could change.
- `CAVEATS_PENDING` left in a report.
- A QA fix committed without a regression test.
- Probing a dev server that turned out to be another worker's.

## Verification

- [ ] Every critical path in the test plan exercised; results in `qa/report.md`
- [ ] Each bug: failing regression test first, then fix, then re-check
- [ ] User-facing criteria recorded; frames confirmed by an independent check; caveats written
- [ ] `review-record.mjs verify --kind qa` prints CURRENT; `review-gate` re-run if QA changed code
