#!/usr/bin/env node
// dispatch.mjs: the factory runner. One git worktree and one headless worker per card,
// parallel only where card file scopes do not overlap, with stall/time/cost escalation and a merge queue.
//
//   plan                     what would run now, what waits, and why
//   start [--max N] [--card C-001] [--dry-run]
//   status [--json]          refresh worker state; escalate stalls, overruns, failures
//   tick [--max N]           status, then start whatever became launchable
//   watch [--interval 60] [--max N]   tick until nothing runs and nothing can start, then run the merge queue
//                            exit 0 all clear, 3 open escalations, 4 waiting on human merges or locked files
//   queue [--json]           merge queue: rebase finished cards in dependency order, re-check, mark done
//   escalations [--all]      open escalations for a human
//   resolve <id> --note "…"  close an escalation
//   stop <card>              kill a worker (card -> blocked)
//   cleanup <card|--merged>  remove worktrees/branches of merged or archived cards
//
// Pattern credit: ECC orchestrate-worktrees + loop-operator (MIT, (c) 2026 Affaan Mustafa).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLUGIN_ROOT, factoryRoot, factoryDir, git, parseArgs, readJSON, writeJSON, appendJSONL, readJSONL, nowIso, treeHash, die,
} from './lib/common.mjs';
import { scanUsage, costOf } from './lib/usage.mjs';
import { workerAllowedTools, expandCommand } from './lib/permissions.mjs';
import { loadCards, saveCard, validateCard, topoOrder, readyCards, pickLaunchable } from './lib/cards.mjs';

const args = parseArgs();
const cmd = args._[0] || 'plan';
const root = factoryRoot();
const fdir = factoryDir(root);
const configPath = path.join(fdir, 'config.json');
if (!fs.existsSync(configPath)) die('no .factory/config.json: run factory-init first');
const config = readJSON(configPath);
const W = {
  max: 3, stallMinutes: 15, maxMinutesPerCard: 120, maxCostUsdPerCard: 15, maxAttemptsPerCard: 2, virtualDisplay: true,
  command: ['claude', '-p', '{prompt}', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--allowedTools', '{allowedTools}'],
  ...(config.workers || {}),
};
// Configs written before workers.allowedTools existed get the profile defaults.
if (!Array.isArray(W.allowedTools)) W.allowedTools = workerAllowedTools(config.profiles || [config.profile].filter(Boolean));
const base = config.baseBranch || 'main';
const boardPath = path.join(fdir, 'board.json');
const escPath = path.join(fdir, 'runs', 'escalations.jsonl');
const runDirOf = (id) => path.join(fdir, 'runs', id);
const wtOf = (id) => path.join(fdir, 'worktrees', id);
const branchOf = (id) => `factory/${id}`;

// ---------- single-dispatcher lock ----------
const lockPath = path.join(fdir, 'dispatch.lock');
function withLock(fn) {
  fs.mkdirSync(fdir, { recursive: true });
  // The lock appears atomically with the pid already in it (write a temp file, then hard-link it into
  // place; link fails if the lock exists), so a reader never sees an empty lock and mistakes it for stale.
  const tmp = `${lockPath}.${process.pid}`;
  fs.writeFileSync(tmp, String(process.pid));
  const take = () => { try { fs.linkSync(tmp, lockPath); return true; } catch { return false; } };
  try {
    if (!take()) {
      const holder = Number(fs.readFileSync(lockPath, 'utf8').trim()) || 0;
      if (!holder) die(`dispatch lock ${lockPath} has no pid; remove it by hand if no dispatcher is running`);
      if (alive(holder)) die(`another dispatcher (pid ${holder}) is running`);
      // Stale: move it aside (rename is atomic, so only one dispatcher wins), then take the lock.
      try { fs.renameSync(lockPath, `${lockPath}.stale-${holder}-${process.pid}`); } catch { /* another dispatcher moved it */ }
      fs.rmSync(`${lockPath}.stale-${holder}-${process.pid}`, { force: true });
      if (!take()) die('another dispatcher took the lock');
    }
  } finally { fs.rmSync(tmp, { force: true }); }
  try { return fn(); } finally { fs.rmSync(lockPath, { force: true }); }
}

const loadBoard = () => readJSON(boardPath, { cards: {} });
const saveBoard = (b) => writeJSON(boardPath, b);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function killGroup(pid, signal = 'SIGTERM') { try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } } }

