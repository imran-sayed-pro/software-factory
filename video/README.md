# Explainer video

A 3Blue1Brown-style explainer of the software factory: 7 scenes, about 3 minutes, built with
[Manim Community](https://www.manim.community/) and narrated with ElevenLabs.

| File | What it is |
| --- | --- |
| `script.json` | The narration, one entry per scene, and the voice (id and model) |
| `scenes.py` | The animation. Each scene anchors its visual beats to phrases in its narration |
| `narrate.mjs` | Calls ElevenLabs: one MP3 per scene plus character timestamps |
| `build.mjs` | Renders each scene to its audio length, adds the audio, joins the scenes |

## Build

```bash
# Once: Manim needs Cairo, Pango and ffmpeg (Debian/Ubuntu: apt install libpango1.0-dev ffmpeg).
# Use a virtualenv; some distro Pythons fail to build Manim's dependencies.
python3 -m venv .venv && .venv/bin/pip install manim

# Silent preview (timing estimated from the script):
MANIM=.venv/bin/manim node video/build.mjs --silent --quality m

# Narrated, 1080p60. Needs ELEVENLABS_API_KEY in the environment and network access to api.elevenlabs.io:
MANIM=.venv/bin/manim node video/build.mjs --quality h
```

The output lands in `video/build/` (ignored by git).

## The API key

`narrate.mjs` reads `ELEVENLABS_API_KEY` from the environment only. Never put the key in a file in this
repo, a commit or a chat. The script passes it to curl through stdin, so it does not appear in the
process list, and it masks the key in error messages.

## Changing the video

- **Words:** edit `script.json`, then run `node video/narrate.mjs --force --only <scene id>`. If you
  rename a phrase that `scenes.py` anchors to with `self.at("…")`, update that call too; a missing
  phrase stops the render with a clear error.
- **Voice:** set `voice.id` in `script.json`, or pass `--voice <id>` / `ELEVENLABS_VOICE_ID`.
- **Visuals:** edit `scenes.py`. Render one scene quickly with `--only Hook --quality l --silent`.
