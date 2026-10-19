import test from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneInput } from '../microphone.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class Track extends EventTarget {
  readyState = 'live';
  stops = 0;
  stop() { this.stops++; this.readyState = 'ended'; }
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
}

function stream() {
  const track = new Track();
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

function setup(options = {}) {
  const events = [], contexts = [], requests = [], frames = [], errors = [], rafs = new Map();
  let rafId = 0;
  class Context extends EventTarget {
    constructor() {
      super(); this.state = 'suspended'; this.sampleRate = options.sampleRate || 48000; this.closes = 0;
      this.source = { connections: [], disconnects: 0, connect(node) { this.connections.push(node); if (options.connectError) throw options.connectError; }, disconnect() { this.disconnects++; } };
      this.analyser = { reads: 0, disconnects: 0, getFloatTimeDomainData(buffer) { this.reads++; buffer.fill(0.1); }, disconnect() { this.disconnects++; } };
      contexts.push(this); events.push('context');
    }
    resume() {
      events.push('resume');
      if (options.resumeError) return Promise.reject(options.resumeError);
      if (!options.staySuspended) this.state = 'running';
      return Promise.resolve();
    }
    close() { this.closes++; this.state = 'closed'; return Promise.resolve(); }
    createAnalyser() { return this.analyser; }
    createMediaStreamSource(value) { this.stream = value; return this.source; }
    suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); }
  }
  const mic = new MicrophoneInput({
    AudioContextClass: Context,
    mediaDevices: { getUserMedia(constraints) { events.push('permission'); const request = deferred(); request.constraints = constraints; requests.push(request); return request.promise; } },
    requestFrame(callback) { const id = rafId++; rafs.set(id, callback); return id; },
    cancelFrame(id) { rafs.delete(id); },
    onFrame: (...args) => { frames.push(args); options.onFrame?.(...args); },
    onError: error => errors.push(error)
  });
  const frame = now => { const pending = [...rafs.values()]; rafs.clear(); pending.forEach(callback => callback(now)); };
  return { mic, events, contexts, requests, frames, errors, rafs, frame };
}

async function start(harness, value = stream()) {
  const pending = harness.mic.start();
  harness.requests.at(-1).resolve(value);
  assert.equal(await pending, true);
  return value;
}

test('resume begins in the user gesture, mono raw input, shared start and silent analyser', async () => {
  const h = setup();
  const first = h.mic.start(), second = h.mic.start();
  assert.equal(h.mic.state, 'starting');
  assert.deepEqual(h.events, ['context', 'resume', 'permission']);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].constraints, { audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false } }, video: false });
  const audio = stream(); h.requests[0].resolve(audio);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(await h.mic.start(), true);
  assert.equal(h.contexts.length, 1);
  assert.deepEqual(h.contexts[0].source.connections, [h.contexts[0].analyser]);
  assert.equal(h.contexts[0].analyser.fftSize, 4096);
  h.mic.stop();
});

test('polls at most 25Hz, passes 4096 float samples and cleans every resource', async () => {
  const h = setup(), audio = await start(h);
  [0, 16, 32, 40, 50, 79, 80].forEach(h.frame);
  assert.deepEqual(h.frames.map(value => value[2]), [0, 40, 80]);
  assert.ok(h.frames[0][0] instanceof Float32Array);
  assert.equal(h.frames[0][0].length, 4096);
  assert.equal(h.frames[0][1], 48000);
  h.mic.stop(); h.mic.stop(); h.frame(120);
  assert.equal(h.mic.state, 'idle');
  assert.equal(h.rafs.size, 0);
  assert.equal(audio.track.stops, 1);
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(h.contexts[0].source.disconnects, 1);
  assert.equal(h.contexts[0].analyser.disconnects, 1);
  audio.track.end();
  assert.deepEqual(h.errors, []);
});

test('stop cancels pending permission promptly and stops a late granted stream', async () => {
  const h = setup(), pending = h.mic.start();
  h.mic.stop();
  assert.equal(await pending, false);
  assert.equal(h.contexts[0].closes, 1);
  const audio = stream(); h.requests[0].resolve(audio);
  await Promise.resolve();
  assert.equal(audio.track.stops, 1);
  assert.equal(h.mic.state, 'idle');
  assert.equal(h.rafs.size, 0);
});

