#!/usr/bin/env node
// review-record.mjs: verdicts bound to the exact code they judged.
//   write --kind review|qa --verdict APPROVE|WARN|BLOCK|PASS|FAIL --summary "..." [--findings file.json] [--card C-001]
//   verify --kind review|qa [--card C-001] [--json]   exit 0 only if a passing verdict matches the current tree
//   tree                                                print the current content hash
// Records live in .factory/runs/<card>/<kind>.json in the main checkout. Any edit after the
// verdict changes the tree hash, which makes the record STALE: re-run the gate.
import fs from 'node:fs';
import path from 'node:path';
import { factoryRoot, factoryDir, parseArgs, readJSON, writeJSON, treeHash, nowIso, die, currentCard } from './lib/common.mjs';

const args = parseArgs();
const cmd = args._[0];
const card = currentCard(args) || 'local';
const kind = args.kind || 'review';
if (!['review', 'qa'].includes(kind)) die('--kind must be review or qa');
const runDir = process.env.FACTORY_RUN_DIR || path.join(factoryDir(factoryRoot()), 'runs', card);
const file = path.join(runDir, `${kind}.json`);
const PASSING = { review: ['APPROVE', 'WARN'], qa: ['PASS'] };
const VALID = { review: ['APPROVE', 'WARN', 'BLOCK'], qa: ['PASS', 'FAIL', 'PARTIAL'] };

if (cmd === 'tree') { console.log(treeHash()); process.exit(0); }

if (cmd === 'write') {
  const verdict = String(args.verdict || '').toUpperCase();
  if (!VALID[kind].includes(verdict)) die(`--verdict must be one of ${VALID[kind].join(', ')}`);
  let findings = [];
  if (args.findings) findings = readJSON(path.resolve(args.findings));
  const blocking = findings.filter((f) => ['CRITICAL', 'BLOCKER'].includes(String(f.severity).toUpperCase()));
  if (kind === 'review' && verdict === 'APPROVE' && blocking.length) die('cannot APPROVE with CRITICAL findings: verdict must be BLOCK');
  const record = { card, kind, verdict, summary: args.summary || '', tree: treeHash(), at: nowIso(), findings };
  writeJSON(file, record);
  console.log(`${kind} ${verdict} recorded for ${card} at tree ${record.tree.slice(0, 12)}`);
  process.exit(0);
}

if (cmd === 'verify') {
  if (!fs.existsSync(file)) {
    const out = { status: 'MISSING', file };
    if (args.json) console.log(JSON.stringify(out)); else console.error(`${kind}: MISSING (${file})`);
    process.exit(1);
  }
  const rec = readJSON(file);
  const current = treeHash();
  const fresh = rec.tree === current;
  const passing = PASSING[kind].includes(rec.verdict);
  const status = !fresh ? 'STALE' : passing ? 'CURRENT' : 'FAILED';
  const out = { status, verdict: rec.verdict, recordedTree: rec.tree, currentTree: current, at: rec.at };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`${kind}: ${status} (verdict ${rec.verdict}, recorded ${rec.at})${fresh ? '' : ' - code changed since the verdict; re-run the gate'}`);
  process.exit(status === 'CURRENT' ? 0 : 1);
}
die('usage: review-record.mjs <write|verify|tree> ...');
