# Note Flash

A simple musical-note practice game. Choose the notes you want to practice, switch between sharps and flats, and use either a timer or your microphone to advance.

## Play

- **Timer:** adjust the slider from 0.5 to 10 seconds between notes. Pause, resume, or skip with Next.
- **Microphone:** choose Microphone mode, click **Start listening**, and allow microphone access. Play the displayed note in any octave. Hold a steady pitch for about 200 milliseconds; a correct note flashes green, adds to your score, and advances automatically.
- **Your notes:** check the notes you want included, or use All / None. A single selected note can be practiced repeatedly; release it briefly before playing it again to score.
- **Use flats:** switch accidental note names between sharps and flats.

For microphone practice, play one clear note at a time and let other strings or notes stop ringing. Background noise, chords, and instrument overtones can affect recognition. Pitch detection has synthetic signal tests; reliability with your instrument and microphone still needs practical testing.

Microphone audio is processed locally in your browser and is not recorded or uploaded. Use a modern browser over HTTPS or localhost, and grant microphone permission when prompted.

## Preview locally

From this folder, run:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). No build step or dependencies are required.

## Tests

With Node.js installed, run:

```sh
node tests/pitch.test.mjs
node tests/note-match.test.mjs
node tests/microphone.test.mjs
```

These check synthetic pitch detection, steady-note scoring and release behavior, and microphone lifecycle logic using test doubles. They do not use a real microphone.

## GitHub Pages

In the repository's **Settings → Pages**, select **Deploy from a branch**, choose **main**, and select **/ (root)**. Save, then open the HTTPS site URL shown by GitHub. Keep `.nojekyll` in the repository root so Pages serves the static files directly.
