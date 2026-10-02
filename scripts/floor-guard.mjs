#!/usr/bin/env node
// floor-guard.mjs: diff-scoped enforcement of the CONSTRAINTS.md floor.
// Catches the cheap roads to green an agent takes: silenced checkers, easier tests,
// unfinished stubs, a loosened CONSTRAINTS.md, and undiscussed exceptions.
//
// Adapted from the floor-guard reference in addyosmani/agent-skills (MIT, (c) 2025 Addy Osmani),
// extended with Python/Swift/Go patterns, an ignore file, and JSON output.
// Standalone on purpose (no imports) so `factory-init` can copy it into a repo for CI.
//
// Usage: node floor-guard.mjs [--base <ref>] [--json] [--cwd <dir>]
// Exit codes: 0 clean, 1 floor violation(s), 2 the guard could not run (never read 2 as clean).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : def; };
const asJson = argv.includes('--json');
const cwd = path.resolve(opt('--cwd', process.cwd()));

const git = (args, { diffExit = false } = {}) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }); }
  catch (e) { return diffExit && e.status === 1 && typeof e.stdout === 'string' ? e.stdout : null; }
};
const bail = (msg) => {
  if (asJson) process.stdout.write(JSON.stringify({ status: 'error', error: msg }) + '\n');
  else process.stderr.write('floor-guard: ' + msg + '\n');
  process.exit(2);
};

