# Skill anatomy

Every factory skill uses the same shape, adapted from addyosmani/agent-skills (MIT).

```markdown
---
name: <kebab-case, matches the folder>
description: <what it does + when to use it, in the words people actually say. This line decides routing.>
---

# <Title>

## Overview         what the skill produces and why it exists (2-4 sentences)
## When to use      triggers, and **When not to use** (which skill to use instead)
## Inputs and outputs   files read and written; the handoff contract with the next skill
## Process          numbered steps with exact commands; gates marked **STOP**
## Unattended mode  how the skill behaves when FACTORY_UNATTENDED=1 (no questions, log decisions)
## Common rationalizations   | Excuse | Reality |, the shortcuts an agent will try, each answered
## Red flags        signs the skill is being misapplied
## Verification     the checklist that proves the skill was applied correctly
```

Rules:

- **Commands, not vibes.** Every check a skill asks for names the command that runs it.
- **Brakes are numbers.** Stop conditions are counts and thresholds, not "use judgment".
- **Files are the handoff.** A skill's output is a file the next skill reads, never chat.
- Keep `SKILL.md` under about 400 lines; put long checklists in `references/`.
- Scripts are referenced as `${FACTORY_PLUGIN_ROOT}/scripts/<name>.mjs`. `dispatch` sets
  `FACTORY_PLUGIN_ROOT` for workers, and the session-start hook prints it in every session. Otherwise
  it is two directories above the skill's base directory (shown when the skill loads). Commands are refused by Claude Code's permission check when they contain shell variables, so step 0 of
  each skill tells the model to write the absolute path out.
