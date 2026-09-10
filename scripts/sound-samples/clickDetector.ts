// ABOUTME: The click detector: a normalised linear-prediction residual over rendered float buffers.
// ABOUTME: Shared by the click scanner and the morning render so both judge crackle by one measure.

/**
 * What separates a click from a loud note, and why the obvious measures do not.
 *
 * Flagging any sample-to-sample step above some size has no workable setting.
 * Against full scale it is useless here: the arrangement peaks around 0.3 and
 * one flourish note peaks at 0.056, so every note in the engine could be
 * hard-cut without tripping a 0.25 threshold and a thoroughly broken engine
 * would still scan clean. Set low enough to catch a cut of one note, it fires
 * on ordinary content, whose own per-sample slew is amplitude x omega / rate —
 * a clean 3.15kHz tone at 0.35 steps by 0.15 every sample, three times larger
 * than the fault. Normalising the second difference by local amplitude helps
 * but does not settle it: that measure still rises with frequency, reading
 * 0.20 for a clean 3.15kHz tone and 0.69 at 6kHz, which is where the
 * spotlight's brightened filter puts real content.
 *
 * So the measure is prediction error instead. A sum of up to `PREDICTOR_ORDER`
 * / 2 sinusoids satisfies a linear recurrence over its own past exactly, at any
 * frequencies, so fitting that recurrence over a short window by least squares
 * and predicting the next sample leaves a residual near zero for periodic
 * content of any pitch or chord, while a discontinuity is by definition what
 * the past does not predict.
 *
 * Order matters here. An order-two fit models one sinusoid, which is enough
 * for a single voice but not for what this engine actually renders: a chime
 * cluster is three to five detuned notes plus their partials sounding at once,
 * and an order-two model reads 0.066 on such a cluster — still under
 * threshold, but only by a factor of eight, and the margin closes further on
 * a busy mix. Order eight models four simultaneous sinusoids exactly and
 * reads 0.0003 on the same cluster.
 *
 * Measured at order eight: clean content reads 0.0000 for one tone, 0.0003 for
 * a seven-tone cluster and 0.0000 at 6kHz, while hard cuts read 2.4 for a lone
 * note and 5.1 for one note cut out of a cluster — the normalisation having
 * removed level from the measure.
 *
 * 0.5 sits between two populations three to four orders of magnitude apart.
 * `verifyThreshold` re-proves both ends on every run.
 */
export const CLICK_RATIO_THRESHOLD = 0.5;

/**
 * How many past samples the predictor fits against. Each pair of coefficients
 * buys one simultaneous sinusoid, so eight covers a chime cluster's notes plus
 * the bed underneath them.
 */
const PREDICTOR_ORDER = 8;

/**
 * Window the predictor is fitted over, in samples — about 6ms, long enough to
 * constrain eight coefficients and to span a cycle of everything above roughly
 * 170Hz, short enough that an envelope does not move much across it.
 */
const AMPLITUDE_WINDOW = 256;

/**
 * How often the sliding autocorrelation is rebuilt from the window rather than
 * updated incrementally, in samples. One window's worth: often enough that no
 * drift accumulates, rare enough that the rebuild costs a constant factor
 * rather than a whole order of magnitude.
 */
const PREDICTOR_REFRESH_SAMPLES = AMPLITUDE_WINDOW;

/**
 * Amplitude below which a discontinuity is not worth reporting. A step inside
 * a signal this quiet is inaudible under the arrangement, and normalising by a
 * near-zero amplitude turns numerical noise into a large ratio.
 */
const MIN_AUDIBLE_AMPLITUDE = 0.002;

/**
 * Peak amplitude of one flourish note alone, measured by rendering a single
 * click bell into a silent context. The calibration's injected fault is scaled
 * to this rather than to full scale, so the check proves the detector catches
 * a cut of the quietest thing worth catching.
 */
export const SINGLE_NOTE_PEAK = 0.056;

export interface ClickHit {
  channel: number;
  sampleIndex: number;
  seconds: number;
  /** Prediction error over local amplitude — see CLICK_RATIO_THRESHOLD. */
  ratio: number;
  amplitude: number;
}

export interface ScanReport {
  label: string;
  durationSeconds: number;
  peak: number;
  maxRatio: number;
  hits: ClickHit[];
}

/**
 * Every discontinuity above the threshold, with the worst first.
 *
 * Scanning the rendered floats rather than the scheduled automation is what
 * makes this an acceptance test: it catches a discontinuity whatever produced
 * it, including one from a node stopped mid-cycle that no AudioParam audit
 * would see.
 *
 * A single click spans a few samples once the rest of the graph's filtering is
 * accounted for, so consecutive flagged samples are collapsed into one hit at
 * their worst point — otherwise one audible click would be counted several
 * times and the count would say more about filter length than about faults.
 */
const CLICK_MERGE_SAMPLES = 32;

/**
 * Solve the normal equations for the predictor by Cholesky, in place.
 *
 * Returns false when the matrix is not positive definite, which happens on a
 * window with no usable structure; the caller skips such a sample rather than
 * trusting a degenerate fit.
 */
