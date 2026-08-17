// ABOUTME: Renders the orchestral sound candidates as long solos and against the real event fixture.
// ABOUTME: Writes deterministic stereo WAV files and rejects silent or clipped output.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import { PROGRESSIONS } from "../../extension/website/shared/sound/scales";
import type {
  CantusVariant,
  PizzicatoVariant,
  SoundLayer,
  TimpaniVariant,
  TrailSoundFrame,
} from "../../extension/website/shared/sound/types";
import {
  buildMoveTracks,
  interpolateTrackPosition,
  type MoveTrack,
  type SampleEvent,
} from "../../extension/website/sounds/SamplePlayback";
import fixtureEvents from "../../extension/website/sounds/sampleEvents.json";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const SILENCE_THRESHOLD_DBFS = -40;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;
const VOLUME = 0.5;

/** Simulated frame rate the fixture is replayed at, matching a live rAF loop. */
const REPLAY_FPS = 60;
/** How long a participant stays drawn after their last event, as in the pad. */
const TRAIL_IDLE_TIMEOUT_MS = 4_000;

/**
 * Chord dwell used while rendering, in ms. The shipped base is 20s, which a
 * demo shorter than a minute never gets past — every sample would sit on one
 * chord. This is applied by overriding each progression's `dwellScale` for the
 * duration of the render process only; the shipped constant is untouched and
 * the scales are restored before the script exits.
 */
const DEMO_CHORD_DWELL_MS = 8_000;
const BASE_CHORD_DWELL_MS = 20_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  "../../internal-docs/sound-samples",
);

Object.assign(globalThis, {
  window: {
    innerWidth: CANVAS_WIDTH,
    innerHeight: CANVAS_HEIGHT,
  },
});

/**
 * Spencer's default arrangement: the toggle set every in-context render is
 * judged against, so the only difference between those files is which
 * candidate instrument is driven on top of it.
 */
const ARRANGEMENT = {
  mode: "spotlight",
  spotlight: true,
  chordVoicing: true,
  cursorInstruments: true,
  trailVoices: true,
  swells: true,
  choralTimbre: false,
  chordRotation: true,
  energyArc: true,
  trailArrivals: true,
  navigationSounds: true,
  bassPedal: false,
  crossings: "off",
} as const;

/** How the render matrix describes one arrangement toggle set in the README. */
const ARRANGEMENT_SUMMARY =
  "spotlight, chordRotation, energyArc, trailArrivals, navigationSounds, trailVoices, swells, chordVoicing, cursorInstruments, volume 0.5";

/** The same, for a solo: no trails, so no energy arc, and one layer soloed. */
const SOLO_CONFIG_SUMMARY = (layer: SoundLayer): string =>
  `${ARRANGEMENT_SUMMARY.replace("energyArc, ", "")}, energyArc off; ${layer} soloed; chord dwell ${DEMO_CHORD_DWELL_MS / 1000}s`;

interface RenderResult {
  filename: string;
  label: string;
  demonstrates: string;
  durationSeconds: number;
  config: string;
  peakDbfs: number;
}

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const hash = (value: string): number => {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
};

const peakLevel = (buffer: AudioBuffer): number => {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index++) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
  }
  return peak;
};

const toDbfs = (amplitude: number): number =>
  amplitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude);

const encodeWave = (buffer: AudioBuffer): Uint8Array => {
  const bytesPerSample = 2;
  const frameCount = buffer.length;
  const dataSize = frameCount * CHANNEL_COUNT * bytesPerSample;
  const wave = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wave);

  const writeText = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNEL_COUNT, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * CHANNEL_COUNT * bytesPerSample, true);
  view.setUint16(32, CHANNEL_COUNT * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: CHANNEL_COUNT }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 32_768 : sample * 32_767,
        true,
      );
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(wave);
};

/**
 * An offline context whose clock the caller drives.
 *
 * The engine schedules every note relative to `ctx.currentTime`, and an
 * offline context's clock does not advance while a synchronous loop feeds it —
 * so a driven render would stack a whole minute of events onto instant zero.
 * Replacing `currentTime` with the simulated clock is what makes tick-driven
 * playback render as the timeline it represents: notes land where they were
 * fired, and the velocity the engine derives from per-frame clock deltas is
 * the velocity a live page would have produced.
 */
