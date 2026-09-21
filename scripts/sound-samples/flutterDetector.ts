// ABOUTME: The flutter detector: measures fast amplitude modulation in a rendered buffer's envelope.
// ABOUTME: Catches the crackle a click scan cannot see, where every ramp is legal but the level flaps.

/**
 * Why a second detector, and what it measures that the click scan does not.
 *
 * `scanForClicks` asks whether the waveform ever does something its own past
 * fails to predict — a step, a cut, a node stopped mid-cycle. That is the
 * right question for a discontinuity and the wrong one for the fault this
 * catches, because the fault contains no discontinuity at all.
 *
 * A gain that alternates between two targets on every tick, each move a legal
 * linear ramp over tens of milliseconds, produces a waveform that is
 * continuous everywhere and differentiable almost everywhere. The predictor
 * sees smooth content and reports zero. What a listener hears is the envelope
 * itself: a level flapping up and down thirty times a second is amplitude
 * modulation at thirty hertz, and the ear resolves that as roughness or
 * crackle rather than as a change in loudness.
 *
 * So this measures the envelope, not the waveform. Rectify, smooth to an
 * envelope, high-pass the envelope to keep only modulation faster than a
 * musical dynamic, and report the depth of what is left as a fraction of the
 * local level. A crescendo, a swell, a tremolo and an ensemble breath all fall
 * below the corner and read as nothing; a breath flapping at the tick rate
 * reads as most of the signal.
 */

/**
 * Modulation slower than this is music, not crackle.
 *
 * The engine's own slow movements sit well under it: the ensemble breath runs
 * at ~0.05Hz, a swell's crescendo over seconds, the polyphony duck and the
 * energy arc slower still, and a vibrato at 5-7Hz is a timbre a listener hears
 * as one voice rather than as a fluttering one. The faults are all above it:
 * a fade flapping at the tick rate modulates somewhere between 15 and 60Hz,
 * and a control ramp restarting on every frame is at 60.
 *
 * Placed above the vibrato band rather than between it and the fault, because
 * the skirt is gentle (see the filter below) and the two populations are only
 * a couple of octaves apart. At 12Hz a 6Hz tremolo comes through at under half
 * while a 30Hz flap comes through at over nine tenths, which is separation the
 * threshold can rest on rather than balance on.
 */
const FLUTTER_CORNER_HZ = 12;

/**
 * How much of the local level the fast modulation may account for.
 *
 * Read as a diagnostic, not as a gate, and the difference is not a matter of
 * taste. The click detector separates its two populations by three to four
 * orders of magnitude, which is what lets a count from it be believed as a
 * pass or a fail. This measure does not: across the scan matrix, clean scenes
 * reach 0.35 and scenes with real fast modulation in them reach 0.52, an
 * overlap rather than a gap. The reason is inherent to what is being measured
 * — a dense scene's envelope genuinely moves fast, because notes start and
 * stop in it, and no threshold can tell "many onsets" from "one level
 * flapping" by depth alone.
 *
 * So it is set where a reading is worth looking at rather than where a build
 * should fail, and the scan reports the number without acting on it. What it
 * is good for is comparison: the same scene before and after a change, where a
 * depth that climbs is a regression the click scan would not have seen.
 */
export const FLUTTER_DEPTH_THRESHOLD = 0.35;

/**
 * Envelope follower time constant, in seconds.
 *
 * Pulled from both sides. Too fast and the carrier's own ripple survives into
 * the envelope and is read as modulation — a clean tone would flag, worst at
 * the bottom of the register where the ripple is slowest. Too slow and the
 * follower smooths the fault away with it: a 30Hz flap has a 33ms period, so a
 * constant much past a few milliseconds averages the flap out and the detector
 * reads a fault as clean. 5ms is where the two are furthest apart, measured
 * across the engine's register: a steady tone reads 0.07 and a flap 0.46.
 */
const ENVELOPE_TIME_CONSTANT = 0.005;

/**
 * How long a stretch is judged as one, in seconds. Long enough to contain
 * several cycles at the corner frequency, short enough that a flutter lasting
 * a fraction of a second is not averaged away by the calm around it.
 */
const WINDOW_SECONDS = 0.25;

/**
 * Level below which modulation is not worth reporting.
 *
 * A depth is a ratio, so it grows without bound as the level it is taken
 * against falls — and every note in the engine ends by falling. A modulation
 * of fixed absolute size therefore reads as ever-deeper flutter through a
 * release, which says nothing about the fault and everything about the decay.
 * The floor is set relative to the arrangement's own peak rather than to
 * digital silence: around a tenth of it, which is roughly where a voice stops
 * carrying the mix and starts being covered by whatever else is sounding.
 */
const MIN_AUDIBLE_LEVEL = 0.03;

export interface FlutterHit {
  channel: number;
  seconds: number;
  /** Fast envelope modulation over local level — see FLUTTER_DEPTH_THRESHOLD. */
  depth: number;
  level: number;
}

