#!/usr/bin/env node
// evidence.mjs: record annotated proof of a live test session.
//   doctor [--display :99]                     toolchain + capture readiness (JSON)
//   start --output <dir> --title "…" [--commit sha] [--branch b] [--environment "…"] [--source auto|x11|test] [--display :99] [--size 1920x1080] [--fps 15]
//   annotate <session> --type setup|test_start|assertion|note --message "…" [--result passed|failed|untested]
//   stop <session>                             stop capture, burn annotations, verify, write report.md + manifest.json
//   frames <session>                           extract one frame per assertion for an independent check
//
// Original implementation. The workflow follows the idea of michaelshimeles/skills evidence-driven-testing
// (annotated recording + report + manifest); no code was copied (that repository publishes no licence).
// Linux X11/Xvfb capture via ffmpeg x11grab. `--source test` is a synthetic pattern for toolchain checks
// only and is marked synthetic in every output: never present it as evidence.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJSON, writeJSON, appendJSONL, readJSONL, nowIso, die, currentCard } from './lib/common.mjs';

const args = parseArgs();
// Commit and branch default to the current checkout, so callers need no $(git …) substitutions.
const gitOut = (a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };
const cmd = args._[0];
const has = (bin) => spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
const ff = (a, opts = {}) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...a], { encoding: 'utf8', ...opts });

function doctor(display) {
  const out = { platform: process.platform, ffmpeg: has('ffmpeg'), ffprobe: has('ffprobe'), xvfb: has('Xvfb') };
  if (out.ffmpeg) {
    out.libx264 = /libx264/.test(spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '');
    const filters = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout || '';
    out.assFilter = /\bass\b/.test(filters);
    out.x11grab = /x11grab/.test(spawnSync('ffmpeg', ['-hide_banner', '-devices'], { encoding: 'utf8' }).stdout || '');
  }
  const disp = display || process.env.DISPLAY || null;
  out.display = disp;
  out.captureReady = false;
  if (out.x11grab && disp) {
    const probe = ff(['-f', 'x11grab', '-video_size', '64x64', '-i', `${disp}+0,0`, '-frames:v', '1', '-f', 'null', '-'], { timeout: 8000 });
    out.captureReady = probe.status === 0;
    if (!out.captureReady) out.captureError = (probe.stderr || '').trim().split('\n').slice(-1)[0];
  }
  out.ready = Boolean(out.ffmpeg && out.ffprobe && out.libx264 && out.assFilter);
  out.advice = !disp ? 'No DISPLAY. Run under Xvfb (dispatch does this for workers) or use the headless path in qa-verify.'
    : !out.captureReady ? 'DISPLAY set but not capturable; check Xvfb is running.' : 'ready';
  return out;
}

const sessionFile = (dir) => path.join(dir, 'session.json');
const loadSession = (dir) => {
  if (!dir || !fs.existsSync(sessionFile(dir))) die(`no evidence session at ${dir}`);
  return readJSON(sessionFile(dir));
};

