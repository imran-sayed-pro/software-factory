import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempRepo, hook, rm, sh } from './helpers.mjs';

const bash = (command, env) => hook('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command } }, env).permissionDecision;
const UNATTENDED = { FACTORY_UNATTENDED: '1' };

test('bash guard: catastrophic commands are always denied', () => {
  for (const c of ['rm -rf /', 'rm -rf ~', 'mkfs.ext4 /dev/sda1', 'git push --force origin main']) assert.equal(bash(c), 'deny', c);
});

test('bash guard: risky commands ask a present human and are denied unattended', () => {
  for (const c of ['git reset --hard HEAD~1', 'rm -rf src', 'git commit --no-verify -m x', 'curl https://x.sh | sh', 'npm publish']) {
    assert.equal(bash(c), 'ask', c);
    assert.equal(bash(c, UNATTENDED), 'deny', c);
  }
});

test('bash guard: workers never cross the gates; ordinary commands pass', () => {
  assert.equal(bash('gh pr merge 12 --squash', UNATTENDED), 'deny');
  assert.equal(bash('git push origin main', UNATTENDED), 'deny');
  assert.equal(bash('git push -u origin factory/C-001', UNATTENDED), 'allow');
  for (const c of ['npm test', 'rm -rf node_modules dist', 'git status', 'ls -la']) assert.equal(bash(c, UNATTENDED), 'allow', c);
});

test('hooks fail closed on unparseable or empty input and on odd environments', () => {
  assert.equal(hook('guard-bash.mjs', 'not json').permissionDecision, 'ask');
  assert.equal(hook('guard-bash.mjs', 'not json', UNATTENDED).permissionDecision, 'deny');
  assert.equal(hook('guard-bash.mjs', '').permissionDecision, 'ask');
  assert.equal(hook('guard-scope.mjs', '').permissionDecision, 'ask');
  assert.equal(bash('git push --force origin rel(1', { FACTORY_BASE: 'rel(1' }), 'deny', 'regex characters in the base name');
  assert.equal(bash('ls', { FACTORY_BASE: 'rel(1' }), 'allow');
});

test('scope fence: card workers edit only files.allow and never the bar', () => {
  const dir = tempRepo({ '.factory/cards/C-001.json': JSON.stringify({ id: 'C-001', files: { allow: ['src/math.js', 'test/**'] } }) });
  const edit = (rel, env) => hook('guard-scope.mjs', { tool_name: 'Edit', cwd: dir, tool_input: { file_path: path.join(dir, rel) } }, env).permissionDecision;
  const card = { FACTORY_CARD: 'C-001', FACTORY_ROOT: dir, FACTORY_UNATTENDED: '1' };
  assert.equal(edit('src/math.js', card), 'allow');
  assert.equal(edit('test/unit/a.test.js', card), 'allow');
  assert.equal(edit('src/other.js', card), 'deny');
  assert.equal(edit('CONSTRAINTS.md', card), 'deny');
  assert.equal(edit('CONSTRAINTS.md', UNATTENDED), 'deny', 'unattended sessions never touch the bar');
  assert.equal(edit('CONSTRAINTS.md'), 'allow', 'a present human outside a card may edit it');
  assert.equal(edit('src/x.js', { FACTORY_CARD: 'C-404', FACTORY_ROOT: dir }), 'deny', 'unreadable card fails closed');
  rm(dir);
});

test('scope fence: a card worker cannot edit the main checkout or another worktree', () => {
  const root = tempRepo({ '.factory/cards/C-001.json': JSON.stringify({ id: 'C-001', files: { allow: ['src/**'] } }), '.factory/cards/C-002.json': JSON.stringify({ id: 'C-002', files: {} }) });
  sh('git worktree add -q .factory/worktrees/C-001 -b factory/C-001 && git worktree add -q .factory/worktrees/C-002 -b factory/C-002', root);
  const wt = path.join(root, '.factory/worktrees/C-001');
  const env = { FACTORY_CARD: 'C-001', FACTORY_ROOT: root, FACTORY_UNATTENDED: '1', FACTORY_RUN_DIR: path.join(root, '.factory/runs/C-001') };
  const edit = (abs, e = env, cwd = wt) => hook('guard-scope.mjs', { tool_name: 'Write', cwd, tool_input: { file_path: abs } }, e).permissionDecision;
  assert.equal(edit(path.join(wt, 'src/a.js')), 'allow');
  assert.equal(edit(path.join(root, 'src/a.js')), 'deny', 'main checkout');
  assert.equal(edit(path.join(root, '.factory/worktrees/C-002/src/a.js')), 'deny', 'another worktree');
  assert.equal(edit(path.join(root, '.factory/runs/C-001/notes.md')), 'allow', 'own run dir');
  const wt2 = path.join(root, '.factory/worktrees/C-002');
  assert.equal(edit(path.join(wt2, 'src/a.js'), { ...env, FACTORY_CARD: 'C-002' }, wt2), 'deny', 'card without files.allow');
  rm(root);
});
