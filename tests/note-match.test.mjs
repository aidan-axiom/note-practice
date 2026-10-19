import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NoteMatcher } from '../note-match.mjs';

const note = (midi, cents = 0, clarity = .99) => ({ midi, pitchClass: midi % 12, cents, clarity });
function hold(gate, reading, target, start = 0) {
  return [0, 50, 100, 150, 200].map(offset => gate.update(reading, target, start + offset));
}

test('accepts all pitch classes across octaves after 200 ms, never sooner', () => {
  for (let midi = 28; midi <= 94; midi++) {
    const frames = hold(new NoteMatcher(), note(midi), midi % 12);
    assert.ok(frames.slice(0, 4).every(frame => !frame.matched));
    assert.equal(frames[4].matched, true);
  }
});

test('wrong pitch, noise, silence, detuning and a frame gap break the hold', () => {
  for (const interruption of [null, note(61), note(60, 36), note(60, -36), note(60, 0, .89)]) {
    const gate = new NoteMatcher();
    gate.update(note(60), 0, 0);
    gate.update(note(60), 0, 100);
    gate.update(interruption, 0, 150);
    assert.equal(gate.update(note(60), 0, 200).progress, 0);
    assert.equal(gate.update(note(60), 0, 250).matched, false);
  }
  const gate = new NoteMatcher();
  gate.update(note(60), 0, 0);
  assert.equal(gate.update(note(60), 0, 300).progress, 0);
  for (const cents of [-35, 35]) assert.equal(hold(new NoteMatcher(), note(60, cents), 0).at(-1).matched, true);
});

test('a held note scores once until released, including a single-note pool', () => {
  const gate = new NoteMatcher();
  assert.equal(hold(gate, note(60), 0).at(-1).matched, true);
  for (let now = 250; now <= 2000; now += 50) assert.equal(gate.update(note(60), 0, now).matched, false);
  for (let now = 2050; now <= 2200; now += 50) gate.update(null, 0, now);
  assert.equal(hold(gate, note(60), 0, 2250).at(-1).matched, true);
});

test('target and octave changes restart stability; lock survives target changes', () => {
  const gate = new NoteMatcher();
  gate.update(note(60), 0, 0);
  gate.update(note(60), 0, 100);
  assert.equal(gate.update(note(72), 0, 150).progress, 0);
  assert.equal(gate.update(note(62), 2, 200).progress, 0);
  assert.equal(hold(gate, note(62), 2, 250).filter(frame => frame.matched).length, 1);
  gate.reset({ keepLock: true });
  for (let now = 500; now <= 1000; now += 50) assert.equal(gate.update(note(62), 2, now).matched, false);
  gate.reset();
  assert.equal(hold(gate, note(62), 2, 1100).at(-1).matched, true);
});
