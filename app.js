import { detectPitch, noteFromFrequency } from './pitch.mjs';
import { NoteMatcher } from './note-match.mjs';
import { MicrophoneInput } from './microphone.mjs';

(() => {
  const notes = [
    { name: 'C' }, { name: 'C', sharp: true, flat: 'D♭' },
    { name: 'D' }, { name: 'D', sharp: true, flat: 'E♭' },
    { name: 'E' }, { name: 'F' }, { name: 'F', sharp: true, flat: 'G♭' },
    { name: 'G' }, { name: 'G', sharp: true, flat: 'A♭' },
    { name: 'A' }, { name: 'A', sharp: true, flat: 'B♭' }, { name: 'B' }
  ];
  const el = Object.fromEntries(['note', 'alternate', 'interval', 'interval-value', 'use-flats', 'toggle', 'toggle-text', 'play-icon', 'pause-icon', 'mic-icon', 'next', 'status', 'status-text', 'countdown', 'progress', 'note-options', 'select-all', 'select-none', 'selection-summary', 'pool-label', 'mode-timer', 'mode-mic', 'timer-settings', 'mic-settings', 'mic-message', 'heard-note', 'correct-count', 'note-card'].map(id => [id, document.getElementById(id)]));
  let selected = new Set(notes.map((_, index) => index));
  const noteInputs = notes.map((note, index) => {
    const label = document.createElement('label');
    label.className = 'note-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    const text = document.createElement('span');
    label.append(input, text);
    el['note-options'].append(label);
    input.addEventListener('change', updateSelection);
    return input;
  });
  let intervalMs = Number(el.interval.value) * 1000;
  let remaining = intervalMs;
  let running = true;
  let lastTime = performance.now();
  let current = -1;
  let lastCountdown = '';
  let mode = 'timer';
  let micAction = 0;
  let feedback = null;
  let micProgress = 0;
  let heardNote = null;
  let correctCount = 0;
  const matcher = new NoteMatcher();
  const microphone = new MicrophoneInput({
    onFrame: hearFrame,
    onError: error => stopListening(microphoneError(error), true)
  });

  function showNext() {
    if (!selected.size) return;
    invalidateMatch();
    // Avoid consecutive repeats whenever the practice set contains another note.
    const choices = [...selected].filter(index => index !== current);
    const next = choices.length ? choices[Math.floor(Math.random() * choices.length)] : current;
    const changed = next !== current;
    current = next;
    renderNote();
    if (changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.note.getAnimations().forEach(animation => animation.cancel());
      el.note.animate([{ opacity: 0.25, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 190, easing: 'ease-out' });
    }
    remaining = intervalMs;
    lastTime = performance.now();
    renderPlayback();
    renderProgress();
  }

  function renderNote() {
    el.note.classList.toggle('empty', current < 0);
    if (current < 0) {
      el.note.textContent = 'Choose a note';
      el.note.setAttribute('aria-label', 'No notes selected');
      el.alternate.textContent = 'Select notes to begin.';
      return;
    }
    const note = notes[current];
    const useFlat = el['use-flats'].checked && note.sharp;
    const name = useFlat ? note.flat[0] : note.name;
    const accidental = note.sharp ? (useFlat ? '♭' : '♯') : '';
    el.note.innerHTML = name + (accidental ? `<sup>${accidental}</sup>` : '');
    el.note.setAttribute('aria-label', name + (accidental ? (useFlat ? ' flat' : ' sharp') : ''));
    el.alternate.textContent = note.sharp ? `also ${useFlat ? note.name + '♯' : note.flat}` : '\u00a0';
  }

  function renderProgress() {
    const progress = mode === 'mic' ? micProgress : selected.size > 1 ? Math.max(0, Math.min(1, 1 - remaining / intervalMs)) : 0;
    el.progress.style.transform = `scaleX(${progress})`;
    const label = !selected.size ? 'Waiting for notes' : mode === 'mic' ? feedback ? 'Correct!' : microphone.state === 'listening' ? micProgress > 0 ? 'Hold it steady' : 'Play this note' : 'Microphone off' : selected.size === 1 ? 'One note selected' : running ? `Next in ${(Math.ceil(remaining / 100) / 10).toFixed(1)}s` : 'Take your time';
    if (label !== lastCountdown) el.countdown.textContent = lastCountdown = label;
  }

  function togglePlayback() {
    if (!selected.size) return;
    if (mode === 'mic') {
      if (microphone.state === 'idle') startListening();
      else stopListening();
      return;
    }
    running = !running;
    lastTime = performance.now();
    renderPlayback();
    renderProgress();
  }

  function renderPlayback() {
    const isMic = mode === 'mic';
    const active = isMic ? microphone.state === 'listening' : running;
    const starting = isMic && microphone.state === 'starting';
    el['toggle-text'].textContent = starting ? 'Cancel' : isMic && !active ? 'Start listening' : active ? 'Pause' : 'Resume';
    el.toggle.setAttribute('aria-label', starting ? 'Cancel microphone request' : isMic ? active ? 'Pause listening' : 'Start listening' : running ? 'Pause note changes' : 'Resume note changes');
    el['pause-icon'].toggleAttribute('hidden', !active && !starting);
    el['play-icon'].toggleAttribute('hidden', isMic || active);
    el['mic-icon'].toggleAttribute('hidden', !isMic || active || starting);
    el.toggle.disabled = !selected.size;
    el.next.disabled = selected.size < 2;
    el['status-text'].textContent = !selected.size ? 'Choose notes' : feedback ? 'Correct!' : starting ? 'Connecting' : isMic ? active ? 'Listening' : 'Mic off' : running ? 'Playing' : 'Paused';
    el.status.classList.toggle('paused', !active || !selected.size);
  }

  function renderNoteOptions() {
    noteInputs.forEach((input, index) => {
      const note = notes[index];
      const useFlat = el['use-flats'].checked && note.sharp;
      input.nextElementSibling.textContent = useFlat ? note.flat : note.name + (note.sharp ? '♯' : '');
      input.setAttribute('aria-label', useFlat ? `${note.flat[0]} flat` : note.name + (note.sharp ? ' sharp' : ''));
    });
  }

  function updateSelection() {
    invalidateMatch();
    selected = new Set(noteInputs.flatMap((input, index) => input.checked ? [index] : []));
    el['selection-summary'].textContent = `${selected.size} of 12 selected`;
    el['pool-label'].textContent = selected.size === 12 ? 'ALL 12 NOTES' : `${selected.size} ${selected.size === 1 ? 'NOTE' : 'NOTES'}`;
    el['select-all'].disabled = selected.size === 12;
    el['select-none'].disabled = !selected.size;
    renderPlayback();
    if (!selected.size) {
      if (microphone.state !== 'idle') stopListening('Select notes, then click Start listening.');
      current = -1;
      remaining = intervalMs;
      lastTime = performance.now();
      el.note.getAnimations().forEach(animation => animation.cancel());
      renderNote();
    } else if (!selected.has(current)) {
      showNext();
    }
    if (mode === 'mic' && microphone.state === 'listening') setMicMessage('Play one clear note.');
    renderProgress();
  }

  function noteName(index) {
    const note = notes[index];
    return el['use-flats'].checked && note.sharp ? note.flat : note.name + (note.sharp ? '♯' : '');
  }

  function setMicMessage(message, error = false) {
    if (el['mic-message'].textContent !== message) el['mic-message'].textContent = message;
    el['mic-message'].classList.toggle('error', error);
  }

  function renderHeard() {
    el['heard-note'].textContent = heardNote ? `Hearing ${noteName(heardNote.pitchClass)}${Math.floor(heardNote.midi / 12) - 1} · ${Math.round(heardNote.cents) > 0 ? '+' : ''}${Math.round(heardNote.cents)}¢` : 'Hearing —';
  }

  function invalidateMatch({ unlock = false } = {}) {
    feedback = null;
    micProgress = 0;
    matcher.reset({ keepLock: !unlock });
    el['note-card'].classList.remove('correct');
  }

  function microphoneError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Microphone access was blocked. Allow it in browser settings and try again. In an embedded preview, try opening the game link in your browser.';
    if (error?.name === 'NotFoundError') return 'No microphone found. Connect a microphone and try again.';
    if (error?.name === 'NotReadableError') return 'The microphone is busy or unavailable. Close other audio apps and try again.';
    if (error?.name === 'NotSupportedError') return 'Microphone mode is unavailable here. Open the game link in your browser, or use Timer mode.';
    return 'Microphone listening stopped. Check your microphone and click Start listening to try again.';
  }

  async function startListening() {
    if (!selected.size || document.hidden || mode !== 'mic') return;
    const action = ++micAction;
    invalidateMatch({ unlock: true });
    heardNote = null;
    renderHeard();
    setMicMessage('Allow microphone access to start.');
    try {
      const starting = microphone.start();
      renderPlayback();
      renderProgress();
      const started = await starting;
      if (action !== micAction) return;
      if (!started || mode !== 'mic' || document.hidden || !selected.size) {
        microphone.stop();
        renderPlayback();
        return;
      }
      running = true;
      setMicMessage('Play one clear note.');
    } catch (error) {
      if (action !== micAction) return;
      running = false;
      setMicMessage(microphoneError(error), true);
    }
    renderPlayback();
    renderProgress();
  }

  function stopListening(message = 'Microphone is off. Click Start listening to continue.', error = false) {
    micAction++;
    microphone.stop();
    running = false;
    heardNote = null;
    invalidateMatch({ unlock: true });
    renderHeard();
    setMicMessage(message, error);
    renderPlayback();
    renderProgress();
  }

  function changeMode() {
    stopListening('Click Start listening and allow your microphone.');
    mode = el['mode-mic'].checked ? 'mic' : 'timer';
    running = mode === 'timer';
    remaining = intervalMs;
    lastTime = performance.now();
    el['timer-settings'].hidden = mode !== 'timer';
    el['mic-settings'].hidden = mode !== 'mic';
    renderPlayback();
    renderProgress();
  }

  function hearFrame(samples, sampleRate, now) {
    if (mode !== 'mic' || microphone.state !== 'listening' || !running || document.hidden || current < 0) return;
    const pitch = detectPitch(samples, sampleRate);
    heardNote = pitch ? { ...noteFromFrequency(pitch.frequency), clarity: pitch.clarity } : null;
    renderHeard();
    const result = matcher.update(heardNote, feedback ? -1 : current, now);
    if (!feedback) {
      micProgress = result.progress;
      if (result.matched) {
        correctCount++;
        el['correct-count'].textContent = `${correctCount} correct`;
        feedback = { target: current, until: now + 600 };
        el['note-card'].classList.add('correct');
        micProgress = 1;
        setMicMessage(`Nice! That's ${noteName(current)}.`);
        renderPlayback();
      } else if (!heardNote || heardNote.clarity < .9) setMicMessage('Play one clear note.');
      else if (matcher.locked === current && heardNote.pitchClass === current) setMicMessage('Release the note, then play it again.');
      else if (heardNote.pitchClass !== current) setMicMessage(`Aim for ${noteName(current)}.`);
      else if (Math.abs(heardNote.cents) > 35) setMicMessage(`A little ${heardNote.cents > 0 ? 'sharp' : 'flat'} — adjust the pitch.`);
      else setMicMessage('Hold it steady…');
    }
    renderProgress();
  }

  el.interval.addEventListener('input', () => {
    const seconds = Number(el.interval.value);
    intervalMs = seconds * 1000;
    remaining = intervalMs;
    lastTime = performance.now();
    el['interval-value'].innerHTML = `${seconds.toFixed(1)} <span>sec</span>`;
    el.interval.setAttribute('aria-valuetext', `${seconds} seconds`);
    const percent = (seconds - 0.5) / 9.5 * 100;
    el.interval.style.background = `linear-gradient(to right, var(--purple) 0%, var(--purple) ${percent}%, #e3dfe9 ${percent}%, #e3dfe9 100%)`;
    renderProgress();
  });
  el.toggle.addEventListener('click', togglePlayback);
  el.next.addEventListener('click', showNext);
  el['use-flats'].addEventListener('change', () => {
    renderNote(); renderNoteOptions(); renderHeard();
    if (feedback) setMicMessage(`Nice! That's ${noteName(current)}.`);
  });
  el['mode-timer'].addEventListener('change', changeMode);
  el['mode-mic'].addEventListener('change', changeMode);
  el['select-all'].addEventListener('click', () => { noteInputs.forEach(input => { input.checked = true; }); updateSelection(); });
  el['select-none'].addEventListener('click', () => { noteInputs.forEach(input => { input.checked = false; }); updateSelection(); });
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.code === 'Space' && !target.closest('button, a')) { event.preventDefault(); togglePlayback(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); showNext(); }
  });
  // Keep the current note and remaining time when the practice tab is hidden.
  document.addEventListener('visibilitychange', () => {
    lastTime = performance.now();
    if (document.hidden && microphone.state !== 'idle') stopListening('Listening paused while this tab was hidden. Click Start listening to continue.');
  });
  window.addEventListener('pagehide', () => { if (microphone.state !== 'idle') stopListening(); });
  function tick(now) {
    if (mode === 'timer' && running && selected.size > 1 && !document.hidden) {
      remaining -= Math.max(0, now - lastTime);
      if (remaining <= 0) showNext();
      renderProgress();
    }
    if (mode === 'mic' && feedback && now >= feedback.until && microphone.state === 'listening' && running && !document.hidden) {
      if (feedback.target === current && selected.has(current)) showNext();
      else invalidateMatch();
      renderPlayback();
    }
    lastTime = now;
    requestAnimationFrame(tick);
  }
  renderNoteOptions();
  updateSelection();
  requestAnimationFrame(tick);
})();
