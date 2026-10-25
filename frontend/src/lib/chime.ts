// A short two-note chime made with the Web Audio API, so there's no sound file to ship.
//
// Browsers block audio until the user has interacted with the page (autoplay policy). So the
// AudioContext is created by unlockAudio(), called from the Start button's click handler, and
// reused later when the timer finishes on its own.

let context: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    context = null; // no Web Audio: the timer works silently
  }
}

export function playChime(): void {
  if (!context) return;
  const start = context.currentTime;
  [660, 880].forEach((frequency, i) => {
    const osc = context!.createOscillator();
    const gain = context!.createGain();
    osc.frequency.value = frequency;
    const t = start + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02); // quick fade in/out: no clicks
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(context!.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}
