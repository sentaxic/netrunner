// ============================================================================
// NETRUNNER · src/ui/menu.js — front-of-house scenes, all drawn on the canvas.
//
// Contract (ARCHITECTURE.md §7):
//   export class EthicsScene   first-launch splash + the Runner's Code
//   export class MenuScene     animated neon title / NEW GAME / CONTINUE / ...
//   export class NewGameScene  handle entry + look pick -> newGame -> 'intro'
//   export class OptionsScene  CRT / text speed / volumes / color-safe / back
//   export class CreditsScene  scrolling credits + the diegetic end-card
// ============================================================================

import { Scene, scenes } from '../core/scenes.js'
import { G, hasSaveCached, load, newGame, saveSettings } from '../core/state.js'
import { VIEW_W, VIEW_H, setCRT } from '../core/renderer.js'
import { audio } from '../core/audio.js'
import { drawActor } from '../assets/sprites.js'
import { drawTile, setTilePalette } from '../assets/tiles.js'
import { PAL, mix, rgba } from '../assets/palette.js'
import { Particles, glitchRect } from '../assets/vfx.js'

const P = PAL.aster
const CYAN = P.neon1
const MAGENTA = P.neon2
const AMBER = P.accent
const INK = P.ink
const HI = P.hi
const DIM = '#5b6c8e'
const DEAD = '#323d54'

// ---- tiny shared helpers ----------------------------------------------------

function txt(ctx, s, x, y, col = INK, font = '8px monospace', align = 'left') {
  ctx.font = font
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  ctx.fillStyle = col
  ctx.fillText(s, x, y)
}

function glowTxt(ctx, s, x, y, col, font, align = 'left', blur = 6) {
  ctx.shadowColor = col
  ctx.shadowBlur = blur
  txt(ctx, s, x, y, col, font, align)
  ctx.shadowBlur = 0
}

// deterministic 0..1 hash — same recipe the tiles use, kept local on purpose
function hsh(a, b, s = 0) {
  let n = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}

// keydown -> abstract action (menus are onKey-driven, not polled)
function act(e) {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': return 'left'
    case 'ArrowRight': case 'KeyD': return 'right'
    case 'ArrowUp': case 'KeyW': return 'up'
    case 'ArrowDown': case 'KeyS': return 'down'
    case 'Enter': case 'KeyZ': case 'Space': return 'confirm'
    case 'Escape': case 'KeyX': return 'cancel'
    default: return null
  }
}

// ============================================================================
// EthicsScene — the gate. Mandatory real-world disclaimer + the Runner's Code.
// ============================================================================

const ETHICS_LINES = [
  'NETRUNNER IS A GAME. EVERY SYSTEM YOU WILL BREACH IN IT IS',
  'FICTIONAL — BUILT TO BE BROKEN, SANDBOXED, AND YOURS TO EXPLORE.',
  '',
  'OUT THERE IT IS DIFFERENT. ACCESSING COMPUTERS YOU DO NOT OWN,',
  'OR LACK PERMISSION TO TEST, IS A CRIME — US COMPUTER FRAUD &',
  'ABUSE ACT, UK COMPUTER MISUSE ACT, AND SIMILAR LAWS WORLDWIDE.',
  '',
  'TAKE WHAT YOU LEARN HERE AND USE IT TO BUILD AND TO DEFEND.',
  'PRACTICE FOR REAL ONLY WHERE YOU ARE INVITED: YOUR OWN MACHINES,',
  'HOME LABS, CTF EVENTS, AND AUTHORIZED BUG-BOUNTY PROGRAMS.',
]

const RUNNERS_CODE = [
  'I.   YOUR RIG, YOUR RULES. ANYONE ELSE\'S — ONLY WITH THEIR WORD.',
  'II.  BREAK NOTHING YOU WERE NOT INVITED TO BREAK.',
  'III. WHAT YOU LEARN IN THE DARK, USE TO GUARD THE LIGHT.',
  'IV.  THE GRID FORGETS NOTHING. RUN CLEAN.',
]

export class EthicsScene extends Scene {
  enter() { this.t = 0 }

  update(dt) { this.t += dt }

