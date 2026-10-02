#!/usr/bin/env node
// PreToolUse(Bash): stop destructive and gate-skipping commands.
//   deny  : catastrophic commands (always), and in unattended workers anything that would need a human
//   ask   : destructive-but-sometimes-legitimate commands when a human is present
// Pattern-matching a shell string is best effort, not a sandbox. Obfuscation primitives are treated as risky.
// Ideas from gstack /careful (MIT, (c) 2026 Garry Tan). Disable with FACTORY_GUARD=off.
import { readInput, decide, allow, askOrDeny, unattended, failClosed } from './lib.mjs';

failClosed('bash guard');

if (process.env.FACTORY_GUARD === 'off') allow();
const input = readInput();
if (input === null) askOrDeny('[factory] could not parse the tool payload to safety-check this command');
const cmd = String(input?.tool_input?.command || '');
if (!cmd.trim()) allow();
const lc = cmd.toLowerCase();
// Escaped: the base branch name is interpolated into regular expressions below.
const base = (process.env.FACTORY_BASE || 'main').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Safe deletions of build output and caches never need a question.
const SAFE_RM = /^\s*rm\s+-[a-z]*r[a-z]*f?[a-z]*\s+((\.\/)?(node_modules|dist|build|out|\.next|\.nuxt|\.turbo|\.cache|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|target|\.build|DerivedData|tmp|\.factory\/runs\/[\w.-]+\/tmp)\/?\s*)+$/;
if (SAFE_RM.test(cmd)) allow();

// Always deny: catastrophic, simple forms.
const CATASTROPHIC = [
  [/\brm\s+-[a-z]*(rf|fr)[a-z]*\s+(--no-preserve-root\s+)?(\/|~|\$home|\/\*|~\/\*|\$\{?home\}?\/?\*?)(\s|$)/i, 'recursive delete of / or home'],
  [/\bmkfs(\.\w+)?\b/, 'filesystem format'],
  [/\bdd\b[^|]*\bof=\/dev\/(sd|nvme|disk|hd)/, 'raw write to a disk device'],
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, 'fork bomb'],
  [new RegExp(`\\bgit\\s+push\\b[^;&|]*(--force\\b|--force-with-lease\\b|\\s-f\\b)[^;&|]*\\b(main|master|${base})\\b`), `force-push to the base branch (${base})`],
];
for (const [re, why] of CATASTROPHIC) if (re.test(lc)) decide('deny', `[factory] blocked: ${why}`);

// Obfuscation tripwire: string checks cannot see through these.
if (/\$\{?ifs\}?|base64\s+(-d|--decode)[^|]*\|\s*(ba)?sh\b|\beval\s+"?\$\(/.test(lc)) askOrDeny('[factory] shell obfuscation (IFS splitting, base64-to-shell or eval of a substitution)');

// Workers must never cross the human gates.
if (unattended()) {
  if (new RegExp(`\\bgit\\s+push\\b[^;&|]*\\b(origin\\s+)?(${base}|head:${base})\\b`).test(lc)) decide('deny', `[factory] workers never push to ${base}; ship handles merging after Gate 2`);
  if (/\bgh\s+pr\s+merge\b/.test(lc)) decide('deny', '[factory] merging is Gate 2 (a human), not a worker action');
  if (/\bgh\s+release\s+(delete|edit)\b|\bgh\s+repo\s+(delete|edit|rename)\b/.test(lc)) decide('deny', '[factory] repository settings and releases are not worker actions');
}

const RISKY = [
  [/\brm\s+-[a-z]*(r[a-z]*f|f[a-z]*r)[a-z]*\b/, 'recursive force delete'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard discards work'],
  [/\bgit\s+clean\s+-[a-z]*f/, 'git clean deletes untracked files'],
  [/\bgit\s+push\b[^;&|]*(--force\b|\s-f\b|--force-with-lease\b)/, 'force push'],
  [/\bgit\s+branch\s+-d[a-z]*\s.*--force|\bgit\s+branch\s+-D\b/i, 'force branch delete'],
  [/\bgit\s+checkout\s+--\s+\.|\bgit\s+restore\s+(--staged\s+)?\.(\s|$)/, 'discarding all local changes'],
  [/\b(drop|truncate)\s+(table|database|schema)\b|\btruncate\s+\w+/, 'destructive SQL'],
  [/\bdelete\s+from\s+\w+\s*(;|$|")/, 'DELETE without WHERE'],
  [/\bkubectl\s+delete\b|\bterraform\s+destroy\b|\bpulumi\s+destroy\b|\bhelm\s+uninstall\b/, 'infrastructure teardown'],
  [/\bdocker\s+(system|volume|image)\s+prune\b/, 'docker prune'],
  [/\bchmod\s+-r\s+0?777\b/, 'world-writable permissions'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'piping a download into a shell'],
  [/--no-verify\b/, '--no-verify skips the repository hooks and checks'],
  [/\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+npm\s+publish\b|\btwine\s+upload\b|\bpod\s+trunk\s+push\b/, 'publishing a package'],
];
for (const [re, why] of RISKY) if (re.test(lc)) askOrDeny(`[factory] ${why}: \`${cmd.slice(0, 120)}\``);
allow();
