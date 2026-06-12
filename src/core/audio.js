// NETRUNNER audio — pure WebAudio synth engine, zero asset files. ARCHITECTURE.md §11.
// Themes are tiny lookahead-scheduled sequencers; SFX are one-shot envelope voices.
// Everything is gated behind unlock() so a locked/suspended context never throws.
import { G } from '../core/state.js'

const LOOKAHEAD = 0.12   // seconds of audio scheduled ahead of the clock
const TICK_MS = 27       // scheduler wakeup interval
const FADE = 0.8         // crossfade time between themes
const DUCK_LEVEL = 0.35  // music bed level while dialogue runs

let ctx = null
let musicVol = null      // master music gain  (G.settings.musicVol)
let sfxVol = null        // master sfx gain    (G.settings.sfxVol)
let duckBus = null       // tracks -> duckBus -> musicVol -> destination
let noiseBuf = null      // shared 2s white-noise buffer (rain / hits / hats)
let current = null       // active theme track
let pendingTheme = null  // play() requested before unlock()
let ducked = false

const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0))
const n2f = n => 440 * 2 ** ((n - 69) / 12) // midi note -> Hz
const rnd = (a, b) => a + Math.random() * (b - a)

function buildGraph() {
  musicVol = ctx.createGain()
  musicVol.gain.value = clamp01(G.settings.musicVol)
  musicVol.connect(ctx.destination)
  duckBus = ctx.createGain()
  duckBus.gain.value = ducked ? DUCK_LEVEL : 1
  duckBus.connect(musicVol)
  sfxVol = ctx.createGain()
  sfxVol.gain.value = clamp01(G.settings.sfxVol)
  sfxVol.connect(ctx.destination)
  const len = ctx.sampleRate * 2
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
}

// ---- voices ---------------------------------------------------------------

// Musical voice: osc (+optional filter) with attack/hold/release envelope.
function voice(t, o) {
  const { freq, dur = 0.3, type = 'sine', vol = 0.1, attack = 0.01, release = 0.15,
          slide = 0, detune = 0, fType = null, fFreq = 1200, q = 1, out } = o
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(Math.max(20, freq), t)
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur)
  if (detune) osc.detune.setValueAtTime(detune, t)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(vol, t + attack)
  g.gain.setValueAtTime(vol, t + Math.max(attack, dur))
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release)
  let head = osc
  if (fType) {
    const f = ctx.createBiquadFilter()
    f.type = fType
    f.frequency.setValueAtTime(Math.max(40, fFreq), t)
    f.Q.value = q
    osc.connect(f)
    head = f
  }
  head.connect(g)
  g.connect(out)
  osc.start(t)
  osc.stop(t + Math.max(attack, dur) + release + 0.1)
}

// Percussive noise voice: filtered slice of the shared noise buffer.
function noise(t, o) {
  const { dur = 0.1, vol = 0.1, attack = 0.004, release = 0.05,
          fType = 'bandpass', fFreq = 2000, q = 1, slide = 0, out } = o
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  src.playbackRate.value = rnd(0.85, 1.15)
  const f = ctx.createBiquadFilter()
  f.type = fType
  f.frequency.setValueAtTime(Math.max(40, fFreq), t)
  f.Q.value = q
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(vol, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release)
  src.connect(f)
  f.connect(g)
  g.connect(out)
  src.start(t)
  src.stop(t + dur + release + 0.1)
}

// ---- ambient layers (looping noise beds, fade with their track) -----------

function startAmbient(kind, out) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const f = ctx.createBiquadFilter()
  const g = ctx.createGain()
  const lfo = ctx.createOscillator()
  const lfoG = ctx.createGain()
  if (kind === 'rain') {           // steady hiss, slow filter drift = sheets of rain
    f.type = 'bandpass'
    f.frequency.value = 2600
    f.Q.value = 0.45
    g.gain.value = 0.045
    lfo.frequency.value = 0.13
    lfoG.gain.value = 700
    lfo.connect(lfoG)
    lfoG.connect(f.frequency)
  } else {                         // 'rumble' — deep ventilation throb
    f.type = 'lowpass'
    f.frequency.value = 130
    f.Q.value = 0.8
    g.gain.value = 0.1
    lfo.frequency.value = 0.07
    lfoG.gain.value = 0.04
    lfo.connect(lfoG)
    lfoG.connect(g.gain)
  }
  src.connect(f)
  f.connect(g)
  g.connect(out)
  src.start()
  lfo.start()
  return [src, lfo]
}

