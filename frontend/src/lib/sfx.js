// Navigation sound — soft synthesized "blips", OFF by default (a settings toggle turns
// it on). No audio files: each blip is a short Web Audio envelope, so the folder stays
// self-contained and there's nothing to fetch. The pure "which sound does this action
// make" decision is split from the effectful player so it's testable without an
// AudioContext (this app has no DOM in its tests).

// Every action that should click. Directional moves share one soft blip; confirm and
// back get their own so the ear can tell "in" from "out".
const MOVE = new Set(['up', 'down', 'left', 'right', 'railPrev', 'railNext', 'jumpPrev', 'jumpNext'])

export function soundForAction(action) {
  if (MOVE.has(action)) return 'move'
  if (action === 'confirm') return 'confirm'
  if (action === 'back') return 'back'
  return null
}

// One shared AudioContext, created lazily on the first real blip — which only ever
// happens inside a button press, so the browser's autoplay policy is satisfied.
let ctx = null
function audioCtx() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!ctx) {
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

// Each blip: a frequency, a short duration, a gentle peak gain, and a waveform. Kept
// quiet and short — a cue, never a beep.
const TONES = {
  move: { freq: 523, dur: 0.05, gain: 0.045, type: 'sine' },
  confirm: { freq: 740, dur: 0.09, gain: 0.06, type: 'sine' },
  back: { freq: 340, dur: 0.08, gain: 0.05, type: 'triangle' },
}

// Play one blip. Silently does nothing when there's no audio (SSR, tests, a browser
// without Web Audio) — sound is a nicety and must never throw into the UI.
export function playSound(kind) {
  const tone = TONES[kind]
  if (!tone) return
  const ac = audioCtx()
  if (!ac) return

  // Schedule the blip relative to currentTime read AFTER the context is running. A
  // freshly-created context starts 'suspended' even inside a gesture (iOS Safari), and
  // resume() is async — scheduling at the still-frozen currentTime would let the note's
  // window elapse before playback starts, dropping the very first blip. So if we have to
  // resume, fire from the resolved promise; otherwise fire straight away.
  const fire = () => {
    try {
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = tone.type
      osc.frequency.setValueAtTime(tone.freq, t)
      // A soft pluck: near-instant attack, short exponential decay — the shape of a drop
      // of water, not a UI beep.
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(tone.gain, t + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur)
      osc.connect(gain).connect(ac.destination)
      osc.start(t)
      osc.stop(t + tone.dur + 0.02)
    } catch {
      /* audio hiccup — never let it bubble into navigation */
    }
  }

  try {
    if (ac.state === 'suspended') ac.resume().then(fire).catch(() => {})
    else fire()
  } catch {
    /* resume can throw synchronously on some engines — sound is a nicety, swallow it */
  }
}

// The convenience the dispatcher calls: blip for this action, but only when enabled.
export function playForAction(action, enabled) {
  if (!enabled) return
  const kind = soundForAction(action)
  if (kind) playSound(kind)
}
