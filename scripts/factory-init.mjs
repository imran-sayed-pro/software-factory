#!/usr/bin/env node
// factory-init.mjs: set a repository up for the software factory (idempotent).
// Usage: node factory-init.mjs [--profile auto|typescript|python|swift] [--base main] [--force] [--dry-run]
// Creates: CONSTRAINTS.md, DONE.md, .factory/{config.json,cards,specs,plans,test-plans,bin/floor-guard.mjs,.gitignore},
// and a "Software factory" section in CLAUDE.md. Existing CONSTRAINTS.md / DONE.md are never overwritten
// unless --force (and even then CONSTRAINTS.md is backed up first).
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT, checkoutRoot, git, parseArgs, writeJSON, die } from './lib/common.mjs';
import { detectProfiles, resolveProfile, listProfiles } from './lib/profile.mjs';

const args = parseArgs();
const root = checkoutRoot();
const dry = Boolean(args['dry-run']);
const actions = [];
const write = (rel, content, { overwrite = false } = {}) => {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs) && !overwrite) { actions.push(`kept   ${rel} (exists)`); return; }
  if (fs.existsSync(abs) && overwrite && rel === 'CONSTRAINTS.md') {
    const bak = path.join(root, '.factory', 'backups', `CONSTRAINTS.md.${Date.now()}`);
    if (!dry) { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(abs, bak); }
    actions.push(`backup ${path.relative(root, bak)}`);
  }
  if (!dry) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); }
  actions.push(`wrote  ${rel}`);
};

const detected = detectProfiles(root);
let profileName = args.profile && args.profile !== 'auto' ? args.profile : detected[0];
if (!profileName) {
  die(`no stack detected (looked for ${listProfiles().map((p) => (p.detect.anyFile || []).join('/')).join(', ')}).\nPass --profile typescript|python|swift to choose one.`);
}
const profile = resolveProfile(root, profileName);
const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, allowFail: true });
const base = args.base || (head ? head.trim().replace(/^origin\//, '') : (git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, allowFail: true }) || 'main').trim());

const fill = (s) => s
  .replaceAll('{{date}}', new Date().toISOString().slice(0, 10))
  .replaceAll('{{profile}}', profile.name)
  .replaceAll('{{base}}', base)
  .replaceAll('{{coverage_today}}', 'not measured yet (run the coverage command, then record the number)')
  .replace(/\{\{(\w+)\}\}/g, (m, k) => profile.commands[k] ?? m);

const tpl = (name) => fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', name), 'utf8');

write('CONSTRAINTS.md', fill(tpl('CONSTRAINTS.md')), { overwrite: Boolean(args.force) });
write('DONE.md', tpl('DONE.md'), { overwrite: Boolean(args.force) });

const config = JSON.parse(fill(tpl('config.json')));
config.profiles = detected.length ? detected : [profile.name];
if (fs.existsSync(path.join(root, '.factory/config.json')) && !args.force) actions.push('kept   .factory/config.json (exists)');
else { if (!dry) writeJSON(path.join(root, '.factory/config.json'), config); actions.push('wrote  .factory/config.json'); }

for (const d of ['cards', 'specs', 'plans', 'test-plans']) {
  const keep = path.join(root, '.factory', d, '.gitkeep');
  if (!fs.existsSync(keep)) { if (!dry) { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.writeFileSync(keep, ''); } actions.push(`made   .factory/${d}/`); }
}
write('.factory/.gitignore', '# runtime state: never committed\nruns/\nworktrees/\nbackups/\nboard.json\n*.lock\n', { overwrite: true });
write('.factory/bin/floor-guard.mjs', fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'floor-guard.mjs'), 'utf8'), { overwrite: true });
for (const t of ['spec.md', 'plan.md', 'test-plan.md', 'handoff.md', 'card.schema.json']) {
  write(`.factory/templates/${t}`, tpl(t), { overwrite: true });
}

// AGENTS.md is the tool-neutral rulebook; CLAUDE.md imports it and adds Claude-specific notes.
// A file that already exists keeps its own content: the factory text lives between markers and is
// replaced in place on re-runs, so the repo-specific sections a human filled in are preserved only
// when the file was not factory-generated. Fill repo-specific sections outside the markers.
const START = '<!-- software-factory:start -->';
const END = '<!-- software-factory:end -->';
function upsertBlock(rel, block, { prependImport = false } = {}) {
  const abs = path.join(root, rel);
  const wrapped = `${START}\n${block.trim()}\n${END}\n`;
  if (!fs.existsSync(abs)) {
    if (!dry) fs.writeFileSync(abs, prependImport ? `@AGENTS.md\n\n${wrapped}` : wrapped);
    actions.push(`wrote  ${rel}`);
    return;
  }
  let text = fs.readFileSync(abs, 'utf8');
  const re = new RegExp(`${START}[\\s\\S]*?${END}\\n?`);
  let updated = re.test(text) ? text.replace(re, wrapped) : text.replace(/\n*$/, '\n\n') + wrapped;
  if (prependImport && !/^@AGENTS\.md\s*$/m.test(updated)) updated = `@AGENTS.md\n\n${updated}`;
  if (updated === text) { actions.push(`kept   ${rel} (factory block current)`); return; }
  if (!dry) fs.writeFileSync(abs, updated);
  actions.push(`update ${rel} (factory block)`);
}
// The "Repo-specific" part is for humans to fill in, so it sits after the markers and is written once.
const agentsFull = fill(tpl('AGENTS.md'));
const cut = agentsFull.indexOf('## Repo-specific');
upsertBlock('AGENTS.md', agentsFull.slice(0, cut));
const agentsPath = path.join(root, 'AGENTS.md');
if (!dry && !fs.readFileSync(agentsPath, 'utf8').includes('## Repo-specific')) {
  fs.appendFileSync(agentsPath, '\n' + agentsFull.slice(cut));
  actions.push('append AGENTS.md (repo-specific sections to fill in)');
}
// The template's first line is the import; keep it outside the markers so it survives edits.
const claudeTpl = tpl('CLAUDE.md').replace(/^@AGENTS\.md\s*\n+/, '');
upsertBlock('CLAUDE.md', claudeTpl, { prependImport: true });

console.log(`software-factory init${dry ? ' (dry run)' : ''}: profile ${profile.name}${detected.length > 1 ? ` (also detected: ${detected.slice(1).join(', ')})` : ''}, base ${base}`);
for (const a of actions) console.log('  ' + a);
const gaps = Object.entries(profile.commands).filter(([, v]) => /not yet installed/.test(v)).map(([k]) => k);
if (gaps.length) console.log(`\nGaps to close: ${gaps.join(', ')} (see CONSTRAINTS.md).`);
console.log('\nNext: review CONSTRAINTS.md with a human, record today\'s coverage in the ratchet table, and commit.');
