# QA surfaces

| Surface | Drive it with | Evidence |
| --- | --- | --- |
| `browser` | Playwright headed on `$DISPLAY`, or the project's e2e command | Recorded run, plus console and network errors per page |
| `api` | `curl` or an HTTP client script against a local server with a test database | `qa/probe-output.txt`: request, expected, actual, status, latency |
| `cli` | The CLI with fixture inputs, valid and invalid | `qa/probe-output.txt`: command, exit code, stdout/stderr, expected vs actual |
| `ios-simulator` | macOS only: `xcodebuild test` with XCUITest; record with `xcrun simctl io booted recordVideo qa/sim.mp4` | Simulator recording, XCUITest results, annotations in `assertions.md` |
| `ios-device` | macOS with a trusted USB iPhone, driven by a human or a device harness. Unattended workers mark it `untested` unless a harness is configured | Device recording or screenshots with `assertions.md` |

## Browser checklist (per page in scope)

- Loads without console errors (collect `console.error`, uncaught errors, unhandled rejections).
- No failed network requests (4xx/5xx) caused by the change.
- Each acceptance criterion's flow works with the keyboard as well as the mouse.
- Loading, empty and error states render.
- Works at a phone width (390px) and a desktop width.

## qa/report.md template

```markdown
# QA: C-### <title>

Verdict: PASS | PARTIAL | FAIL · Surface: <surface> · Commit: <sha> · Environment: <OS, browser, URL>

## Critical paths
| # | Path | Result | Evidence |
| --- | --- | --- | --- |

## Bugs found
| # | Bug | Regression test (failed first) | Fix commit |
| --- | --- | --- | --- |

## Untested (and why)
- …

## Frame check
<confirmed / contradicted / cannot tell, per frame>
```