export interface FlutterReport {
  label: string;
  maxDepth: number;
  hits: FlutterHit[];
}

/**
 * One-pole smoothing coefficient for a time constant at a sample rate.
 */
const smoothingCoefficient = (
  timeConstantSeconds: number,
  sampleRate: number,
): number => Math.exp(-1 / (timeConstantSeconds * sampleRate));

/**
 * Every stretch whose envelope carries more fast modulation than
 * `FLUTTER_DEPTH_THRESHOLD`, worst first.
 *
 * Read alongside `scanForClicks` rather than instead of it: the two measure
 * different faults and neither subsumes the other. A hard cut is a
 * discontinuity with almost no envelope modulation around it; a flapping fade
 * is envelope modulation with no discontinuity in it.
 */
export const scanForFlutter = (
  buffer: AudioBuffer,
  label: string,
): FlutterReport => {
  const sampleRate = buffer.sampleRate;
  const hits: FlutterHit[] = [];
  let maxDepth = 0;

  const envelopeCoefficient = smoothingCoefficient(
    ENVELOPE_TIME_CONSTANT,
    sampleRate,
  );
  // The high-pass is expressed as its complement: a slow follower over the
  // envelope is the part below the corner, and what the envelope exceeds it by
  // is the part above. One subtraction rather than a filter design.
  //
  // One pole, deliberately. Cascading for a steeper skirt is the obvious
  // improvement and it breaks the measure: the complement is only a high-pass
  // while the two paths share a phase, and each added pole delays the slow one
  // further, so on a swell the difference reads the reference's lag rather
  // than any modulation. A gentle skirt with matched phase measures the right
  // thing; a steep one with mismatched phase measures the filter.
  const slowCoefficient = smoothingCoefficient(
    1 / (2 * Math.PI * FLUTTER_CORNER_HZ),
    sampleRate,
  );
  const windowSamples = Math.max(1, Math.round(WINDOW_SECONDS * sampleRate));
  /**
   * How long both followers are run before their output is believed.
   *
   * Each starts at zero, so on the first samples the slow reference is far
   * below the envelope and their difference is the convergence rather than any
   * modulation — which reads as a large depth at the very start of every
   * render regardless of what is in it. Several time constants of the slower
   * of the two is enough for that gap to close.
   */
  const primeSamples = Math.round(
    (5 / (2 * Math.PI * FLUTTER_CORNER_HZ)) * sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let smoothedPower = 0;
    let slow = 0;
    // Per-window accumulators: the mean level the depth is taken against, and
    // the RMS of the fast component. RMS rather than peak because a single
    // sample of envelope noise should not stand in for a sustained flutter.
    let levelSum = 0;
    let fastSquaredSum = 0;
    let windowCount = 0;
    let windowStart = 0;

    const closeWindow = (endIndex: number): void => {
      if (windowCount === 0) return;
      const level = levelSum / windowCount;
      if (level >= MIN_AUDIBLE_LEVEL) {
        // Scaled to a peak-equivalent depth, so a sinusoidal modulation that
        // swings the level by half of itself reads as 0.5 rather than as its
        // RMS. That keeps the number readable as "how much of the level is
        // flapping".
        const depth =
          (Math.sqrt(fastSquaredSum / windowCount) * Math.SQRT2) / level;
        if (depth > maxDepth) maxDepth = depth;
        if (depth > FLUTTER_DEPTH_THRESHOLD) {
          hits.push({
            channel,
            seconds: windowStart / sampleRate,
            depth,
            level,
          });
        }
      }
      levelSum = 0;
      fastSquaredSum = 0;
      windowCount = 0;
      windowStart = endIndex;
    };

    for (let index = 0; index < samples.length; index++) {
      // Smoothed power, then a square root — an RMS envelope rather than a
      // rectified one. Squaring puts the carrier's ripple at twice its own
      // frequency beside a DC term of half the squared amplitude, so the
      // smoother has an octave more of it to remove and the root lands on a
      // level with markedly less ripple left on it than rectifying and
      // smoothing at the same time constant leaves. Symmetric, not peak-hold:
      // a follower that jumps to each new peak and smooths only downward
      // passes every rising edge through untouched.
      const power = samples[index] * samples[index];
      smoothedPower =
        smoothedPower * envelopeCoefficient + power * (1 - envelopeCoefficient);
      const envelope = Math.sqrt(smoothedPower);
      slow = slow * slowCoefficient + envelope * (1 - slowCoefficient);
      const fast = envelope - slow;

      if (index < primeSamples) {
        // Still converging; run the followers but do not judge their output.
        windowStart = index + 1;
        continue;
      }

      levelSum += slow;
      fastSquaredSum += fast * fast;
      windowCount++;

      if (windowCount >= windowSamples) closeWindow(index + 1);
    }
    closeWindow(samples.length);
  }

  hits.sort((a, b) => b.depth - a.depth);
  return { label, maxDepth, hits };
};