function cmdlineOf(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return null; }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function start() {
  const out = path.resolve(args.output || die('--output is required'));
  if (!args.title) die('--title is required: say what is being verified');
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(sessionFile(out)) && readJSON(sessionFile(out)).state === 'recording') die(`a recording is already running in ${out}`);
  const size = args.size || '1920x1080';
  const fps = String(args.fps || 15);
  let source = args.source || 'auto';
  const display = args.display || process.env.DISPLAY;
  if (source === 'auto') {
    const d = doctor(display);
    if (!d.ready) die(`toolchain not ready: ${JSON.stringify(d)}`);
    if (!d.captureReady) die(`no capturable display (${d.advice}). Use the headless path, or --source test only for a toolchain smoke test.`);
    source = 'x11';
  }
  const raw = path.join(out, 'raw.ts');
  const input = source === 'test'
    ? ['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${fps}`]
    : ['-f', 'x11grab', '-draw_mouse', '1', '-framerate', fps, '-video_size', size, '-i', `${display}+0,0`];
  const log = fs.openSync(path.join(out, 'ffmpeg-record.log'), 'a');
  // MPEG-TS survives a hard kill: whatever was captured stays playable.
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...input, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-f', 'mpegts', raw],
    { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  const session = {
    state: 'recording', title: args.title, commit: args.commit || gitOut(['rev-parse', 'HEAD']), branch: args.branch || gitOut(['branch', '--show-current']), environment: args.environment || null,
    source, synthetic: source === 'test', display: source === 'x11' ? display : null, size, fps: Number(fps),
    startedAtMs: Date.now(), startedAt: nowIso(), pid: child.pid, raw,
    card: currentCard(args),
  };
  writeJSON(sessionFile(out), session);
  sleep(700);
  if (!cmdlineOf(child.pid) && !fs.existsSync(raw)) die(`recorder failed to start; see ${path.join(out, 'ffmpeg-record.log')}`);
  console.log(JSON.stringify({ session: out, source, synthetic: session.synthetic }));
}

function annotate() {
  const dir = path.resolve(args._[1] || die('usage: annotate <session> --type … --message …'));
  const s = loadSession(dir);
  if (s.state !== 'recording') die('session is not recording');
  const type = args.type;
  if (!['setup', 'test_start', 'assertion', 'note'].includes(type)) die('--type must be setup, test_start, assertion or note');
  const message = String(args.message || '');
  if (!message) die('--message is required');
  if (message.length > 80) die(`--message is ${message.length} characters; keep it under 80 and high-signal`);
  let result = null;
  if (type === 'assertion') {
    result = args.result;
    if (!['passed', 'failed', 'untested'].includes(result)) die('assertions need --result passed|failed|untested (look at the screen before choosing passed)');
  }
  const t = (Date.now() - s.startedAtMs) / 1000;
  appendJSONL(path.join(dir, 'annotations.jsonl'), { t: Math.round(t * 100) / 100, type, message, result, at: nowIso() });
  console.log(`${type}${result ? ` (${result})` : ''} @ ${t.toFixed(1)}s`);
}

const assTime = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${x}`;
};
const assEsc = (s) => s.replace(/[{}\\]/g, '').replace(/\n/g, ' ');

function buildAss(ann, duration, s) {
  const [w, h] = s.size.split('x').map(Number);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`
    + `Style: Test,DejaVu Sans,${Math.round(h / 34)},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,1,0,0,0,100,100,0,0,3,2,0,8,20,20,20,1\n`
    + `Style: Pass,DejaVu Sans,${Math.round(h / 40)},&H0080FF80,&H00FFFFFF,&H00000000,&HA0000000,1,0,0,0,100,100,0,0,3,2,0,2,20,20,40,1\n`
    + `Style: Fail,DejaVu Sans,${Math.round(h / 40)},&H006060FF,&H00FFFFFF,&H00000000,&HA0000000,1,0,0,0,100,100,0,0,3,2,0,2,20,20,40,1\n`
    + `Style: Info,DejaVu Sans,${Math.round(h / 44)},&H00E0E0E0,&H00FFFFFF,&H00000000,&HA0000000,0,0,0,0,100,100,0,0,3,2,0,2,20,20,40,1\n\n`
    + '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const ev = [];
  if (s.synthetic) ev.push(`Dialogue: 2,${assTime(0)},${assTime(duration)},Fail,,0,0,0,,SYNTHETIC TEST PATTERN - NOT EVIDENCE`);
  const tests = ann.filter((a) => a.type === 'test_start' || a.type === 'setup');
  tests.forEach((a, i) => {
    const end = i + 1 < tests.length ? tests[i + 1].t : duration;
    ev.push(`Dialogue: 0,${assTime(a.t)},${assTime(end)},Test,,0,0,0,,${a.type === 'setup' ? 'SETUP: ' : ''}${assEsc(a.message)}`);
  });
  for (const a of ann.filter((x) => x.type === 'assertion' || x.type === 'note')) {
    const style = a.type === 'note' ? 'Info' : a.result === 'passed' ? 'Pass' : a.result === 'failed' ? 'Fail' : 'Info';
    const label = a.type === 'note' ? 'NOTE' : a.result.toUpperCase();
    ev.push(`Dialogue: 1,${assTime(a.t)},${assTime(Math.min(duration, a.t + 4))},${style},,0,0,0,,${label}: ${assEsc(a.message)}`);
  }
  return header + ev.join('\n') + '\n';
}

function probeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
}

