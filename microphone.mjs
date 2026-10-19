const AUDIO_OPTIONS = {
  audio: {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false }
  },
  video: false
};

const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());

export class MicrophoneInput {
  constructor({ onFrame, onError, mediaDevices = globalThis.navigator?.mediaDevices,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) } = {}) {
    Object.assign(this, { onFrame, onError, mediaDevices, AudioContextClass, requestFrame, cancelFrame });
    this.state = 'idle';
    this.session = null;
  }

  async start() {
    if (this.state === 'listening') return true;
    if (this.state === 'starting') return this.session.promise;
    const session = { raf: null, listeners: [], lastFrame: null, closed: false, cancelled: false };
    session.abort = new Promise(resolve => { session.resolveAbort = resolve; });
    this.session = session;
    this.state = 'starting';
    session.promise = this.open(session);
    return session.promise;
  }

  async open(session) {
    try {
      if (!this.mediaDevices?.getUserMedia || !this.AudioContextClass || !this.requestFrame || !this.cancelFrame) {
        const error = new Error('Microphone listening is unavailable in this browser.');
        error.name = 'NotSupportedError';
        throw error;
      }
      // Start/resume the context synchronously in the Start button's user gesture.
      const context = session.context = new this.AudioContextClass();
      const onStateChange = () => {
        if (this.active(session) && this.state === 'listening' && context.state !== 'running') {
          this.fail(session, new Error('Microphone audio was interrupted. Start listening again.'));
        }
      };
      this.listen(session, context, 'statechange', onStateChange);
      const resumed = Promise.resolve(context.resume());
      // Also handle rejection if getUserMedia throws before Promise.all is attached.
      resumed.catch(() => {});
      const acquired = Promise.resolve(this.mediaDevices.getUserMedia(AUDIO_OPTIONS)).then(stream => {
        if (!this.active(session)) { stopTracks(stream); return null; }
        session.stream = stream;
        const tracks = stream.getAudioTracks ? stream.getAudioTracks() : stream.getTracks();
        if (!tracks.length) throw new Error('The microphone supplied no audio track.');
        for (const track of tracks) {
          const ended = () => this.fail(session, new Error('The microphone disconnected. Start listening again.'));
          this.listen(session, track, 'ended', ended);
          if (track.readyState === 'ended') ended();
        }
        return stream;
      });
      const result = await Promise.race([Promise.all([resumed, acquired]), session.abort]);
      if (result?.cancelled) return false;
      if (result?.error) throw result.error;
      if (!this.active(session)) return false;
      if (context.state !== 'running') throw new Error('Microphone audio could not start. Try listening again.');
      session.analyser = context.createAnalyser();
      session.analyser.fftSize = context.sampleRate > 48000 ? 8192 : 4096;
      session.buffer = new Float32Array(session.analyser.fftSize);
      session.source = context.createMediaStreamSource(session.stream);
      session.source.connect(session.analyser);
      // Deliberately do not connect to context.destination.
      this.state = 'listening';
      session.raf = this.requestFrame(now => this.tick(session, now));
      return true;
    } catch (error) {
      this.release(session);
      if (session.cancelled) return false;
      throw error;
    }
  }

  active(session) { return this.session === session && !session.closed; }

  listen(session, target, type, handler) {
    target.addEventListener(type, handler);
    session.listeners.push(() => target.removeEventListener(type, handler));
  }

  tick(session, now) {
    if (!this.active(session)) return;
    session.raf = null;
    try {
      if (session.lastFrame === null || now - session.lastFrame >= 40) {
        session.analyser.getFloatTimeDomainData(session.buffer);
        session.lastFrame = now;
        this.onFrame?.(session.buffer, session.context.sampleRate, now);
      }
      if (this.active(session)) session.raf = this.requestFrame(next => this.tick(session, next));
    } catch (error) { this.fail(session, error); }
  }

  fail(session, error) {
    if (!this.active(session)) return;
    const wasListening = this.state === 'listening';
    session.resolveAbort({ error });
    this.release(session);
    if (wasListening) this.onError?.(error);
  }

  stop() {
    if (!this.session) return;
    this.session.cancelled = true;
    this.session.resolveAbort({ cancelled: true });
    this.release(this.session);
  }

  release(session) {
    if (session.closed) return;
    session.closed = true;
    if (this.session === session) { this.session = null; this.state = 'idle'; }
    if (session.raf !== null) this.cancelFrame(session.raf);
    session.listeners.forEach(remove => remove());
    for (const node of [session.source, session.analyser]) {
      try { node?.disconnect(); } catch { /* Already disconnected. */ }
    }
    stopTracks(session.stream);
    try { Promise.resolve(session.context?.close()).catch(() => {}); } catch { /* Already closed. */ }
  }
}
