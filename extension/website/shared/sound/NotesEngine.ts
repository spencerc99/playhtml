// ABOUTME: Prototype note-based sonification of cursor trails, an alternative to sustained voices
// ABOUTME: Emits discrete plucked notes on distance/turn events, with crowd-vs-soloist separation

import { TrailSoundFrame, InstrumentConfig } from "./types";
import {
  directionToPitch,
  computeDirection,
  computeVelocity,
  positionToPan,
  velocityToNoteGain,
  velocityToOctaveMultiplier,
  velocityToFilterFrequency,
  angleDelta,
  NOTE_FILTER_MIN_HZ,
} from "./scales";
import { getInstrument } from "./instruments";

/**
 * Tunables. These are the knobs to turn during a listening pass — every value
 * that shapes rhythm, register, or the crowd/soloist split lives here.
 */
export const NOTES_TUNING = {
  /** Pixels of travel between notes for a soloist or an uncrowded scene. */
  distanceQuantumPx: 55,
  /** Multiplier on the quantum for crowd trails, thinning the background. */
  crowdQuantumMultiplier: 2,
  /** Direction change (radians) that triggers a note early. ~60 degrees. */
  turnThresholdRadians: (60 * Math.PI) / 180,
  /** Minimum gap between notes from one trail, so fast sweeps stay musical. */
  minNoteIntervalMs: 55,
  /** Minimum velocity for a trail to make any sound at all. */
  silenceVelocity: 0.3,

  /** Seconds of velocity history used for the rolling scene average. */
  velocityWindowMs: 3000,
  /** Velocity ratio vs the scene average that promotes a trail to soloist. */
  soloistVelocityRatio: 2.5,
  /** Absolute velocity floor — a slow trail in a still scene is not a soloist. */
  soloistMinVelocity: 6,
  /** Active trails above which the crowd treatment engages. */
  crowdThresholdTrails: 6,

  /** Gain applied to crowd trails while a soloist holds the scene. */
  crowdDuckedGain: 0.4,
  /** Gain for crowd trails when nobody is soloing. */
  crowdBaseGain: 0.75,
  /** Gain multiplier for the soloist. */
  soloistGain: 1,
  /** Seconds over which per-trail crowd/solo params crossfade. */
  roleCrossfadeMs: 300,

  /** Crowd trails drop this many octaves and darken to this cutoff. */
  crowdOctaveShift: 0.5,
  crowdFilterHz: 700,
  /** The soloist's envelope runs this much longer than a crowd note. */
  soloistDecayMultiplier: 1.4,

  /** Note envelope shape (seconds). */
  attackSeconds: 0.006,
  decaySeconds: 0.55,

  /** Cap on simultaneously-sounding one-shot notes. */
  maxConcurrentNotes: 32,
};

/** Master output shaping for notes mode — gentler than the sustained path. */
const COMPRESSOR_THRESHOLD = -18;
const COMPRESSOR_RATIO = 3;

interface TrailState {
  /** Distance traveled since the last note. */
  distanceSinceNote: number;
  /** Direction at the last note, for turn detection. */
  directionAtLastNote: number;
  lastNoteTimeMs: number;
  lastX: number;
  lastY: number;
  hasPosition: boolean;
  /** Smoothed 0-1 role weight: 0 = full crowd, 1 = full soloist. */
  roleWeight: number;
}

interface ActiveNote {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  panNode: StereoPannerNode;
  /** Peak gain, used to pick the quietest note when we need to drop one. */
  peakGain: number;
  startedAtMs: number;
}

