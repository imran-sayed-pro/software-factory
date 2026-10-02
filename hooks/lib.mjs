// Shared hook helpers. Claude Code reads the decision only when nested under hookSpecificOutput.
import fs from 'node:fs';

/** Parsed hook payload, or null when stdin is empty or not a JSON object (callers fail closed). */
export function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}
export const unattended = () => process.env.FACTORY_UNATTENDED === '1';
export function decide(decision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }) + '\n');
  process.exit(0);
}
export const allow = () => process.exit(0);
/** Ask a human when one is present; deny when the session runs unattended (nobody can answer). */
export const askOrDeny = (reason) => decide(unattended() ? 'deny' : 'ask', unattended() ? `${reason} (unattended worker: denied; record it in decisions.md and escalate instead)` : reason);

/** Hooks fail closed: an unexpected crash asks a human (or denies when unattended) instead of exiting 1,
 *  which Claude Code would treat as a non-blocking error and let the tool call through. */
export function failClosed(name) {
  process.on('uncaughtException', (e) => askOrDeny(`[factory] ${name} hook crashed (${String(e?.message || e).slice(0, 160)}); refusing to allow unchecked`));
}
