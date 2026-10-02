#!/usr/bin/env node
// Structural lint for the plugin: script syntax, JSON files, skill and agent anatomy.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const errors = [];
const err = (f, m) => errors.push(`${path.relative(root, f)}: ${m}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.factory'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(root);

// 1. Every script parses.
for (const f of files.filter((f) => f.endsWith('.mjs'))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) err(f, `syntax error: ${r.stderr.trim().split('\n').slice(0, 3).join(' ')}`);
}
// 2. Every JSON file parses.
for (const f of files.filter((f) => f.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err(f, `invalid JSON: ${e.message}`); }
}
// 3. floor-guard stays standalone (it is copied into target repos).
const fg = fs.readFileSync(path.join(root, 'scripts/floor-guard.mjs'), 'utf8');
if (/from '\.\.?\//.test(fg)) err(path.join(root, 'scripts/floor-guard.mjs'), 'must not import local modules (it is copied into target repos)');
for (const fx of fs.existsSync(path.join(root, 'evals/fixtures')) ? fs.readdirSync(path.join(root, 'evals/fixtures')) : []) {
  const copy = path.join(root, 'evals/fixtures', fx, '.factory/bin/floor-guard.mjs');
  if (fs.existsSync(copy) && fs.readFileSync(copy, 'utf8') !== fg) err(copy, 'is stale: copy scripts/floor-guard.mjs over it');
}

// 4. Skill anatomy.
const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return fm;
};
const REQUIRED = ['## Overview', '## When to use', '## Process', '## Common rationalizations', '## Red flags', '## Verification'];
const skillsDir = path.join(root, 'skills');
for (const name of fs.readdirSync(skillsDir)) {
  const f = path.join(skillsDir, name, 'SKILL.md');
  if (!fs.existsSync(f)) { err(path.join(skillsDir, name), 'missing SKILL.md'); continue; }
  const text = fs.readFileSync(f, 'utf8');
  const fm = frontmatter(text);
  if (!fm) { err(f, 'missing frontmatter'); continue; }
  if (fm.name !== name) err(f, `frontmatter name "${fm.name}" must match folder "${name}"`);
  if (!fm.description || fm.description.length < 120) err(f, 'description too short (< 120 chars): say what it does and when to use it');
  if (fm.description && fm.description.length > 1024) err(f, 'description over 1024 characters');
  for (const h of REQUIRED) if (!text.includes(h)) err(f, `missing section "${h}"`);
  if (!/## Process: |## Process\n/.test(text)) { /* Process may be split into parts */ }
  const lines = text.split('\n').length;
  if (lines > 400) err(f, `${lines} lines; keep SKILL.md under 400 and move detail to references/`);
  for (const m of text.matchAll(/`references\/([\w.-]+)`/g)) {
    if (!fs.existsSync(path.join(skillsDir, name, 'references', m[1]))) err(f, `references/${m[1]} does not exist`);
  }
  for (const m of text.matchAll(/scripts\/([\w-]+\.mjs)/g)) {
    if (!fs.existsSync(path.join(root, 'scripts', m[1]))) err(f, `scripts/${m[1]} does not exist`);
  }
  for (const m of text.matchAll(/`(code-reviewer|test-reviewer|silent-failure-hunter|security-reviewer|red-team)`/g)) {
    if (!fs.existsSync(path.join(root, 'agents', `${m[1]}.md`))) err(f, `agent ${m[1]} does not exist`);
  }
}
// 5. Agent anatomy.
for (const f of files.filter((f) => f.startsWith(path.join(root, 'agents')) && f.endsWith('.md'))) {
  const fm = frontmatter(fs.readFileSync(f, 'utf8'));
  if (!fm) { err(f, 'missing frontmatter'); continue; }
  if (fm.name !== path.basename(f, '.md')) err(f, 'name must match file name');
  for (const k of ['description', 'tools']) if (!fm[k]) err(f, `missing ${k}`);
  if (/\b(Edit|Write)\b/.test(fm.tools || '')) err(f, 'reviewer agents are read-only: no Edit/Write tools');
}
// 6. Hook commands point at files that exist.
const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.json'), 'utf8'));
for (const groups of Object.values(hooks.hooks)) for (const g of groups) for (const h of g.hooks) {
  const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(h.command);
  if (!m || !fs.existsSync(path.join(root, m[1]))) err(path.join(root, 'hooks/hooks.json'), `hook command target missing: ${h.command}`);
}

if (errors.length) { console.error(`lint: ${errors.length} problem(s)`); for (const e of errors) console.error('  ' + e); process.exit(1); }
console.log(`lint: ok (${files.filter((f) => f.endsWith('.mjs')).length} scripts, ${fs.readdirSync(skillsDir).length} skills)`);
