// What an unattended worker may run. `claude -p` cannot ask anyone, so Claude Code's permission system
// denies any shell command that is not allowed up front. Workers get an explicit allowlist: the edit
// and search tools, git, node (factory scripts), basic file commands, and the tools of the repo's stack
// profiles. Anything else is denied, and the worker records it and escalates. The factory hooks still
// apply on top (destructive-command guard, scope fence).
import { listProfiles } from './profile.mjs';

export const WORKER_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Agent', 'Task', 'TodoWrite'];

// Shell commands every stack needs. Deliberately absent: command runners that would turn the list into
// "anything" (bash, sh, zsh, env, xargs, eval, exec, sudo, timeout, nohup) and network fetchers other
// than curl (needed for API QA; piping it into a shell is still caught by the guard hook).
export const BASE_COMMANDS = [
  'git', 'node', 'cd', 'export', 'pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'sort', 'uniq',
  'diff', 'cut', 'tr', 'sed', 'awk', 'jq', 'echo', 'printf', 'test', 'true', 'mkdir', 'touch', 'cp', 'mv', 'rm',
  'ln', 'chmod', 'basename', 'dirname', 'realpath', 'which', 'command', 'date', 'sleep', 'curl', 'lsof', 'kill',
  'ps', 'ffmpeg', 'ffprobe',
];

const WRAPPERS = new Set(['bash', 'sh', 'zsh', 'env', 'xargs', 'eval', 'exec', 'sudo', 'timeout', 'nohup']);

/** First program name in a command string (skips VAR=value prefixes), or null. */
export function programOf(cmd) {
  const word = String(cmd || '').trim().split(/\s+/).find((w) => !/^\w+=/.test(w));
  return word && /^[\w.+-]+$/.test(word) ? word : null;
}

/**
 * Allowed-tools rules for workers in a repo using these profiles. `resolved` is an optional list of
 * resolved profile command strings (from resolveProfile) whose programs are added too.
 */
export function workerAllowedTools(profileNames = [], resolved = []) {
  const profiles = listProfiles().filter((p) => profileNames.includes(p.name));
  const programs = new Set(BASE_COMMANDS);
  for (const p of profiles) for (const c of p.workerCommands || []) programs.add(c);
  for (const c of resolved) { const prog = programOf(c); if (prog) programs.add(prog); }
  for (const w of WRAPPERS) programs.delete(w);
  const bash = [...programs].sort().flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]);
  return [...WORKER_TOOLS, ...bash];
}

/** Expand a `{allowedTools}` element of a worker command into one argument per rule. */
export function expandCommand(command, { prompt = '', card = '', allowedTools = [] } = {}) {
  return command.flatMap((a) => (a === '{allowedTools}' ? allowedTools : [a.replaceAll('{prompt}', prompt).replaceAll('{card}', card)]));
}
