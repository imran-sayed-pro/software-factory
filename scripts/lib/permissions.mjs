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
  'diff', 'cut', 'tr', 'sed', 'awk', 'jq', 'tee', 'echo', 'printf', 'test', 'true', 'mkdir', 'touch', 'cp', 'mv', 'rm',
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

/**
 * Fill a worker command: `{allowedTools}` becomes one argument per rule; `{prompt}`, `{card}`,
 * `{pluginDir}` and `{runDir}` are substituted. A `claude` command always gets the plugin (skills and
 * safety hooks) and the run directory, even from a config written before these flags existed.
 */
export function expandCommand(command, { prompt = '', card = '', allowedTools = [], pluginDir = '', runDir = '' } = {}) {
  const sub = (a) => a.replaceAll('{prompt}', prompt).replaceAll('{card}', card).replaceAll('{pluginDir}', pluginDir).replaceAll('{runDir}', runDir);
  const argv = command.flatMap((a) => (a === '{allowedTools}' ? allowedTools : [sub(a)]));
  if (/(^|\/)claude$/.test(argv[0] || '')) {
    const extra = [];
    if (pluginDir && !argv.includes('--plugin-dir')) extra.push('--plugin-dir', pluginDir);
    if (runDir && !argv.includes('--add-dir')) extra.push('--add-dir', runDir);
    // Before any variadic flag (--allowedTools takes the rest of the line).
    argv.splice(1, 0, ...extra);
  }
  return argv;
}

/**
 * Environment for a worker: the parent's, minus the variables that tie a process to the parent
 * Claude Code session (its id, socket, pid). Auth and proxy settings are kept.
 */
export const PARENT_SESSION_VARS = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_AFTER_LAST_COMPACT', 'CLAUDE_ENV_FILE',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_DIAGNOSTICS_FILE'];
export function workerEnv(base, extra) {
  const env = { ...base };
  for (const k of PARENT_SESSION_VARS) delete env[k];
  return { ...env, ...extra };
}
