#!/usr/bin/env node
// learn.mjs: the shared learnings log every skill reads at start and writes at end.
//   add --type pattern|pitfall|preference|architecture|operational --key k --insight "..." [--files a,b] [--confidence 1-10] [--skill s]
//   search [--query words] [--files a,b] [--limit 8]   ranked by keyword/file match, confidence and recency
//   prune [--days 120] [--min-confidence 3]             drop stale low-confidence entries and duplicates (keeps newest per key)
//   stats
import fs from 'node:fs';
import path from 'node:path';
import { factoryRoot, factoryDir, parseArgs, appendJSONL, readJSONL, nowIso, die, currentCard } from './lib/common.mjs';

const TYPES = ['pattern', 'pitfall', 'preference', 'architecture', 'operational', 'investigation'];
const args = parseArgs();
const file = path.join(factoryDir(factoryRoot()), 'learnings.jsonl');
const cmd = args._[0];

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9_-]+/).filter((w) => w.length > 2);

if (cmd === 'add') {
  if (!TYPES.includes(args.type)) die(`--type must be one of ${TYPES.join(', ')}`);
  if (!args.key || !args.insight) die('--key and --insight are required');
  if (String(args.insight).length > 400) die('--insight must be 400 characters or fewer: one reusable rule, not a diary');
  const entry = {
    ts: nowIso(), type: args.type, key: String(args.key), insight: String(args.insight),
    files: args.files ? String(args.files).split(',').map((s) => s.trim()).filter(Boolean) : [],
    confidence: Math.max(1, Math.min(10, Number(args.confidence || 7))),
    skill: args.skill || process.env.FACTORY_SKILL || 'unknown', card: currentCard(args),
  };
  appendJSONL(file, entry);
  console.log(`learned: ${entry.key}`);
} else if (cmd === 'search') {
  const q = words(args.query), files = args.files ? String(args.files).split(',') : [];
  const now = Date.now();
  const latest = new Map();
  for (const e of readJSONL(file)) latest.set(e.key, e);
  const scored = [...latest.values()].map((e) => {
    const hay = new Set(words(`${e.key} ${e.insight} ${e.type}`));
    let s = q.filter((w) => hay.has(w)).length * 3;
    s += files.filter((f) => e.files?.some((x) => x === f || f.startsWith(path.dirname(x) + '/'))).length * 4;
    s += e.confidence / 2;
    s -= (now - Date.parse(e.ts)) / (1000 * 60 * 60 * 24 * 60); // lose a point every ~60 days
    return { e, s };
  }).filter((x) => (q.length || files.length) ? x.s > x.e.confidence / 2 : true)
    .sort((a, b) => b.s - a.s).slice(0, Number(args.limit || 8));
  if (!scored.length) { console.log('no matching learnings'); process.exit(0); }
  for (const { e } of scored) console.log(`- [${e.type}] ${e.key} (conf ${e.confidence}, ${e.ts.slice(0, 10)}): ${e.insight}`);
} else if (cmd === 'prune') {
  const days = Number(args.days || 120), minC = Number(args['min-confidence'] || 3);
  const cutoff = Date.now() - days * 864e5;
  const latest = new Map();
  for (const e of readJSONL(file)) latest.set(e.key, e);
  const keep = [...latest.values()].filter((e) => !(Date.parse(e.ts) < cutoff && e.confidence < minC));
  const before = readJSONL(file).length;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''));
  console.log(`pruned ${before - keep.length} of ${before}; ${keep.length} kept`);
} else if (cmd === 'stats') {
  const all = readJSONL(file);
  const byType = {};
  for (const e of all) byType[e.type] = (byType[e.type] || 0) + 1;
  console.log(JSON.stringify({ total: all.length, byType }, null, 2));
} else die('usage: learn.mjs <add|search|prune|stats> ...');