  onKey(e) {
    if (this.t < 0.8) return // let it land before it can be skipped
    if (act(e) === 'confirm') {
      localStorage.setItem('netrunner_ethics_ack', '1')
      audio.sfx('confirm')
      scenes.switchTo('menu', {}, 'fade')
    }
  }

  render(ctx) {
    const t = this.t
    ctx.fillStyle = '#030409'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)

    // slow scanline shimmer
    ctx.fillStyle = 'rgba(120,150,200,0.03)'
    for (let y = (t * 14) % 6; y < VIEW_H; y += 6) ctx.fillRect(0, y | 0, VIEW_W, 1)

    // amber broadcast frame
    ctx.shadowColor = AMBER
    ctx.shadowBlur = 8
    ctx.strokeStyle = rgba(AMBER, 0.8)
    ctx.strokeRect(8.5, 8.5, VIEW_W - 17, VIEW_H - 17)
    ctx.shadowBlur = 0
    ctx.strokeStyle = rgba(AMBER, 0.25)
    ctx.strokeRect(12.5, 12.5, VIEW_W - 25, VIEW_H - 25)

    glowTxt(ctx, '// PRIORITY BROADCAST — READ BEFORE YOU JACK IN //', VIEW_W / 2, 20, AMBER, 'bold 9px monospace', 'center', 8)

    ctx.textAlign = 'left'
    let y = 40
    for (const line of ETHICS_LINES) {
      if (line) txt(ctx, line, 28, y, INK, '8px monospace')
      y += 10
    }

    y += 4
    glowTxt(ctx, 'THE RUNNER\'S CODE', VIEW_W / 2, y, CYAN, 'bold 9px monospace', 'center', 7)
    y += 14
    ctx.textAlign = 'left'
    for (const line of RUNNERS_CODE) {
      txt(ctx, line, 28, y, mix(CYAN, INK, 0.45), '8px monospace')
      y += 10
    }

    if (this.t > 0.8 && Math.sin(t * 4) > -0.2) {
      glowTxt(ctx, '[ ENTER ]  I UNDERSTAND', VIEW_W / 2, VIEW_H - 26, HI, 'bold 9px monospace', 'center', 6)
    }

    // the broadcast crawls a little — it is coming over a bad wire
    if (hsh((t * 3) | 0, 7) > 0.93) glitchRect(ctx, 8, 8, VIEW_W - 16, VIEW_H - 16, 0.12)
    ctx.textAlign = 'left'
  }
}

// ============================================================================
// MenuScene — the living title screen. Rain, skyline, flickering neon logo.
// ============================================================================

const SPAN = 960 // skyline strip width before it wraps (2x view)

function makeSkyline(seed, minH, maxH) {
  const out = []
  let x = 0
  while (x < SPAN) {
    const r = hsh(x, seed)
    const w = 18 + ((r * 30) | 0)
    const h = minH + ((hsh(x, seed + 1) * (maxH - minH)) | 0)
    out.push({ x, w, h, r: hsh(x, seed + 2) })
    x += w + 2 + ((r * 8) | 0)
  }
  return out
}

export class MenuScene extends Scene {
  constructor() {
    super()
    this.far = makeSkyline(11, 70, 150)
    this.mid = makeSkyline(23, 50, 115)
    this.near = makeSkyline(37, 34, 88)
    this.fx = new Particles()
    this.t = 0
    this.cam = 0
    this.sel = 0
  }

  enter() {
    this.t = 0
    this.sel = 0
    setTilePalette('aster')
    audio.play('menu')
    if (!this.fx.rain.length) { this.fx.spawnRain(170); this.fx.spawnDataMotes(22) }
  }

  entries() {
    return [
      { label: 'NEW GAME', go: () => scenes.switchTo('newgame', {}, 'fade') },
      // disabled state uses the synchronous cache (entries() runs every frame);
      // load(0) is async, so switch only after it resolves.
      { label: 'CONTINUE', disabled: !hasSaveCached(0), go: () => { load(0).then(ok => { if (ok) scenes.switchTo('overworld', {}, 'glitch') }) } },
      { label: 'OPTIONS', go: () => scenes.switchTo('options', { back: 'menu' }, 'fade') },
      { label: 'CREDITS', go: () => scenes.switchTo('credits', {}, 'fade') },
    ]
  }

