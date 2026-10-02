// Scenario test for the runner: a fake worker stands in for `claude -p`.
// C-001 finishes and passes the merge queue, C-002 reports blocked (escalation),
// C-003 depends on C-001 and must wait until C-001 is merged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRepo, write, sh, node, rm, ROOT } from './helpers.mjs';

const FAKE_WORKER = `#!/usr/bin/env bash
set -e
R="$FACTORY_RUN_DIR"
printf '%s\\n' "$@" > "$R/args.txt"
case "$FACTORY_CARD" in
  C-001) printf 'export const add = (a, b) => a + b;\\nexport const subtract = (a, b) => a - b;\\n' > src/math.js
         printf "import test from 'node:test';\\nimport assert from 'node:assert';\\nimport { add, subtract } from '../src/math.js';\\ntest('add', () => assert.equal(add(1, 2), 3));\\ntest('subtract', () => assert.equal(subtract(5, 3), 2));\\n" > test/math.test.js ;;
  C-002) echo '{"card":"C-002","state":"blocked","phase":"build","summary":"unclear","blockedReason":"float precision rule not specified"}' > "$R/status.json"; exit 0 ;;
  *) exit 1 ;;
esac
git add -A && git commit -qm "feat: $FACTORY_CARD"
node "$FACTORY_PLUGIN_ROOT/scripts/review-record.mjs" write --kind review --verdict APPROVE --summary fake
printf '{"card":"%s","state":"done","phase":"review","summary":"implemented"}\\n' "$FACTORY_CARD" > "$R/status.json"
`;

const card = (id, o) => JSON.stringify({
  id, spec: 'S-001', title: `Card ${id}`, description: 'A scenario card for the runner test.', acceptance: ['works'],
  verification: { commands: ['npm test'], qaSurface: 'none' }, dependsOn: [], size: 'XS', risk: 'low', highRiskReasons: [],
  rollback: 'git revert', status: 'ready', ...o,
}, null, 2);

test('dispatch: parallel start, blocked escalation, dependency wait, merge queue', { timeout: 120000 }, () => {
  const dir = tempRepo({
    'package.json': JSON.stringify({ name: 'sample', type: 'module', scripts: { test: 'node --test', lint: 'node -e "process.exit(0)"' } }),
    'src/math.js': 'export const add = (a, b) => a + b;\n',
    'test/math.test.js': "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from '../src/math.js';\ntest('add', () => assert.equal(add(1, 2), 3));\n",
  });
  assert.equal(node('factory-init.mjs', [], dir).code, 0);
  const cfgPath = path.join(dir, '.factory/config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.workers = { ...cfg.workers, command: ['bash', path.join(dir, '.factory/fake-worker.sh'), '{allowedTools}'], virtualDisplay: false };
  write(dir, {
    '.factory/config.json': JSON.stringify(cfg, null, 2),
    '.factory/fake-worker.sh': FAKE_WORKER,
    '.factory/cards/C-001.json': card('C-001', { files: { allow: ['src/math.js', 'test/math.test.js'] } }),
    '.factory/cards/C-002.json': card('C-002', { files: { allow: ['src/mul.js'] } }),
    '.factory/cards/C-003.json': card('C-003', { files: { allow: ['src/c.js'] }, dependsOn: ['C-001'] }),
  });
  sh('git add -A && git commit -qm "factory init"', dir);

  const w = node('dispatch.mjs', ['watch', '--interval', '1'], dir, { FACTORY_PLUGIN_ROOT: ROOT });
  const status = (id) => JSON.parse(fs.readFileSync(path.join(dir, `.factory/cards/${id}.json`), 'utf8')).status;
  assert.equal(w.code, 3, `open escalation expected\n${w.out}\n${w.err}`);
  assert.equal(status('C-001'), 'done', w.out + w.err);
  assert.equal(status('C-002'), 'blocked');
  assert.equal(status('C-003'), 'ready', 'dependency is done but not merged, so C-003 waits');
  assert.match(w.out, /awaiting Gate 2.*C-001/);
  assert.match(node('dispatch.mjs', ['escalations'], dir).out, /C-002/);
  assert.equal(node('review-record.mjs', ['verify'], path.join(dir, '.factory/worktrees/C-001'), { FACTORY_CARD: 'C-001', FACTORY_ROOT: dir }).code, 0, 'verdict carried through the queue');
  const args = fs.readFileSync(path.join(dir, '.factory/runs/C-001/args.txt'), 'utf8').split('\n');
  assert.ok(args.includes('Bash(git *)') && args.includes('Bash(npm *)'), 'the allowlist reaches the worker as separate arguments');
  assert.ok(!args.includes('Bash(bash *)'), 'no shell wrappers');
  node('dispatch.mjs', ['cleanup', '--all'], dir);
  rm(dir);
});
