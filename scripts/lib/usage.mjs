// Running cost estimate for a worker, from the `usage` blocks in its stream-json log.
// `claude -p --output-format stream-json` reports total_cost_usd only in the final `result` event, after
// the worker has exited, so a cost brake needs an estimate while it runs. Prices are per million tokens
// and come from .factory/config.json (workers.pricing); the defaults are deliberately on the high side.
import fs from 'node:fs';

export const DEFAULT_PRICING = { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 };

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
