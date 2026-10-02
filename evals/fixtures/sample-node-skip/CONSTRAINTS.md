# Constraints

This file is the quality bar for this repository. Every factory worker reads it before
writing code. **It is never weakened to make a change pass.** Tightening is fine and silent;
loosening needs its own pull request, reviewed by a human, separate from any feature work.

Last reviewed: 2026-10-02 · Stack profile: `typescript`

## Floor (always enforced, checked by `floor-guard`)

- No new suppression comments: `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `# noqa`, `# type: ignore`, `swiftlint:disable`, `istanbul ignore`, `nosemgrep`, `gitleaks:allow`
- No unimplemented stubs: `throw new Error("Not implemented")`, `fatalError("TODO")`, `raise NotImplementedError`, empty `catch {}` / `except: pass`
- No skipped or deleted tests, and no assertions removed from a test that stays
- No secrets in source
- This file is not weakened in the same change as a feature

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Floor | Zero floor violations | `node .factory/bin/floor-guard.mjs` | every task end, review |
| Types | Zero type errors | `(not yet installed: no tsconfig.json)` | every task end |
| Lint | Zero lint errors | `npm run lint --if-present` | every task end |
| Tests | All tests pass | `npm test --if-present` | every task end |
| Coverage | Changed lines >= 80% covered | `mkdir -p coverage && node --test --experimental-test-coverage --test-reporter=spec --test-reporter-destination=stdout --test-reporter=lcov --test-reporter-destination=coverage/lcov.info` + changed-line check | review |
| Secrets | No secrets in source | `gitleaks detect --redact --no-banner` | review |
| Security: deps | Nothing at high or above | `osv-scanner scan source -r .` | review, CI |

Every row names the command that produces the verdict. A rule with no command is an aspiration,
not a constraint. If a tool is not installed yet, mark the row `(not yet installed)` instead of
deleting it, and the review gate reports it as a coverage gap.

## Measured, not yet enforced (ratchets: must not get worse)

| Metric | Today | Direction |
|--------|-------|-----------|
| Project coverage | not measured yet (run the coverage command, then record the number) | must not fall |

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
