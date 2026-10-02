# Recording evidence

The recording is the capture of you testing the app live. It has value only if it shows the real
session. (Workflow idea from michaelshimeles/skills `evidence-driven-testing`; the recorder in this
plugin is an original implementation.)

## Before recording

- `evidence.mjs doctor` must report `ready` and `captureReady`. Factory workers get a private
  virtual display (`$DISPLAY`) from `dispatch`. Interactive Linux sessions can start one:
  `Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & export DISPLAY=:99`.
- Run the browser **headed on that display**, maximised, popups closed, already at the starting
  state (signed in with a *test* account), unless setup itself is under test. With Playwright:
  `chromium.launch({ headless: false, args: ['--start-maximized'] })` with a 1920×1080 viewport.
- Note the revision under test (`git rev-parse HEAD`); `start` stamps it into the manifest.
- Nothing secret on screen: no real tokens, customer data or payment details. If a flow needs them,
  mark it `untested` and say why.

## While recording

- One `setup` annotation describing the starting context.
- One `test_start` per behaviour, phrased like a test name: "It should …".
- An `assertion` after each meaningful state change, `--result passed|failed|untested`, under 80
  characters. One per state change, not one per label on the page. "Precondition: …" assertions set up state.
- Move at a watchable pace; let the UI settle before asserting. Look before choosing `passed`.
- For a bug fix, show the old failure too: record a short run on the base branch first, or
  reference the failing regression test in the report.

## After recording

- `stop` burns the labels into `evidence.mp4`, verifies it with ffprobe, and writes `report.md`
  and `manifest.json`. If it reports `finalization_failed`, fix the cause and run `stop` again.
- `frames` extracts one frame half a second after each assertion, for the independent check.
- Replace `CAVEATS_PENDING` in `report.md`. `ship` uploads the evidence and links it in the PR; the
  uploader refuses synthetic recordings and reports with pending caveats.

## No display available

Use scripted capture instead of a video: Playwright screenshots named in test order with the
assertion in the file name (`01-precondition-signed-in.png`, `02-it-saves-on-blur-passed.png`), plus
`assertions.md` listing each `test_start` and `assertion` with its result. Same discipline, files
instead of an overlay.
