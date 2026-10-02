#!/usr/bin/env node
// scope-check.mjs: every file this card changed must be inside its files.allow.
// Covers what the edit hook cannot see (files written by Bash, generators, formatters).
// Usage: node scope-check.mjs [--card C-001] [--base main] [--json]   Exit: 0 in scope, 1 out of scope, 2 error.
import { factoryRoot, git, parseArgs, readJSON, matchesAny, die } from './lib/common.mjs';
import { cardPath } from './lib/cards.mjs';

const args = parseArgs();
const id = args.card || process.env.FACTORY_CARD || die('--card or FACTORY_CARD is required');
const card = readJSON(cardPath(factoryRoot(), id));
const base = args.base || process.env.FACTORY_BASE || 'main';
const mb = git(['merge-base', base, 'HEAD'], { allowFail: true })?.trim() || die(`no merge base with ${base}`);
const changed = new Set([
  ...git(['diff', '--name-only', mb]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
].filter((f) => f && !f.startsWith('.factory/')));
const outside = [...changed].filter((f) => !matchesAny(f, card.files.allow));
const out = { card: id, base, changed: [...changed], outside, ok: outside.length === 0 };
if (args.json) console.log(JSON.stringify(out, null, 2));
else if (out.ok) console.log(`scope: ${changed.size} changed file(s), all inside ${id}'s files.allow`);
else { console.error(`scope: ${outside.length} file(s) outside ${id}'s files.allow:`); for (const f of outside) console.error(`  ${f}`); }
process.exit(out.ok ? 0 : 1);
