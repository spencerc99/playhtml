// ABOUTME: Replays anonymized live bed input while native audio is rendering.
// ABOUTME: Fails on discontinuities or silent output at real update boundaries.

import assert from "node:assert/strict";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import type { TrailSoundFrame } from "../../extension/website/shared/sound/types";
import { scanForClicks } from "./clickDetector";
import fixture from "./fixtures/live-bed.json";

Object.assign(globalThis, { window: { innerWidth: 1280, innerHeight: 720 } });
const random = Math.random;
let seed = 12345;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

try {
  const context = new OfflineAudioContext(2, 48_000 * 21, 48_000);
  // The engine's runtime guard must see an active context during each suspension.
  Object.defineProperty(context, "state", { value: "running" });
  const engine = new SoundEngine(context as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(1280);
  engine.setConfig(fixture.config as Parameters<SoundEngine["setConfig"]>[0]);
  engine.setLayerSoloed("bed", true);
  const steps = fixture.ticks.map((tick) => ({
    tick,
    pause: context.suspend(tick.time),
  }));
  const rendering = context.startRendering();
  for (const { tick, pause } of steps) {
    await pause;
    const frames: TrailSoundFrame[] = tick.frames.map((frame) => ({
      ...frame,
      cursorType: frame.cursorType ?? undefined,
    }));
    engine.tick(tick.ms, frames);
    await context.resume();
  }
  const buffer = await rendering;
  const result = scanForClicks(buffer as unknown as AudioBuffer, "live-bed");
  console.log(JSON.stringify({ ...result, clickCount: result.hits.length }));
  assert.ok(result.peak > 0.01, "The bed must produce audible output");
  assert.equal(
    result.hits.length,
    0,
    "Live bed updates must remain click-free",
  );
} finally {
  Math.random = random;
}
