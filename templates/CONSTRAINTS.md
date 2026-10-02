# Constraints

This file is the quality bar for this repository. Every factory worker reads it before
writing code. **It is never weakened to make a change pass.** Tightening is fine and silent;
loosening needs its own pull request, reviewed by a human, separate from any feature work.

Last reviewed: {{date}} · Stack profile: `{{profile}}`

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
| Types | Zero type errors | `{{typecheck}}` | every task end |
| Lint | Zero lint errors | `{{lint}}` | every task end |
| Tests | All tests pass | `{{test}}` | every task end |
| Coverage | Changed lines >= 80% covered | `{{coverage}}` + changed-line check | review |
| Secrets | No secrets in source | `{{secrets}}` | review |
| Security: deps | Nothing at high or above | `{{auditDeps}}` | review, CI |

Every row names the command that produces the verdict. A rule with no command is an aspiration,
not a constraint. If a tool is not installed yet, mark the row `(not yet installed)` instead of
deleting it, and the review gate reports it as a coverage gap.

## Measured, not yet enforced (ratchets: must not get worse)

| Metric | Today | Direction |
|--------|-------|-----------|
| Project coverage | {{coverage_today}} | must not fall |

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
