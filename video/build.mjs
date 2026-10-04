#!/usr/bin/env node
// Build the explainer: narrate (if a key is set and audio is missing), render every scene timed to its
// narration, add the audio, and join the scenes into one MP4.
//
// Usage: node video/build.mjs [--quality l|m|h|k] [--silent] [--only Hook,TheLine]
//   --silent   no audio; scene timing is estimated from the script (a visual preview)
//   MANIM      path to the manim executable (default: manim on PATH)
// Output: video/build/software-factory-explainer[-silent].mp4
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, 'build');
const script = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };
const quality = opt('--quality') || 'h';
const silent = argv.includes('--silent');
const only = opt('--only')?.split(',');
// Resolve a relative MANIM path now: scenes render with cwd set to video/, where it would not exist.
const manim = process.env.MANIM?.includes('/') ? path.resolve(process.env.MANIM) : process.env.MANIM || 'manim';
const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...o });
  if (r.status !== 0) { console.error(`${cmd} failed:\n${(r.stderr || r.stdout || '').slice(-2000)}`); process.exit(1); }
  return r.stdout;
};
fs.mkdirSync(BUILD, { recursive: true });

// 1. Narration.
const haveAudio = script.scenes.every((s) => fs.existsSync(path.join(BUILD, `${s.id}.mp3`)));
if (!silent && !haveAudio) {
  if (!process.env.ELEVENLABS_API_KEY) { console.error('build: no narration yet and ELEVENLABS_API_KEY is not set. Use --silent for a preview.'); process.exit(2); }
  execFileSync(process.execPath, [path.join(HERE, 'narrate.mjs')], { stdio: 'inherit' });
}
// A silent preview must not pick up timings or alignment from a previous narrated build.
const env = { ...process.env };
const stash = path.join(BUILD, '.stash');
const moved = [];
if (silent) {
  fs.mkdirSync(stash, { recursive: true });
  for (const f of fs.readdirSync(BUILD).filter((f) => f === 'timings.json' || f.endsWith('.alignment.json'))) {
    fs.renameSync(path.join(BUILD, f), path.join(stash, f)); moved.push(f);
  }
}

// 2. Render and 3. add audio, per scene.
const media = path.join(BUILD, 'media');
const segments = [];
try {
  for (const s of script.scenes) {
    if (only && !only.includes(s.class)) continue;
    console.log(`render ${s.class}…`);
    run(manim, [`-q${quality}`, '--media_dir', media, '-o', s.id, path.join(HERE, 'scenes.py'), s.class], { cwd: HERE, env });
    const video = run('find', [media, '-name', `${s.id}.mp4`, '-newer', path.join(HERE, 'scenes.py')]).trim().split('\n').filter(Boolean).pop()
      || run('find', [media, '-name', `${s.id}.mp4`]).trim().split('\n').pop();
    const seg = path.join(BUILD, `seg-${s.id}.mp4`);
    const mp3 = path.join(BUILD, `${s.id}.mp3`);
    const audioIn = !silent && fs.existsSync(mp3) ? ['-i', mp3] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    run('ffmpeg', ['-v', 'error', '-y', '-i', video, ...audioIn, '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', seg]);
    segments.push(seg);
  }
} finally {
  for (const f of moved) fs.renameSync(path.join(stash, f), path.join(BUILD, f));
}

// 4. Join.
const list = path.join(BUILD, 'segments.txt');
fs.writeFileSync(list, segments.map((f) => `file '${f}'`).join('\n') + '\n');
const out = path.join(BUILD, `software-factory-explainer${silent ? '-silent' : ''}.mp4`);
run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
const secs = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim());
console.log(`done: ${path.relative(process.cwd(), out)} (${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')})`);