interface DrivenContext {
  audioContext: OfflineAudioContext;
  /** Move the simulated clock to this many seconds from the render start. */
  setClock: (seconds: number) => void;
}

const createDrivenContext = (durationSeconds: number): DrivenContext => {
  const frameCount = Math.ceil(durationSeconds * SAMPLE_RATE);
  const audioContext = new OfflineAudioContext(
    CHANNEL_COUNT,
    frameCount,
    SAMPLE_RATE,
  );

  // node-web-audio-api reports an offline context as suspended until rendering
  // starts. Exposing its render-ready state prevents live-context resume logic
  // from waiting for a render that has not started yet.
  Object.defineProperty(audioContext, "state", { value: "running" });

  let clockSeconds = 0;
  Object.defineProperty(audioContext, "currentTime", {
    get: () => clockSeconds,
    configurable: true,
  });

  return {
    audioContext,
    setClock: (seconds: number) => {
      clockSeconds = seconds;
    },
  };
};

/** Verify a rendered buffer, write it, and log its peak. */
const finish = async (
  filename: string,
  buffer: AudioBuffer,
  meta: Omit<RenderResult, "filename" | "peakDbfs">,
): Promise<RenderResult> => {
  const peak = peakLevel(buffer);
  const peakDbfs = toDbfs(peak);

  if (peakDbfs <= SILENCE_THRESHOLD_DBFS) {
    throw new Error(
      `${filename} is silent: ${peakDbfs.toFixed(2)} dBFS is not above ${SILENCE_THRESHOLD_DBFS} dBFS`,
    );
  }
  if (peak > 1) {
    throw new Error(
      `${filename} clips: peak ${peak.toFixed(6)} (${peakDbfs.toFixed(2)} dBFS)`,
    );
  }

  await writeFile(resolve(outputDirectory, filename), encodeWave(buffer));
  console.log(
    `${filename.padEnd(30)} ${String(meta.durationSeconds).padStart(3)}s  ${peakDbfs.toFixed(2)} dBFS`,
  );

  return { filename, peakDbfs, ...meta };
};

// ---------------------------------------------------------------------------
// Solo demos
// ---------------------------------------------------------------------------

/**
 * One instrument alone, over enough time and enough chord changes to hear how
 * it sits on a moving harmony rather than on one static chord.
 *
 * The layer is soloed so nothing else reaches the master bus, but the engine
 * still runs its full arrangement underneath: the progression rotates, so each
 * strike or held note is drawn from whatever chord is in force at that moment.
 */
const renderSolo = async (
  id: string,
  layer: SoundLayer,
  durationSeconds: number,
  demonstrates: string,
  config: string,
  drive: (engine: SoundEngine, tick: (seconds: number) => void) => void,
): Promise<RenderResult> => {
  Math.random = seededRandom(hash(id));
  const { audioContext, setClock } = createDrivenContext(durationSeconds);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  // The arrangement, minus the energy arc. A solo draws no trails, so the
  // engine correctly reads the canvas as a permanent lull and decays the
  // master to the arc's lull floor (0.12x) — which renders the whole demo
  // twelve decibels down for a reason that has nothing to do with the
  // instrument being auditioned. Everything else, chord rotation included,
  // runs exactly as it does in context.
  engine.setConfig({ ...ARRANGEMENT, energyArc: false });
  engine.setLayerSoloed(layer, true);

  // The progression only advances inside tick(), so a solo has to keep ticking
  // even with no trails on the canvas — otherwise the chord never turns over
  // and the whole point of the longer render is lost.
  const tick = (seconds: number): void => {
    setClock(seconds);
    engine.tick(seconds * 1000, []);
  };

  drive(engine, tick);

  const rendered = (await audioContext.startRendering()) as unknown as AudioBuffer;
  return finish(`${id}.wav`, rendered, {
    label: id,
    demonstrates,
    durationSeconds,
    config,
  });
};

