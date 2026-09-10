// ABOUTME: Measures 1-8 Hz modulation in a stereo RMS amplitude envelope.
// ABOUTME: Reports comparable depths without treating musical onsets as audio defects.

export function measurePumping(buffer: Pick<AudioBuffer, "sampleRate" | "length" | "numberOfChannels" | "getChannelData">) {
  const hop = Math.round(buffer.sampleRate / 100);
  const rate = buffer.sampleRate / hop;
  const envelope: number[] = [];
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let start = 0; start + hop <= buffer.length; start += hop) {
    let energy = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = channels[channel];
      for (let i = start; i < start + hop; i++) energy += samples[i] ** 2;
    }
    envelope.push(Math.sqrt(energy / (hop * buffer.numberOfChannels)));
  }
  const size = Math.round(8 * rate);
  const depths: number[] = [];
  // Omit startup and release; overlapping windows cover the sustained scene.
  for (let start = Math.round(2 * rate); start + size <= envelope.length - rate; start += size / 2) {
    const values = envelope.slice(start, start + size);
    const mean = values.reduce((sum, value) => sum + value, 0) / size;
    if (mean < 1e-6) continue;
    let windowEnergy = 0;
    const centered = values.map((value, i) => {
      const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
      windowEnergy += weight ** 2;
      return (value - mean) * weight;
    });
    // Fourier projection is a band-pass of the envelope, not the audio.
    let bandEnergy = 0;
    for (let bin = Math.ceil(size / rate); bin <= Math.floor(8 * size / rate); bin++) {
      let real = 0;
      let imaginary = 0;
      for (let i = 0; i < size; i++) {
        const phase = 2 * Math.PI * bin * i / size;
        real += centered[i] * Math.cos(phase);
        imaginary += centered[i] * Math.sin(phase);
      }
      bandEnergy += 2 * (real ** 2 + imaginary ** 2) / (size * windowEnergy);
    }
    depths.push(Math.sqrt(bandEnergy) / mean);
  }
  if (!depths.length) throw new Error("Pumping measurement needs at least 11 seconds of audible audio");
  return {
    meanDepth: depths.reduce((sum, value) => sum + value, 0) / depths.length,
    peakDepth: Math.max(...depths),
    windows: depths.length,
  };
}

export function verifyPumpingDetector(): void {
  const sampleRate = 44_100;
  const samples = new Float32Array(sampleRate * 16);
  const probe = (frequency: number, depth: number) => {
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      samples[i] = (1 + depth * Math.sin(2 * Math.PI * frequency * t)) * Math.sin(2 * Math.PI * 400 * t);
    }
    return measurePumping({ sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples }).meanDepth;
  };
  const steady = probe(4, 0);
  const slow = probe(0.05, 0.3);
  const pumping = probe(4, 0.3);
  const fast = probe(20, 0.3);
  if (steady > 0.001 || slow > 0.005 || fast > 0.005 || Math.abs(pumping - 0.3 / Math.sqrt(2)) > 0.01) {
    throw new Error(`Pumping detector calibration failed: ${JSON.stringify({ steady, slow, pumping, fast })}`);
  }
  console.log("Pumping detector calibration", { steady, slow, pumping, fast });
}
