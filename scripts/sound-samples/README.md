# Sound regression suite

Run from the repository root after `bun run setup`:

```sh
cd scripts/sound-samples
bun install --frozen-lockfile
cd ../..
bun run test:sound
```

PR Validation runs the same suite in its `sound-regression` job. No browser, audio device, or dev server is required. A failed assertion or detected click exits nonzero.

The suite runs three checks in order:

- `rampScan.ts` tests completed and interrupted gain/pitch ramps against rendered samples. Each case uses a separate native renderer process and checks the boundary step and final target.
- `liveScan.ts` feeds the engine a 20-second bed-only cursor fixture while rendering is suspended at each recorded update time. It renders 21 seconds, asserts audible output, and requires zero click detections. Scheduling all updates before rendering does not exercise the same failure.
- `clickScan.ts` renders the full scene collection and requires zero clicks. Flutter is reported separately and is not a pass/fail threshold.

The fixture `fixtures/live-bed.json` retains recorded update times, cursor motion, activation, and trail churn. Participant identifiers are replaced with local ordinal names; colors are fixed, custom cursor image URLs become `default`, and URLs, browsing paths, capture origin, and runtime diagnostic metadata are omitted. The anonymized fixture reproduces the ramp discontinuity independently of the private source trace.

For future sound changes, run the full suite and retain paired WAVs for listening review. Keep discontinuity assertions independent of a waveform snapshot so intentional musical changes can remain valid. Add a small failing case when a live defect is discovered; preserve the update/render ordering that exposes it.

These native renders test scheduling continuity and scene output. They do not measure Chrome page load, device underruns, or establish audible character preservation. Use the portrait `?sounddev=1` performance readout and a live recording for those checks. Do not relax the click threshold merely to accommodate a failing change.