test('96kHz input uses an 8192-sample analyser and frame buffer', async () => {
  const h = setup({ sampleRate: 96000 });
  await start(h); h.frame(0);
  assert.equal(h.contexts[0].analyser.fftSize, 8192);
  assert.equal(h.frames[0][0].length, 8192);
  assert.equal(h.frames[0][1], 96000);
  h.mic.stop();
});

test('unavailable APIs reject with NotSupportedError', async () => {
  const mic = new MicrophoneInput({ mediaDevices: {}, AudioContextClass: class {}, requestFrame() {}, cancelFrame() {} });
  await assert.rejects(mic.start(), { name: 'NotSupportedError' });
  assert.equal(mic.state, 'idle');
});

test('a stale permission cannot replace or stop a newer active session', async () => {
  const h = setup(), old = h.mic.start(); h.mic.stop();
  const active = await start(h);
  const late = stream(); h.requests[0].resolve(late);
  assert.equal(await old, false);
  await Promise.resolve();
  assert.equal(late.track.stops, 1);
  assert.equal(active.track.stops, 0);
  assert.equal(h.mic.state, 'listening');
  assert.equal(h.contexts[1].closes, 0);
  assert.equal(h.rafs.size, 1);
  h.mic.stop();
});

test('permission rejection throws to the caller without runtime error callback', async () => {
  const h = setup(), error = new Error('Permission denied'), pending = h.mic.start();
  h.requests[0].reject(error);
  await assert.rejects(pending, value => value === error);
  assert.equal(h.mic.state, 'idle');
  assert.equal(h.contexts[0].closes, 1);
  assert.deepEqual(h.errors, []);
});

test('resume failure cleans context and also cleans a stream granted later', async () => {
  const error = new Error('Cannot resume'), h = setup({ resumeError: error });
  await assert.rejects(h.mic.start(), value => value === error);
  const audio = stream(); h.requests[0].resolve(audio); await Promise.resolve();
  assert.equal(audio.track.stops, 1);
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(h.mic.state, 'idle');
});

test('partial setup failure disconnects nodes, stops tracks, and closes context', async () => {
  const error = new Error('Connect failed'), h = setup({ connectError: error });
  const pending = h.mic.start(), audio = stream(); h.requests[0].resolve(audio);
  await assert.rejects(pending, value => value === error);
  assert.equal(audio.track.stops, 1);
  assert.equal(h.contexts[0].source.disconnects, 1);
  assert.equal(h.contexts[0].analyser.disconnects, 1);
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(h.rafs.size, 0);
});

test('device disconnection reports once and fully stops listening', async () => {
  const h = setup(), audio = await start(h);
  audio.track.end(); audio.track.end();
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /disconnected/);
  assert.equal(h.mic.state, 'idle');
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(h.rafs.size, 0);
});

test('context interruption is reported and cleans up', async () => {
  const h = setup(), audio = await start(h);
  h.contexts[0].suspend();
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /interrupted/);
  assert.equal(audio.track.stops, 1);
  assert.equal(h.mic.state, 'idle');
});

test('a context still suspended after resume fails startup with cleanup', async () => {
  const h = setup({ staySuspended: true }), pending = h.mic.start(), audio = stream();
  h.requests[0].resolve(audio);
  await assert.rejects(pending, /could not start/);
  assert.equal(audio.track.stops, 1);
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(h.mic.state, 'idle');
  assert.deepEqual(h.errors, []);
});

test('an already ended input rejects startup without becoming active', async () => {
  const h = setup(), pending = h.mic.start(), audio = stream();
  audio.track.readyState = 'ended'; h.requests[0].resolve(audio);
  await assert.rejects(pending, /disconnected/);
  assert.equal(h.mic.state, 'idle');
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(audio.track.stops, 1);
  assert.equal(h.rafs.size, 0);
  assert.deepEqual(h.errors, []);
});

test('frame callback failure is reported and cannot leave a polling loop', async () => {
  const error = new Error('Frame failed'), h = setup({ onFrame() { throw error; } });
  const audio = await start(h); h.frame(0);
  assert.deepEqual(h.errors, [error]);
  assert.equal(audio.track.stops, 1);
  assert.equal(h.rafs.size, 0);
  assert.equal(h.mic.state, 'idle');
});
