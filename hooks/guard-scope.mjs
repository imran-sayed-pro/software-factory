#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): keep a worker inside its card.
// Outside a factory card (FACTORY_CARD unset) every edit is allowed, except that unattended sessions
// may never touch the bar itself. Inside a card, the target must match files.allow or be in the run dir.
// Bash can still write files: this fence is for the edit tools, and review-gate checks the final diff.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, decide, allow, askOrDeny, unattended, failClosed } from './lib.mjs';

failClosed('scope fence');
if (process.env.FACTORY_GUARD === 'off') allow();
const input = readInput();
if (input === null) askOrDeny('[factory] could not parse the edit payload');
const ti = input?.tool_input || {};
const target = ti.file_path || ti.notebook_path || ti.path;
if (!target) allow();
const cwd = input.cwd || process.cwd();
const abs = path.resolve(cwd, target);
const card = process.env.FACTORY_CARD;

const gitTop = (dir) => fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
// A new file may sit in directories that do not exist yet: resolve paths from the nearest existing one.
let probe = path.dirname(abs);
while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
// Compare real paths so symlinked temp dirs (macOS /var -> /private/var) do not look outside the repo.
const absReal = path.join(fs.realpathSync(probe), path.relative(probe, abs));

// Inside a card the boundary is the worker's own worktree (from its cwd), so it can reach neither the
// human's checkout nor another worker's worktree. Outside a card, judge the repo the file belongs to.
let top;
if (card) {
  try { top = gitTop(cwd); } catch { decide('deny', `[factory] ${card}: cannot resolve the worker's worktree from ${cwd}; refusing edits`); }
} else {
  try { top = gitTop(probe); } catch { top = fs.realpathSync(cwd); }
}
const rel = path.relative(top, absReal).split(path.sep).join('/');

const PROTECTED = [/^CONSTRAINTS\.md$/, /^DONE\.md$/, /^\.factory\/config\.json$/, /^\.factory\/cards\//, /^\.factory\/bin\//, /^\.factory\/learnings\.jsonl$/];
const realish = (p) => { let q = p; while (!fs.existsSync(q) && path.dirname(q) !== q) q = path.dirname(q); return path.join(fs.realpathSync(q), path.relative(q, p)); };
const runDir = process.env.FACTORY_RUN_DIR ? realish(path.resolve(process.env.FACTORY_RUN_DIR)) : null;

if (runDir && (absReal === runDir || absReal.startsWith(runDir + path.sep))) allow();
if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
  if (card) decide('deny', `[factory] ${card} may only edit files inside its worktree (${top}); ${target} is outside`);
  allow();
}
if (PROTECTED.some((re) => re.test(rel))) {
  if (card || unattended()) decide('deny', `[factory] ${rel} is part of the quality bar or factory state; workers never edit it. Escalate if it must change.`);
  allow();
}
if (!card) allow();

// Glob matching identical to scripts/lib/common.mjs globToRegExp.
function globToRegExp(glob) {
  let g = glob.replace(/^\.\//, ''); if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = g.indexOf('}', i); if (end === -1) { re += '\\{'; continue; } re += '(?:' + g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

const root = process.env.FACTORY_ROOT || top;
const cardFile = path.join(root, '.factory', 'cards', `${card}.json`);
let allowGlobs;
try { allowGlobs = JSON.parse(fs.readFileSync(cardFile, 'utf8')).files.allow; }
catch { decide('deny', `[factory] cannot read card ${card} at ${cardFile}; refusing edits until the card is readable`); }
if (!Array.isArray(allowGlobs) || !allowGlobs.length) decide('deny', `[factory] card ${card} has no files.allow list; refusing edits until the card is fixed`);
if (allowGlobs.some((g) => globToRegExp(g).test(rel))) allow();
decide('deny', `[factory] ${rel} is outside ${card}'s files.allow (${allowGlobs.join(', ')}). If the card truly needs it, stop and record it in decisions.md so the card can be re-scoped.`);