// ---- themes ---------------------------------------------------------------
// Each theme: { level, stepDur, ambient, step(t, i, out) }. step() schedules the
// notes for sequencer step i at audio-clock time t into the track's gain `out`.

const MENU_PROG = [ // Am7  Fmaj  C  G — slow synthwave
  [57, 60, 64, 67], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67],
]
const ASTER_PROG = [ // Dm  Bb  Gm  F-ish — rainy and aching
  [50, 53, 57, 62], [46, 50, 53, 58], [43, 46, 50, 55], [45, 48, 53, 57],
]
const HACK_ARP = [57, 60, 64, 68] // A C E G# — unresolved, tense

const THEMES = {
  menu: {
    level: 1, stepDur: 0.27, ambient: null,
    step(t, i, out) {
      const chord = MENU_PROG[(i >> 4) % 4]
      const seq = [0, 1, 2, 3, 1, 2, 3, 2]
      voice(t, { freq: n2f(chord[seq[i % 8]] + 12), dur: 0.22, type: 'sawtooth', vol: 0.055,
        attack: 0.005, release: 0.12, fType: 'lowpass', fFreq: 950 + 300 * Math.sin(i * 0.6), q: 4, out })
      if (i % 8 === 0) voice(t, { freq: n2f(chord[0] - 12), dur: 1.6, type: 'triangle', vol: 0.11, attack: 0.02, release: 0.4, out })
      if (i % 4 === 0) voice(t, { freq: 100, slide: 40, dur: 0.12, type: 'sine', vol: 0.22, attack: 0.004, release: 0.05, out })
      if (i % 16 === 0) for (const n of chord) voice(t, { freq: n2f(n), dur: 3.4, type: 'triangle', vol: 0.02, attack: 1, release: 1.2, detune: rnd(-7, 7), out })
    },
  },
  aster: {
    level: 1, stepDur: 0.5, ambient: 'rain',
    step(t, i, out) {
      const chord = ASTER_PROG[(i >> 4) % 4]
      if (i % 16 === 0) for (const n of chord) {
        voice(t, { freq: n2f(n + 12), dur: 6.4, type: 'sine', vol: 0.035, attack: 1.4, release: 1.8, out })
        voice(t, { freq: n2f(n + 12), dur: 6.4, type: 'triangle', vol: 0.016, attack: 1.8, release: 1.8, detune: 9, out })
      }
      if (i % 16 === 8) voice(t, { freq: n2f(chord[0] - 12), dur: 1.8, type: 'triangle', vol: 0.085, attack: 0.04, release: 0.6, out })
      if (i % 16 === 13) { // lone bell + its echo, far off in the rain
        const top = n2f(chord[3] + 24)
        voice(t, { freq: top, dur: 0.5, type: 'sine', vol: 0.04, attack: 0.01, release: 0.9, out })
        voice(t + 0.42, { freq: top, dur: 0.4, type: 'sine', vol: 0.018, attack: 0.01, release: 0.8, out })
      }
    },
  },
  underground: {
    level: 1, stepDur: 0.46, ambient: 'rumble',
    step(t, i, out) {
      if (i % 2 === 0) voice(t, { freq: 55, dur: 0.5, type: 'sine', vol: 0.16, attack: 0.06, release: 0.25, out })
      if (i % 4 === 0) voice(t, { freq: 110, dur: 0.3, type: 'triangle', vol: 0.04, attack: 0.05, release: 0.2, fType: 'lowpass', fFreq: 500, out })
      if (i % 32 === 0) {
        voice(t, { freq: 220, dur: 12, type: 'sine', vol: 0.022, attack: 3, release: 4, out })
        voice(t, { freq: 261.6, dur: 12, type: 'sine', vol: 0.016, attack: 4, release: 4, detune: 6, out })
      }
      if (i % 16 === 10) voice(t, { freq: n2f(79), dur: 0.12, type: 'square', vol: 0.022, attack: 0.005, release: 0.3, fType: 'lowpass', fFreq: 2200, out })
    },
  },
  forge: {
    level: 1, stepDur: 0.21, ambient: null,
    step(t, i, out) {
      const p = i % 16
      if (p % 4 === 0) voice(t, { freq: 95, slide: 38, dur: 0.13, type: 'sine', vol: 0.3, attack: 0.003, release: 0.06, out })
      if (p === 3 || p === 6 || p === 11 || p === 14) { // metal-on-metal clank
        noise(t, { dur: 0.16, vol: 0.13, fType: 'bandpass', fFreq: 1900 + (p * 173) % 1400, q: 9, out })
        voice(t, { freq: 720 * (1 + (p % 3) * 0.41), dur: 0.07, type: 'square', vol: 0.026, attack: 0.002, release: 0.18, fType: 'highpass', fFreq: 900, out })
      }
      if (p % 2 === 1) noise(t, { dur: 0.03, vol: 0.035, fType: 'highpass', fFreq: 6500, out })
      if (p === 0 || p === 3 || p === 6 || p === 10) voice(t, { freq: 55, dur: 0.16, type: 'square', vol: 0.1, attack: 0.004, release: 0.05, fType: 'lowpass', fFreq: 320, out })
    },
  },
  hack: {
    level: 1, stepDur: 0.13, ambient: null,
    step(t, i, out) {
      const heat = Math.min(1, i / 220) // intensifies as the run drags on
      const seq = [0, 1, 2, 3, 2, 3, 1, 2]
      voice(t, { freq: n2f(HACK_ARP[seq[i % 8]] + ((i >> 5) % 2 ? 12 : 0)), dur: 0.1, type: 'square',
        vol: 0.038 + 0.02 * heat, attack: 0.003, release: 0.07,
        fType: 'lowpass', fFreq: 450 + 1900 * heat + 250 * Math.sin(i * 0.4), q: 6, out })
      if (i % 8 === 0) voice(t, { freq: 55, dur: 0.5, type: 'sine', vol: 0.13, attack: 0.01, release: 0.2, out })
      if (i % 4 === 2) noise(t, { dur: 0.025, vol: 0.03 + 0.025 * heat, fType: 'highpass', fFreq: 7000, out })
      if (heat > 0.5 && i % 16 === 12) voice(t, { freq: n2f(69), dur: 0.08, type: 'square', vol: 0.03, attack: 0.002, release: 0.1, fType: 'bandpass', fFreq: 1800, q: 8, out })
    },
  },
  sister: {
    level: 1, stepDur: 0.55, ambient: null,
    step(t, i, out) {
      const p = i % 32
      const notes = (i >> 5) % 2 ? [74, 71, 69] : [76, 72, 71] // 3-note motif, answered lower
      const hit = p === 0 ? notes[0] : p === 3 ? notes[1] : p === 6 ? notes[2] : 0
      if (hit) {
        const f = n2f(hit)
        voice(t, { freq: f, dur: 1.2, type: 'sine', vol: 0.065, attack: 0.04, release: 1.6, out })
        voice(t, { freq: f, dur: 1.2, type: 'triangle', vol: 0.014, attack: 0.06, release: 1.4, detune: 9, out })
        voice(t + 0.45, { freq: f, dur: 0.9, type: 'sine', vol: 0.024, attack: 0.03, release: 1.4, out })
        voice(t + 0.9, { freq: f, dur: 0.7, type: 'sine', vol: 0.01, attack: 0.03, release: 1.2, out })
      }
      if (p === 0) {
        voice(t, { freq: 110, dur: 14, type: 'sine', vol: 0.025, attack: 4, release: 5, out })
        voice(t, { freq: 164.8, dur: 14, type: 'sine', vol: 0.014, attack: 5, release: 5, detune: -6, out })
      }
    },
  },
  victory: {
    level: 1, stepDur: 0.16, ambient: null,
    step(t, i, out) {
      const p = i % 48
      const run = [72, 76, 79, 84]
      if (p < 4) {
        voice(t, { freq: n2f(run[p]), dur: 0.14, type: 'sawtooth', vol: 0.07, attack: 0.004, release: 0.25, fType: 'lowpass', fFreq: 3200, out })
        voice(t, { freq: n2f(run[p] + 12), dur: 0.12, type: 'triangle', vol: 0.04, attack: 0.004, release: 0.2, out })
      }
      if (p === 4) for (const n of [60, 64, 67, 72]) voice(t, { freq: n2f(n), dur: 1.6, type: 'triangle', vol: 0.045, attack: 0.02, release: 0.9, detune: rnd(-6, 6), out })
      if (p === 10 || p === 14) voice(t, { freq: n2f(p === 10 ? 88 : 91), dur: 0.2, type: 'sine', vol: 0.035, attack: 0.01, release: 0.5, out })
      if (p === 24) for (const n of [76, 79]) voice(t, { freq: n2f(n), dur: 2.4, type: 'sine', vol: 0.02, attack: 0.8, release: 1.2, out })
    },
  },
}

