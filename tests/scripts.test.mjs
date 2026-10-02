import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRepo, write, sh, node, rm } from './helpers.mjs';

const nodeRepo = (extra = {}) => tempRepo({
  'package.json': JSON.stringify({ name: 'sample', type: 'module', scripts: { test: 'node --test', lint: 'node -e "process.exit(0)"' } }),
  'src/math.js': 'export const add = (a, b) => a + b;\n',
  'test/math.test.js': "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from '../src/math.js';\ntest('add', () => assert.equal(add(1, 2), 3));\n",
  ...extra,
});

test('review-record binds a verdict to the tree and goes STALE when code changes', () => {
  const dir = nodeRepo();
  const run = path.join(dir, '.factory/runs/C-001');
  const env = { FACTORY_CARD: 'C-001', FACTORY_RUN_DIR: run };
  assert.equal(node('review-record.mjs', ['verify', '--json'], dir, env).code, 1, 'missing before write');
  assert.equal(node('review-record.mjs', ['write', '--verdict', 'APPROVE', '--summary', 'ok'], dir, env).code, 0);
  const ok = node('review-record.mjs', ['verify', '--json'], dir, env);
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.out).status, 'CURRENT');
  write(dir, { 'src/math.js': 'export const add = (a, b) => a - b;\n' });
  const stale = node('review-record.mjs', ['verify', '--json'], dir, env);
  assert.equal(stale.code, 1);
  assert.equal(JSON.parse(stale.out).status, 'STALE');
  rm(dir);
});

test('review-record refuses APPROVE with CRITICAL findings and treats BLOCK as FAILED', () => {
  const dir = nodeRepo();
  const env = { FACTORY_CARD: 'C-001', FACTORY_RUN_DIR: path.join(dir, '.factory/runs/C-001') };
  write(dir, { 'f.json': JSON.stringify([{ severity: 'CRITICAL', file: 'src/math.js', line: 1, issue: 'x' }]) });
  assert.notEqual(node('review-record.mjs', ['write', '--verdict', 'APPROVE', '--findings', 'f.json'], dir, env).code, 0);
  assert.equal(node('review-record.mjs', ['write', '--verdict', 'BLOCK', '--findings', 'f.json'], dir, env).code, 0);
  assert.equal(JSON.parse(node('review-record.mjs', ['verify', '--json'], dir, env).out).status, 'FAILED');
  rm(dir);
});

test('changed-coverage measures only added lines', () => {
  const dir = nodeRepo();
  sh('git checkout -qb work', dir);
  write(dir, { 'src/math.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\nexport const mul = (a, b) => a * b;\n' });
  const lcov = (hits) => `SF:src/math.js\nDA:1,1\nDA:2,${hits[0]}\nDA:3,${hits[1]}\nend_of_record\n`;
  write(dir, { 'lcov.info': lcov([1, 0]), '.gitignore': 'lcov.info\n' });
  const half = node('changed-coverage.mjs', ['--lcov', 'lcov.info', '--base', 'main', '--min', '80', '--json'], dir);
  assert.equal(half.code, 1);
  assert.equal(JSON.parse(half.out).pct, 50);
  write(dir, { 'lcov.info': lcov([1, 1]) });
  assert.equal(node('changed-coverage.mjs', ['--lcov', 'lcov.info', '--base', 'main', '--min', '80'], dir).code, 0);
  assert.equal(node('changed-coverage.mjs', ['--lcov', 'nope.info', '--base', 'main'], dir).code, 2);
  // Changed source the report never saw fails instead of passing by omission.
  write(dir, { 'packages/a/src/x.js': 'export const x = 1;\n' });
  const un = node('changed-coverage.mjs', ['--lcov', 'lcov.info', '--base', 'main', '--json'], dir);
  assert.equal(un.code, 1);
  assert.deepEqual(JSON.parse(un.out).unmeasured, ['packages/a/src/x.js']);
  write(dir, { '.factory/coverage-ignore': 'packages/**\n' });
  assert.equal(node('changed-coverage.mjs', ['--lcov', 'lcov.info', '--base', 'main'], dir).code, 0);
  rm(dir);
});

test('scope-check flags files outside the card', () => {
  const dir = nodeRepo();
  write(dir, { '.factory/cards/C-001.json': JSON.stringify({ id: 'C-001', files: { allow: ['src/math.js', 'test/**'] } }) });
  sh('git add -A && git commit -qm card && git checkout -qb factory/C-001', dir);
  write(dir, { 'src/math.js': 'export const add = (a, b) => b + a;\n' });
  assert.equal(node('scope-check.mjs', ['--card', 'C-001'], dir).code, 0);
  write(dir, { 'src/other.js': 'export {};\n' });
  const out = node('scope-check.mjs', ['--card', 'C-001', '--json'], dir);
  assert.equal(out.code, 1);
  assert.match(out.out, /src\/other\.js/);
  rm(dir);
});

