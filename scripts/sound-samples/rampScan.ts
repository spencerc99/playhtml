// ABOUTME: Checks rendered continuity when the engine replaces completed and running ramps.
// ABOUTME: Suspends native audio between updates to expose retroactive automation changes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";

interface RampControls {
  rampParam(param: AudioParam, value: number, seconds: number): void;
  glideParam(
    param: AudioParam,
    value: number,
    now: number,
    seconds: number,
  ): void;
}

Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } });

const kind = process.argv[2];
if (kind === undefined) {
  // Separate processes give each native renderer its own audio-thread lifecycle.
  for (const voice of ["gain", "pitch"]) {
    for (const end of [0.2, 1]) {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), voice, String(end)],
        { stdio: "inherit" },
      );
      assert.equal(result.status, 0, `${voice} ramp case failed`);
    }
  }
} else {
  assert.ok(kind === "gain" || kind === "pitch");
  const firstEnd = Number(process.argv[3]);
  assert.ok(firstEnd === 0.2 || firstEnd === 1);

  const context = new OfflineAudioContext(1, 72_000, 48_000);
  Object.defineProperty(context, "state", { value: "running" });
  const engine = new SoundEngine(context as unknown as BaseAudioContext);
  await engine.init();
  const controls = engine as unknown as RampControls;
  // A constant signal makes the AudioParam's rendered curve directly measurable.
  const source = context.createConstantSource();
  const gain = context.createGain();
  source.offset.value = 0.2;
  gain.gain.value = 0.2;
  source.connect(gain);
  gain.connect(context.destination);
  if (kind === "gain") source.offset.value = 1;
  else gain.gain.value = 1;
  const param = (kind === "gain"
    ? gain.gain
    : source.offset) as unknown as AudioParam;
  const ramp = (value: number, seconds: number) => {
    if (kind === "gain") controls.rampParam(param, value, seconds);
    else controls.glideParam(param, value, context.currentTime, seconds);
  };
  source.start();
  ramp(0.4, firstEnd);
  const paused = context.suspend(0.5);
  const rendered = context.startRendering();
  await paused;
  const boundary = Math.round(context.currentTime * context.sampleRate);
  ramp(0.8, 0.5);
  await context.resume();
  const samples = (await rendered).getChannelData(0);
  const jump = Math.abs(samples[boundary] - samples[boundary - 1]);
  assert.ok(jump < 0.0001, `${kind}, first end ${firstEnd}: jump ${jump}`);
  assert.ok(Math.abs(samples[samples.length - 1] - 0.8) < 0.0001);
  console.log(
    `${kind}, ${firstEnd < 0.5 ? "completed" : "running"}: boundary change ${jump}`,
  );
}
