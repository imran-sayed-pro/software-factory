@AGENTS.md

## Claude Code notes

- Load this repo as a plugin while developing: `claude --plugin-dir .`
- The hooks in `hooks/hooks.json` are active in that session too; set `FACTORY_GUARD=off` only for a
  test that must exercise a blocked command, and never in committed scripts.
- When editing a skill, read `docs/skill-anatomy.md` first and keep the description specific: the
  description is what decides whether the skill triggers.