// ---- track lifecycle -------------------------------------------------------

function startTrack(name, def) {
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(duckBus)
  const tr = { name, def, out, step: 0, nextTime: ctx.currentTime + 0.06, timer: 0, dead: false, ambient: [] }
  if (def.ambient) tr.ambient = startAmbient(def.ambient, out)
  const tick = () => {
    if (tr.dead) return
    const horizon = ctx.currentTime + LOOKAHEAD
    while (tr.nextTime < horizon) { // drift-free: steps ride ctx.currentTime, not setTimeout
      try { def.step(tr.nextTime, tr.step, out) } catch { /* keep the loop alive */ }
      tr.nextTime += def.stepDur
      tr.step++
    }
    tr.timer = setTimeout(tick, TICK_MS)
  }
  tick()
  const t = ctx.currentTime
  out.gain.setValueAtTime(0, t)
  out.gain.linearRampToValueAtTime(def.level, t + FADE)
  return tr
}

function killTrack(tr, fade = FADE) {
  const t = ctx.currentTime
  tr.out.gain.cancelScheduledValues(t)
  tr.out.gain.setValueAtTime(Math.max(tr.out.gain.value, 0.0001), t)
  tr.out.gain.linearRampToValueAtTime(0, t + fade)
  setTimeout(() => {
    tr.dead = true
    clearTimeout(tr.timer)
    for (const n of tr.ambient) { try { n.stop() } catch { /* already stopped */ } }
    try { tr.out.disconnect() } catch { /* already gone */ }
  }, fade * 1000 + 80)
}

