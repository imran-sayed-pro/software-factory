@AGENTS.md

<!-- software-factory:start -->
## Claude Code notes

`AGENTS.md` (imported above) is the rulebook. These notes cover only what is specific to Claude Code.

- The factory is the `software-factory` plugin. Its skills are `spec`, `plan-review`, `dispatch`,
  `build`, `review-gate`, `qa-verify`, `ship` and `factory-init`.
- Plugin hooks enforce the rules: destructive shell commands ask a human (and are denied for
  unattended workers), and edits outside a card's `files.allow` or to `CONSTRAINTS.md`,
  `DONE.md` and `.factory/` are denied inside a card.
- Unattended workers run with `FACTORY_UNATTENDED=1`, `FACTORY_CARD`, `FACTORY_RUN_DIR` and
  `FACTORY_ROOT` set by `dispatch`. With `FACTORY_UNATTENDED=1`, never use AskUserQuestion.
- Workers may run only the commands in `.factory/config.json` → `workers.allowedTools`. Write paths
  out in full: commands containing `$VAR` or a `VAR=value` prefix are refused.
- For parallel reviewers, issue every Agent call in one message with `run_in_background: false`,
  so they run concurrently and their results come back before you continue.
- Factory scripts live in the plugin: `node "${FACTORY_PLUGIN_ROOT:-<plugin dir>}/scripts/<name>.mjs"`.
<!-- software-factory:end -->