const solveNormalEquations = (
  matrix: Float64Array,
  rhs: Float64Array,
  out: Float64Array,
  order: number,
): boolean => {
  // A small ridge term keeps the solve stable on a near-silent or perfectly
  // periodic window, where the matrix is singular to floating point.
  const ridge = 1e-9 * matrix[0] + 1e-15;
  for (let p = 0; p < order; p++) matrix[p * order + p] += ridge;

  const lower = new Float64Array(order * order);
  for (let p = 0; p < order; p++) {
    for (let q = 0; q <= p; q++) {
      let sum = matrix[p * order + q];
      for (let t = 0; t < q; t++) {
        sum -= lower[p * order + t] * lower[q * order + t];
      }
      if (p === q) {
        if (sum <= 0) return false;
        lower[p * order + p] = Math.sqrt(sum);
      } else {
        lower[p * order + q] = sum / lower[q * order + q];
      }
    }
  }

  const intermediate = new Float64Array(order);
  for (let p = 0; p < order; p++) {
    let sum = rhs[p];
    for (let t = 0; t < p; t++) sum -= lower[p * order + t] * intermediate[t];
    intermediate[p] = sum / lower[p * order + p];
  }
  for (let p = order - 1; p >= 0; p--) {
    let sum = intermediate[p];
    for (let t = p + 1; t < order; t++) sum -= lower[t * order + p] * out[t];
    out[p] = sum / lower[p * order + p];
  }
  return true;
};

export const scanForClicks = (buffer: AudioBuffer, label: string): ScanReport => {
  const hits: ClickHit[] = [];
  let maxRatio = 0;
  let peak = 0;

  const order = PREDICTOR_ORDER;
  const matrix = new Float64Array(order * order);
  const rhs = new Float64Array(order);
  const coefficients = new Float64Array(order);
  // Running autocorrelation sums over the sliding window, so each sample costs
  // O(order^2) rather than O(window x order^2).
  const running = new Float64Array((order + 1) * (order + 1));

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (const sample of samples) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }

    running.fill(0);
    const first = AMPLITUDE_WINDOW + order;
    // Prime the running sums over the window preceding the first tested sample.
    for (let k = first - AMPLITUDE_WINDOW; k < first; k++) {
      for (let p = 0; p <= order; p++) {
        for (let q = p; q <= order; q++) {
          running[p * (order + 1) + q] += samples[k - p] * samples[k - q];
        }
      }
    }

    let lastHitIndex = Number.NEGATIVE_INFINITY;
    for (let index = first; index < samples.length; index++) {
      // The window's peak normalises the residual into a fraction of the
      // amplitude a cut would have removed.
      let amplitude = 0;
      for (let k = index - AMPLITUDE_WINDOW; k < index; k++) {
        const magnitude = Math.abs(samples[k]);
        if (magnitude > amplitude) amplitude = magnitude;
      }

      let ratio = 0;
      if (amplitude >= MIN_AUDIBLE_AMPLITUDE) {
        for (let p = 0; p < order; p++) {
          rhs[p] = running[0 * (order + 1) + (p + 1)];
          for (let q = 0; q < order; q++) {
            const lo = Math.min(p + 1, q + 1);
            const hi = Math.max(p + 1, q + 1);
            matrix[p * order + q] = running[lo * (order + 1) + hi];
          }
        }
        if (solveNormalEquations(matrix, rhs, coefficients, order)) {
          let predicted = 0;
          for (let p = 0; p < order; p++) {
            predicted += coefficients[p] * samples[index - 1 - p];
          }
          ratio = Math.abs(samples[index] - predicted) / amplitude;
        }
      }

      // Slide the window forward one sample before the next iteration.
      //
      // Rebuilt from scratch periodically rather than only updated. Each step
      // adds one product and subtracts another of nearly equal size, so the
      // running sums lose a little precision every time; across a forty-second
      // render that is millions of steps, and the drift eventually swamps the
      // sums themselves. Left uncorrected it manufactures large residuals at
      // perfectly smooth points — a scanner reporting clicks that are not
      // there, which is exactly as useless as one missing clicks that are.
      if ((index - first) % PREDICTOR_REFRESH_SAMPLES === 0) {
        running.fill(0);
        // The window the NEXT iteration will fit against: it ends at `index`
        // inclusive, because by then `index` is part of the past. Including
        // `index + 1` here would let the sample under test into its own fit.
        for (let k = index + 1 - AMPLITUDE_WINDOW; k <= index; k++) {
          for (let p = 0; p <= order; p++) {
            for (let q = p; q <= order; q++) {
              running[p * (order + 1) + q] += samples[k - p] * samples[k - q];
            }
          }
        }
      } else {
        const entering = index;
        const leaving = index - AMPLITUDE_WINDOW;
        for (let p = 0; p <= order; p++) {
          for (let q = p; q <= order; q++) {
            running[p * (order + 1) + q] +=
              samples[entering - p] * samples[entering - q] -
              samples[leaving - p] * samples[leaving - q];
          }
        }
      }

      if (ratio > maxRatio) maxRatio = ratio;
      if (ratio <= CLICK_RATIO_THRESHOLD) continue;

      if (index - lastHitIndex <= CLICK_MERGE_SAMPLES) {
        const previous = hits[hits.length - 1];
        if (ratio > previous.ratio) {
          previous.ratio = ratio;
          previous.sampleIndex = index;
          previous.seconds = index / buffer.sampleRate;
          previous.amplitude = amplitude;
        }
      } else {
        hits.push({
          channel,
          sampleIndex: index,
          seconds: index / buffer.sampleRate,
          ratio,
          amplitude,
        });
      }
      lastHitIndex = index;
    }
  }

  hits.sort((a, b) => b.ratio - a.ratio);
  return {
    label,
    durationSeconds: buffer.length / buffer.sampleRate,
    peak,
    maxRatio,
    hits,
  };
};