// Base: explicit flag, then FACTORY_BASE, then origin/<default>, then main/master.
const candidates = [opt('--base'), process.env.FACTORY_BASE, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
let base = null, mergeBase = null;
for (const c of candidates) {
  const mb = git(['merge-base', c, 'HEAD'])?.trim();
  if (mb) { base = c; mergeBase = mb; break; }
}
if (!mergeBase) bail(`no merge base against any of: ${candidates.join(', ')}`);

// --no-renames: a test moved to a non-test path must show up as a deleted test, not a rename.
const tracked = git(['diff', '--no-renames', '--unified=0', '--no-color', mergeBase, '--', '.', ':(exclude).factory']);
if (tracked === null) bail('could not diff against ' + mergeBase);
const untrackedList = git(['ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude).factory']);
if (untrackedList === null) bail('could not list untracked files');
const untracked = untrackedList.split('\n').filter(Boolean).map((f) => {
  const d = git(['diff', '--no-index', '--unified=0', '--no-color', '/dev/null', f], { diffExit: true });
  if (d === null) bail('could not diff untracked file ' + f);
  return d;
}).join('\n');
const diff = tracked + '\n' + untracked;

// Ignore file: one glob per line, for tracked, reviewed exemptions (e.g. vendored code). It is read
// from the merge base, never from the change being judged, so a change cannot exempt itself; any edit
// to it is itself a finding for a human to review.
const IGNORE_PATH = '.factory/floor-ignore';
const parseIgnore = (t) => (t || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const baseIgnore = git(['show', `${mergeBase}:${IGNORE_PATH}`]);
const ignores = parseIgnore(baseIgnore);
const workIgnorePath = path.join(cwd, IGNORE_PATH);
const workIgnore = fs.existsSync(workIgnorePath) ? fs.readFileSync(workIgnorePath, 'utf8') : null;
const ignoreChanged = parseIgnore(workIgnore).join('\n') !== ignores.join('\n');
const globRe = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
const ignored = (f) => ignores.some((g) => globRe(g).test(f));

const added = [], removed = [], deleted = [];
const pathOf = (s) => s.replace(/^[ab]\//, '').replace(/\t.*$/, '');
let file = '', oldFile = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('--- ')) oldFile = pathOf(line.slice(4));
  else if (line.startsWith('+++ ')) {
    const newFile = pathOf(line.slice(4));
    file = newFile === '/dev/null' ? oldFile : newFile;
    if (newFile === '/dev/null') deleted.push(file);
  } else if (line.startsWith('+') && !line.startsWith('+++')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-') && !line.startsWith('---')) removed.push({ file, text: line.slice(1) });
}

const findings = [];
const flag = (rule, f, text) => { if (!ignored(f)) findings.push({ rule, file: f, text: String(text).trim().slice(0, 140) }); };
const isTest = (f) => /(\.(test|spec)\.|_test\.|(^|\/)test_[^/]*\.py$|(^|\/)tests?\/|Tests\/|Tests\.swift$)/.test(f);
const isConstraints = (f) => /(^|\/)CONSTRAINTS\.md$/.test(f);
const isDoc = (f) => /\.(md|mdx|txt|rst)$/i.test(f);

// 1. Silenced checker.
const SUPPRESSIONS = /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|biome-ignore|oxlint-disable|# *noqa|# *type: *ignore|# *pragma: *no cover|# *pylint: *disable|istanbul ignore|c8 ignore|v8 ignore|nosemgrep|gitleaks:allow|Stryker disable|swiftlint:disable|\/\/ *nolint|#\[allow\(/;
// 4. Unfinished work.
const STUBS = /throw new (Error|NotImplemented\w*)\(.*[Nn]ot implemented|raise NotImplementedError|fatalError\(\s*"(TODO|[Nn]ot implemented)|todo!\(|unimplemented!\(|catch\s*\(\s*\w*\s*\)\s*\{\s*\}|catch\s*\{\s*\}|except(\s+\w+)?\s*:\s*pass\b|\b(TODO|FIXME)\b(?!\s*[(:]\s*#?[A-Za-z]*-?\d+)|\bpass\s*# *stub/;
// A TODO/FIXME that cites a ticket (TODO(#123), TODO: ENG-42) is tracked work, not a stub.
// 2. A test made easier.
const SKIPS = /\b(it|test|describe)\.(skip|todo)\b|\.only\(|\bxit\(|\bxdescribe\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|unittest\.skip|\bt\.Skip\(|XCTSkip|@Disabled|\.disabled\(/;

for (const { file: f, text } of added) {
  const code = !isDoc(f);
  if (code && SUPPRESSIONS.test(text)) flag('silenced-checker', f, text);
  if (code && STUBS.test(text)) flag('unfinished-work', f, text);
  if (code && SKIPS.test(text)) flag('test-made-easier', f, text);
  if (isConstraints(f) && /^\| *(W|E)\d+ *\|/.test(text)) flag('new-exception', f, text);
}

if (ignoreChanged) findings.push({ rule: 'floor-ignore-changed', file: IGNORE_PATH, text: 'exemptions changed; they apply only after a human merges them' });
for (const f of deleted) if (isTest(f)) flag('test-deleted', f, 'file deleted');
// Assertions removed from a test file that stays: compare the number of assertion *calls* removed vs
// added per file, so a rewritten or reformatted test does not trip it but a net loss does.
const ASSERT_CALL = /(\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\.should\b|\bXCTAssert\w*\s*\(|#expect\s*\(|\brequire\.\w+\s*\(|\bself\.assert\w*\s*\()/g;
const countCalls = (lines, f) => lines.filter((l) => l.file === f).reduce((n, l) => n + (l.text.match(ASSERT_CALL) || []).length, 0);
for (const f of new Set(removed.map((l) => l.file))) {
  if (!isTest(f) || deleted.includes(f)) continue;
  const lost = countCalls(removed, f) - countCalls(added, f);
  if (lost > 0) {
    const sample = removed.find((l) => l.file === f && ASSERT_CALL.test(l.text));
    ASSERT_CALL.lastIndex = 0;
    flag('assertion-removed', f, `${lost} fewer assertion call(s); e.g. ${sample ? sample.text.trim() : ''}`);
  }
}

// CONSTRAINTS.md: a rule removed or a threshold loosened. Rules are floor bullets (key = text before
// the first colon) or table rows (key = first cell). Each number gets a direction from nearby words.
const ruleKey = (t) => {
  const s = t.trim();
  if (/^\|[-: |]+\|$/.test(s)) return null;
  if (s.startsWith('|')) return s.split('|').map((c) => c.trim()).filter(Boolean)[0] ?? '';
  if (/^[-*] /.test(s)) return s.slice(2).split(':')[0].trim();
  return null;
};
const isException = (t) => /^\| *(W|E)\d+ *\|/.test(t.trim());
const MIN_BEFORE = /(>=|>|≥|at least|minimum|\bmin\b|no less than|not fall|not drop)\s*$/;
const MAX_BEFORE = /(<=|<|≤|at most|maximum|\bmax\b|no more than|under|below|not grow|not exceed)\s*$/;
const MIN_AFTER = /^\s*\S*\s*(or more|or higher|must not fall|must not drop)/;
const MAX_AFTER = /^\s*\S*\s*(or less|or lower|must not grow|must not exceed)/;
const thresholds = (t) => {
  const out = [], re = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    const dir = MIN_BEFORE.test(before) || MIN_AFTER.test(after) ? 'min'
      : MAX_BEFORE.test(before) || MAX_AFTER.test(after) ? 'max' : null;
    out.push({ n: Number(m[0]), dir });
  }
  return out;
};
const removedRules = removed.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
const addedRules = added.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
for (const r of removedRules) {
  const a = addedRules.find((x) => x.file === r.file && ruleKey(x.text) === ruleKey(r.text));
  if (!a) { if (!isException(r.text)) flag('rule-removed', r.file, r.text); continue; }
  const before = thresholds(r.text), after = thresholds(a.text);
  let verdict = null;
  for (const dir of ['min', 'max', null]) {
    const was = before.filter((x) => x.dir === dir), now = after.filter((x) => x.dir === dir);
    was.forEach((b, i) => {
      const n = now[i];
      if (verdict) return;
      if (!n) verdict = 'threshold-removed';
      else if (n.n === b.n) return;
      else if (dir === 'min' ? n.n < b.n : dir === 'max' ? n.n > b.n : true) verdict = dir ? 'threshold-loosened' : 'threshold-changed';
    });
  }
  if (verdict) flag(verdict, r.file, r.text + '  ->  ' + a.text);
}

// The enforced table: a rule's command or its stages may not be weakened silently. Compare whole tables
// (base vs now) by Dimension, since a zero-context diff cannot tell which table a row belongs to.
const enforced = (text) => {
  const rows = new Map();
  let inTable = false;
  for (const line of (text || '').split('\n')) {
    if (/^##\s+Enforced with numbers/i.test(line)) { inTable = true; continue; }
    if (inTable && /^##\s/.test(line)) break;
    if (!inTable || !line.trim().startsWith('|') || /^\|[-: |]+\|$/.test(line.trim())) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'Dimension' || cells.length < 4) continue;
    rows.set(cells[0], { checkedBy: cells[2], runsAt: cells[3] });
  }
  return rows;
};
const stages = (t) => new Set(['task', 'review', 'ci'].filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(t) || (k === 'task' && /every task/i.test(t))));
for (const f of new Set([...added, ...removed].map((l) => l.file).filter(isConstraints))) {
  const before = enforced(git(['show', `${mergeBase}:${f}`]));
  const now = enforced(fs.existsSync(path.join(cwd, f)) ? fs.readFileSync(path.join(cwd, f), 'utf8') : '');
  for (const [dim, b] of before) {
    const n = now.get(dim);
    if (!n) continue; // a removed row is reported as rule-removed above
    if (n.checkedBy !== b.checkedBy) flag(/not yet installed/i.test(n.checkedBy) ? 'check-disabled' : 'check-changed', f, `${dim}: ${b.checkedBy}  ->  ${n.checkedBy}`);
    const lost = [...stages(b.runsAt)].filter((k) => !stages(n.runsAt).has(k));
    if (lost.length) flag('stage-dropped', f, `${dim}: no longer runs at ${lost.join(', ')} (${b.runsAt}  ->  ${n.runsAt})`);
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ status: findings.length ? 'violations' : 'clean', base, mergeBase, findings }, null, 2) + '\n');
  process.exit(findings.length ? 1 : 0);
}
if (findings.length === 0) { console.log(`floor-guard: clean (base ${base})`); process.exit(0); }
console.error(`floor-guard: ${findings.length} floor violation(s) against ${base}:`);
for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
console.error('\nEach is a move that lowers the bar. Fix the code, or route it through a tracked exception in CONSTRAINTS.md (reviewed by a human).');
process.exit(1);