test('factory-init writes the bar, keeps user content and is idempotent', () => {
  const dir = nodeRepo({ 'AGENTS.md': '# Mine\n\nKeep this line.\n' });
  const first = node('factory-init.mjs', [], dir);
  assert.equal(first.code, 0, first.err);
  for (const f of ['CONSTRAINTS.md', 'DONE.md', 'CLAUDE.md', '.factory/config.json', '.factory/bin/floor-guard.mjs', '.factory/cards/.gitkeep']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} exists`);
  }
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Keep this line\./);
  assert.match(agents, /software-factory:start/);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md/m);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.factory/config.json'), 'utf8'));
  assert.ok(cfg.workers.allowedTools.includes('Bash(npm *)'), 'workers may run the stack tools');
  assert.ok(cfg.workers.command.includes('{allowedTools}'));
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'CONSTRAINTS.md'), 'utf8'), /\{\{\w+\}\}/, 'no unfilled placeholders');
  assert.equal(node('factory-init.mjs', [], dir).code, 0);
  const again = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(again.match(/software-factory:start/g).length, 1, 'one managed block after re-run');
  assert.equal(again.match(/## Repo-specific/g).length, 1, 'repo-specific section appended once');
  rm(dir);
});

test('check runs the CONSTRAINTS table: pass, fail and gap', () => {
  const dir = nodeRepo({
    'CONSTRAINTS.md': '# C\n\n## Enforced with numbers\n\n| Dimension | Rule | Checked by | Runs at |\n|---|---|---|---|\n| Tests | pass | `npm test --silent` | task |\n| Lint | clean | `false` | task |\n| Types | none | (not yet installed: no tsconfig.json) | task |\n| Build | ok | `echo "Module not found: Error: Cannot resolve x" >&2; exit 1` | task |\n| Bundle | small | `true` | CI |\n\n## Next\n',
  });
  const r = node('check.mjs', ['--stage', 'task', '--json'], dir);
  assert.equal(r.code, 1);
  const res = JSON.parse(r.out);
  assert.deepEqual(res.results.map((x) => [x.dimension, x.status]), [['Tests', 'pass'], ['Lint', 'fail'], ['Types', 'gap'], ['Build', 'fail']]);
  rm(dir);
});

test('evidence uploader refuses synthetic recordings', () => {
  const dir = nodeRepo();
  const ev = path.join(dir, '.factory/runs/C-001/evidence');
  write(dir, { '.factory/runs/C-001/evidence/manifest.json': JSON.stringify({ card: 'C-001', synthetic: true, source: 'test' }), '.factory/runs/C-001/evidence/report.md': '# r\n' });
  const r = node('evidence-upload.mjs', [ev, '--adapter', 'local'], dir, { FACTORY_CARD: 'C-001' });
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /synthetic/i);
  rm(dir);
});

test('cost estimate reads per-message usage while the worker runs', async () => {
  const { scanUsage, costOf } = await import('../scripts/lib/usage.mjs');
  const dir = tempRepo();
  const log = path.join(dir, 'worker.log');
  const ev = (id, i, o) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: i, output_tokens: o } } });
  fs.writeFileSync(log, `${ev('m1', 1000000, 10)}\n${ev('m1', 1000000, 100000)}\n${ev('m2', 0, 100000)}\n{"partial`);
  let st = scanUsage(log);
  assert.equal(costOf(st, { inputPerMTok: 1, outputPerMTok: 10 }), 3, '1M in + 200k out, m1 counted once');
  fs.appendFileSync(log, `":1}\n${JSON.stringify({ type: 'result', total_cost_usd: 2.5 })}\n`);
  st = scanUsage(log, st);
  assert.equal(costOf(st), 2.5, 'the CLI total wins once reported');
  rm(dir);
});

test('worker allowlist: base tools, stack tools, resolved commands, never shell wrappers', async () => {
  const { workerAllowedTools, expandCommand, programOf } = await import('../scripts/lib/permissions.mjs');
  const py = workerAllowedTools(['python'], ['CI=1 gitleaks detect --redact', 'bash -lc "x"']);
  for (const r of ['Edit', 'Bash(git *)', 'Bash(node *)', 'Bash(pytest *)', 'Bash(uv *)', 'Bash(gitleaks *)', 'Bash(ls)']) assert.ok(py.includes(r), r);
  for (const r of ['Bash(bash *)', 'Bash(sh *)', 'Bash(env *)', 'Bash(xargs *)', 'Bash(npm *)']) assert.ok(!py.includes(r), r);
  assert.equal(programOf('FOO=1 npm test'), 'npm');
  assert.deepEqual(expandCommand(['claude', '-p', '{prompt}', '--allowedTools', '{allowedTools}'], { prompt: 'do C-1', allowedTools: ['Edit', 'Bash(git *)'] }),
    ['claude', '-p', 'do C-1', '--allowedTools', 'Edit', 'Bash(git *)']);
});

test('scripts infer the card from a factory/C-### branch, without environment variables', () => {
  const dir = nodeRepo();
  sh('git checkout -qb factory/C-007', dir);
  assert.equal(node('review-record.mjs', ['write', '--verdict', 'APPROVE'], dir).code, 0);
  assert.ok(fs.existsSync(path.join(dir, '.factory/runs/C-007/review.json')));
  assert.equal(node('review-record.mjs', ['verify'], dir).code, 0);
  rm(dir);
});

test('factory-init --help prints usage and writes nothing', () => {
  const dir = nodeRepo();
  const r = node('factory-init.mjs', ['--help'], dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /usage/);
  assert.ok(!fs.existsSync(path.join(dir, 'CONSTRAINTS.md')));
  rm(dir);
});