  update(dt) {
    this.t += dt
    this.cam += dt * 5 // the whole city slides past, slow as fog
    this.fx.update(dt)
  }

  onKey(e) {
    const a = act(e)
    const list = this.entries()
    if (a === 'up' || a === 'down') {
      const step = a === 'up' ? -1 : 1
      let s = this.sel
      do { s = (s + step + list.length) % list.length } while (list[s].disabled && s !== this.sel)
      this.sel = s
      audio.sfx('blip')
    } else if (a === 'confirm') {
      const item = list[this.sel]
      if (item.disabled) { audio.sfx('error'); return }
      audio.sfx('confirm')
      item.go()
    }
  }

  drawLayer(ctx, layer, factor, col, windows) {
    const base = VIEW_H - 16
    const off = (this.cam * factor) % SPAN
    for (const b of layer) {
      for (const wrap of [0, SPAN]) {
        const sx = Math.round(b.x - off + wrap)
        if (sx + b.w < -4 || sx > VIEW_W + 4) continue
        const top = base - b.h
        ctx.fillStyle = col
        ctx.fillRect(sx, top, b.w, b.h)
        // rooftop furniture
        if (b.r > 0.5) ctx.fillRect(sx + ((b.r * b.w) | 0) % Math.max(1, b.w - 3), top - 4, 2, 4)
        if (b.r > 0.82) { // blinking aircraft-warning beacon
          const on = Math.sin(this.t * 2.4 + b.x) > 0.55
          if (on) {
            ctx.shadowColor = '#ff4d4d'
            ctx.shadowBlur = 4
            ctx.fillStyle = '#ff5a5a'
            ctx.fillRect(sx + ((b.r * b.w) | 0) % Math.max(1, b.w - 3), top - 5, 1, 1)
            ctx.shadowBlur = 0
          }
        }
        if (!windows) continue
        // lit windows, hashed in building-local space so they hold still as the city drifts
        for (let wy = top + 4; wy < base - 5; wy += 5) {
          for (let wx = sx + 2; wx < sx + b.w - 3; wx += 4) {
            const h = hsh(b.x + (wx - sx), wy - top, 5)
            if (h < 0.66) continue
            let a = h > 0.94 ? 0.4 + 0.6 * Math.max(0, Math.sin(this.t * 11 + h * 40)) : 0.75
            ctx.globalAlpha = a * 0.8
            ctx.fillStyle = h > 0.9 ? CYAN : h > 0.8 ? AMBER : mix(INK, col, 0.45)
            ctx.fillRect(wx, wy, 2, 2)
          }
        }
        ctx.globalAlpha = 1
        // the occasional vertical neon sign
        if (b.r > 0.74 && b.w > 22) {
          const nc = b.r > 0.87 ? MAGENTA : CYAN
          const flick = hsh((this.t * 9) | 0, b.x) > 0.12 ? 1 : 0.25
          ctx.shadowColor = nc
          ctx.shadowBlur = 7 * flick
          ctx.fillStyle = rgba(nc, 0.85 * flick)
          ctx.fillRect(sx + b.w - 6, top + 8, 2, Math.min(22, b.h - 14))
          ctx.shadowBlur = 0
        }
        // a scrolling billboard on the widest near towers
        if (windows && b.r > 0.93 && b.w > 30 && b.h > 50) {
          drawTile(ctx, 'billboard', sx + 4, top + 10, this.t)
        }
      }
    }
  }

