// Monophonic YIN-style detector. Based on de Cheveigne & Kawahara (2002):
// https://doi.org/10.1121/1.1458024
// Input: one 4096-sample Web Audio frame; output is deliberately conservative.
const MIN_HZ = 40;
const MAX_HZ = 2000;
const MIN_RMS = 0.005;
const MAX_DIFFERENCE = 0.15;

export function detectPitch(frame, sampleRate) {
  if (!(frame instanceof Float32Array) || frame.length < 256 ||
      !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) return null;

  // Averaged decimation keeps the expensive lag search near 24 kHz.
  const stride = Math.max(1, Math.floor(sampleRate / 22050));
  const rate = sampleRate / stride;
  const length = Math.floor(frame.length / stride);
  const samples = new Float64Array(length);
  let mean = 0, energy = 0;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) {
      const value = frame[i * stride + j];
      if (!Number.isFinite(value)) return null;
      sum += value;
    }
    const value = sum / stride;
    samples[i] = value;
    mean += value;
    energy += value * value;
  }
  mean /= length;
  const rms = Math.sqrt(Math.max(0, energy / length - mean * mean));
  if (rms < MIN_RMS) return null;

  const minLag = Math.max(2, Math.floor(rate / MAX_HZ));
  const maxLag = Math.min(Math.ceil(rate / MIN_HZ) + 1, Math.floor((length - 1) / 2));
  const window = length - maxLag - 1;
  if (maxLag <= minLag + 1 || window < maxLag) return null;
  const difference = new Float64Array(maxLag + 1);
  const rawDifference = new Float64Array(maxLag + 1);
  difference[0] = 1;
  let cumulative = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const delta = samples[i] - samples[i + lag];
      sum += delta * delta;
    }
    rawDifference[lag] = sum;
    cumulative += sum;
    difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
  }

  let lag = minLag;
  while (lag < maxLag && difference[lag] >= MAX_DIFFERENCE) lag++;
  if (lag >= maxLag) return null;
  while (lag + 1 <= maxLag && difference[lag + 1] < difference[lag]) lag++;
  if (lag >= maxLag) return null;

  // Prefer a clearly better full period over a strong second/third harmonic.
  // The absolute improvement guard avoids choosing multiples of a clean sine.
  const minimum = (at) => {
    const left = difference[at - 1], middle = difference[at], right = difference[at + 1];
    const curve = left - 2 * middle + right;
    const offset = curve ? Math.max(-.5, Math.min(.5, .5 * (left - right) / curve)) : 0;
    return { offset, value: Math.max(0, middle - .5 * curve * offset * offset) };
  };
  const firstLag = lag;
  for (let multiple = 2; multiple <= 3; multiple++) {
    const predicted = firstLag * multiple;
    if (predicted - 2 >= maxLag) break;
    let candidate = Math.max(minLag, predicted - 2);
    const end = Math.min(predicted + 2, maxLag - 1);
    for (let i = candidate + 1; i <= end; i++) {
      if (difference[i] < difference[candidate]) candidate = i;
    }
    if (minimum(candidate).value < minimum(lag).value * 0.35 &&
        minimum(lag).value - minimum(candidate).value > 0.01) lag = candidate;
  }

  const { value } = minimum(lag);
  // Refine using the original difference: normalization biases short periods.
  const left = rawDifference[lag - 1], middle = rawDifference[lag], right = rawDifference[lag + 1];
  const curve = left - 2 * middle + right;
  const offset = curve ? Math.max(-.5, Math.min(.5, .5 * (left - right) / curve)) : 0;
  const frequency = rate / (lag + offset);
  // One cent of tolerance handles interpolation at the configured boundaries.
  const boundaryTolerance = 2 ** (1 / 1200);
  if (frequency < MIN_HZ / boundaryTolerance || frequency > MAX_HZ * boundaryTolerance) return null;
  return { frequency, clarity: Math.max(0, Math.min(1, 1 - value)), rms };
}

export function noteFromFrequency(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  const exact = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(exact);
  return { midi, pitchClass: ((midi % 12) + 12) % 12, cents: (exact - midi) * 100 };
}