/** Tick the solo clock up to `untilSeconds` at the replay frame rate. */
const advanceTo = (
  tick: (seconds: number) => void,
  fromSeconds: number,
  untilSeconds: number,
): number => {
  const step = 1 / REPLAY_FPS;
  let at = fromSeconds;
  while (at < untilSeconds) {
    at = Math.min(untilSeconds, at + step);
    tick(at);
  }
  return at;
};

const PIZZICATO_SOLO_SECONDS = 20;
const TIMPANI_SOLO_SECONDS = 20;
const CANTUS_SOLO_SECONDS = 45;

/**
 * Fifteen plucks across twenty seconds at varied heights and spacings, so the
 * pitch the height picks is heard against a moving harmony rather than one chord.
 */
const PIZZICATO_STRIKES: Array<{ at: number; y: number }> = [
  { at: 0.6, y: 0.15 },
  { at: 1.4, y: 0.55 },
  { at: 2.1, y: 0.3 },
  { at: 3.6, y: 0.85 },
  { at: 4.4, y: 0.45 },
  { at: 6.2, y: 0.2 },
  { at: 6.9, y: 0.7 },
  { at: 8.4, y: 0.4 },
  { at: 9.8, y: 0.95 },
  { at: 11.5, y: 0.25 },
  { at: 12.3, y: 0.6 },
  { at: 13.1, y: 0.35 },
  { at: 15.0, y: 0.8 },
  { at: 16.7, y: 0.5 },
  { at: 18.2, y: 0.1 },
];

/** Four holds of rising length, spaced so each roll finishes before the next. */
const TIMPANI_HOLDS: Array<{ at: number; seconds: number }> = [
  { at: 1.0, seconds: 0.5 },
  { at: 5.5, seconds: 1.2 },
  { at: 10.5, seconds: 2.5 },
  { at: 15.5, seconds: 1.8 },
];

const renderPizzicatoSolo = (variant: PizzicatoVariant): Promise<RenderResult> =>
  renderSolo(
    `pizzicato-${variant}-solo`,
    "clickBell",
    PIZZICATO_SOLO_SECONDS,
    `${variant} pluck alone, 15 strikes at varied heights across two chord changes`,
    SOLO_CONFIG_SUMMARY("clickBell"),
    (engine, tick) => {
      let at = 0;
      for (const strike of PIZZICATO_STRIKES) {
        at = advanceTo(tick, at, strike.at);
        engine.triggerClickPizzicato(
          CANVAS_WIDTH * (0.2 + strike.y * 0.6),
          CANVAS_HEIGHT * strike.y,
          variant,
        );
      }
      advanceTo(tick, at, PIZZICATO_SOLO_SECONDS);
    },
  );

const renderTimpaniSolo = (variant: TimpaniVariant): Promise<RenderResult> =>
  renderSolo(
    `timpani-${variant}-solo`,
    "clickBell",
    TIMPANI_SOLO_SECONDS,
    `${variant} roll alone, four holds of 0.5s to 2.5s across two chord changes`,
    SOLO_CONFIG_SUMMARY("clickBell"),
    (engine, tick) => {
      let at = 0;
      for (const hold of TIMPANI_HOLDS) {
        at = advanceTo(tick, at, hold.at);
        engine.triggerHold(CANVAS_WIDTH * 0.5, variant, hold.seconds);
      }
      advanceTo(tick, at, TIMPANI_SOLO_SECONDS);
    },
  );

const renderCantusSolo = (variant: CantusVariant): Promise<RenderResult> =>
  renderSolo(
    `cantus-${variant}-solo`,
    "cantus",
    CANTUS_SOLO_SECONDS,
    `${variant} line alone across five chord changes, so the voice-leading between chords is audible`,
    SOLO_CONFIG_SUMMARY("cantus"),
    (engine, tick) => {
      engine.setCantus(variant);
      advanceTo(tick, 0, CANTUS_SOLO_SECONDS);
    },
  );

// ---------------------------------------------------------------------------
// In-context renders, driven from the bundled fixture
// ---------------------------------------------------------------------------

