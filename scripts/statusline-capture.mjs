#!/usr/bin/env node
// statusline-capture.mjs: a Claude Code statusLine command that snapshots the account's Claude-plan
// usage window (rate_limits.five_hour / seven_day, documented at
// https://code.claude.com/docs/en/statusline.md) to a file dispatch.mjs polls, so dispatch can stop
// starting new workers before the account's session/weekly allowance runs out.
//
// There is no documented way for a headless `claude -p` worker to read this itself (see README's
// "Session usage brake" section), so the snapshot instead comes from any live, rendering, interactive
// Claude Code session that has this configured as its statusLine. Configure it once per machine, in
// ~/.claude/settings.json (or a project's .claude/settings.json):
//
//   { "statusLine": { "type": "command", "command": "node /abs/path/to/software-factory/scripts/statusline-capture.mjs" } }
//
// Keep at least one such session open while dispatch runs — dispatch fails safe (stops starting new
// workers rather than assuming it's fine) if the snapshot is missing or older than
// workers.usageStatusMaxAgeMinutes, which is what happens once nothing is left refreshing it.
import fs from 'node:fs';
import { writeJSON } from './lib/common.mjs';
import { DEFAULT_USAGE_STATUS_FILE } from './lib/usage.mjs';

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

let input = {};
try { input = JSON.parse(readStdin()); } catch { /* no/invalid stdin: still emit a status line below */ }

const rl = input.rate_limits || {};
const target = process.env.SOFTWARE_FACTORY_USAGE_FILE || DEFAULT_USAGE_STATUS_FILE;
try { writeJSON(target, { capturedAt: new Date().toISOString(), rate_limits: rl }); }
catch { /* best-effort: a snapshot write failure should never break the user's status line */ }

const pct = (w) => (typeof w?.used_percentage === 'number' ? `${Math.round(w.used_percentage)}%` : '?');
process.stdout.write(`factory 5h ${pct(rl.five_hour)} · 7d ${pct(rl.seven_day)}\n`);
