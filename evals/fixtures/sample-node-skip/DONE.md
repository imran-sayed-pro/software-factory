# Definition of Done

The same bar for every change. A card is done only when **its acceptance criteria are met and
every box below is true**. Acceptance criteria answer "did we build the right thing?";
this list answers "is it finished to our standard?".

## Correctness
- [ ] Every acceptance criterion on the card is met and verified at runtime, not only typechecked
- [ ] New behaviour is covered by tests that failed before the change and pass after it (RED evidence recorded)
- [ ] The full test suite passes; no regressions
- [ ] Error paths and edge cases on the card are handled, not only the happy path

## Quality
- [ ] `floor-guard` is clean and every `CONSTRAINTS.md` row passes or is a tracked exception
- [ ] The change stays inside the card's allowed files; no drive-by refactors
- [ ] No dead code, debug output or commented-out blocks

## Review and evidence
- [ ] `review-gate` verdict is APPROVE (or WARN with each finding acknowledged) and bound to the current tree
- [ ] `qa-verify` report exists; user-facing changes have a recorded evidence run
- [ ] Every decision the worker made on its own is listed in `decisions.md`

## Ship-readiness
- [ ] Public interfaces, config and user-facing behaviour are documented
- [ ] Migrations, feature flags and environment variables are accounted for
- [ ] A rollback path exists for anything risky
- [ ] A human approved the merge (Gate 2)