  render(ctx) {
    const t = this.t
    // sky
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.fillStyle = P.sky
    ctx.fillRect(0, 0, VIEW_W, 120)
    // city glow on the horizon
    ctx.fillStyle = rgba('#27406b', 0.22 + 0.04 * Math.sin(t * 0.7))
    ctx.fillRect(0, 96, VIEW_W, 60)

    // parallax skyline
    this.drawLayer(ctx, this.far, 0.35, '#0a0f1d', false)
    ctx.fillStyle = P.fog
    ctx.fillRect(0, 60, VIEW_W, VIEW_H - 60)
    this.drawLayer(ctx, this.mid, 0.7, '#0e1526', false)
    this.drawLayer(ctx, this.near, 1.3, '#131c33', true)

    // drifting fog bands
    ctx.fillStyle = rgba('#7896c8', 0.05)
    ctx.fillRect(0, 150 + Math.sin(t * 0.21) * 8, VIEW_W, 22)
    ctx.fillRect(0, 200 + Math.sin(t * 0.13 + 2) * 10, VIEW_W, 16)

    // wet street out front
    for (let x = 0; x < VIEW_W; x += 16) {
      const h = hsh(x, 99)
      drawTile(ctx, h < 0.22 ? 'puddle' : 'road', x, VIEW_H - 16, t)
    }

    // rain — glued to the drifting city, not the lens
    this.fx.render(ctx, this.cam, 0)

    // ---- the logo
    this.drawLogo(ctx, t)
    txt(ctx, 'SHE WAS ERASED. THE GRID LIED. JACK IN.', VIEW_W / 2, 86, DIM, '8px monospace', 'center')

    // ---- entries
    const list = this.entries()
    const baseY = 152
    list.forEach((item, i) => {
      const y = baseY + i * 17
      const sel = i === this.sel
      const col = item.disabled ? DEAD : sel ? HI : INK
      if (sel) {
        ctx.fillStyle = rgba(CYAN, 0.08)
        ctx.fillRect(VIEW_W / 2 - 64, y - 3, 128, 13)
        glowTxt(ctx, '>', VIEW_W / 2 - 56 + Math.round(Math.sin(t * 6)), y, CYAN, 'bold 9px monospace', 'left', 5)
        glowTxt(ctx, item.label, VIEW_W / 2, y, col, 'bold 9px monospace', 'center', 6)
      } else {
        txt(ctx, item.label, VIEW_W / 2, y, col, 'bold 9px monospace', 'center')
      }
    })

    // quiet footer
    txt(ctx, 'ALL TARGETS IN THIS GAME ARE FICTIONAL.', VIEW_W / 2, VIEW_H - 34, DEAD, '7px monospace', 'center')
    txt(ctx, 'REAL-WORLD UNAUTHORIZED ACCESS IS A CRIME. BUILD & DEFEND.', VIEW_W / 2, VIEW_H - 26, DEAD, '7px monospace', 'center')

    // the title screen itself is on a bad feed
    if (hsh((t * 2.5) | 0, 3) > 0.94) glitchRect(ctx, 0, 24, VIEW_W, 56, 0.25)
    ctx.textAlign = 'left'
  }

  drawLogo(ctx, t) {
    const word = 'NETRUNNER'
    const cx = VIEW_W / 2
    const y = 36
    ctx.font = 'bold 30px monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    const totalW = word.length * 21
    const bucket = (t * 8) | 0
    for (let i = 0; i < word.length; i++) {
      const lx = cx - totalW / 2 + i * 21 + 10
      const flick = hsh(i, bucket)
      const a = flick > 0.93 ? 0.3 : 0.92 + 0.08 * Math.sin(t * 30 + i)
      const jx = flick > 0.97 ? Math.round((flick - 0.97) * 90) : 0
      // magenta echo behind — the RGB split of an old sign
      ctx.globalAlpha = a * 0.45
      ctx.fillStyle = MAGENTA
      ctx.fillText(word[i], lx + 1 + jx, y + 1)
      // cyan main pass
      ctx.globalAlpha = a
      ctx.shadowColor = CYAN
      ctx.shadowBlur = 12
      ctx.fillStyle = mix(CYAN, '#ffffff', 0.25)
      ctx.fillText(word[i], lx + jx, y)
      ctx.shadowBlur = 0
    }
    ctx.globalAlpha = 1
    // sweeping highlight bar across the letters
    const sweep = ((t * 90) % (totalW + 160)) - 80
    ctx.globalAlpha = 0.16
    ctx.fillStyle = HI
    ctx.fillRect(cx - totalW / 2 + sweep, y - 2, 3, 32)
    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
  }
}