const CONTEXT_SECONDS = 60;

/** How a fixture render voices clicks and holds on top of the arrangement. */
interface ContextInstruments {
  pizzicato?: PizzicatoVariant;
  timpani?: TimpaniVariant;
  cantus?: CantusVariant;
}

/** A live participant during fixture playback, mirroring the pad's trail. */
interface ReplayTrail {
  trailIndex: number;
  pid: string;
  color: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  cursorType: string | undefined;
  lastEventMs: number;
  firstSeen: boolean;
  searchIndex: number;
}

/** Colours cycled across participants, matching the playground's palette. */
const REPLAY_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

const fixture = fixtureEvents as SampleEvent[];

/**
 * The busiest `windowMs` slice of the fixture, rebased to start at zero.
 *
 * A minute cut from the top of a fifteen-minute sample can land on a stretch
 * with two participants in it; the densest window is the part that actually
 * represents what the arrangement has to hold together.
 */
const densestSlice = (
  events: SampleEvent[],
  windowMs: number,
): SampleEvent[] => {
  let bestStart = 0;
  let bestCount = 0;
  let end = 0;
  for (let start = 0; start < events.length; start++) {
    if (end < start) end = start;
    while (end < events.length && events[end].t < events[start].t + windowMs) {
      end++;
    }
    if (end - start > bestCount) {
      bestCount = end - start;
      bestStart = start;
    }
  }
  const slice = events.slice(bestStart, bestStart + bestCount);
  const origin = slice[0].t;
  return slice.map((event) => ({ ...event, t: event.t - origin }));
};

const CONTEXT_EVENTS = densestSlice(fixture, CONTEXT_SECONDS * 1_000);
const CONTEXT_TRACKS: Map<string, MoveTrack> = buildMoveTracks(CONTEXT_EVENTS);

/**
 * Replay the fixture slice through the engine at a simulated 60fps.
 *
 * This is the same driver the playground's pad runs, minus the canvas: events
 * fire as their moment arrives, positions come from interpolating each
 * participant's move track rather than from the sparse samples themselves, and
 * the interpolated frames go to `tick` so the engine derives real velocity.
 */
