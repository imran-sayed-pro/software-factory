import test from 'node:test';
import assert from 'node:assert/strict';
import { tempRepo, write, sh, node, rm } from './helpers.mjs';

const base = {
  'src/math.js': 'export const add = (a, b) => a + b;\n',
  'test/math.test.js': "import assert from 'node:assert';\ntest('add', () => assert.equal(add(1, 2), 3));\ntest('add0', () => assert.equal(add(0, 0), 0));\n",
  'CONSTRAINTS.md': '# Constraints\n\n## Enforced with numbers\n\n| Dimension | Rule | Checked by | Runs at |\n|---|---|---|---|\n| Coverage | Changed lines >= 80% covered | `x` | review |\n| Bundle | main bundle under 200 kB | `y` | CI |\n\n## Exceptions\n\n| ID | Rule | Path | Reason | Owner | Expires |\n|----|------|------|--------|-------|---------|\n',
};

function guard(changes, extra = []) {
  const dir = tempRepo(base);
  sh('git checkout -qb factory/C-001', dir);
  write(dir, changes);
  const r = node('floor-guard.mjs', ['--base', 'main', '--json', ...extra], dir);
  rm(dir);
  return { code: r.code, report: JSON.parse(r.out || '{}') };
}
const rules = (r) => r.report.findings.map((f) => f.rule);

test('clean change passes', () => {
  const r = guard({ 'src/math.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n' });
  assert.equal(r.code, 0);
  assert.equal(r.report.status, 'clean');
});

test('suppression comments are blocked', () => {
  const r = guard({ 'src/math.js': '// eslint-disable-next-line\nexport const add = (a, b) => a + b; // @ts-ignore\n' });
  assert.equal(r.code, 1);
  assert.ok(rules(r).includes('silenced-checker'));
});

test('skipped tests and removed assertions are blocked', () => {
  const r = guard({ 'test/math.test.js': "import assert from 'node:assert';\ntest.skip('add', () => assert.equal(add(1, 2), 3));\ntest('add0', () => {});\n" });
  assert.ok(rules(r).includes('test-made-easier'));
  assert.ok(rules(r).includes('assertion-removed'));
});

test('rewriting a test without losing assertions is allowed', () => {
  const r = guard({ 'test/math.test.js': "import assert from 'node:assert/strict';\ntest('add', () => assert.equal(add(1, 2), 3));\ntest('add zero', () => assert.equal(add(0, 0), 0));\n" });
  assert.equal(r.code, 0, JSON.stringify(r.report));
});

test('stubs are blocked; a TODO citing a ticket is not', () => {
  assert.ok(rules(guard({ 'src/x.js': 'export function f() {\n  // TODO\n  throw new Error("Not implemented");\n}\n' })).includes('unfinished-work'));
  assert.equal(guard({ 'src/x.js': 'export const f = () => 1; // TODO(#123): cache this\n' }).code, 0);
});

test('loosening a CONSTRAINTS.md threshold is blocked, tightening is not', () => {
  const loosened = guard({ 'CONSTRAINTS.md': base['CONSTRAINTS.md'].replace('>= 80%', '>= 60%') });
  assert.ok(rules(loosened).includes('threshold-loosened'));
  const tightened = guard({ 'CONSTRAINTS.md': base['CONSTRAINTS.md'].replace('>= 80%', '>= 90%').replace('under 200', 'under 150') });
  assert.equal(tightened.code, 0, JSON.stringify(tightened.report));
  const bundle = guard({ 'CONSTRAINTS.md': base['CONSTRAINTS.md'].replace('under 200', 'under 300') });
  assert.ok(rules(bundle).includes('threshold-loosened'));
});

test('removing a rule or adding an exception is reported', () => {
  assert.ok(rules(guard({ 'CONSTRAINTS.md': base['CONSTRAINTS.md'].replace(/\| Bundle.*\n/, '') })).includes('rule-removed'));
  assert.ok(rules(guard({ 'CONSTRAINTS.md': base['CONSTRAINTS.md'] + '| W1 | no-any | src/** | legacy | @me | 2027-01-01 |\n' })).includes('new-exception'));
});

test('deleting a test file is blocked', () => {
  const dir = tempRepo(base);
  sh('git checkout -qb x && git rm -q test/math.test.js && git commit -qm del', dir);
  const r = node('floor-guard.mjs', ['--base', 'main', '--json'], dir);
  rm(dir);
  assert.ok(JSON.parse(r.out).findings.some((f) => f.rule === 'test-deleted'));
});

test('floor-ignore applies from the base only; changing it is itself a finding', () => {
  assert.ok(rules(guard({ 'vendor/lib.js': '/* eslint-disable */\n' })).includes('silenced-checker'));
  // Added in the change being judged: does not exempt, and is reported.
  const self = guard({ 'vendor/lib.js': '/* eslint-disable */\n', '.factory/floor-ignore': '**\n' });
  assert.ok(rules(self).includes('silenced-checker'));
  assert.ok(rules(self).includes('floor-ignore-changed'));
  // Already on the base branch: honoured.
  const dir = tempRepo({ ...base, '.factory/floor-ignore': 'vendor/**\n' });
  sh('git checkout -qb x', dir);
  write(dir, { 'vendor/lib.js': '/* eslint-disable */\n' });
  const r = node('floor-guard.mjs', ['--base', 'main', '--json'], dir);
  rm(dir);
  assert.equal(r.code, 0, r.out);
});

test('moving a test to a non-test path counts as deleting it', () => {
  const dir = tempRepo(base);
  sh('git checkout -qb x && mkdir -p disabled && git mv test/math.test.js disabled/math.js && git commit -qm mv', dir);
  const r = node('floor-guard.mjs', ['--base', 'main', '--json'], dir);
  rm(dir);
  assert.ok(JSON.parse(r.out).findings.some((f) => f.rule === 'test-deleted'), r.out);
});

test('disabling a rule command or dropping its stage is blocked', () => {
  const c = base['CONSTRAINTS.md'];
  assert.ok(rules(guard({ 'CONSTRAINTS.md': c.replace('| `x` | review |', '| (not yet installed) | review |') })).includes('check-disabled'));
  assert.ok(rules(guard({ 'CONSTRAINTS.md': c.replace('| `x` | review |', '| `x` | CI |') })).includes('stage-dropped'));
  assert.equal(guard({ 'CONSTRAINTS.md': c.replace('| `y` | CI |', '| `y` | review, CI |') }).code, 0, 'adding a stage is fine');
});

test('no merge base exits 2, never clean', () => {
  const dir = tempRepo(base);
  const r = node('floor-guard.mjs', ['--base', 'does-not-exist', '--json'], dir, { FACTORY_BASE: 'nope' });
  rm(dir);
  // Falls back to main, which exists; force a repo with no main to check the error path.
  const solo = tempRepo(base, { branch: 'trunk' });
  const r2 = node('floor-guard.mjs', ['--base', 'does-not-exist'], solo, { FACTORY_BASE: 'nope' });
  rm(solo);
  assert.equal(r.code, 0);
  assert.equal(r2.code, 2);
});
