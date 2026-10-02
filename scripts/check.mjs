#!/usr/bin/env node
// check.mjs: run the CONSTRAINTS.md "Enforced with numbers" rows for one stage.
// Usage: node check.mjs [--stage task|review|ci|all] [--json] [--timeout 900]
// A row runs when its "Runs at" cell mentions the stage ("every task end" -> task, "review", "CI").
// Results: pass, fail, gap (tool not installed / row marked "not yet installed"), and a summary.
// Writes .factory/runs/<card>/checks-<stage>.json when FACTORY_RUN_DIR or FACTORY_CARD is set.
// Exit: 0 all pass (gaps allowed but reported), 1 any fail, 2 could not run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkoutRoot, factoryRoot, factoryDir, parseArgs, writeJSON, nowIso } from './lib/common.mjs';

const args = parseArgs();
const stage = String(args.stage || 'task').toLowerCase();
const timeoutMs = Number(args.timeout || 900) * 1000;
const cwd = checkoutRoot();
const file = path.join(cwd, 'CONSTRAINTS.md');
if (!fs.existsSync(file)) { console.error('check: no CONSTRAINTS.md here; run factory-init first'); process.exit(2); }

const rows = [];
let inTable = false;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (/^##\s+Enforced with numbers/i.test(line)) { inTable = true; continue; }
  if (inTable && /^##\s/.test(line)) break;
  if (!inTable || !line.trim().startsWith('|') || /^\|[-: |]+\|$/.test(line.trim())) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells[0] === 'Dimension') continue;
  const [dimension, rule, checkedBy = '', runsAt = ''] = cells;
  const cmds = [...checkedBy.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  rows.push({ dimension, rule, cmds, runsAt, notInstalled: /not yet installed/i.test(checkedBy) });
}
const want = (r) => stage === 'all' || (stage === 'task' ? /task/i.test(r.runsAt) : stage === 'review' ? /review|task/i.test(r.runsAt) : new RegExp(stage, 'i').test(r.runsAt));
const plugin = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const firstWord = (c) => (c.trim().split(/\s+/).find((w) => !/^\w+=/.test(w)) || '').replace(/^['"]|['"]$/g, '');
const toolExists = (c) => {
  const w = firstWord(c);
  if (!w || /[|&;<>()$`]/.test(w)) return true; // compound shell: cannot tell, so treat the exit code as real
  return spawnSync('bash', ['-lc', 'command -v "$1" >/dev/null', '_', w], { cwd }).status === 0;
};

const results = [];
for (const r of rows.filter(want)) {
  if (r.notInstalled || !r.cmds.length) { results.push({ ...r, status: 'gap', note: 'no command / not yet installed' }); continue; }
  let status = 'pass', note = '', tail = '';
  for (let c of r.cmds) {
    c = c.replaceAll('{{plugin}}', plugin);
    const t0 = Date.now();
    const res = spawnSync('bash', ['-lc', c], { cwd, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, CI: process.env.CI || '1' }, maxBuffer: 1 << 26 });
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    tail = out.trim().split('\n').slice(-15).join('\n');
    if (res.error?.code === 'ETIMEDOUT') { status = 'fail'; note = `timed out after ${timeoutMs / 1000}s`; break; }
    // A gap means the tool itself is missing (exit 127, or its first word does not resolve). Any other
    // non-zero exit is a failure, even when the output says "not found" (a missing module, a missing element).
    if (res.status !== 0 && (res.status === 127 || !toolExists(c))) { status = 'gap'; note = `tool not installed: ${firstWord(c)}`; break; }
    if (res.status !== 0) { status = 'fail'; note = `exit ${res.status} from \`${c}\` after ${Math.round((Date.now() - t0) / 1000)}s`; break; }
  }
  // Coverage rows that ask for a changed-line check get one, using the threshold in the rule text.
  if (status === 'pass' && /changed[- ]lines?/i.test(`${r.rule} ${r.cmds.join(' ')}`) && /coverage/i.test(r.dimension)) {
    const min = (/(\d+(?:\.\d+)?)\s*%/.exec(r.rule) || [])[1] || '80';
    const res = spawnSync('node', [path.join(plugin, 'scripts', 'changed-coverage.mjs'), '--min', min], { cwd, encoding: 'utf8' });
    tail = (res.stdout + res.stderr).trim();
    if (res.status === 1) { status = 'fail'; note = `changed-line coverage below ${min}%`; }
    else if (res.status === 2) { status = 'gap'; note = 'changed-line coverage could not be measured'; }
  }
  results.push({ dimension: r.dimension, rule: r.rule, runsAt: r.runsAt, status, note, tail });
}

const summary = { stage, at: nowIso(), pass: results.filter((r) => r.status === 'pass').length, fail: results.filter((r) => r.status === 'fail').length, gap: results.filter((r) => r.status === 'gap').length };
const record = { summary, results };
const runDir = process.env.FACTORY_RUN_DIR || (process.env.FACTORY_CARD ? path.join(factoryDir(factoryRoot()), 'runs', process.env.FACTORY_CARD) : null);
if (runDir) writeJSON(path.join(runDir, `checks-${stage}.json`), record);

if (args.json) console.log(JSON.stringify(record, null, 2));
else {
  for (const r of results) console.log(`${r.status.toUpperCase().padEnd(4)} ${r.dimension}: ${r.rule}${r.note ? `  (${r.note})` : ''}`);
  console.log(`\n${summary.pass} pass, ${summary.fail} fail, ${summary.gap} gap`);
  for (const r of results.filter((x) => x.status === 'fail')) console.log(`\n--- ${r.dimension} ---\n${r.tail}`);
}
process.exit(summary.fail ? 1 : 0);