// ============================================================================
// NewGameScene — name your runner, pick your look, fall into the intro.
// ============================================================================

const LOOKS = ['a', 'b', 'c']
const LOOK_TAGS = { a: 'CYAN // WIRE-RAT', b: 'MAGENTA // NIGHT-OWL', c: 'AMBER // SALVAGER' }
const DIRS = ['down', 'left', 'up', 'right']

export class NewGameScene extends Scene {
  enter() {
    this.t = 0
    this.phase = 0      // 0 = handle entry · 1 = look pick
    this.name = ''
    this.look = 0
  }

  update(dt) { this.t += dt }

  onKey(e) {
    if (this.phase === 0) {
      if (e.code === 'Enter') {
        if (!this.name.trim()) this.name = 'RUNNER'
        this.name = this.name.trim()
        this.phase = 1
        audio.sfx('confirm')
        return
      }
      if (e.code === 'Escape') { audio.sfx('cancel'); scenes.switchTo('menu', {}, 'fade'); return }
      if (e.code === 'Backspace') { this.name = this.name.slice(0, -1); audio.sfx('blip'); return }
      if (e.key && e.key.length === 1 && /^[a-zA-Z0-9 _\-]$/.test(e.key) && this.name.length < 10) {
        this.name += e.key.toUpperCase()
        audio.sfx('blip')
      }
      return
    }
    // look pick
    const a = act(e)
    if (a === 'left') { this.look = (this.look + LOOKS.length - 1) % LOOKS.length; audio.sfx('blip') }
    else if (a === 'right') { this.look = (this.look + 1) % LOOKS.length; audio.sfx('blip') }
    else if (a === 'confirm') {
      audio.sfx('win')
      newGame(this.name, LOOKS[this.look])
      scenes.switchTo('intro', {}, 'glitch')
    } else if (a === 'cancel') { this.phase = 0; audio.sfx('cancel') }
  }

  render(ctx) {
    const t = this.t
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    // faint data grid
    ctx.strokeStyle = 'rgba(41,243,226,0.05)'
    ctx.lineWidth = 1
    for (let x = ((t * 6) % 24); x < VIEW_W; x += 24) { ctx.beginPath(); ctx.moveTo(x | 0, 0); ctx.lineTo(x | 0, VIEW_H); ctx.stroke() }
    for (let y = 0; y < VIEW_H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(VIEW_W, y + 0.5); ctx.stroke() }

    glowTxt(ctx, '// NEW RUNNER REGISTRATION //', VIEW_W / 2, 22, CYAN, 'bold 10px monospace', 'center', 7)

    if (this.phase === 0) {
      txt(ctx, 'EVERY HANDLE IS A MASK. CHOOSE YOURS.', VIEW_W / 2, 64, DIM, '8px monospace', 'center')
      // entry field
      const fw = 150
      const fx = VIEW_W / 2 - fw / 2
      ctx.fillStyle = 'rgba(4,6,13,0.95)'
      ctx.fillRect(fx, 100, fw, 22)
      ctx.shadowColor = CYAN
      ctx.shadowBlur = 6
      ctx.strokeStyle = rgba(CYAN, 0.7)
      ctx.strokeRect(fx + 0.5, 100.5, fw - 1, 21)
      ctx.shadowBlur = 0
      const caret = Math.sin(t * 6) > 0 ? '_' : ' '
      txt(ctx, '> ' + this.name + caret, fx + 8, 107, HI, 'bold 9px monospace')
      txt(ctx, 'TYPE A HANDLE · ENTER TO LOCK IT IN', VIEW_W / 2, 140, DIM, '7px monospace', 'center')
      txt(ctx, 'ESC · BACK', VIEW_W / 2, 152, DEAD, '7px monospace', 'center')
    } else {
      txt(ctx, 'HANDLE: ' + this.name, VIEW_W / 2, 48, INK, 'bold 9px monospace', 'center')
      txt(ctx, 'PICK YOUR SILHOUETTE. THE CITY WILL KNOW YOU BY IT.', VIEW_W / 2, 64, DIM, '8px monospace', 'center')

      const frame = Math.floor(t * 6) % 4
      const dir = DIRS[Math.floor(t / 1.2) % 4]
      LOOKS.forEach((lk, i) => {
        const sel = i === this.look
        const cx = VIEW_W / 2 + (i - 1) * 90
        const scale = sel ? 4 : 2.5
        const y = sel ? 96 : 118
        if (sel) {
          // glowing pad under the chosen runner
          ctx.shadowColor = CYAN
          ctx.shadowBlur = 9
          ctx.strokeStyle = rgba(CYAN, 0.7 + 0.3 * Math.sin(t * 3))
          ctx.beginPath()
          ctx.ellipse(cx, 96 + 24 * scale + 6, 38, 9, 0, 0, Math.PI * 2)
          ctx.stroke()
          ctx.shadowBlur = 0
        }
        ctx.save()
        ctx.translate(Math.round(cx - 8 * scale), Math.round(y))
        ctx.scale(scale, scale)
        ctx.globalAlpha = sel ? 1 : 0.45
        drawActor(ctx, 0, 0, { look: lk, dir: sel ? dir : 'down', frame: sel ? frame : 0, tint: sel ? 1.4 : 0.6 })
        ctx.restore()
        ctx.globalAlpha = 1
        if (sel) glowTxt(ctx, LOOK_TAGS[lk], cx, 226, CYAN, '8px monospace', 'center', 5)
      })

      if (Math.sin(t * 4) > -0.3) txt(ctx, '< >  CHOOSE   ·   ENTER  WAKE UP   ·   ESC  RENAME', VIEW_W / 2, 248, DIM, '7px monospace', 'center')
    }
    ctx.textAlign = 'left'
  }
}

