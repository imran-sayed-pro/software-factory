# Notice and attribution

This project adapts ideas and, where noted, code from these MIT-licensed projects.
Their copyright notices are reproduced here as the MIT licence requires.

| Project | Copyright | What was adapted |
| --- | --- | --- |
| [affaan-m/ECC](https://github.com/affaan-m/ECC) | (c) 2026 Affaan Mustafa | Reviewer persona ideas (code-reviewer false-positive gating, silent-failure-hunter, pr-test-analyzer), worktree orchestration pattern, loop-operator escalation triggers |
| [garrytan/gstack](https://github.com/garrytan/gstack) | (c) 2026 Garry Tan | Sprint order, spawned/unattended decision mode, scope-fence and destructive-command guard ideas, review army + Fix-First split, QA self-regulation brake, ship route, canary "don't cry wolf" rule |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | (c) 2025 Addy Osmani | `CONSTRAINTS.md` contract and floor-guard reference implementation (adapted in `scripts/floor-guard.mjs`), skill anatomy (Common Rationalizations, Red Flags, Verification), task sizing, Definition of Done, eval tiers |

Each upstream project is distributed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

The evidence recorder in `scripts/evidence.mjs` is an original implementation. It follows the
*idea* of michaelshimeles/skills `evidence-driven-testing` (annotated recording + report + manifest),
but no code was copied, because that repository publishes no licence.
