import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { detectPitch, noteFromFrequency } from '../pitch.mjs';

let seed = 0x41494441;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function signal(frequency, sampleRate, { harmonics = [0.4], noise = 0, decay = 0, phase = 0.4 } = {}) {
  return Float32Array.from({ length: 4096 }, (_, i) => {
    const wave = harmonics.reduce((sum, amplitude, j) =>
      sum + amplitude * Math.sin(2 * Math.PI * frequency * (j + 1) * i / sampleRate + phase * (j + 1)), 0);
    return wave * Math.exp(-decay * i / sampleRate) + noise * (random() * 2 - 1);
  });
}
function check(frequency, sampleRate, options, toleranceCents = 10) {
  const result = detectPitch(signal(frequency, sampleRate, options), sampleRate);
  assert.ok(result, `No pitch at ${frequency} Hz / ${sampleRate} Hz ${JSON.stringify(options)}`);
  const error = 1200 * Math.log2(result.frequency / frequency);
  assert.ok(Math.abs(error) < toleranceCents,
    `${frequency} Hz detected as ${result.frequency}: ${error.toFixed(2)} cents ${JSON.stringify(options)}`);
  assert.ok(result.clarity >= .85 && result.clarity <= 1);
  assert.ok(result.rms > .005);
  return Math.abs(error);
}
const start = performance.now();
let tested = 0, worst = 0;
for (const sampleRate of [44100, 48000]) {
  for (let midi = 28; midi <= 95; midi++) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (const cents of [-30, 0, 30]) {
      const detuned = frequency * 2 ** (cents / 1200);
      if (detuned > 2000) continue;
      worst = Math.max(worst, check(detuned, sampleRate));
      assert.equal(noteFromFrequency(detuned).midi, midi);
      assert.ok(Math.abs(noteFromFrequency(detuned).cents - cents) < 1e-8);
      tested++;
    }
  }
}
for (const sampleRate of [44100, 48000]) {
  check(40, sampleRate);
  check(2000, sampleRate);
}
for (const frequency of [40, 55, 82.4069, 110, 164.8138, 220, 440, 880]) {
  for (const harmonics of [[.08, .6], [.12, .6, .4], [0, .5, .4], [.4, .2, .13, .1, .08]]) {
    worst = Math.max(worst, check(frequency, 48000, { harmonics, noise: .008, decay: 2 }));
    tested++;
  }
}
check(440, 48000, { harmonics: [.015], noise: .003 });
for (const sampleRate of [44100, 48000, 96000]) {
  check(440, sampleRate, { noise: .06 });
  const noise = Float32Array.from({length:4096}, () => random() * .5 - .25);
  assert.equal(detectPitch(noise, sampleRate), null, 'White noise must not score');
}
for (let i = 0; i < 24; i++) {
  const amplitude = [.01, .06, .25][i % 3];
  const noise = Float32Array.from({length:4096}, () => (random() * 2 - 1) * amplitude);
  assert.equal(detectPitch(noise, 48000), null);
}
for (const input of [null, [], new Float32Array(32), new Float32Array(4096),
  new Float32Array(4096).fill(.2), new Float32Array(4096).fill(NaN),
  new Float32Array(4096).fill(Infinity), signal(440, 48000, { harmonics: [.001] })]) {
  assert.equal(detectPitch(input, 48000), null);
}
for (const sampleRate of [0, -1, NaN, Infinity, 4000, '48000']) {
  assert.equal(detectPitch(signal(440, 48000), sampleRate), null);
}
for (const invalid of [0, -1, null, NaN, Infinity, '440']) assert.equal(noteFromFrequency(invalid), null);
assert.deepEqual(noteFromFrequency(440), { midi:69, pitchClass:9, cents:0 });
assert.equal(noteFromFrequency(261.6255653).pitchClass, 0);
assert.equal(noteFromFrequency(880).pitchClass, 9);
assert.ok(Math.abs(noteFromFrequency(440 * 2 ** (.2 / 12)).cents - 20) < 1e-8);
const elapsed = performance.now() - start;
console.log(`${tested} chromatic/detuned/harmonic frames passed; worst error ${worst.toFixed(2)} cents.`);
console.log(`Noise, silence, DC, weak/invalid input and note conversion passed; ${(elapsed / (tested + 20)).toFixed(2)} ms/frame including synthesis.`);