// ---- one-shot SFX ----------------------------------------------------------

const SFX = {
  blip(t) { voice(t, { freq: 880, dur: 0.05, type: 'square', vol: 0.12, attack: 0.002, release: 0.04, out: sfxVol }) },
  confirm(t) {
    voice(t, { freq: 660, dur: 0.05, type: 'square', vol: 0.1, attack: 0.002, release: 0.04, out: sfxVol })
    voice(t + 0.07, { freq: 990, dur: 0.08, type: 'square', vol: 0.1, attack: 0.002, release: 0.08, out: sfxVol })
  },
  cancel(t) { voice(t, { freq: 520, slide: 320, dur: 0.12, type: 'square', vol: 0.09, attack: 0.002, release: 0.06, out: sfxVol }) },
  step(t) { noise(t, { dur: 0.04, vol: 0.05, fType: 'lowpass', fFreq: rnd(380, 520), release: 0.03, out: sfxVol }) },
  error(t) {
    voice(t, { freq: 220, slide: 92, dur: 0.22, type: 'sawtooth', vol: 0.09, attack: 0.004, release: 0.08, fType: 'lowpass', fFreq: 900, detune: -14, out: sfxVol })
    voice(t, { freq: 222, slide: 96, dur: 0.22, type: 'sawtooth', vol: 0.09, attack: 0.004, release: 0.08, fType: 'lowpass', fFreq: 900, detune: 14, out: sfxVol })
  },
  win(t) {
    const run = [67, 72, 76, 79]
    run.forEach((n, k) => voice(t + k * 0.07, { freq: n2f(n), dur: 0.1, type: 'triangle', vol: 0.11, attack: 0.003, release: 0.12, out: sfxVol }))
    voice(t + 0.3, { freq: n2f(84), dur: 0.35, type: 'triangle', vol: 0.1, attack: 0.004, release: 0.4, out: sfxVol })
  },
  keyget(t) {
    voice(t, { freq: 1318.5, dur: 0.07, type: 'triangle', vol: 0.09, attack: 0.002, release: 0.1, out: sfxVol })
    voice(t + 0.09, { freq: 1760, dur: 0.16, type: 'triangle', vol: 0.09, attack: 0.002, release: 0.3, out: sfxVol })
    voice(t + 0.09, { freq: 2637, dur: 0.12, type: 'sine', vol: 0.03, attack: 0.002, release: 0.3, out: sfxVol })
  },
  glitch(t) {
    for (let k = 0; k < 6; k++)
      voice(t + k * 0.03, { freq: rnd(280, 1900), dur: 0.025, type: 'square', vol: 0.05, attack: 0.001, release: 0.02, out: sfxVol })
    noise(t, { dur: 0.16, vol: 0.04, fType: 'highpass', fFreq: 2800, release: 0.04, out: sfxVol })
  },
  train(t) {
    noise(t, { dur: 1, vol: 0.09, attack: 0.4, release: 0.5, fType: 'lowpass', fFreq: 750, slide: 320, out: sfxVol })
    voice(t + 0.18, { freq: 233.1, dur: 0.5, type: 'sawtooth', vol: 0.045, attack: 0.06, release: 0.25, fType: 'lowpass', fFreq: 1100, out: sfxVol })
    voice(t + 0.18, { freq: 277.2, dur: 0.5, type: 'sawtooth', vol: 0.04, attack: 0.06, release: 0.25, fType: 'lowpass', fFreq: 1100, out: sfxVol })
  },
}