function escalate(card, kind, detail) {
  const esc = { id: `E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: nowIso(), card, kind, detail, open: true };
  appendJSONL(escPath, esc);
  console.log(`ESCALATION ${esc.id} ${card} [${kind}] ${detail}`);
  return esc;
}
function openEscalations() {
  const all = readJSONL(escPath);
  const closed = new Set(all.filter((e) => e.resolves).map((e) => e.resolves));
  return all.filter((e) => e.open && !closed.has(e.id));
}

// ---------- worker launch ----------
function workerPrompt(card) {
  return [
    `You are an UNATTENDED software-factory worker for card ${card.id}: "${card.title}".`,
    `Card file: ${path.join(fdir, 'cards', `${card.id}.json`)}. Plan: ${path.join(fdir, 'plans', `${card.id}.md`)} (if present). Test plan: ${path.join(fdir, 'test-plans', `${card.id}.md`)} (if present).`,
    `Your git worktree is the current directory, on branch ${branchOf(card.id)} from ${base}. Run directory for all evidence and reports: ${runDirOf(card.id)}.`,
    `Factory scripts are in ${path.join(PLUGIN_ROOT, 'scripts')}. Write that absolute path (and the run directory) out in full: the permission check refuses commands that contain shell variables such as $FACTORY_PLUGIN_ROOT, and commands not on the allowlist.`,
    'Do the work in this order, using the software-factory skills:',
    '1. build: test-first implementation of the card (RED evidence, minimal GREEN, refactor, commit on this branch).',
    '2. review-gate: run it on your diff; fix ASK/BLOCK findings you are allowed to fix, then re-run until APPROVE or WARN.',
    `3. qa-verify: surface "${card.verification?.qaSurface || 'none'}"; record evidence for user-facing behaviour.`,
    `4. Write ${path.join(runDirOf(card.id), 'handoff.md')} and finally ${path.join(runDirOf(card.id), 'status.json')} as {"card","state":"done"|"blocked","phase","summary","blockedReason"}.`,
    'Rules: never ask questions (choose the recommended option, never a destructive one, and append each choice to decisions.md in the run directory);',
    'stay inside the card files.allow; never edit CONSTRAINTS.md, DONE.md or anything under .factory/ except your run directory; never push or merge; stop with state "blocked" on any brake',
    '(3 failed hypotheses, a fix needing more than the allowed files, a high-risk action without sign-off, or a decision the card does not cover).',
  ].join('\n');
}

function freeDisplay() {
  for (let n = 90; n < 140; n++) if (!fs.existsSync(`/tmp/.X11-unix/X${n}`) && !fs.existsSync(`/tmp/.X${n}-lock`)) return n;
  return null;
}

function startVirtualDisplay(runDir) {
  if (!W.virtualDisplay || process.platform !== 'linux') return {};
  if (spawnSync('bash', ['-lc', 'command -v Xvfb'], { encoding: 'utf8' }).status !== 0) return {};
  const n = freeDisplay();
  if (n === null) return {};
  const log = fs.openSync(path.join(runDir, 'xvfb.log'), 'a');
  const p = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { detached: true, stdio: ['ignore', log, log] });
  p.unref();
  return { display: `:${n}`, xvfbPid: p.pid };
}

function launch(card, board, dry) {
  const runDir = runDirOf(card.id);
  const wt = wtOf(card.id);
  const branch = branchOf(card.id);
  if (dry) { console.log(`would start ${card.id} in ${path.relative(root, wt)} on ${branch}`); return; }
  fs.mkdirSync(runDir, { recursive: true });
  for (const f of ['status.json']) fs.rmSync(path.join(runDir, f), { force: true });
  if (!fs.existsSync(wt)) {
    const exists = git(['rev-parse', '--verify', '-q', branch], { cwd: root, allowFail: true });
    git(['worktree', 'add', ...(exists ? [wt, branch] : ['-b', branch, wt, base])], { cwd: root });
  }
  const prompt = workerPrompt(card);
  fs.writeFileSync(path.join(runDir, 'prompt.md'), prompt + '\n');
  const vd = startVirtualDisplay(runDir);
  const argv = expandCommand(W.command, { prompt, card: card.id, allowedTools: W.allowedTools });
  const log = fs.openSync(path.join(runDir, 'worker.log'), 'a');
  const env = {
    ...process.env, FACTORY_UNATTENDED: '1', FACTORY_CARD: card.id, FACTORY_ROOT: root, FACTORY_RUN_DIR: runDir,
    FACTORY_BASE: base, FACTORY_PLUGIN_ROOT: PLUGIN_ROOT, ...(vd.display ? { DISPLAY: vd.display } : {}),
  };
  const child = spawn(argv[0], argv.slice(1), { cwd: wt, env, detached: true, stdio: ['ignore', log, log] });
  child.on('error', (e) => fs.appendFileSync(path.join(runDir, 'worker.log'), `\n[dispatch] spawn error: ${e.message}\n`));
  child.unref();
  const prev = board.cards[card.id] || {};
  board.cards[card.id] = {
    pid: child.pid, startedAt: nowIso(), worktree: wt, branch, runDir, attempts: (prev.attempts || 0) + 1,
    display: vd.display || null, xvfbPid: vd.xvfbPid || null, lastLogSize: 0, lastActivity: nowIso(), costUsd: null, state: 'running',
  };
  card.status = 'running';
  saveCard(root, card);
  console.log(`started ${card.id} (pid ${child.pid}${vd.display ? `, display ${vd.display}` : ''}) attempt ${board.cards[card.id].attempts}`);
}

// ---------- status ----------
function refresh(board, cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rows = [];
  for (const [id, w] of Object.entries(board.cards)) {
    const card = byId.get(id);
    if (!card || w.state !== 'running') { rows.push({ id, state: w.state, attempts: w.attempts }); continue; }
    const logFile = path.join(w.runDir, 'worker.log');
    const size = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    if (size !== w.lastLogSize) { w.lastLogSize = size; w.lastActivity = nowIso(); }
    w.usage = scanUsage(logFile, w.usage);
    w.costUsd = costOf(w.usage, W.pricing);
    const isAlive = alive(w.pid);
    const statusFile = path.join(w.runDir, 'status.json');
    let st = null, stError = null;
    if (fs.existsSync(statusFile)) { try { st = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch (e) { stError = e.message; } }
    const idleMin = (Date.now() - Date.parse(w.lastActivity)) / 60000;
    const runMin = (Date.now() - Date.parse(w.startedAt)) / 60000;
    const finish = (state, cardStatus) => {
      w.state = state; w.finishedAt = nowIso();
      delete w.usage; // per-message counts are only needed while the worker runs; costUsd keeps the total
      if (w.xvfbPid) killGroup(w.xvfbPid);
      card.status = cardStatus; saveCard(root, card);
    };
    if (stError && !isAlive) {
      finish('failed', 'blocked');
      escalate(id, 'crashed', `status.json is not valid JSON (${stError}); log: ${logFile}`);
    } else if (!isAlive) {
      if (st?.state === 'done') finish('done', 'review');
      else {
        const reason = st?.state === 'blocked' ? `worker blocked: ${st.blockedReason || st.summary || 'no reason given'}` : 'worker exited without writing status.json';
        finish('failed', 'blocked');
        escalate(id, st?.state === 'blocked' ? 'blocked' : 'crashed', `${reason} (attempt ${w.attempts}/${W.maxAttemptsPerCard}); log: ${logFile}`);
      }
    } else if (idleMin > W.stallMinutes) {
      killGroup(w.pid); finish('stalled', 'blocked');
      escalate(id, 'stalled', `no worker output for ${Math.round(idleMin)} min (limit ${W.stallMinutes})`);
    } else if (runMin > W.maxMinutesPerCard) {
      killGroup(w.pid); finish('overtime', 'blocked');
      escalate(id, 'overtime', `ran ${Math.round(runMin)} min (limit ${W.maxMinutesPerCard})`);
    } else if (w.costUsd > W.maxCostUsdPerCard) {
      killGroup(w.pid); finish('over-budget', 'blocked');
      escalate(id, 'cost', `spent about $${w.costUsd.toFixed(2)} (limit $${W.maxCostUsdPerCard}; estimated from token usage)`);
    }
    rows.push({ id, state: w.state, attempts: w.attempts, idleMin: Math.round(idleMin), runMin: Math.round(runMin), costUsd: w.costUsd, phase: st?.phase || null });
  }
  return rows;
}

function startLaunchable(board, cards, { max, only, dry }) {
  const capacity = Math.max(0, Number(max || W.max) - Object.values(board.cards).filter((w) => w.state === 'running').length);
  let pool = cards;
  if (only) pool = cards.filter((c) => c.id === only || c.status !== 'ready');
  const invalid = pool.filter((c) => c.status === 'ready' && validateCard(c, cards).length);
  for (const c of invalid) console.log(`skip ${c.id}: invalid card (${validateCard(c, cards)[0]})`);
  const eligible = pool.filter((c) => !invalid.includes(c) && !(c.status === 'ready' && (board.cards[c.id]?.attempts || 0) >= W.maxAttemptsPerCard));
  for (const c of pool.filter((c) => c.status === 'ready' && (board.cards[c.id]?.attempts || 0) >= W.maxAttemptsPerCard)) {
    console.log(`skip ${c.id}: reached ${W.maxAttemptsPerCard} attempts; needs a human`);
  }
  const { chosen, skipped } = pickLaunchable(eligible, capacity);
  for (const s of skipped) console.log(`wait ${s.id}: ${s.reason}`);
  for (const c of chosen) launch(c, board, dry);
  return chosen.length;
}

// ---------- merge queue ----------
function patchId(wt, from, to) {
  const d = git(['diff', `${from}...${to}`], { cwd: wt, allowFail: true });
  if (d === null) return null;
  const r = spawnSync('git', ['patch-id', '--stable'], { cwd: wt, input: d, encoding: 'utf8' });
  return (r.stdout || '').split(' ')[0] || 'empty';
}
function runNode(script, scriptArgs, cwd, env = {}) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', script), ...scriptArgs], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

function queue(board, cards) {
  const order = topoOrder(cards);
  const results = [];
  git(['fetch', '--quiet', 'origin', base], { cwd: root, allowFail: true });
  const target = git(['rev-parse', '--verify', '-q', `origin/${base}`], { cwd: root, allowFail: true }) ? `origin/${base}` : base;
  for (const id of order) {
    const card = cards.find((c) => c.id === id);
    if (card.status !== 'review') continue;
    const w = board.cards[id];
    const wt = w?.worktree || wtOf(id);
    const env = { FACTORY_CARD: id, FACTORY_RUN_DIR: runDirOf(id), FACTORY_ROOT: root, FACTORY_BASE: base };
    if (!fs.existsSync(wt)) { results.push({ id, result: 'missing-worktree' }); escalate(id, 'queue', `worktree ${wt} is missing`); continue; }
    const deps = card.dependsOn.filter((d) => cards.find((c) => c.id === d)?.status !== 'merged');
    if (deps.length) { results.push({ id, result: 'waiting', detail: `waits for ${deps.join(', ')}` }); continue; }
    const rv = runNode('review-record.mjs', ['verify', '--kind', 'review', '--json'], wt, env);
    const needsQa = (card.verification?.qaSurface || 'none') !== 'none';
    const qv = needsQa ? runNode('review-record.mjs', ['verify', '--kind', 'qa', '--json'], wt, env) : { status: 0 };
    if (rv.status !== 0 || qv.status !== 0) {
      const why = rv.status !== 0 ? `review ${JSON.parse(rv.stdout || '{}').status || 'invalid'}` : `qa ${JSON.parse(qv.stdout || '{}').status || 'invalid'}`;
      results.push({ id, result: 'not-ready', detail: why });
      escalate(id, 'queue', `cannot enter merge queue: ${why}; re-run the gate in the worktree`);
      continue;
    }
    const before = patchId(wt, target, 'HEAD');
    const dirty = git(['status', '--porcelain'], { cwd: wt }).trim();
    if (dirty) { results.push({ id, result: 'dirty' }); escalate(id, 'queue', 'worktree has uncommitted changes'); continue; }
    const rb = spawnSync('git', ['rebase', target], { cwd: wt, encoding: 'utf8' });
    if (rb.status !== 0) {
      spawnSync('git', ['rebase', '--abort'], { cwd: wt });
      results.push({ id, result: 'conflict' });
      escalate(id, 'conflict', `rebase onto ${target} conflicts; resolve in ${wt} or re-scope the card`);
      continue;
    }
    const after = patchId(wt, target, 'HEAD');
    const checks = runNode('check.mjs', ['--stage', 'review', '--json'], wt, env);
    const floor = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'floor-guard.mjs'), '--base', target], { cwd: wt, encoding: 'utf8' });
    // The tree was verified clean before the rebase, so anything changed now was generated by the checks
    // (coverage reports, caches). Drop it so the re-bound verdict covers the committed code only.
    git(['checkout', '--', '.'], { cwd: wt, allowFail: true });
    git(['clean', '-fdq'], { cwd: wt, allowFail: true });
    if (checks.status !== 0 || floor.status !== 0) {
      results.push({ id, result: 'checks-failed' });
      escalate(id, 'queue', `checks failed after rebase (check exit ${checks.status}, floor-guard exit ${floor.status})`);
      continue;
    }
    if (before !== after) {
      results.push({ id, result: 're-review', detail: 'the card diff changed during rebase; review-gate must run again' });
      escalate(id, 're-review', 'rebase changed the card diff; re-run review-gate (and qa-verify) in the worktree');
      continue;
    }
    // Same patch on a newer base, checks green: carry the verdicts forward to the rebased tree, with provenance.
    for (const kind of needsQa ? ['review', 'qa'] : ['review']) {
      const f = path.join(runDirOf(id), `${kind}.json`);
      const rec = readJSON(f);
      rec.rebased = { from: rec.tree, onto: target, patchId: after, at: nowIso(), checks: 'pass', floorGuard: 'clean' };
      rec.tree = treeHash(wt);
      writeJSON(f, rec);
    }
    card.status = 'done';
    saveCard(root, card);
    results.push({ id, result: 'done', detail: `rebased onto ${target}; ready for ship (Gate 2)` });
  }
  return results;
}

// ---------- commands ----------
const cards = loadCards(root);
switch (cmd) {
  case 'plan': {
    let order = [];
    try { order = topoOrder(cards); } catch (e) { die(e.message); }
    const board = loadBoard();
    const ready = readyCards(cards);
    const running = Object.values(board.cards).filter((w) => w.state === 'running').length;
    const { chosen, skipped } = pickLaunchable(cards, Math.max(0, W.max - running));
    console.log(`base ${base} · workers ${running}/${W.max} running · ${cards.length} cards`);
    console.log(`order: ${order.join(' -> ') || '(none)'}`);
    console.log(`ready now: ${ready.map((c) => c.id).join(', ') || '(none)'}`);
    console.log(`would start: ${chosen.map((c) => c.id).join(', ') || '(none)'}`);
    for (const s of skipped) console.log(`waits: ${s.id} (${s.reason})`);
    for (const c of cards.filter((c) => c.status === 'ready' && !ready.includes(c))) console.log(`waits: ${c.id} (dependencies ${c.dependsOn.join(', ')})`);
    for (const c of cards) { const p = validateCard(c, cards); if (p.length && c.status !== 'draft') console.log(`invalid: ${c.id}: ${p.join('; ')}`); }
    break;
  }
  case 'start': withLock(() => { const b = loadBoard(); startLaunchable(b, cards, { max: args.max, only: args.card, dry: args['dry-run'] }); if (!args['dry-run']) saveBoard(b); }); break;
  case 'status': {
    withLock(() => {
      const b = loadBoard(); const rows = refresh(b, cards); saveBoard(b);
      if (args.json) console.log(JSON.stringify({ rows, escalations: openEscalations() }, null, 2));
      else {
        for (const r of rows) console.log(`${r.id}  ${String(r.state).padEnd(11)} attempt ${r.attempts}${r.runMin !== undefined ? `  ${r.runMin}m run, ${r.idleMin}m idle` : ''}${r.costUsd != null ? `  $${r.costUsd.toFixed(2)}` : ''}${r.phase ? `  phase ${r.phase}` : ''}`);
        const open = openEscalations();
        if (open.length) console.log(`\n${open.length} open escalation(s): run "dispatch.mjs escalations"`);
      }
    });
    break;
  }
  case 'tick': withLock(() => { const b = loadBoard(); refresh(b, loadCards(root)); startLaunchable(b, loadCards(root), { max: args.max }); saveBoard(b); }); break;
  case 'watch': {
    const interval = Number(args.interval || 60) * 1000;
    const loop = () => {
      let running = 0, started = 0;
      withLock(() => {
        const b = loadBoard();
        refresh(b, loadCards(root));
        started = startLaunchable(b, loadCards(root), { max: args.max });
        saveBoard(b);
        running = Object.values(b.cards).filter((w) => w.state === 'running').length;
      });
      if (running === 0 && started === 0) {
        // Nothing runs and nothing can start: move finished cards through the merge queue, then report.
        let queued = [];
        withLock(() => { const b = loadBoard(); queued = queue(b, loadCards(root)); saveBoard(b); });
        for (const r of queued) console.log(`queue ${r.id}: ${r.result}${r.detail ? ` (${r.detail})` : ''}`);
        const now = loadCards(root);
        const awaitingMerge = now.filter((c) => c.status === 'done').map((c) => c.id);
        const waiting = now.filter((c) => c.status === 'ready').map((c) => c.id);
        const open = openEscalations();
        console.log(`watch: idle. ${open.length} open escalation(s).`);
        if (awaitingMerge.length) console.log(`awaiting Gate 2 (human merge via ship): ${awaitingMerge.join(', ')}`);
        if (waiting.length) console.log(`still waiting (dependencies or file locks on unmerged work): ${waiting.join(', ')}`);
        process.exit(open.length ? 3 : awaitingMerge.length || waiting.length ? 4 : 0);
      }
      setTimeout(loop, interval);
    };
    loop();
    break;
  }
  case 'queue': withLock(() => {
    const b = loadBoard(); const res = queue(b, loadCards(root)); saveBoard(b);
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else for (const r of res) console.log(`${r.id}  ${r.result}${r.detail ? `  ${r.detail}` : ''}`);
  }); break;
  case 'escalations': {
    const list = args.all ? readJSONL(escPath) : openEscalations();
    if (!list.length) console.log('no open escalations');
    for (const e of list) console.log(`${e.id}  ${e.at.slice(0, 16)}  ${e.card}  [${e.kind}] ${e.detail}${e.resolves ? ` (resolves ${e.resolves})` : ''}`);
    break;
  }
  case 'resolve': {
    const id = args._[1] || die('usage: resolve <escalation-id> --note "…"');
    appendJSONL(escPath, { id: `R-${Date.now().toString(36)}`, at: nowIso(), resolves: id, note: args.note || '', open: false });
    console.log(`resolved ${id}`);
    break;
  }
  case 'stop': withLock(() => {
    const id = args._[1] || die('usage: stop <card>');
    const b = loadBoard(); const w = b.cards[id] || die(`no worker for ${id}`);
    killGroup(w.pid); if (w.xvfbPid) killGroup(w.xvfbPid);
    w.state = 'stopped'; saveBoard(b);
    const card = cards.find((c) => c.id === id); if (card) { card.status = 'blocked'; saveCard(root, card); }
    console.log(`stopped ${id}`);
  }); break;
  case 'cleanup': withLock(() => {
    const b = loadBoard();
    const targets = args.merged ? cards.filter((c) => ['merged', 'archived'].includes(c.status)).map((c) => c.id) : [args._[1] || die('usage: cleanup <card>|--merged')];
    for (const id of targets) {
      const card = cards.find((c) => c.id === id);
      if (!args.force && card && !['merged', 'archived'].includes(card.status)) { console.log(`skip ${id}: status ${card.status} (use --force)`); continue; }
      if (fs.existsSync(wtOf(id))) git(['worktree', 'remove', '--force', wtOf(id)], { cwd: root, allowFail: true });
      git(['branch', '-D', branchOf(id)], { cwd: root, allowFail: true });
      delete b.cards[id];
      console.log(`cleaned ${id}`);
    }
    saveBoard(b);
  }); break;
  default: die('usage: dispatch.mjs <plan|start|status|tick|watch|queue|escalations|resolve|stop|cleanup>');
}
