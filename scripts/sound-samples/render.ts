// ABOUTME: Renders the orchestral sound candidates alone and against a representative trail bed.
// ABOUTME: Writes deterministic stereo WAV files and rejects silent or clipped output.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import { SoundEngine } from "../../extension/website/shared/sound/SoundEngine";
import type {
  AuditionAccent,
  SoundLayer,
  TrailSoundFrame,
} from "../../extension/website/shared/sound/types";

const SAMPLE_RATE = 44_100;
const CHANNEL_COUNT = 2;
const SILENCE_THRESHOLD_DBFS = -40;
const CANVAS_WIDTH = 1_200;
const CANVAS_HEIGHT = 800;

type SampleContext = "solo" | "in-context";

interface SoundCandidate {
  id: string;
  label: string;
  accent: AuditionAccent;
  layer: SoundLayer;
  durationSeconds: number;
  role: string;
}

interface RenderResult {
  filename: string;
  candidate: SoundCandidate;
  context: SampleContext;
  peakDbfs: number;
}

const CANDIDATES: SoundCandidate[] = [
  {
    id: "pizzicato-soft",
    label: "Pizzicato soft",
    accent: "pizzicatoSoft",
    layer: "clickBell",
    durationSeconds: 4,
    role: "click",
  },
  {
    id: "pizzicato-crisp",
    label: "Pizzicato crisp",
    accent: "pizzicatoCrisp",
    layer: "clickBell",
    durationSeconds: 4,
    role: "click",
  },
  {
    id: "pizzicato-double",
    label: "Pizzicato double",
    accent: "pizzicatoDouble",
    layer: "clickBell",
    durationSeconds: 4,
    role: "click",
  },
  {
    id: "timpani-root",
    label: "Timpani root",
    accent: "timpaniRoot",
    layer: "clickBell",
    durationSeconds: 4,
    role: "held click",
  },
  {
    id: "timpani-root-fifth",
    label: "Timpani root + fifth",
    accent: "timpaniRootFifth",
    layer: "clickBell",
    durationSeconds: 4,
    role: "held click",
  },
  {
    id: "timpani-swell",
    label: "Timpani swell",
    accent: "timpaniSwell",
    layer: "clickBell",
    durationSeconds: 4,
    role: "held click",
  },
  {
    id: "cantus-tenor",
    label: "Cantus tenor",
    accent: "cantusTenor",
    layer: "cantus",
    durationSeconds: 18,
    role: "autonomous line",
  },
  {
    id: "cantus-soprano",
    label: "Cantus soprano",
    accent: "cantusSoprano",
    layer: "cantus",
    durationSeconds: 18,
    role: "autonomous line",
  },
  {
    id: "cantus-duet",
    label: "Cantus duet",
    accent: "cantusDuet",
    layer: "cantus",
    durationSeconds: 18,
    role: "autonomous line",
  },
];

const SAMPLE_CONTEXTS: SampleContext[] = ["solo", "in-context"];

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

const contextFrames = (moved: boolean): TrailSoundFrame[] => {
  const movement = moved ? 12 : 0;
  return [
    {
      trailIndex: 0,
      x: 260 + movement,
      y: 280,
      prevX: 260,
      prevY: 280,
      cursorType: "pointer",
      progress: 0.35,
      color: "#4a90a4",
      isNewlyActive: !moved,
      identityKey: "sample-context-cool",
    },
    {
      trailIndex: 1,
      x: 600 + movement * 0.75,
      y: 430,
      prevX: 600,
      prevY: 430,
      cursorType: "text",
      progress: 0.5,
      color: "#8a7355",
      isNewlyActive: !moved,
      identityKey: "sample-context-neutral",
    },
    {
      trailIndex: 2,
      x: 940 + movement * 0.5,
      y: 330,
      prevX: 940,
      prevY: 330,
      cursorType: "grab",
      progress: 0.65,
      color: "#b7654a",
      isNewlyActive: !moved,
      identityKey: "sample-context-warm",
    },
  ];
};

