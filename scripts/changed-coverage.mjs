#!/usr/bin/env node
// changed-coverage.mjs: coverage of the lines this change added, read from an existing lcov report.
// Coverage of changed lines is a number a worker can move; project coverage is inherited.
// Usage: node changed-coverage.mjs [--lcov coverage/lcov.info] [--min 80] [--base main] [--json]
// Exit: 0 at/above min (or no source changed), 1 below min or changed source missing from the report,
// 2 could not run. Source files that never appear in lcov (config files, generated code) can be listed
// as globs in .factory/coverage-ignore.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, matchesAny } from './lib/common.mjs';

const args = parseArgs();
const cwd = process.cwd();
const lcovPath = path.resolve(args.lcov || 'coverage/lcov.info');
const min = Number(args.min ?? 80);
const git = (a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }); } catch { return null; } };
const fail = (m) => { console.error('changed-coverage: ' + m); process.exit(2); };

if (!fs.existsSync(lcovPath)) fail(`no lcov report at ${lcovPath}; run the coverage command first`);
const base = [args.base, process.env.FACTORY_BASE, 'origin/main', 'main', 'master'].filter(Boolean)
  .find((b) => git(['merge-base', b, 'HEAD']));
if (!base) fail('no merge base');
const mb = git(['merge-base', base, 'HEAD']).trim();

// Added lines per file (tracked diff against the merge base, plus untracked files whole).
const changed = new Map();
let cur = null;
for (const line of (git(['diff', '--unified=0', '--no-color', mb, '--']) || '').split('\n')) {
  if (line.startsWith('+++ ')) cur = line.slice(4).replace(/^b\//, '');
  else if (line.startsWith('@@') && cur && cur !== '/dev/null') {
    const m = /\+(\d+)(?:,(\d+))?/.exec(line);
    const start = Number(m[1]), count = m[2] === undefined ? 1 : Number(m[2]);
    const set = changed.get(cur) || new Set();
    for (let i = 0; i < count; i++) set.add(start + i);
    changed.set(cur, set);
  }
}
for (const f of (git(['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean)) {
  const n = fs.readFileSync(path.join(cwd, f), 'utf8').split('\n').length;
  changed.set(f, new Set(Array.from({ length: n }, (_, i) => i + 1)));
}

// lcov: SF:<path> then DA:<line>,<hits>
const cov = new Map();
let sf = null;
for (const line of fs.readFileSync(lcovPath, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) { sf = path.relative(cwd, path.resolve(cwd, line.slice(3).trim())); cov.set(sf, cov.get(sf) || new Map()); }
  else if (line.startsWith('DA:') && sf) { const [ln, hits] = line.slice(3).split(','); cov.get(sf).set(Number(ln), Number(hits)); }
  else if (line === 'end_of_record') sf = null;
}

const ignoreFile = path.join(cwd, '.factory', 'coverage-ignore');
const ignore = ['**/*.config.{js,cjs,mjs,ts}', ...(fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [])];
const isSource = (f) => /\.(m?[jt]sx?|c[jt]s|py|swift|go|rb|kt|java)$/.test(f) && !/(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$|_test\.\w+$|Tests?\.swift$/i.test(f) && !f.startsWith('.factory/');

let instrumented = 0, covered = 0;
const perFile = [], unmeasured = [];
for (const [file, lines] of changed) {
  const fc = cov.get(file);
  if (!fc) { if (isSource(file) && !matchesAny(file, ignore)) unmeasured.push(file); continue; }
  let fi = 0, fcov = 0;
  for (const ln of lines) if (fc.has(ln)) { fi++; if (fc.get(ln) > 0) fcov++; }
  instrumented += fi; covered += fcov;
  if (fi) perFile.push({ file, covered: fcov, lines: fi, pct: Math.round((fcov / fi) * 1000) / 10 });
}
const pct = instrumented ? Math.round((covered / instrumented) * 1000) / 10 : null;
// Changed source the report never saw is unmeasured, not covered: fail rather than pass by omission.
const ok = (pct === null || pct >= min) && unmeasured.length === 0;
const out = { base, min, pct, covered, instrumented, perFile, unmeasured, ok };
if (args.json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(pct === null ? `changed-coverage: no instrumented changed lines${unmeasured.length ? ' (FAIL: changed source not measured)' : ''}` : `changed-coverage: ${pct}% of ${instrumented} changed lines covered (min ${min}%)`);
  for (const f of perFile.filter((f) => f.pct < min)) console.log(`  below: ${f.file} ${f.pct}% (${f.covered}/${f.lines})`);
  if (unmeasured.length) console.log(`  FAIL not in coverage report (fix the coverage config, or list it in .factory/coverage-ignore): ${unmeasured.join(', ')}`);
}
process.exit(ok ? 0 : 1);
