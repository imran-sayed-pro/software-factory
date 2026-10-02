import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, globsOverlap, staticPrefix, matchesAny } from '../scripts/lib/common.mjs';
import { validateCard, topoOrder, readyCards, pickLaunchable } from '../scripts/lib/cards.mjs';

test('globToRegExp handles **, *, ? and braces', () => {
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/c.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/c.ts'));
  assert.ok(globToRegExp('tests/{unit,e2e}/*.test.js').test('tests/e2e/x.test.js'));
  assert.ok(globToRegExp('src/auth/').test('src/auth/login.ts'));
  assert.ok(matchesAny('./src/a.ts', ['src/a.ts']));
});

test('staticPrefix and globsOverlap are conservative', () => {
  assert.equal(staticPrefix('src/auth/**'), 'src/auth/');
  assert.equal(staticPrefix('src/a.ts'), 'src/a.ts');
  assert.ok(globsOverlap(['src/auth/**'], ['src/auth/login.ts']));
  assert.ok(globsOverlap(['src/**'], ['src/billing/x.ts']));
  assert.ok(!globsOverlap(['src/auth/**'], ['src/billing/**']));
  assert.ok(!globsOverlap(['src/a.ts'], ['src/b.ts']));
  assert.ok(globsOverlap(['src/a.ts', 'test/a.test.ts'], ['test/a.test.ts']));
  assert.ok(globsOverlap(['src/'], ['src/a.js']), 'a directory entry locks its contents');
  assert.ok(globsOverlap(['src/auth/'], ['src/**']));
});

const card = (o = {}) => ({
  id: 'C-001', spec: 'S-001', title: 'Add a subtract function', description: 'Add subtract(a, b) with unit tests for the math module.',
  acceptance: ['subtract(5,3) returns 2'], verification: { commands: ['npm test'], qaSurface: 'none' }, dependsOn: [],
  files: { allow: ['src/math.js'] }, size: 'S', risk: 'low', highRiskReasons: [], rollback: 'git revert', status: 'ready', ...o,
});

test('validateCard accepts a good card and rejects common mistakes', () => {
  assert.deepEqual(validateCard(card()), []);
  assert.match(validateCard(card({ title: 'Add login and billing' })).join(), /two cards/);
  assert.match(validateCard(card({ size: 'XL' })).join(), /too large/);
  assert.match(validateCard(card({ description: '(Describe what this card accomplishes and why.)' })).join(), /placeholder/);
  assert.match(validateCard(card({ files: { allow: ['**'] } })).join(), /whole repo/);
  assert.match(validateCard(card({ files: { allow: ['CONSTRAINTS.md'] } })).join(), /CONSTRAINTS/);
  assert.match(validateCard(card({ title: 'Change password hashing', risk: 'low' })).join(), /high-risk/);
  assert.match(validateCard(card({ risk: 'high' })).join(), /highRiskReasons/);
  assert.match(validateCard(card({ acceptance: ['a1234', 'b1234', 'c1234', 'd1234', 'e1234', 'f1234'] })).join(), /split/);
  assert.match(validateCard(card({ dependsOn: ['C-009'] }), [card()]).join(), /unknown card/);
});

test('topoOrder orders by dependency and detects cycles', () => {
  const a = card({ id: 'C-001' }), b = card({ id: 'C-002', dependsOn: ['C-001'] }), c = card({ id: 'C-003', dependsOn: ['C-002'] });
  assert.deepEqual(topoOrder([c, b, a]), ['C-001', 'C-002', 'C-003']);
  assert.throws(() => topoOrder([card({ id: 'C-001', dependsOn: ['C-002'] }), card({ id: 'C-002', dependsOn: ['C-001'] })]), /cycle/);
});

test('a dependency counts only when merged', () => {
  const a = card({ id: 'C-001', status: 'done' });
  const b = card({ id: 'C-002', dependsOn: ['C-001'], files: { allow: ['src/b.js'] } });
  assert.deepEqual(readyCards([a, b]).map((c) => c.id), []);
  a.status = 'merged';
  assert.deepEqual(readyCards([a, b]).map((c) => c.id), ['C-002']);
});

test('pickLaunchable respects capacity and file locks held by unmerged work', () => {
  const run = card({ id: 'C-001', status: 'done', files: { allow: ['src/math.js'] } });
  const clash = card({ id: 'C-002', files: { allow: ['src/math.js'] } });
  const free1 = card({ id: 'C-003', files: { allow: ['src/a.js'] } });
  const free2 = card({ id: 'C-004', files: { allow: ['src/b.js'] } });
  const { chosen, skipped } = pickLaunchable([run, clash, free1, free2], 1);
  assert.deepEqual(chosen.map((c) => c.id), ['C-003']);
  assert.deepEqual(skipped.map((s) => s.id), ['C-002']);
});
