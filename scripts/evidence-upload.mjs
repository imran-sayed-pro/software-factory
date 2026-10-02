#!/usr/bin/env node
// evidence-upload.mjs: publish an evidence session so a PR can link to it.
//   <session-dir> [--adapter github-release|local] [--release factory-evidence] [--json]
// github-release: uploads evidence.mp4, report.md and manifest.json as assets of one prerelease in this repo
//   (created on first use), named <card>-<commit>-<file>. Access follows the repo's permissions; no browser needed.
// local: no upload; prints repo-relative paths (for repos where evidence must not leave the machine).
// Adapters are a small map below: add one (S3, R2, …) by implementing upload(files) -> [{file,url}].
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { factoryRoot, factoryDir, parseArgs, readJSON, writeJSON, nowIso, die } from './lib/common.mjs';

const args = parseArgs();
const dir = path.resolve(args._[0] || die('usage: evidence-upload.mjs <session-dir> [--adapter …]'));
const manifestPath = path.join(dir, 'manifest.json');
if (!fs.existsSync(manifestPath)) die('no manifest.json: run `evidence.mjs stop` first');
const manifest = readJSON(manifestPath);
if (manifest.synthetic) die('refusing to upload a synthetic test-pattern recording as evidence');
const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
if (report.includes('CAVEATS_PENDING')) die('report.md still has CAVEATS_PENDING: write the real caveats (or "None") first');

let cfg = {};
try { cfg = readJSON(path.join(factoryDir(factoryRoot()), 'config.json')).evidence || {}; } catch { /* outside a factory repo */ }
const adapter = args.adapter || cfg.adapter || 'github-release';
const release = args.release || cfg.release || 'factory-evidence';
const prefix = `${manifest.card || 'local'}-${(manifest.commit || 'nocommit').slice(0, 10)}`;
const files = ['evidence.mp4', 'report.md', 'manifest.json'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));

const gh = (a) => spawnSync('gh', a, { encoding: 'utf8' });

const adapters = {
  local: () => files.map((f) => ({ file: path.basename(f), url: path.relative(process.cwd(), f) })),
  'github-release': () => {
    const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    if (repo.status !== 0) die(`gh cannot see this repo: ${repo.stderr.trim()}`);
    const nwo = repo.stdout.trim();
    if (gh(['release', 'view', release]).status !== 0) {
      const c = gh(['release', 'create', release, '--prerelease', '--title', 'Factory evidence', '--notes', 'Recorded QA evidence attached to factory PRs. Not a software release.']);
      if (c.status !== 0) die(`could not create release ${release}: ${c.stderr.trim()}`);
    }
    const staged = fs.mkdtempSync(path.join(dir, '.upload-'));
    try {
      const named = files.map((f) => { const n = path.join(staged, `${prefix}-${path.basename(f)}`); fs.copyFileSync(f, n); return n; });
      const up = gh(['release', 'upload', release, ...named, '--clobber']);
      if (up.status !== 0) die(`upload failed: ${up.stderr.trim()}`);
      return named.map((n) => ({ file: path.basename(n), url: `https://github.com/${nwo}/releases/download/${release}/${path.basename(n)}` }));
    } finally { fs.rmSync(staged, { recursive: true, force: true }); }
  },
};
if (!adapters[adapter]) die(`unknown adapter ${adapter}; known: ${Object.keys(adapters).join(', ')}`);

const links = adapters[adapter]();
const record = { adapter, release: adapter === 'github-release' ? release : null, at: nowIso(), links };
writeJSON(path.join(dir, 'upload.json'), record);
const video = links.find((l) => l.file.endsWith('evidence.mp4'));
const md = [`**Evidence:** ${manifest.title} — **${manifest.verdict}** (${manifest.counts.passed} passed, ${manifest.counts.failed} failed, ${manifest.counts.untested} untested) on \`${(manifest.commit || '').slice(0, 10)}\``,
  '\n\n', video ? `[Watch the recording](${video.url}) · ` : '', links.filter((l) => !l.file.endsWith('.mp4')).map((l) => `[${l.file.replace(`${prefix}-`, '')}](${l.url})`).join(' · ')].join('');
if (args.json) console.log(JSON.stringify({ ...record, markdown: md }, null, 2)); else console.log(md);
