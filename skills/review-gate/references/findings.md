# Finding schema

Every reviewer returns a JSON array. `review-gate` merges them into `findings.json`.

```json
[
  {
    "id": "F-1",
    "source": "code-reviewer",
    "severity": "HIGH",
    "confidence": 90,
    "file": "src/api/password-reset.ts",
    "line": 42,
    "issue": "Token compared with === allows timing attacks",
    "failure": "Attacker measures response time per guessed prefix and recovers a valid reset token",
    "fix": "Use crypto.timingSafeEqual on equal-length buffers",
    "class": "ASK",
    "status": "open"
  }
]
```

| Field | Rules |
| --- | --- |
| `severity` | `CRITICAL` (security hole, data loss, crash on a main path), `HIGH` (bug users will hit, missing required test), `MEDIUM` (maintainability, minor perf, not-assessed gap), `LOW` (polish) |
| `confidence` | 0–100. Report only at 80 or above. |
| `file`, `line` | Required. A finding you cannot place is dropped. |
| `failure` | Required for HIGH/CRITICAL: input, state, and the bad outcome. |
| `class` | `AUTO-FIX` or `ASK` (see the Fix-First rules). |
| `status` | `open`, `fixed`, `accepted` (with a reason in `decisions.md`), `rejected` (with a reason). |

## Known false positives (skip unless the codebase gives specific evidence)

- "Add error handling" where a caller, framework middleware or error boundary already handles it.
- "Missing validation" on an internal function whose callers validate (trace one caller first).
- "Magic number" for HTTP codes, common time units, array index 0/-1, obvious single-use constants.
- "Function too long" for exhaustive switches, config objects, test tables, generated code.
- "Possible null" right after a guard or type narrowing.
- "N+1" on fixed-size loops or code that already batches.
- "Missing await" on intentionally detached calls (logging, metrics, fire-and-forget queues).
- Hard-coded values in tests and fixtures.

(Adapted from ECC `code-reviewer`, MIT.)
