// Stack profile detection: pick a profile from repo markers and resolve its commands.
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT, readJSON } from './common.mjs';

export function listProfiles() {
  const dir = path.join(PLUGIN_ROOT, 'profiles');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJSON(path.join(dir, f)));
}

function present(root, profile) {
  const d = profile.detect || {};
  if ((d.anyFile || []).some((f) => fs.existsSync(path.join(root, f)))) return true;
  if ((d.anyGlob || []).length) {
    const entries = fs.readdirSync(root);
    for (const g of d.anyGlob) {
      const re = new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (entries.some((e) => re.test(e))) return true;
    }
  }
  return false;
}

/** All profiles whose markers are present, in a stable order (swift, python, typescript). */
export function detectProfiles(root) {
  return listProfiles().filter((p) => present(root, p)).map((p) => p.name).sort((a, b) => {
    const rank = { swift: 0, python: 1, typescript: 2 };
    return (rank[a] ?? 9) - (rank[b] ?? 9);
  });
}

function packageManager(root, profile) {
  for (const [lock, pm] of Object.entries(profile.packageManager?.lockfiles || {})) {
    if (fs.existsSync(path.join(root, lock))) return pm;
  }
  return profile.packageManager?.default || '';
}

/** Resolve a named profile against a repo: fill {pm}, {pm_install} and return concrete commands. */
export function resolveProfile(root, name) {
  const profile = listProfiles().find((p) => p.name === name);
  if (!profile) throw new Error(`unknown profile "${name}". Known: ${listProfiles().map((p) => p.name).join(', ')}`);
  const pm = packageManager(root, profile);
  const pmInstall = profile.pmInstall?.[pm] || '';
  const commands = {};
  for (const [k, v] of Object.entries(profile.commands)) {
    commands[k] = v.replaceAll('{pm}', pm).replaceAll('{pm_install}', pmInstall);
  }
  // Prefer the repo's own scripts when package.json declares them.
  if (profile.name === 'typescript' && fs.existsSync(path.join(root, 'package.json'))) {
    const pkg = readJSON(path.join(root, 'package.json'));
    const scripts = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (scripts.typecheck) commands.typecheck = `${pm} run typecheck`;
    else if (!fs.existsSync(path.join(root, 'tsconfig.json'))) commands.typecheck = '(not yet installed: no tsconfig.json)';
    const test = String(scripts.test || '');
    // Coverage must write lcov to coverage/lcov.info so the changed-line check can read it.
    if (scripts['test:coverage']) commands.coverage = `${pm} run test:coverage`;
    else if (/vitest/.test(test) || deps.vitest) commands.coverage = 'npx --no-install vitest run --coverage --coverage.reporter=lcov';
    else if (/jest/.test(test) || deps.jest) commands.coverage = 'npx --no-install jest --coverage --coverageReporters=lcov';
    else if (/node\s+--test/.test(test)) commands.coverage = 'mkdir -p coverage && node --test --experimental-test-coverage --test-reporter=spec --test-reporter-destination=stdout --test-reporter=lcov --test-reporter-destination=coverage/lcov.info';
    else commands.coverage = '(not yet installed: add a "test:coverage" script that writes coverage/lcov.info)';
    if (!scripts.test) commands.test = '(not yet installed: add a "test" script)';
    if (!scripts.lint) commands.lint = '(not yet installed: add a "lint" script)';
    if (!scripts.build) commands.build = '(no build step)';
  }
  return { ...profile, packageManager: pm, commands };
}
