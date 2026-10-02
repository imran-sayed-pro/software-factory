// Test helpers: throwaway git repos and script runners.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const script = (name) => path.join(ROOT, 'scripts', name);

export function sh(cmd, cwd, env = {}) {
  return spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

/** A fresh git repo with one commit. `files` maps relative paths to contents. */
export function tempRepo(files = {}, { branch = 'main' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
  sh(`git init -q -b ${branch} && git config user.email t@t && git config user.name t && git config commit.gpgsign false`, dir);
  write(dir, { 'README.md': '# test\n', ...files });
  sh('git add -A && git commit -qm init', dir);
  return dir;
}

export function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
}

export function node(scriptName, args, cwd, env = {}, input) {
  const r = spawnSync(process.execPath, [script(scriptName), ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, FACTORY_UNATTENDED: '', FACTORY_CARD: '', FACTORY_RUN_DIR: '', FACTORY_ROOT: '', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function hook(name, payload, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', name)], { encoding: 'utf8', input: typeof payload === 'string' ? payload : JSON.stringify(payload), env: { ...process.env, FACTORY_UNATTENDED: '', FACTORY_CARD: '', FACTORY_GUARD: '', ...env } });
  const out = r.stdout.trim();
  return out ? JSON.parse(out).hookSpecificOutput : { permissionDecision: 'allow' };
}

export const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });
export const has = (bin) => sh(`command -v ${bin}`).status === 0;
