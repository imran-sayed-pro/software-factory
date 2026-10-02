#!/usr/bin/env node
// SessionStart: remind every session in a factory repo of the bar, and brief a worker on its card.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every session learns where the factory scripts live (skills run them as "$FACTORY_PLUGIN_ROOT/scripts/…"),
// including repos not set up yet, where factory-init is the first thing to run.
const rootLine = `- Factory scripts: FACTORY_PLUGIN_ROOT=${PLUGIN_ROOT} (run them as node "${PLUGIN_ROOT}/scripts/<name>.mjs", with the path written out: commands containing shell variables are refused).`;
const emit = (lines) => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n').slice(0, 3000) } }) + '\n'); process.exit(0); };

let top;
try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { emit(['[software-factory] plugin loaded.', rootLine]); }
const root = process.env.FACTORY_ROOT || top;
if (!fs.existsSync(path.join(top, 'CONSTRAINTS.md')) && !fs.existsSync(path.join(root, '.factory', 'config.json'))) {
  emit(['[software-factory] This repo is not set up for the factory yet (the factory-init skill does that).', rootLine]);
}

const lines = ['[software-factory] This repo is built by the software factory.',
  '- Read CONSTRAINTS.md before writing code; never weaken it. DONE.md defines "done".',
  rootLine];
const card = process.env.FACTORY_CARD;
if (card) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(root, '.factory', 'cards', `${card}.json`), 'utf8'));
    lines.push(`- You are an UNATTENDED factory worker on ${c.id}: "${c.title}" (size ${c.size}, risk ${c.risk}).`,
      `- Edit only: ${c.files.allow.join(', ')}. Run directory: ${process.env.FACTORY_RUN_DIR || '(unset)'}.`,
      '- Never ask questions: pick the recommended option, never a destructive one, and log each choice in decisions.md.',
      '- Follow the build skill, then review-gate, then qa-verify. Finish by writing status.json and handoff.md.');
    const lf = path.join(root, '.factory', 'learnings.jsonl');
    if (fs.existsSync(lf)) {
      const all = fs.readFileSync(lf, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const prefixes = c.files.allow.map((g) => g.split(/[*?{]/)[0]);
      const hits = all.filter((e) => (e.files || []).some((f) => prefixes.some((p) => p && f.startsWith(p)))).slice(-5);
      if (hits.length) { lines.push('- Learnings for these files:'); for (const e of hits) lines.push(`  - [${e.type}] ${e.key}: ${e.insight}`); }
    }
  } catch { lines.push(`- Card ${card} could not be read; stop and write status.json with state "blocked".`); }
}
emit(lines);
