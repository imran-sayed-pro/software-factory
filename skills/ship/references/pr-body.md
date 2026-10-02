# Pull request body

Write it plainly: lead with what changed, short sentences, every claim linked to its proof.

```markdown
## C-### <card title>

Spec: S-### · Card: `.factory/cards/C-###.json` · Risk: <low|medium|high>

### What changed
- <one line per behaviour, in user terms>

### Proof
| Acceptance criterion | Proof |
| --- | --- |
| <criterion 1> | `<test file>::<test name>` (failed first, see red.md) · [recording @ 0:42](<video link>) |
| <criterion 2> | `<test>` · `qa/probe-output.txt` |

- Review gate: **APPROVE** (<n> reviewers; findings: <counts>) bound to `<tree hash>`
- QA: **PASS** · [watch the recording](<link>) · [QA report](<link>)
- Checks: types, lint, tests, changed-line coverage <x>%, floor guard clean

### Decisions made without a human
- <copied from decisions.md, or "None">

### Known gaps
- <unchecked DONE.md items, untested QA items, WARN findings with reasons, or "None">

### Risks and rollback
- Risk: <…>
- Rollback: <the card's rollback plan>
```