// ============================================================================
// OptionsScene — settings, editable with arrows + confirm. Saves immediately.
// ============================================================================

const SPEED_NAMES = { 1: 'SLOW', 2: 'NORMAL', 3: 'FAST' }
const SAMPLE = 'The rain keeps falling. The Grid keeps lying.'

export class OptionsScene extends Scene {
  enter(params) {
    this.t = 0
    this.sel = 0
    this.back = (params && params.back) || 'menu'
  }

  rows() {
    const s = G.settings
    return [
      { label: 'CRT FILTER', value: s.crt ? 'ON' : 'OFF', adj: () => { s.crt = !s.crt; setCRT(s.crt) } },
      {
        label: 'TEXT SPEED', value: SPEED_NAMES[s.textSpeed] || 'NORMAL',
        adj: d => { s.textSpeed = Math.max(1, Math.min(3, (s.textSpeed || 2) + (d || 1))) },
      },
      {
        label: 'MUSIC VOL', slider: () => s.musicVol,
        adj: d => { s.musicVol = Math.round(Math.max(0, Math.min(1, s.musicVol + (d || 1) * 0.1)) * 10) / 10; audio.setVols() },
      },
      {
        label: 'SFX VOL', slider: () => s.sfxVol,
        adj: d => { s.sfxVol = Math.round(Math.max(0, Math.min(1, s.sfxVol + (d || 1) * 0.1)) * 10) / 10; audio.setVols() },
      },
      { label: 'COLOR-SAFE MODE', value: s.colorblind ? 'ON' : 'OFF', adj: () => { s.colorblind = !s.colorblind } },
      {
        label: 'JACK-IN LINK',
        value: s.vmMode === 'real' ? 'FULL DIVE' : 'LOCAL MIRROR',
        adj: () => { s.vmMode = s.vmMode === 'real' ? 'sim' : 'real' },
        hint: s.vmMode === 'real' ? 'real x86 linux · streams ~600MB on first dive' : 'instant · sandboxed · works offline',
      },
      { label: 'BACK', exit: true },
    ]
  }

  update(dt) { this.t += dt }

  leave() { saveSettings(); audio.sfx('cancel'); scenes.switchTo(this.back, { fromOptions: true }, 'fade') }

