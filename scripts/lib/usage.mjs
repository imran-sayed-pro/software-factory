// Running cost estimate for a worker, from the `usage` blocks in its stream-json log.
// `claude -p --output-format stream-json` reports total_cost_usd only in the final `result` event, after
// the worker has exited, so a cost brake needs an estimate while it runs. Prices are per million tokens
// and come from .factory/config.json (workers.pricing); the defaults are deliberately on the high side.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PRICING = { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 };

// Default home for the snapshot statusline-capture.mjs writes and this file reads back (see that
// script's header). `.factory/config.json`'s `workers.usageStatusFile` can point elsewhere.
export const DEFAULT_USAGE_STATUS_FILE = path.join(os.homedir(), '.claude', 'software-factory-usage.json');

/**
 * The account's Claude-plan usage window (5h/7d `rate_limits`, from
 * https://code.claude.com/docs/en/statusline.md), as last captured by statusline-capture.mjs. There is
 * no documented way for a headless `claude -p` worker to read this itself, so dispatch instead polls a
 * file that a live, rendering, interactive session's statusLine keeps refreshed.
 *
 * Fails safe: a missing, unparsable, stale, or not-yet-populated snapshot is reported as "not ok", the
 * same as being over the limit, rather than treated as "fine" — because the alternative is an orchestrator
 * that silently stops protecting the account the moment nobody is watching.
 */
export function readSessionUsagePercent(file, maxAgeMinutes) {
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' ? `no usage snapshot at ${file} yet (see README: configure statusline-capture.mjs)` : `unreadable usage snapshot: ${e.message}` };
  }
  const ageMin = (Date.now() - new Date(record.capturedAt || 0).getTime()) / 60000;
  if (!Number.isFinite(ageMin) || ageMin > maxAgeMinutes) {
    return { ok: false, reason: `usage snapshot is ${Number.isFinite(ageMin) ? Math.round(ageMin) + 'm' : 'of unknown age'} old (no live session has refreshed it recently)` };
  }
  const rl = record.rate_limits || {};
  const five = typeof rl.five_hour?.used_percentage === 'number' ? rl.five_hour.used_percentage : -1;
  const week = typeof rl.seven_day?.used_percentage === 'number' ? rl.seven_day.used_percentage : -1;
  const percent = Math.max(five, week);
  if (percent < 0) return { ok: false, reason: 'usage snapshot has no rate_limits yet (first API response of that session has not landed)' };
  return { ok: true, percent, five_hour: five < 0 ? null : five, seven_day: week < 0 ? null : week };
}

/**
 * Read the log from `state.offset`, fold every message's usage into `state.msgs` (keyed by message id,
 * keeping the largest count seen, since partial events repeat a message), and advance the offset.
 * Only whole lines are consumed; a trailing partial line is read again next time.
 */
export function scanUsage(logFile, state = {}) {
  const s = { offset: 0, msgs: {}, reported: null, ...state };
  let size;
  try { size = fs.statSync(logFile).size; } catch { return s; }
  if (size <= s.offset) return s;
  const fd = fs.openSync(logFile, 'r');
  const buf = Buffer.alloc(size - s.offset);
  fs.readSync(fd, buf, 0, buf.length, s.offset);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  if (lastNl === -1) return s;
  s.offset += Buffer.byteLength(text.slice(0, lastNl + 1));
  for (const line of text.slice(0, lastNl).split('\n')) {
    if (!line.includes('"usage"') && !line.includes('total_cost_usd')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (typeof ev.total_cost_usd === 'number') s.reported = ev.total_cost_usd;
    const msg = ev.message || ev;
    const u = msg.usage;
    if (!u || ev.type === 'result') continue;
    const id = msg.id || `anon-${Object.keys(s.msgs).length}`;
    const prev = s.msgs[id] || { i: 0, o: 0, cr: 0, cw: 0 };
    s.msgs[id] = {
      i: Math.max(prev.i, u.input_tokens || 0),
      o: Math.max(prev.o, u.output_tokens || 0),
      cr: Math.max(prev.cr, u.cache_read_input_tokens || 0),
      cw: Math.max(prev.cw, u.cache_creation_input_tokens || 0),
    };
  }
  return s;
}

/** Dollars: the CLI's own total when it has reported one, otherwise the token estimate. */
export function costOf(state, pricing = {}) {
  if (typeof state?.reported === 'number') return state.reported;
  const p = { ...DEFAULT_PRICING, ...pricing };
  let usd = 0;
  for (const m of Object.values(state?.msgs || {})) {
    usd += (m.i * p.inputPerMTok + m.o * p.outputPerMTok + m.cr * p.cacheReadPerMTok + m.cw * p.cacheWritePerMTok) / 1e6;
  }
  return Math.round(usd * 100) / 100;
}