const addTrailBed = (engine: SoundEngine): void => {
  engine.setConfig({
    mode: "sustained",
    chordVoicing: true,
    cursorInstruments: true,
    trailVoices: true,
    spotlight: false,
    swells: false,
    choralTimbre: false,
    chordRotation: false,
    energyArc: false,
    trailArrivals: false,
    navigationSounds: false,
    bassPedal: false,
    crossings: "off",
  });
  engine.tick(0, contextFrames(false));
  engine.tick(16, contextFrames(true));
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

const renderSample = async (
  candidate: SoundCandidate,
  context: SampleContext,
): Promise<RenderResult> => {
  Math.random = seededRandom(hash(candidate.id));
  const frameCount = Math.ceil(candidate.durationSeconds * SAMPLE_RATE);
  const audioContext = new OfflineAudioContext(
    CHANNEL_COUNT,
    frameCount,
    SAMPLE_RATE,
  );

  // node-web-audio-api reports an offline context as suspended until rendering
  // starts. Exposing its render-ready state prevents live-context resume logic
  // from waiting for a render that has not started yet.
  Object.defineProperty(audioContext, "state", { value: "running" });

  const engine = new SoundEngine(audioContext as unknown as BaseAudioContext);
  await engine.init();
  engine.setCanvasWidth(CANVAS_WIDTH);
  engine.setVolume(0.5);

  if (context === "solo") {
    engine.setLayerSoloed(candidate.layer, true);
  } else {
    addTrailBed(engine);
  }

  engine.audition(candidate.accent);
  const rendered = await audioContext.startRendering();
  const peak = peakLevel(rendered as unknown as AudioBuffer);
  const peakDbfs = toDbfs(peak);
  const filename = `${candidate.id}--${context}.wav`;

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

  await writeFile(
    resolve(outputDirectory, filename),
    encodeWave(rendered as unknown as AudioBuffer),
  );
  console.log(`${filename.padEnd(43)} ${peakDbfs.toFixed(2)} dBFS`);

  return { filename, candidate, context, peakDbfs };
};

const readme = (results: RenderResult[]): string => {
  const rows = results
    .map(
      ({ filename, candidate, context, peakDbfs }) =>
        `| ${candidate.label} | ${candidate.role} | ${context} | [${filename}](./${filename}) | ${peakDbfs.toFixed(2)} dBFS |`,
    )
    .join("\n");

  return `# Sound candidate samples

This directory contains the nine pitched orchestral candidates from the sound playground in two listening conditions:

- **solo** routes only the candidate's engine layer to the master output.
- **in-context** plays the same candidate against a restrained three-trail sustained bed using the prototype's chord voicing, cursor instruments, and trail fingerprints.

Both versions use the production \`SoundEngine\` synthesis at its current home chord. The renderer seeds procedural noise so regenerating from the same code produces the same files. Pizzicato and timpani renders are 4 seconds; cantus renders are 18 seconds to preserve the complete 3-second attack, 10-second sustain, and 4-second release.

## Render matrix

| Candidate | Event role | Listening condition | File | Peak |
| --- | --- | --- | --- | --- |
${rows}

Each render is checked directly from its floating-point audio buffer. A passing file has a peak above ${SILENCE_THRESHOLD_DBFS} dBFS and no sample above 0 dBFS.

## Regenerate

From \`scripts/sound-samples/\`:

\`\`\`sh
bun install --frozen-lockfile
bun run render
\`\`\`

The command replaces the WAV files and this README in \`internal-docs/sound-samples/\`, and logs every file's peak level.
`;
};

await mkdir(outputDirectory, { recursive: true });

const results: RenderResult[] = [];
for (const candidate of CANDIDATES) {
  for (const context of SAMPLE_CONTEXTS) {
    results.push(await renderSample(candidate, context));
  }
}

await writeFile(resolve(outputDirectory, "README.md"), readme(results));
console.log(`\nRendered ${results.length} files to ${outputDirectory}`);
