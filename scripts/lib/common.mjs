// Shared helpers for the software-factory scripts. Node >= 18, no dependencies.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Run git and return stdout. Throws with stderr on failure unless `allowFail`. */
export function git(args, { cwd = process.cwd(), allowFail = false, env, input } = {}) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    if (allowFail) return null;
    const msg = (e.stderr || e.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

/** Top level of the git checkout that contains `cwd` (a worktree returns its own path). */
export function checkoutRoot(cwd = process.cwd()) {
  const out = git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true });
  if (!out) throw new Error(`not inside a git repository: ${cwd}`);
  return out.trim();
}

/**
 * The main checkout that owns `.factory/` state. Workers run in linked worktrees, so prefer
 * FACTORY_ROOT, then the parent of the shared git dir, then the current checkout.
 */
export function factoryRoot(cwd = process.cwd()) {
  if (process.env.FACTORY_ROOT) return path.resolve(process.env.FACTORY_ROOT);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, allowFail: true });
  if (common) {
    const dir = common.trim();
    if (path.basename(dir) === '.git') return path.dirname(dir);
  }
  return checkoutRoot(cwd);
}

export const factoryDir = (root) => path.join(root, '.factory');

export function readJSON(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (fallback !== undefined && (e.code === 'ENOENT')) return fallback;
    throw new Error(`cannot read JSON ${file}: ${e.message}`);
  }
}

/** Atomic write: temp file + rename, so a crash never leaves half a JSON file. */
export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function appendJSONL(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

export function readJSONL(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

export const nowIso = () => new Date().toISOString();

/** Minimal flag parser: --key value, --flag, positional args. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

// ---------- globs ----------

/** Convert a repo-relative glob (supports **, *, ?, {a,b}) to a RegExp anchored on the full path. */
export function globToRegExp(glob) {
  let g = glob.replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += '(?:' + g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

export const matchesAny = (relPath, globs) => globs.some((g) => globToRegExp(g).test(relPath.replace(/^\.\//, '')));

/** The literal directory prefix of a glob, before any wildcard. */
export function staticPrefix(glob) {
  const g = glob.replace(/^\.\//, '');
  const idx = g.search(/[*?{]/);
  const lit = idx === -1 ? g : g.slice(0, idx);
  return idx === -1 ? lit : lit.slice(0, lit.lastIndexOf('/') + 1);
}

/**
 * Conservative overlap test for two glob lists: true when any pair could match a common path.
 * Literal paths are compared exactly; wildcard globs overlap when one static prefix contains the other.
 */
export function globsOverlap(a, b) {
  // `dir/` means everything under dir, as in globToRegExp; normalise before deciding what is literal.
  const norm = (g) => { const v = g.replace(/^\.\//, ''); return v.endsWith('/') ? `${v}**` : v; };
  for (const x0 of a) for (const y0 of b) {
    const x = norm(x0), y = norm(y0);
    const wx = /[*?{]/.test(x), wy = /[*?{]/.test(y);
    if (!wx && !wy) { if (x.replace(/^\.\//, '') === y.replace(/^\.\//, '')) return true; continue; }
    if (!wx) { if (globToRegExp(y).test(x.replace(/^\.\//, ''))) return true; continue; }
    if (!wy) { if (globToRegExp(x).test(y.replace(/^\.\//, ''))) return true; continue; }
    const px = staticPrefix(x), py = staticPrefix(y);
    if (px.startsWith(py) || py.startsWith(px)) return true;
  }
  return false;
}

// ---------- current card ----------

/**
 * The card this command is about: --card, then FACTORY_CARD (set for workers), then the branch name
 * (factory/C-###). Inferring from the branch keeps commands free of VAR=value prefixes, which a
 * worker's allowlist would deny.
 */
export function currentCard(args = {}, cwd = process.cwd()) {
  if (args.card) return String(args.card);
  if (process.env.FACTORY_CARD) return process.env.FACTORY_CARD;
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, allowFail: true }) || '').trim();
  return /^factory\/(C-\d+)$/.exec(branch)?.[1] || null;
}

// ---------- content binding ----------

/**
 * Hash of the working tree content (tracked + untracked, non-ignored), excluding .factory/.
 * Built in a throwaway index so the real index is untouched. A review or QA result is valid
 * only while this hash is unchanged.
 */
export function treeHash(cwd = process.cwd()) {
  const root = checkoutRoot(cwd);
  const tmpIndex = path.join(os.tmpdir(), `factory-index-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, allowFail: true });
    if (head) git(['read-tree', 'HEAD'], { cwd: root, env });
    git(['add', '-A', '--', '.', ':(exclude).factory'], { cwd: root, env });
    git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.factory'], { cwd: root, env });
    return git(['write-tree'], { cwd: root, env }).trim();
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

export function die(msg, code = 2) {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(code);
}