export class NotesEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverbGain: GainNode | null = null;
  private canvasWidth = 0;
  private baseVolume = 0.5;
  private trails: Map<number, TrailState> = new Map();
  private activeNotes: Set<ActiveNote> = new Set();
  /** Rolling velocity samples across all trails: [timestampMs, velocity]. */
  private velocitySamples: Array<[number, number]> = [];
  private cursorInstruments = false;
  /** Pitch palette for new notes; undefined uses the default D minor set. */
  private scale: number[] | undefined = undefined;
  private soloistTrailIndex: number | null = null;
  private sceneAverageVelocity = 0;

  attach(
    ctx: AudioContext,
    destination: AudioNode,
    convolver: ConvolverNode | null,
  ): void {
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.baseVolume;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = COMPRESSOR_THRESHOLD;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = COMPRESSOR_RATIO;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.15;

    this.masterGain.connect(this.compressor);

    if (convolver) {
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.25;
      this.masterGain.connect(this.reverbGain);
      this.reverbGain.connect(convolver);
    }

    this.compressor.connect(destination);
  }

  setCanvasWidth(width: number): void {
    this.canvasWidth = width;
  }

  setCursorInstruments(enabled: boolean): void {
    this.cursorInstruments = enabled;
  }

  /**
   * Set the pitch palette new notes are drawn from. Notes already sounding
   * are one-shots and finish on their old pitch, so the harmony drifts over
   * rather than snapping on a chord boundary.
   */
  setScale(scale: number[] | undefined): void {
    this.scale = scale;
  }

  setVolume(volume: number): void {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(this.baseVolume, now + 0.05);
    }
  }

  tick(elapsedMs: number, activeTrails: TrailSoundFrame[]): void {
    if (!this.ctx || !this.masterGain) return;

    this.pruneFinishedNotes();

    const seen = new Set<number>();
    // First pass: measure velocity for every trail so the scene average and
    // soloist decision are computed from the same frame's data.
    const measured: Array<{ frame: TrailSoundFrame; velocity: number }> = [];

    for (const frame of activeTrails) {
      seen.add(frame.trailIndex);
      let state = this.trails.get(frame.trailIndex);
      if (!state) {
        state = {
          distanceSinceNote: 0,
          directionAtLastNote: 0,
          lastNoteTimeMs: 0,
          lastX: frame.x,
          lastY: frame.y,
          hasPosition: false,
          roleWeight: 0,
        };
        this.trails.set(frame.trailIndex, state);
      }

      const velocity = state.hasPosition
        ? computeVelocity(state.lastX, state.lastY, frame.x, frame.y)
        : 0;
      measured.push({ frame, velocity });
    }

    this.recordVelocities(elapsedMs, measured);
    const sceneAverage = this.rollingAverageVelocity(elapsedMs);
    const isCrowded =
      activeTrails.length > NOTES_TUNING.crowdThresholdTrails;

    // Only one trail solos at a time: the fastest qualifying outlier.
    let soloistIndex: number | null = null;
    let soloistVelocity = 0;
    for (const { frame, velocity } of measured) {
      const isOutlier =
        velocity >= NOTES_TUNING.soloistMinVelocity &&
        velocity > sceneAverage * NOTES_TUNING.soloistVelocityRatio;
      if (isOutlier && velocity > soloistVelocity) {
        soloistIndex = frame.trailIndex;
        soloistVelocity = velocity;
      }
    }

    this.soloistTrailIndex = soloistIndex;
    this.sceneAverageVelocity = sceneAverage;

    const crossfadeRate =
      NOTES_TUNING.roleCrossfadeMs > 0
        ? Math.min(1, 16 / NOTES_TUNING.roleCrossfadeMs)
        : 1;

    for (const { frame, velocity } of measured) {
      const state = this.trails.get(frame.trailIndex)!;
      const isSoloist = frame.trailIndex === soloistIndex;

      // Smoothly approach the target role so handoffs do not jump register.
      const targetRole = isSoloist ? 1 : isCrowded ? 0 : 1;
      state.roleWeight += (targetRole - state.roleWeight) * crossfadeRate;

      if (!state.hasPosition) {
        state.lastX = frame.x;
        state.lastY = frame.y;
        state.hasPosition = true;
        state.directionAtLastNote = 0;
        continue;
      }

      const direction = computeDirection(
        state.lastX,
        state.lastY,
        frame.x,
        frame.y,
      );

      state.distanceSinceNote += velocity;
      state.lastX = frame.x;
      state.lastY = frame.y;

      if (velocity < NOTES_TUNING.silenceVelocity) continue;

      const quantum =
        NOTES_TUNING.distanceQuantumPx *
        (1 +
          (NOTES_TUNING.crowdQuantumMultiplier - 1) * (1 - state.roleWeight));

      const turned =
        Math.abs(angleDelta(state.directionAtLastNote, direction)) >
        NOTES_TUNING.turnThresholdRadians;

      const dueByDistance = state.distanceSinceNote >= quantum;
      const gapOk =
        elapsedMs - state.lastNoteTimeMs >= NOTES_TUNING.minNoteIntervalMs;

      if (!(dueByDistance || turned) || !gapOk) continue;

      state.distanceSinceNote = 0;
      state.directionAtLastNote = direction;
      state.lastNoteTimeMs = elapsedMs;

      this.triggerNote(frame, direction, velocity, state.roleWeight, isSoloist);
    }

    for (const index of this.trails.keys()) {
      if (!seen.has(index)) this.trails.delete(index);
    }
  }

  private recordVelocities(
    elapsedMs: number,
    measured: Array<{ frame: TrailSoundFrame; velocity: number }>,
  ): void {
    for (const { velocity } of measured) {
      this.velocitySamples.push([elapsedMs, velocity]);
    }
    const cutoff = elapsedMs - NOTES_TUNING.velocityWindowMs;
    let dropCount = 0;
    while (
      dropCount < this.velocitySamples.length &&
      this.velocitySamples[dropCount][0] < cutoff
    ) {
      dropCount++;
    }
    if (dropCount > 0) this.velocitySamples.splice(0, dropCount);
  }

  private rollingAverageVelocity(elapsedMs: number): number {
    const cutoff = elapsedMs - NOTES_TUNING.velocityWindowMs;
    let sum = 0;
    let count = 0;
    for (const [ts, velocity] of this.velocitySamples) {
      if (ts < cutoff) continue;
      sum += velocity;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  private triggerNote(
    frame: TrailSoundFrame,
    direction: number,
    velocity: number,
    roleWeight: number,
    isSoloist: boolean,
  ): void {
    if (!this.ctx || !this.masterGain) return;

    const instrument: InstrumentConfig = this.cursorInstruments
      ? getInstrument(frame.cursorType)
      : getInstrument(undefined);

    const basePitch = directionToPitch(direction, this.scale);
    // Crowd trails sit below the soloist; roleWeight blends between the two
    // registers so a handoff glides rather than steps.
    const velocityOctave = velocityToOctaveMultiplier(velocity);
    const crowdOctave = Math.pow(2, -NOTES_TUNING.crowdOctaveShift);
    const octaveMultiplier =
      crowdOctave + (velocityOctave - crowdOctave) * roleWeight;
    const frequency = basePitch * octaveMultiplier;

    const openCutoff = velocityToFilterFrequency(velocity);
    const cutoff =
      NOTES_TUNING.crowdFilterHz +
      (openCutoff - NOTES_TUNING.crowdFilterHz) * roleWeight;

    const roleGain =
      NOTES_TUNING.crowdBaseGain +
      (NOTES_TUNING.soloistGain - NOTES_TUNING.crowdBaseGain) * roleWeight;
    // While a soloist holds the scene, everyone else dips further.
    const duck = isSoloist
      ? 1
      : NOTES_TUNING.crowdDuckedGain +
        (1 - NOTES_TUNING.crowdDuckedGain) * roleWeight;

    const peakGain =
      velocityToNoteGain(velocity) * instrument.gain * roleGain * duck;
    if (peakGain <= 0.0001) return;

    const decay =
      NOTES_TUNING.decaySeconds *
      (1 + (NOTES_TUNING.soloistDecayMultiplier - 1) * roleWeight);

    this.enforceNoteBudget();

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = instrument.oscillatorType;
    osc.frequency.value = frequency;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.max(NOTE_FILTER_MIN_HZ, cutoff);
    filter.Q.value = instrument.filterQ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(
      peakGain,
      now + NOTES_TUNING.attackSeconds,
    );
    // Exponential decay to silence gives the plucked/struck character.
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + NOTES_TUNING.attackSeconds + decay,
    );

    const pan = ctx.createStereoPanner();
    pan.pan.value = positionToPan(frame.x, this.canvasWidth);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.masterGain);

    const note: ActiveNote = {
      oscillator: osc,
      gainNode: gain,
      filterNode: filter,
      panNode: pan,
      peakGain,
      startedAtMs: now * 1000,
    };
    this.activeNotes.add(note);

    osc.onended = () => {
      this.disconnectNote(note);
      this.activeNotes.delete(note);
    };

    osc.start(now);
    osc.stop(now + NOTES_TUNING.attackSeconds + decay + 0.05);
  }

  /**
   * Keep the one-shot note count bounded. When at the cap, cut the quietest
   * note (ties broken by age) rather than refusing to play the new one — a
   * dropped quiet note is far less noticeable than a missing loud one.
   */
  private enforceNoteBudget(): void {
    while (this.activeNotes.size >= NOTES_TUNING.maxConcurrentNotes) {
      let victim: ActiveNote | null = null;
      for (const note of this.activeNotes) {
        if (
          !victim ||
          note.peakGain < victim.peakGain ||
          (note.peakGain === victim.peakGain &&
            note.startedAtMs < victim.startedAtMs)
        ) {
          victim = note;
        }
      }
      if (!victim) return;
      this.stopNote(victim);
    }
  }

  private stopNote(note: ActiveNote): void {
    const now = this.ctx?.currentTime ?? 0;
    try {
      note.gainNode.gain.cancelScheduledValues(now);
      note.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.02);
      note.oscillator.stop(now + 0.03);
    } catch {
      /* already stopped */
    }
    this.activeNotes.delete(note);
  }

  private pruneFinishedNotes(): void {
    if (!this.ctx) return;
    const nowMs = this.ctx.currentTime * 1000;
    for (const note of this.activeNotes) {
      // Safety net in case an onended callback never fires (e.g. a suspended
      // context) — anything far past its envelope is torn down here.
      const maxLifeMs =
        (NOTES_TUNING.attackSeconds +
          NOTES_TUNING.decaySeconds * NOTES_TUNING.soloistDecayMultiplier) *
          1000 +
        2000;
      if (nowMs - note.startedAtMs > maxLifeMs) {
        this.stopNote(note);
        this.disconnectNote(note);
      }
    }
  }

  private disconnectNote(note: ActiveNote): void {
    try {
      note.oscillator.disconnect();
      note.filterNode.disconnect();
      note.gainNode.disconnect();
      note.panNode.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  /**
   * Drop one trail's accumulated state. Notes already sounding are one-shots
   * that finish on their own envelope, so only the per-trail bookkeeping goes.
   */
  retireTrail(trailIndex: number): void {
    this.trails.delete(trailIndex);
    if (this.soloistTrailIndex === trailIndex) {
      this.soloistTrailIndex = null;
    }
  }

  /** Silence everything and drop per-trail state, keeping the graph attached. */
  reset(): void {
    for (const note of [...this.activeNotes]) {
      this.stopNote(note);
      this.disconnectNote(note);
    }
    this.activeNotes.clear();
    this.trails.clear();
    this.velocitySamples = [];
    this.soloistTrailIndex = null;
    this.sceneAverageVelocity = 0;
  }

  detach(): void {
    this.reset();
    this.masterGain?.disconnect();
    this.compressor?.disconnect();
    this.reverbGain?.disconnect();
    this.masterGain = null;
    this.compressor = null;
    this.reverbGain = null;
    this.ctx = null;
  }

  /** Diagnostics for the playground readout. */
  getActiveNoteCount(): number {
    return this.activeNotes.size;
  }

  getSoloistTrailIndex(): number | null {
    return this.soloistTrailIndex;
  }

  getSceneAverageVelocity(): number {
    return this.sceneAverageVelocity;
  }
}