const renderContext = async (
  id: string,
  demonstrates: string,
  instruments: ContextInstruments,
): Promise<RenderResult> => {
  Math.random = seededRandom(hash(id));
  const { audioContext, setClock } = createDrivenContext(CONTEXT_SECONDS);
  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(VOLUME);
  engine.setConfig({ ...ARRANGEMENT });
  if (instruments.cantus) engine.setCantus(instruments.cantus);

  const trails = new Map<string, ReplayTrail>();
  let nextTrailIndex = 0;
  let cursor = 0;
  const stepMs = 1_000 / REPLAY_FPS;

  for (let frameIndex = 0; ; frameIndex++) {
    const sampleMs = frameIndex * stepMs;
    if (sampleMs > CONTEXT_SECONDS * 1_000) break;
    setClock(sampleMs / 1_000);

    while (
      cursor < CONTEXT_EVENTS.length &&
      CONTEXT_EVENTS[cursor].t <= sampleMs
    ) {
      const event = CONTEXT_EVENTS[cursor++];
      const x = (event.x ?? 0.5) * CANVAS_WIDTH;
      const y = (event.y ?? 0.5) * CANVAS_HEIGHT;

      if (event.type === "navigation") {
        // Only real page arrivals sound; blur and beforeunload are departures.
        if (event.event === "focus" || event.event === "popstate") {
          engine.triggerNavigation({ x });
        }
        continue;
      }
      // Keyboard and viewport events belong to the percussion candidates,
      // which are not what these renders are auditioning.
      if (event.type !== "cursor") continue;

      let trail = trails.get(event.pid);
      if (!trail) {
        const trailIndex = nextTrailIndex++;
        trail = {
          trailIndex,
          pid: event.pid,
          color: REPLAY_COLORS[trailIndex % REPLAY_COLORS.length],
          x,
          y,
          prevX: x,
          prevY: y,
          cursorType: event.cursor,
          lastEventMs: sampleMs,
          firstSeen: true,
          searchIndex: 0,
        };
        trails.set(event.pid, trail);
      }

      trail.lastEventMs = sampleMs;
      if (event.cursor) trail.cursorType = event.cursor;

      if (event.event !== "click" && event.event !== "hold") continue;

      const isHold = event.event === "hold" || event.duration !== undefined;
      const rolled = Boolean(instruments.timpani) && isHold;
      if (rolled && instruments.timpani) {
        engine.triggerHold(
          x,
          instruments.timpani,
          event.duration === undefined ? undefined : event.duration / 1_000,
        );
      }

      if (instruments.pizzicato) {
        engine.triggerClickPizzicato(x, y, instruments.pizzicato);
      } else if (!rolled) {
        // The shipped bell, unless the timpani roll has already taken this
        // event — the roll replaces the stretched bell rather than layering.
        engine.triggerClick({ x, y, holdDuration: event.duration });
      }
    }

    for (const trail of trails.values()) {
      const track = CONTEXT_TRACKS.get(trail.pid);
      if (!track) continue;
      const position = interpolateTrackPosition(
        track,
        sampleMs,
        trail.searchIndex,
      );
      if (!position) continue;
      trail.searchIndex = position.index;
      trail.prevX = trail.x;
      trail.prevY = trail.y;
      trail.x = position.x * CANVAS_WIDTH;
      trail.y = position.y * CANVAS_HEIGHT;
      if (position.cursor) trail.cursorType = position.cursor;
    }

    for (const [pid, trail] of trails) {
      if (sampleMs - trail.lastEventMs > TRAIL_IDLE_TIMEOUT_MS) {
        engine.retireTrail(trail.trailIndex);
        trails.delete(pid);
      }
    }

    const frames: TrailSoundFrame[] = [];
    for (const trail of trails.values()) {
      frames.push({
        trailIndex: trail.trailIndex,
        x: trail.x,
        y: trail.y,
        prevX: trail.prevX,
        prevY: trail.prevY,
        cursorType: trail.cursorType,
        progress: 0,
        color: trail.color,
        isNewlyActive: trail.firstSeen,
        identityKey: `sample-${trail.pid}`,
      });
      trail.firstSeen = false;
    }

    engine.tick(sampleMs, frames);
  }

  const rendered = (await audioContext.startRendering()) as unknown as AudioBuffer;
  const added = [
    instruments.pizzicato ? `pizzicato ${instruments.pizzicato} on clicks` : "",
    instruments.timpani ? `timpani ${instruments.timpani} on holds` : "",
    instruments.cantus ? `cantus ${instruments.cantus}` : "",
  ].filter(Boolean);

  return finish(`${id}.wav`, rendered, {
    label: id,
    demonstrates,
    durationSeconds: CONTEXT_SECONDS,
    config: `${ARRANGEMENT_SUMMARY}; ${
      added.length === 0 ? "no added instruments" : added.join(", ")
    }; chord dwell ${DEMO_CHORD_DWELL_MS / 1000}s`,
  });
};

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

