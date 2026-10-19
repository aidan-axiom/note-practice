// Require a steady, in-tune target; release the scored note before scoring again.
export class NoteMatcher {
  constructor({ holdMs = 200, releaseMs = 140, toleranceCents = 35, minClarity = .9 } = {}) {
    Object.assign(this, { holdMs, releaseMs, toleranceCents, minClarity });
    this.reset();
  }

  reset({ keepLock = false } = {}) {
    this.since = null;
    this.candidate = null;
    this.lastFrame = null;
    this.target = null;
    if (!keepLock) { this.locked = null; this.releaseSince = null; }
  }

  update(reading, target, now) {
    const valid = reading && Number.isInteger(reading.midi) &&
      Number.isInteger(reading.pitchClass) && Number.isFinite(reading.cents) &&
      reading.clarity >= this.minClarity;
    const gap = this.lastFrame !== null && (now - this.lastFrame > 120 || now < this.lastFrame);
    if (gap || target !== this.target) { this.since = null; this.candidate = null; }
    if (gap) this.releaseSince = null;
    this.lastFrame = now;
    this.target = target;

    if (this.locked !== null) {
      if (!valid || reading.pitchClass !== this.locked) {
        if (this.releaseSince === null) this.releaseSince = now;
        if (now - this.releaseSince >= this.releaseMs) {
          this.locked = null;
          this.releaseSince = null;
        }
      } else this.releaseSince = null;
      this.since = null;
      this.candidate = null;
      return { matched: false, progress: 0 };
    }

    if (!valid || target < 0 || reading.pitchClass !== target || Math.abs(reading.cents) > this.toleranceCents) {
      this.since = null;
      this.candidate = null;
      return { matched: false, progress: 0 };
    }
    if (this.candidate !== reading.midi || this.since === null) {
      this.candidate = reading.midi;
      this.since = now;
    }
    const progress = Math.min(1, (now - this.since) / this.holdMs);
    if (progress >= 1) {
      this.locked = target;
      this.releaseSince = null;
      this.since = null;
      this.candidate = null;
      return { matched: true, progress: 1 };
    }
    return { matched: false, progress };
  }
}
