#!/usr/bin/env node
// Generate the narration with ElevenLabs: one MP3 per scene plus character timestamps, so the
// animation can land each visual beat on the spoken word.
//
//   ELEVENLABS_API_KEY must be set in the environment. It is never written to disk or logged,
//   and it reaches curl through stdin (not argv), so it does not show up in the process list.
//
// Usage: node video/narrate.mjs [--voice <voice_id>] [--force] [--only s1_hook,s2_line]
// Output: video/build/<scene>.mp3, <scene>.alignment.json, timings.json
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, 'build');
const script = JSON.parse(fs.readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };
const voice = opt('--voice') || process.env.ELEVENLABS_VOICE_ID || script.voice.id;
const model = process.env.ELEVENLABS_MODEL || script.voice.model;
const only = opt('--only')?.split(',');
const force = argv.includes('--force');

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('narrate: ELEVENLABS_API_KEY is not set. Set it as an environment variable (never in a file in this repo).');
  process.exit(2);
}
fs.mkdirSync(BUILD, { recursive: true });

const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
const timingsPath = path.join(BUILD, 'timings.json');
const timings = fs.existsSync(timingsPath) ? JSON.parse(fs.readFileSync(timingsPath, 'utf8')) : {};

const scenes = script.scenes;
for (const [i, s] of scenes.entries()) {
  if (only && !only.includes(s.id)) continue;
  const mp3 = path.join(BUILD, `${s.id}.mp3`);
  const align = path.join(BUILD, `${s.id}.alignment.json`);
  if (!force && fs.existsSync(mp3) && fs.existsSync(align)) {
    timings[s.id] = duration(mp3);
    console.log(`keep ${s.id} (${timings[s.id].toFixed(1)} s)`);
    continue;
  }
  const body = {
    text: s.text,
    model_id: model,
    // Neighbouring text keeps the intonation continuous across scene boundaries.
    previous_text: scenes[i - 1]?.text,
    next_text: scenes[i + 1]?.text,
    voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
  };
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`;
  let out;
  try {
    out = execFileSync('curl', ['-sS', '--fail-with-body', '-X', 'POST', url,
      '-H', 'Content-Type: application/json', '-H', '@-', '--data-binary', JSON.stringify(body)],
    { input: `xi-api-key: ${key}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) {
    const msg = String(e.stdout || e.stderr || e.message).replaceAll(key, '***').slice(0, 600);
    console.error(`narrate: ElevenLabs request for ${s.id} failed: ${msg}`);
    if (/403|CONNECT tunnel/.test(msg)) console.error('narrate: the network may block api.elevenlabs.io; allow it in the environment settings.');
    process.exit(1);
  }
  const res = JSON.parse(out);
  fs.writeFileSync(mp3, Buffer.from(res.audio_base64, 'base64'));
  fs.writeFileSync(align, JSON.stringify(res.alignment));
  timings[s.id] = duration(mp3);
  fs.writeFileSync(timingsPath, JSON.stringify(timings, null, 2));
  const aligned = res.alignment?.characters?.length === s.text.length ? 'aligned' : 'alignment length differs; beats use estimates';
  console.log(`made ${s.id} (${timings[s.id].toFixed(1)} s, ${aligned})`);
}
fs.writeFileSync(timingsPath, JSON.stringify(timings, null, 2));
const total = Object.values(timings).reduce((a, b) => a + b, 0);
console.log(`narration: ${Object.keys(timings).length} scenes, ${total.toFixed(1)} s total, voice ${voice}`);