const readme = (results: RenderResult[], slice: SampleEvent[]): string => {
  const participants = new Set(slice.map((event) => event.pid)).size;
  const clicks = slice.filter(
    (event) => event.type === "cursor" && event.event === "click",
  ).length;
  const holds = slice.filter(
    (event) => event.type === "cursor" && event.event === "hold",
  ).length;
  const navigations = slice.filter(
    (event) =>
      event.type === "navigation" &&
      (event.event === "focus" || event.event === "popstate"),
  ).length;

  const rows = results
    .map(
      ({ filename, demonstrates, durationSeconds, peakDbfs, config }) =>
        `| [${filename}](./${filename}) | ${demonstrates} | ${durationSeconds}s | ${peakDbfs.toFixed(2)} dBFS | ${config} |`,
    )
    .join("\n");

  return `# Sound candidate samples

Two kinds of render, both from the production \`SoundEngine\`.

**Solos** put one candidate alone on the master bus by soloing its layer, while
the full arrangement keeps running underneath — so the plucks, rolls and cantus
notes are drawn from a chord progression that turns over several times during
the render, not from one static chord.

**In-context** renders replay the bundled event fixture
(\`extension/website/sounds/sampleEvents.json\`) through the engine at a
simulated 60fps, using the same replay helpers the sound playground's pad uses:
cursor moves are interpolated between sparse archival samples so the engine
derives real velocity, clicks and holds drive the candidate instrument, and
page arrivals sound the navigation note. The slice is the busiest 60 seconds of
the fixture: ${slice.length} events, ${participants} participants, ${clicks} clicks, ${holds} holds, ${navigations} arrivals.

\`context-baseline.wav\` is that same minute with no candidate instrument at
all — the arrangement on its own, so every other in-context file can be heard
against what it adds.

Chord dwell is shortened to ${DEMO_CHORD_DWELL_MS / 1000}s for these renders (the shipped base is
${BASE_CHORD_DWELL_MS / 1000}s) so a sample shorter than a minute still hears the harmony move. The
override lives in the render script and applies to the render process only.

## Render matrix

| File | What it demonstrates | Duration | Peak | Config |
| --- | --- | --- | --- | --- |
${rows}

Each render is checked directly from its floating-point audio buffer. A passing
file has a peak above ${SILENCE_THRESHOLD_DBFS} dBFS and no sample above 0 dBFS. The renderer seeds
procedural noise, so regenerating from the same code produces the same files.

## Regenerate

From \`scripts/sound-samples/\`:

\`\`\`sh
bun install --frozen-lockfile
bun run render
\`\`\`

The command replaces the WAV files and this README in
\`internal-docs/sound-samples/\`, and logs every file's peak level.
`;
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await mkdir(outputDirectory, { recursive: true });

// Shorten the dwell for the duration of this process only. Every progression
// is scaled by the same ratio, so a rotation that deliberately holds longer
// (breath) keeps its relative pacing.
const originalDwellScales = new Map(
  Object.values(PROGRESSIONS).map((progression) => [
    progression.id,
    progression.dwellScale,
  ]),
);
for (const progression of Object.values(PROGRESSIONS)) {
  progression.dwellScale =
    (originalDwellScales.get(progression.id) ?? 1) *
    (DEMO_CHORD_DWELL_MS / BASE_CHORD_DWELL_MS);
}

const results: RenderResult[] = [];
try {
  for (const variant of ["soft", "crisp", "double"] as PizzicatoVariant[]) {
    results.push(await renderPizzicatoSolo(variant));
  }
  for (const variant of ["root", "rootFifth", "swell"] as TimpaniVariant[]) {
    results.push(await renderTimpaniSolo(variant));
  }
  for (const variant of ["tenor", "soprano", "duet"] as CantusVariant[]) {
    results.push(await renderCantusSolo(variant));
  }

  results.push(
    await renderContext(
      "context-baseline",
      "the arrangement alone over a real minute, with no candidate instrument",
      {},
    ),
  );
  for (const variant of ["soft", "crisp", "double"] as PizzicatoVariant[]) {
    results.push(
      await renderContext(
        `context-pizzicato-${variant}`,
        `${variant} pluck on every real click, against the arrangement`,
        { pizzicato: variant },
      ),
    );
  }
  results.push(
    await renderContext(
      "context-timpani-root",
      "timpani roll on every real held click, against the arrangement",
      { timpani: "root" },
    ),
  );
  for (const variant of ["tenor", "soprano", "duet"] as CantusVariant[]) {
    results.push(
      await renderContext(
        `context-cantus-${variant}`,
        `${variant} cantus line over the arrangement and a real minute of events`,
        { cantus: variant },
      ),
    );
  }
} finally {
  for (const progression of Object.values(PROGRESSIONS)) {
    progression.dwellScale = originalDwellScales.get(progression.id) ?? 1;
  }
}

await writeFile(
  resolve(outputDirectory, "README.md"),
  readme(results, CONTEXT_EVENTS),
);
console.log(`\nRendered ${results.length} files to ${outputDirectory}`);
