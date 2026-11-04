// ABOUTME: Measures the body and continuity of an isolated text-cursor instrument.
// ABOUTME: Replays intermittent typing motion while native audio renders between updates.

import assert from "node:assert/strict";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { scanForClicks } from "./clickDetector";

Object.assign(globalThis, { window: { innerWidth: 1280, innerHeight: 720 } });
const originalRandom = Math.random;
let seed = 12345;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

try {
  const context = new OfflineAudioContext(2, 48_000 * 6, 48_000);
  Object.defineProperty(context, "state", { value: "running" });
  const engine = new SoundEngine(context as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(1280);
  engine.setConfig({
    cursorInstruments: true,
    spotlight: false,
    swells: false,
  });
  engine.setLayerSoloed("bed", true);
  const steps = Array.from({ length: 100 }, (_, index) => ({
    index,
    pause: context.suspend(index * 0.05),
  }));
  const rendering = context.startRendering();
  let x = 100;
  for (const { index, pause } of steps) {
    await pause;
    const prevX = x;
    if (index % 3 === 0) x += 8;
    engine.tick(index * 50, [
      {
        trailIndex: 0,
        x,
        y: 300,
        prevX,
        prevY: 300,
        cursorType: "text",
        progress: 0,
        color: "#4a9a8a",
        isNewlyActive: index === 0,
        identityKey: "probe-typist",
      },
    ]);
    await context.resume();
  }
  const audio = await rendering;
  const samples = audio.getChannelData(0);
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  const scan = scanForClicks(audio as unknown as AudioBuffer, "typing-body");
  console.log(
    JSON.stringify({ rms, peak: scan.peak, clicks: scan.hits.length }),
  );
  // The reference text voice measures 0.029 RMS. Shortened plucks fall to 0.018.
  assert.ok(rms >= 0.025, `Text plucks lost their audible body: RMS ${rms}`);
  assert.ok(
    scan.peak < 0.15,
    `Text plucks exceeded their peak headroom: ${scan.peak}`,
  );
  assert.equal(
    scan.hits.length,
    0,
    "Repeated text plucks must remain continuous",
  );
} finally {
  Math.random = originalRandom;
}