// ---- public API ------------------------------------------------------------

export const audio = {
  // Create/resume the AudioContext on first user gesture (main.js calls this on keydown).
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      try { ctx = new AC() } catch { ctx = null; return }
      buildGraph()
    }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}) } catch { /* locked */ } }
    if (pendingTheme && !current) {
      const theme = pendingTheme
      pendingTheme = null
      audio.play(theme)
    }
  },

  // Crossfade-loop a generated theme: menu,aster,underground,forge,hack,sister,victory.
  play(theme) {
    const def = THEMES[theme]
    if (!def) return
    if (!ctx) { pendingTheme = theme; return } // queued; unlock() starts it
    if (current && !current.dead && current.name === theme) return
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}) } catch { /* locked */ } }
    if (current) killTrack(current)
    current = startTrack(theme, def)
  },

  stop() {
    pendingTheme = null
    if (current) { killTrack(current); current = null }
  },

  // One-shot: blip,confirm,cancel,step,error,win,keyget,glitch,train.
  sfx(name) {
    if (!ctx || !SFX[name]) return
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}) } catch { /* locked */ } return }
    try { SFX[name](ctx.currentTime + 0.001) } catch { /* never break the frame */ }
  },

  // Lower the music bed under dialogue.
  duck(on = true) {
    ducked = !!on
    if (duckBus) duckBus.gain.setTargetAtTime(ducked ? DUCK_LEVEL : 1, ctx.currentTime, 0.12)
  },

  // Re-read G.settings.musicVol / sfxVol (options screen calls this on change).
  setVols() {
    if (!ctx) return
    musicVol.gain.setTargetAtTime(clamp01(G.settings.musicVol), ctx.currentTime, 0.05)
    sfxVol.gain.setTargetAtTime(clamp01(G.settings.sfxVol), ctx.currentTime, 0.05)
  },
}