  onKey(e) {
    const a = act(e)
    const rows = this.rows()
    if (a === 'up') { this.sel = (this.sel + rows.length - 1) % rows.length; audio.sfx('blip') }
    else if (a === 'down') { this.sel = (this.sel + 1) % rows.length; audio.sfx('blip') }
    else if (a === 'left' || a === 'right') {
      const row = rows[this.sel]
      if (row.adj) { row.adj(a === 'left' ? -1 : 1); saveSettings(); audio.sfx('blip') }
    } else if (a === 'confirm') {
      const row = rows[this.sel]
      if (row.exit) { this.leave(); return }
      if (row.adj) { row.adj(1); saveSettings(); audio.sfx('confirm') }
    } else if (a === 'cancel') this.leave()
  }

  render(ctx) {
    const t = this.t
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.fillStyle = 'rgba(120,150,200,0.03)'
    for (let y = (t * 10) % 5; y < VIEW_H; y += 5) ctx.fillRect(0, y | 0, VIEW_W, 1)

    glowTxt(ctx, '// SYSTEM CONFIG //', VIEW_W / 2, 22, CYAN, 'bold 10px monospace', 'center', 7)

    const rows = this.rows()
    const x0 = 110
    rows.forEach((row, i) => {
      const y = 58 + i * 22
      const sel = i === this.sel
      if (sel) {
        ctx.fillStyle = rgba(CYAN, 0.07)
        ctx.fillRect(x0 - 18, y - 4, 296, 16)
        glowTxt(ctx, '>', x0 - 12 + Math.round(Math.sin(t * 6)), y, CYAN, 'bold 9px monospace', 'left', 5)
      }
      txt(ctx, row.label, x0, y, sel ? HI : INK, 'bold 9px monospace')
      if (row.slider) {
        const v = row.slider()
        const bx = x0 + 140
        for (let k = 0; k < 10; k++) {
          const on = v >= (k + 1) / 10 - 0.001
          if (on && sel) { ctx.shadowColor = CYAN; ctx.shadowBlur = 4 }
          ctx.fillStyle = on ? (sel ? CYAN : mix(CYAN, '#3a4458', 0.45)) : '#1a2238'
          ctx.fillRect(bx + k * 12, y + 1, 8, 7)
          ctx.shadowBlur = 0
        }
        txt(ctx, Math.round(v * 100) + '%', bx + 126, y, sel ? HI : DIM, '8px monospace')
      } else if (row.value != null) {
        const col = row.value === 'OFF' ? DIM : sel ? CYAN : INK
        if (sel) { txt(ctx, '< ' + row.value + ' >', x0 + 140, y, col, 'bold 9px monospace') }
        else txt(ctx, row.value, x0 + 152, y, col, '9px monospace')
      }
    })

    // hint for the selected row (e.g. what the jack-in link actually does)
    const selRow = rows[this.sel]
    if (selRow && selRow.hint) {
      txt(ctx, selRow.hint, VIEW_W / 2, 196, rgba(AMBER, 0.85), '7px monospace', 'center')
      ctx.textAlign = 'left'
    }

    // live text-speed sample, looping forever in its little cage
    const cps = { 1: 16, 2: 36, 3: 72 }[G.settings.textSpeed] || 36
    const n = Math.floor((t * cps) % (SAMPLE.length + 24))
    ctx.fillStyle = 'rgba(4,6,13,0.9)'
    ctx.fillRect(92, 206, 296, 18)
    ctx.strokeStyle = rgba(MAGENTA, 0.35)
    ctx.strokeRect(92.5, 206.5, 295, 17)
    txt(ctx, SAMPLE.slice(0, n), 100, 212, DIM, '8px monospace')

    txt(ctx, '< > ADJUST · ENTER TOGGLE · ESC BACK', VIEW_W / 2, VIEW_H - 22, DEAD, '7px monospace', 'center')
    ctx.textAlign = 'left'
  }
}

// ============================================================================
// CreditsScene — slow scroll up through the dark, ending on the truth.
// ============================================================================