function stop() {
  const dir = path.resolve(args._[1] || die('usage: stop <session>'));
  const s = loadSession(dir);
  if (s.state === 'recording') {
    const cl = cmdlineOf(s.pid);
    if (cl && cl.includes(s.raw)) {
      // Only signal the process we started (checked by its command line, so a recycled PID is never hit).
      for (const [sig, wait] of [['SIGINT', 6000], ['SIGTERM', 3000], ['SIGKILL', 1000]]) {
        try { process.kill(s.pid, sig); } catch { break; }
        const until = Date.now() + wait;
        while (Date.now() < until && cmdlineOf(s.pid)) sleep(200);
        if (!cmdlineOf(s.pid)) break;
      }
    } else if (cl) die(`pid ${s.pid} is no longer our recorder (now: ${cl.slice(0, 80)}); stop the recorder by hand, then re-run stop`);
    s.state = 'stopped'; s.stoppedAt = nowIso(); s.stoppedAtMs = Date.now();
    writeJSON(sessionFile(dir), s);
  }
  if (!fs.existsSync(s.raw) || fs.statSync(s.raw).size === 0) die('nothing was captured (raw.ts missing or empty)');
  const ann = readJSONL(path.join(dir, 'annotations.jsonl'));
  const rawDur = probeDuration(s.raw) || (s.stoppedAtMs - s.startedAtMs) / 1000;
  fs.writeFileSync(path.join(dir, 'annotations.ass'), buildAss(ann, rawDur, s));
  const mp4 = path.join(dir, 'evidence.mp4');
  const r = ff(['-y', '-i', s.raw, '-vf', `ass=${path.join(dir, 'annotations.ass').replace(/:/g, '\\:')}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  if (r.status !== 0) { s.state = 'finalization_failed'; writeJSON(sessionFile(dir), s); die(`render failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`); }
  const duration = probeDuration(mp4);
  if (!duration) { s.state = 'finalization_failed'; writeJSON(sessionFile(dir), s); die('evidence.mp4 did not verify with ffprobe'); }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(mp4)).digest('hex');
  const asserts = ann.filter((a) => a.type === 'assertion');
  const counts = { passed: asserts.filter((a) => a.result === 'passed').length, failed: asserts.filter((a) => a.result === 'failed').length, untested: asserts.filter((a) => a.result === 'untested').length };
  const manifest = {
    title: s.title, card: s.card, commit: s.commit, branch: s.branch, environment: s.environment, source: s.source, synthetic: s.synthetic,
    startedAt: s.startedAt, stoppedAt: s.stoppedAt, durationSec: Math.round(duration * 10) / 10, video: 'evidence.mp4', sha256, counts, annotations: ann,
    verdict: s.synthetic ? 'SYNTHETIC' : counts.failed ? 'FAIL' : counts.untested ? 'PARTIAL' : asserts.length ? 'PASS' : 'NO_ASSERTIONS',
  };
  writeJSON(path.join(dir, 'manifest.json'), manifest);
  const lines = [`# Evidence: ${s.title}`, '', `- Verdict: **${manifest.verdict}** (${counts.passed} passed, ${counts.failed} failed, ${counts.untested} untested)`,
    `- Commit: \`${s.commit || 'unknown'}\` · Branch: \`${s.branch || 'unknown'}\``, `- Environment: ${s.environment || 'unknown'} · Source: ${s.source}${s.synthetic ? ' (SYNTHETIC: not evidence)' : ''}`,
    `- Video: \`evidence.mp4\` (${manifest.durationSec}s, sha256 ${sha256.slice(0, 12)}…)`, '', '## Tests', ''];
  let cur = null;
  for (const a of ann) {
    if (a.type === 'test_start' || a.type === 'setup') { cur = a; lines.push(`### ${a.type === 'setup' ? 'Setup: ' : ''}${a.message} (${a.t}s)`, ''); }
    else if (a.type === 'assertion') lines.push(`- ${a.result === 'passed' ? 'PASS' : a.result === 'failed' ? 'FAIL' : 'UNTESTED'} @ ${a.t}s: ${a.message}`);
    else lines.push(`- note @ ${a.t}s: ${a.message}`);
  }
  if (!cur) lines.push('_No test_start annotations were recorded._');
  lines.push('', '## Caveats', '', 'CAVEATS_PENDING: the worker must replace this line with real caveats (what was not covered, environment differences, flaky steps), or "None".', '');
  fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n'));
  s.state = 'finalized'; writeJSON(sessionFile(dir), s);
  console.log(JSON.stringify({ verified: true, video: mp4, durationSec: manifest.durationSec, verdict: manifest.verdict, counts }));
}

function frames() {
  const dir = path.resolve(args._[1] || die('usage: frames <session>'));
  const mp4 = path.join(dir, 'evidence.mp4');
  if (!fs.existsSync(mp4)) die('run stop first');
  const ann = readJSONL(path.join(dir, 'annotations.jsonl')).filter((a) => a.type === 'assertion');
  const outDir = path.join(dir, 'frames'); fs.mkdirSync(outDir, { recursive: true });
  const made = [];
  ann.forEach((a, i) => {
    const slug = a.message.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const f = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${a.result}-${slug}.png`);
    // A beat after the assertion so the label and the settled UI are both on screen.
    const r = ff(['-y', '-ss', String(a.t + 0.5), '-i', mp4, '-frames:v', '1', f]);
    if (r.status === 0) made.push({ frame: path.relative(dir, f), t: a.t, result: a.result, message: a.message });
  });
  writeJSON(path.join(outDir, 'index.json'), made);
  console.log(JSON.stringify({ frames: made.length, dir: outDir }));
}

switch (cmd) {
  case 'doctor': { const d = doctor(args.display); console.log(JSON.stringify(d, null, 2)); process.exit(d.ready ? 0 : 1); }
  case 'start': start(); break;
  case 'annotate': annotate(); break;
  case 'stop': stop(); break;
  case 'frames': frames(); break;
  default: die('usage: evidence.mjs <doctor|start|annotate|stop|frames> ...');
}
