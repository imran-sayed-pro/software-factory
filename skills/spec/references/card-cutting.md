# Cutting work into cards

## Size

| Size | Files | Example |
| --- | --- | --- |
| XS | 1 | Add a validation rule |
| S | 1–2 | One endpoint or one component |
| M | 3–5 | One feature slice end to end |
| L | 5–8 | Multi-component feature; split if you can |
| XL | 8+ | Not allowed. Split it. |

Split further when: it needs more than one focused session (about 2 hours of agent work), the
acceptance criteria need more than 3 bullets, it touches two independent subsystems, or its title
needs "and".

## Slice vertically

Prefer a thin slice through every layer (schema → service → API → UI → test) over a horizontal layer
("all the models"). A vertical slice can be tested and shipped on its own.

## Order for parallelism

1. **Contracts first.** Shared types, API shapes, schema migrations: one small card that everything
   else depends on. Once it is merged, the slices that use it run in parallel.
2. **Independent slices in parallel.** Cards whose `files.allow` do not overlap run at the same time.
3. **Sequential by nature:** migrations, shared configuration, lockfiles, anything that writes the
   same table or file.
4. **Risky early.** High-risk cards first, so failures surface while there is time.

A dependency is satisfied only when the depended-on card is **merged**: workers branch from the base
branch. Long chains therefore serialise through the human merge gate: keep chains short.

## files.allow

- List exact files when you know them; use narrow globs (`src/billing/invoice*.ts`) otherwise.
- Include the test files and any fixtures the card adds.
- Never `**`, never the repo root, never `CONSTRAINTS.md`, `DONE.md` or `.factory/`.
- If two cards must edit the same file, make one depend on the other.

## Risk

High risk when the card touches: authentication or authorisation, payments or billing, data
deletion or migration, secrets or credentials, deploy or infrastructure, or anything not undoable by
`git revert`. High-risk cards list `highRiskReasons` and get extra review and a human look at Gate 1.

## Card example

```json
{
  "id": "C-004",
  "spec": "S-002",
  "title": "Add password reset request endpoint",
  "description": "POST /api/password-reset sends a single-use reset link valid for 30 minutes. Unknown emails get the same 202 response to avoid account enumeration.",
  "acceptance": [
    "POST with a known email returns 202 and stores one token expiring in 30 minutes",
    "POST with an unknown email returns 202 and stores nothing",
    "More than 5 requests per email per hour return 429"
  ],
  "verification": { "commands": ["npm test -- password-reset"], "manual": [], "qaSurface": "api" },
  "dependsOn": ["C-003"],
  "files": { "allow": ["src/api/password-reset.ts", "src/services/reset-token.ts", "tests/api/password-reset.test.ts"] },
  "size": "M",
  "risk": "high",
  "highRiskReasons": ["authentication flow", "sends email to users"],
  "rollback": "Revert the card commits; the endpoint has no schema changes",
  "status": "draft"
}
```