const CREDITS = [
  { s: 'title', t: 'NETRUNNER' },
  { s: 'dim', t: 'a game about finding what the machine erased' },
  { s: 'gap' },
  { s: 'head', t: 'THE UNDERGROUND CELL' },
  { s: 'dim', t: 'design · code · world' }, { s: 'ink', t: 'THE UNDERGROUND' },
  { s: 'dim', t: 'every pixel' }, { s: 'ink', t: 'DRAWN BY CODE, LIVE, EVERY FRAME' },
  { s: 'dim', t: 'every sound' }, { s: 'ink', t: 'SYNTHESIZED ON THE SPOT — NO TAPES, NO FILES' },
  { s: 'gap' },
  { s: 'head', t: 'CAST' },
  { s: 'ink', t: 'THE RUNNER ......... YOU' },
  { s: 'ink', t: 'MARA ............... THE ONE THEY ERASED' },
  { s: 'ink', t: 'GLITCH ............. THE ONE WHO FOUND YOU' },
  { s: 'ink', t: 'VEX ................ THE ONE WHO SELLS THE KEYS' },
  { s: 'ink', t: 'THE KERNEL ......... IT HAS NO FACE. THAT IS THE POINT.' },
  { s: 'gap' },
  { s: 'head', t: 'TOOLS OF THE TRADE' },
  { s: 'ink', t: 'ls · cd · cat · grep · find · chmod · ssh · SQL' },
  { s: 'dim', t: 'no props. no fakes. the real instruments.' },
  { s: 'gap' },
  { s: 'head', t: 'THE RUNNER\'S CODE' },
  { s: 'dim', t: 'break nothing you were not invited to break.' },
  { s: 'dim', t: 'what you learn in the dark, use to guard the light.' },
  { s: 'gap' }, { s: 'gap' },
  { s: 'card', t: 'Everything you just did was real.' },
  { s: 'card', t: 'You can do all of it on a real computer right now.' },
  { s: 'gap' },
  { s: 'amber', t: 'BUILD. DEFEND. FIND HER.' },
]

export class CreditsScene extends Scene {
  enter() {
    this.t = 0
    this.y = VIEW_H + 16
    this.fx = new Particles()
    this.fx.spawnDataMotes(34)
    audio.play('sister')
  }

  totalH() { return CREDITS.length * 14 + 40 }

  update(dt) {
    this.t += dt
    this.fx.update(dt)
    const stopY = VIEW_H / 2 - this.totalH() + 60 // hold once the end-card is centered
    if (this.y > stopY) this.y -= dt * 16
  }

  onKey(e) {
    const a = act(e)
    if (a === 'cancel' || a === 'confirm') {
      audio.sfx('cancel')
      scenes.switchTo('menu', {}, 'fade')
    }
  }

  render(ctx) {
    ctx.fillStyle = '#030409'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    this.fx.render(ctx, 0, 0)

    let y = this.y
    for (const line of CREDITS) {
      if (y > -20 && y < VIEW_H + 20) {
        switch (line.s) {
          case 'title': glowTxt(ctx, line.t, VIEW_W / 2, y, CYAN, 'bold 18px monospace', 'center', 10); break
          case 'head': glowTxt(ctx, '— ' + line.t + ' —', VIEW_W / 2, y, MAGENTA, 'bold 9px monospace', 'center', 6); break
          case 'ink': txt(ctx, line.t, VIEW_W / 2, y, INK, '8px monospace', 'center'); break
          case 'dim': txt(ctx, line.t, VIEW_W / 2, y, DIM, '8px monospace', 'center'); break
          case 'amber': glowTxt(ctx, line.t, VIEW_W / 2, y, AMBER, 'bold 10px monospace', 'center', 8); break
          case 'card': {
            const a = 0.8 + 0.2 * Math.sin(this.t * 1.6)
            ctx.globalAlpha = a
            glowTxt(ctx, line.t, VIEW_W / 2, y, HI, 'bold 9px monospace', 'center', 7)
            ctx.globalAlpha = 1
            break
          }
        }
      }
      y += line.s === 'title' ? 26 : line.s === 'gap' ? 10 : 14
    }

    txt(ctx, 'ESC · BACK', VIEW_W - 10, VIEW_H - 12, DEAD, '7px monospace', 'right')
    ctx.textAlign = 'left'
  }
}
