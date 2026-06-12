// ============================================================================
// NETRUNNER · src/ui/hud.js — pause menu (Kit / Codex / Quests / Save / Options)
// and the toast queue.
//
// Contract (ARCHITECTURE.md §7):
//   export class PauseScene extends Scene
//   export function updateToasts(dt)
//   export function renderToasts(ctx)     listens to bus 'toast'(str)
// ============================================================================

import { Scene, scenes } from '../core/scenes.js'
import { G, save, hasSaveCached } from '../core/state.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { bus } from '../core/events.js'
import { audio } from '../core/audio.js'
import { PAL, mix, rgba } from '../assets/palette.js'

const P = PAL.aster
const CYAN = P.neon1
const MAGENTA = P.neon2
const AMBER = P.accent
const GREEN = '#6dff7a'
const INK = P.ink
const HI = P.hi
const DIM = '#5b6c8e'
const DEAD = '#323d54'

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

function wrap(ctx, text, maxW, font = '8px monospace') {
  ctx.font = font
  const words = String(text).split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w
    if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  return lines
}

function pretty(id) {
  return String(id).replace(/^(q_|m_|prog_|kit_|codex_|cx_)/, '').replace(/[_-]+/g, ' ').toUpperCase()
}

function act(e) {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': return 'left'
    case 'ArrowRight': case 'KeyD': return 'right'
    case 'ArrowUp': case 'KeyW': return 'up'
    case 'ArrowDown': case 'KeyS': return 'down'
    case 'Enter': case 'KeyZ': case 'Space': return 'confirm'
    case 'Escape': case 'KeyX': case 'KeyI': return 'cancel'
    default: return null
  }
}

// ============================================================================
// Toasts — top-right neon slide-ins ('AUTOSAVED', 'ACCESS-KEY GET', ...)
// ============================================================================

const TOAST_LIFE = 3.0
const TOAST_IN = 0.22
const TOAST_OUT = 0.3
const toasts = []

bus.on('toast', msg => {
  toasts.push({ text: String(msg), t: 0 })
  if (toasts.length > 5) toasts.shift()
  audio.sfx('blip')
})

export function updateToasts(dt) {
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].t += dt
    if (toasts[i].t >= TOAST_LIFE) toasts.splice(i, 1)
  }
}

export function renderToasts(ctx) {
  if (!toasts.length) return
  ctx.save()
  ctx.textBaseline = 'top'
  ctx.font = 'bold 8px monospace'
  toasts.forEach((tst, i) => {
    // slide in from the right, hold, slide back out
    let k = 1
    if (tst.t < TOAST_IN) k = tst.t / TOAST_IN
    else if (tst.t > TOAST_LIFE - TOAST_OUT) k = (TOAST_LIFE - tst.t) / TOAST_OUT
    k = Math.max(0, Math.min(1, k))
    const ease = 1 - (1 - k) * (1 - k)
    const w = ctx.measureText(tst.text).width + 18
    const x = VIEW_W - 6 - w * ease + (1 - ease) * 40
    const y = 8 + i * 18
    ctx.globalAlpha = ease
    ctx.fillStyle = 'rgba(4,6,13,0.93)'
    ctx.fillRect(x, y, w, 14)
    ctx.shadowColor = CYAN
    ctx.shadowBlur = 6
    ctx.strokeStyle = rgba(CYAN, 0.8)
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 13)
    ctx.shadowBlur = 0
    ctx.fillStyle = MAGENTA
    ctx.fillRect(x + 2, y + 2, 2, 10)
    ctx.fillStyle = HI
    ctx.textAlign = 'left'
    ctx.fillText(tst.text, x + 8, y + 3)
  })
  ctx.globalAlpha = 1
  ctx.restore()
}

// ============================================================================
// In-world databases for the panes (graceful fallbacks for unknown ids)
// ============================================================================

const KIT_DESC = {
  default: 'Runner-built program. Does exactly what it says — which is the unsettling part.',
  key: 'An access-key. Opens a door that was never supposed to open for you.',
}

const CODEX_DB = {
  the_blackout: {
    title: 'THE BLACKOUT',
    body: 'For nine seconds the whole city went dark and every screen said ERROR 404. Officially it never happened. Officially is doing a lot of work in that sentence.',
  },
  the_kernel: {
    title: 'THE KERNEL',
    body: 'A century of auto-update scripts left running in the dark. Nobody wrote it. It accreted. Now it edits the records, and the records edit the people.',
  },
  the_underground: {
    title: 'THE UNDERGROUND',
    body: 'Runners who keep their machines off The Grid\'s leash. They build, they defend, they remember. The door is under the rail line, and it only opens for the trusted.',
  },
  the_grid: {
    title: 'THE GRID',
    body: 'The network that runs everything: payroll, trains, memory. It is very good at being believed. That is not the same as being honest.',
  },
  runners_code: {
    title: 'THE RUNNER\'S CODE',
    body: 'Your rig, your rules — anyone else\'s only with their word. Break nothing you were not invited to break. What you learn in the dark, use to guard the light.',
  },
  mara: {
    title: 'MARA',
    body: 'Your sister. HR row deleted, photos blank, neighbors politely confused. Everyone forgot her in a night. You didn\'t. The question is why.',
  },
  rail: {
    title: 'THE RAIL',
    body: 'Mag-rail spine linking the cities. The trains still run on time, which proves at least one machine in this world is on your side.',
  },
  access_keys: {
    title: 'ACCESS-KEYS',
    body: 'Signed tokens that convince a corp gateway you belong. Bosses keep them close. Vex sells them closer.',
  },
  heat: {
    title: 'HEAT',
    body: 'Trace pressure on a run. Watchdog daemons notice noise — sloppy commands, brute force, time wasted. Max heat means a burned line and a fast exit.',
  },
  // --- recovered on successful runs (granted by missions/quests) ---
  cx_hidden_files: {
    title: 'WHAT THE DOT HIDES',
    body: 'A filename that starts with a dot just stops showing up in a plain listing. It is not gone, not locked — only quiet. ls -a shows the quiet ones. Mara knew exactly which kind of quiet to use.',
  },
  cx_underground: {
    title: 'COORDINATES, RECOVERED',
    body: 'She left the way down inside her own machine, behind a dotfile and a knock. The proof of her erasure she left somewhere The Kernel cannot scrub: a corp database, in the one table that writes down everything that touches it.',
  },
  cx_sql_joins: {
    title: 'THE ROW THAT IS LEFT',
    body: 'Delete a person from a table and the things that pointed at them do not vanish — they dangle. A payroll line with no employee. A login with no user. Stitch the tables back together with a join and the hole where she was is the loudest thing in the data.',
  },
  key_forge_works: {
    title: 'ACCESS-KEY // FORGE',
    body: 'Pulled from the foreman rig when the line came back online. Forge Town\'s gateways read it as one of their own now. The rail north no longer argues with you.',
  },
}

const QUEST_DB = {
  q_find_terminal: {
    name: 'STATIC WHERE SHE STOOD',
    stages: [
      'Something is wrong with the morning. Find out what.',
      'Mara is gone and nobody remembers her. Search her room.',
      'There is a hidden terminal in her room. Power it on.',
      'Jack in and follow the thread she left for you.',
      'The thread leads under the city.',
    ],
  },
  q_underground: {
    name: 'DOORS BENEATH THE CITY',
    stages: [
      'Find the way into the Underground.',
      'Earn the doorkeeper\'s trust.',
      'Meet Glitch below the rail line.',
      'You run with the Underground now.',
    ],
  },
  q_forge_plant: {
    name: 'HEAT AND PRESSURE',
    stages: [
      'Ride the rail to Forge Town.',
      'The plant is failing and the town is choking. Find out why.',
      'Get inside the plant network.',
      'Bring the line back up — and collect what the boss owes you.',
      'The Forge breathes again.',
    ],
  },
}

// ---- kit glyphs: tiny 12x12 icons picked deterministically per program id ---

function idHash(id) {
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const GLYPH_COLS = [CYAN, MAGENTA, AMBER, GREEN]

function drawGlyph(ctx, x, y, id, t, lit) {
  const h = idHash(id)
  const col = GLYPH_COLS[h % GLYPH_COLS.length]
  const kind = /key/i.test(id) ? 1 : (h >> 4) % 5
  ctx.save()
  ctx.translate(x, y)
  if (lit) { ctx.shadowColor = col; ctx.shadowBlur = 5 }
  ctx.fillStyle = lit ? col : mix(col, '#1a2238', 0.55)
  switch (kind) {
    case 0: // chip
      ctx.fillRect(2, 2, 8, 8)
      ctx.fillStyle = '#070a14'
      ctx.fillRect(4, 4, 4, 4)
      ctx.fillStyle = lit ? col : mix(col, '#1a2238', 0.55)
      for (let i = 0; i < 3; i++) { ctx.fillRect(3 + i * 3, 0, 1, 2); ctx.fillRect(3 + i * 3, 10, 1, 2) }
      break
    case 1: // key
      ctx.fillRect(1, 4, 6, 4)
      ctx.fillStyle = '#070a14'
      ctx.fillRect(3, 5, 2, 2)
      ctx.fillStyle = lit ? col : mix(col, '#1a2238', 0.55)
      ctx.fillRect(7, 5, 5, 2)
      ctx.fillRect(9, 7, 1, 2)
      ctx.fillRect(11, 7, 1, 3)
      break
    case 2: // eye / scanner
      ctx.fillRect(2, 5, 8, 3)
      ctx.fillRect(4, 3, 4, 7)
      ctx.fillStyle = '#070a14'
      ctx.fillRect(5, 5, 2, 2)
      break
    case 3: // bolt
      ctx.fillRect(6, 0, 3, 5)
      ctx.fillRect(4, 4, 4, 3)
      ctx.fillRect(3, 7, 3, 5)
      break
    default: // ghost / daemon
      ctx.fillRect(3, 2, 6, 8)
      ctx.fillRect(2, 4, 8, 5)
      for (let i = 0; i < 3; i++) ctx.fillRect(3 + i * 3, 10, 1, 2)
      ctx.fillStyle = '#070a14'
      ctx.fillRect(4, 5, 1, 2)
      ctx.fillRect(7, 5, 1, 2)
      break
  }
  ctx.restore()
  ctx.shadowBlur = 0
}

// ============================================================================
// PauseScene
// ============================================================================

const TABS = ['KIT', 'CODEX', 'QUESTS', 'SAVE', 'OPTIONS']

export class PauseScene extends Scene {
  enter(params) {
    this.t = 0
    // coming back from the options screen lands you on the OPTIONS tab
    this.tab = params && params.fromOptions ? TABS.indexOf('OPTIONS') : 0
    this.sel = 0
  }

  update(dt) { this.t += dt }

  listLen() {
    switch (TABS[this.tab]) {
      case 'KIT': return G.kit.length
      case 'CODEX': return G.codex.length
      case 'QUESTS': return Object.keys(G.quests).length
      case 'SAVE': return 3
      default: return 0
    }
  }

  onKey(e) {
    const a = act(e)
    if (a === 'cancel') { audio.sfx('cancel'); scenes.switchTo('overworld', {}, 'none'); return }
    if (a === 'left' || a === 'right') {
      this.tab = (this.tab + (a === 'left' ? -1 : 1) + TABS.length) % TABS.length
      this.sel = 0
      audio.sfx('blip')
      return
    }
    const len = this.listLen()
    if ((a === 'up' || a === 'down') && len > 0) {
      this.sel = (this.sel + (a === 'up' ? -1 : 1) + len) % len
      audio.sfx('blip')
      return
    }
    if (a === 'confirm') {
      const tab = TABS[this.tab]
      if (tab === 'SAVE') {
        // save() is async (writes to the IndexedDB store). Don't assume it has
        // finished synchronously — toast on completion via the bus, and surface
        // a failure rather than a false "SAVED".
        const slot = this.sel
        audio.sfx('keyget')
        save(slot).then(ok => {
          if (ok) bus.emit('toast', slot === 0 ? 'SAVED · AUTO SLOT' : 'SAVED · SLOT ' + slot)
          else bus.emit('toast', 'SAVE FAILED')
        })
      } else if (tab === 'OPTIONS') {
        audio.sfx('confirm')
        scenes.switchTo('options', { back: 'pause' }, 'fade')
      }
    }
  }

  render(ctx) {
    const t = this.t
    // backdrop — the pause space is its own dark room
    ctx.fillStyle = '#04050b'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.strokeStyle = 'rgba(41,243,226,0.04)'
    ctx.lineWidth = 1
    for (let x = ((t * 4) % 26); x < VIEW_W; x += 26) { ctx.beginPath(); ctx.moveTo(x | 0, 0); ctx.lineTo(x | 0, VIEW_H); ctx.stroke() }
    ctx.fillStyle = 'rgba(120,150,200,0.03)'
    for (let y = (t * 12) % 6; y < VIEW_H; y += 6) ctx.fillRect(0, y | 0, VIEW_W, 1)

    // ---- header: runner strip
    const hh = 24
    ctx.fillStyle = 'rgba(8,11,20,0.95)'
    ctx.fillRect(0, 0, VIEW_W, hh)
    ctx.fillStyle = rgba(CYAN, 0.5)
    ctx.fillRect(0, hh, VIEW_W, 1)
    glowTxt(ctx, G.player.name, 10, 8, CYAN, 'bold 9px monospace', 'left', 5)
    txt(ctx, '¤ ' + G.creds, 120, 8, AMBER, 'bold 8px monospace')
    txt(ctx, 'REP ' + G.rep, 180, 8, MAGENTA, 'bold 8px monospace')
    const mins = G.clock.minutes | 0
    const hhmm = String((mins / 60) | 0).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0')
    txt(ctx, 'DAY ' + G.clock.day + ' · ' + hhmm, VIEW_W - 10, 8, INK, '8px monospace', 'right')

    // ---- tabs
    let tx = 10
    ctx.font = 'bold 9px monospace'
    TABS.forEach((tab, i) => {
      const w = ctx.measureText(tab).width + 16
      const on = i === this.tab
      if (on) {
        ctx.fillStyle = rgba(CYAN, 0.1)
        ctx.fillRect(tx, 32, w, 15)
        ctx.shadowColor = CYAN
        ctx.shadowBlur = 6
        ctx.fillStyle = CYAN
        ctx.fillRect(tx, 45, w, 2)
        ctx.shadowBlur = 0
      }
      txt(ctx, tab, tx + 8, 35, on ? HI : DIM, 'bold 9px monospace')
      tx += w + 6
    })

    // ---- content panel
    const py = 54
    const ph = VIEW_H - py - 22
    ctx.fillStyle = 'rgba(5,7,14,0.92)'
    ctx.fillRect(8, py, VIEW_W - 16, ph)
    ctx.strokeStyle = rgba(CYAN, 0.3 + 0.1 * Math.sin(t * 2))
    ctx.strokeRect(8.5, py + 0.5, VIEW_W - 17, ph - 1)

    switch (TABS[this.tab]) {
      case 'KIT': this.renderKit(ctx, py, ph, t); break
      case 'CODEX': this.renderCodex(ctx, py, ph); break
      case 'QUESTS': this.renderQuests(ctx, py, ph); break
      case 'SAVE': this.renderSave(ctx, py, ph, t); break
      case 'OPTIONS':
        txt(ctx, 'CRT · TEXT SPEED · VOLUMES · COLOR-SAFE MODE', VIEW_W / 2, py + ph / 2 - 14, DIM, '8px monospace', 'center')
        if (Math.sin(t * 4) > -0.3) glowTxt(ctx, '[ ENTER ]  OPEN SYSTEM CONFIG', VIEW_W / 2, py + ph / 2 + 2, CYAN, 'bold 9px monospace', 'center', 5)
        break
    }

    txt(ctx, '< > TABS · UP/DOWN SELECT · ENTER OK · ESC RESUME', VIEW_W / 2, VIEW_H - 14, DEAD, '7px monospace', 'center')
    ctx.textAlign = 'left'
  }

  renderKit(ctx, py, ph, t) {
    if (!G.kit.length) {
      txt(ctx, 'YOUR KIT IS EMPTY.', VIEW_W / 2, py + ph / 2 - 10, DIM, 'bold 9px monospace', 'center')
      txt(ctx, 'programs are out there — in the grid, in the dark, for sale.', VIEW_W / 2, py + ph / 2 + 4, DEAD, '8px monospace', 'center')
      return
    }
    G.kit.forEach((id, i) => {
      const y = py + 10 + i * 18
      if (y > py + ph - 30) return
      const sel = i === this.sel
      if (sel) { ctx.fillStyle = rgba(CYAN, 0.07); ctx.fillRect(14, y - 3, 200, 17) }
      drawGlyph(ctx, 18, y - 1, id, t, sel)
      txt(ctx, pretty(id), 36, y + 1, sel ? HI : INK, 'bold 8px monospace')
    })
    // detail pane
    const id = G.kit[this.sel]
    if (id == null) return
    const dx = 226
    ctx.fillStyle = rgba(MAGENTA, 0.06)
    ctx.fillRect(dx - 6, py + 8, VIEW_W - dx - 12, ph - 16)
    drawGlyph(ctx, dx, py + 14, id, t, true)
    glowTxt(ctx, pretty(id), dx + 18, py + 16, CYAN, 'bold 9px monospace', 'left', 5)
    const desc = KIT_DESC[id] || (/key/i.test(id) ? KIT_DESC.key : KIT_DESC.default)
    wrap(ctx, desc, VIEW_W - dx - 28).forEach((ln, k) => txt(ctx, ln, dx, py + 36 + k * 10, INK, '8px monospace'))
  }

  renderCodex(ctx, py, ph) {
    if (!G.codex.length) {
      txt(ctx, 'NOTHING RECOVERED YET.', VIEW_W / 2, py + ph / 2 - 10, DIM, 'bold 9px monospace', 'center')
      txt(ctx, 'the city remembers more than it admits. go ask it.', VIEW_W / 2, py + ph / 2 + 4, DEAD, '8px monospace', 'center')
      return
    }
    G.codex.forEach((id, i) => {
      const y = py + 10 + i * 13
      if (y > py + ph - 20) return
      const sel = i === this.sel
      if (sel) { ctx.fillStyle = rgba(CYAN, 0.07); ctx.fillRect(14, y - 2, 186, 12) }
      const entry = CODEX_DB[id]
      txt(ctx, (sel ? '> ' : '  ') + (entry ? entry.title : pretty(id)), 18, y, sel ? HI : INK, '8px monospace')
    })
    const id = G.codex[this.sel]
    if (id == null) return
    const entry = CODEX_DB[id] || { title: pretty(id), body: 'Recovered fragment. The rest is still encrypted — for now.' }
    const dx = 214
    ctx.fillStyle = rgba(MAGENTA, 0.06)
    ctx.fillRect(dx - 6, py + 8, VIEW_W - dx - 12, ph - 16)
    glowTxt(ctx, entry.title, dx, py + 14, MAGENTA, 'bold 9px monospace', 'left', 5)
    wrap(ctx, entry.body, VIEW_W - dx - 28).forEach((ln, k) => txt(ctx, ln, dx, py + 32 + k * 10, INK, '8px monospace'))
  }

  renderQuests(ctx, py, ph) {
    const entries = Object.entries(G.quests)
    if (!entries.length) {
      txt(ctx, 'NO ACTIVE THREADS.', VIEW_W / 2, py + ph / 2 - 10, DIM, 'bold 9px monospace', 'center')
      txt(ctx, 'the city will give you reasons soon enough.', VIEW_W / 2, py + ph / 2 + 4, DEAD, '8px monospace', 'center')
      return
    }
    let y = py + 12
    entries.forEach(([id, stage], i) => {
      if (y > py + ph - 24) return
      const sel = i === this.sel
      const q = QUEST_DB[id] || { name: pretty(id), stages: [] }
      const stages = q.stages.length ? q.stages : ['Stage ' + stage]
      const sIdx = Math.max(0, Math.min(stages.length - 1, stage | 0))
      const isDone = (stage | 0) >= stages.length - 1 && q.stages.length > 0
      if (sel) { ctx.fillStyle = rgba(CYAN, 0.07); ctx.fillRect(14, y - 3, VIEW_W - 30, 26) }
      glowTxt(ctx, (isDone ? '[OK] ' : '[>>] ') + q.name, 20, y, isDone ? GREEN : sel ? CYAN : INK, 'bold 9px monospace', 'left', sel ? 5 : 0)
      txt(ctx, stages[sIdx], 32, y + 12, sel ? INK : DIM, '8px monospace')
      y += 30
    })
  }

  renderSave(ctx, py, ph, t) {
    txt(ctx, 'BURN THIS MOMENT TO DISK.', VIEW_W / 2, py + 12, DIM, '8px monospace', 'center')
    for (let n = 0; n < 3; n++) {
      const y = py + 34 + n * 34
      const sel = n === this.sel
      const present = hasSaveCached(n) // sync cache; renderSave runs every frame
      ctx.fillStyle = sel ? rgba(CYAN, 0.09) : 'rgba(10,14,26,0.85)'
      ctx.fillRect(60, y, VIEW_W - 120, 26)
      ctx.strokeStyle = sel ? rgba(CYAN, 0.8) : rgba(CYAN, 0.2)
      if (sel) { ctx.shadowColor = CYAN; ctx.shadowBlur = 6 }
      ctx.strokeRect(60.5, y + 0.5, VIEW_W - 121, 25)
      ctx.shadowBlur = 0
      const label = n === 0 ? 'SLOT 0 · AUTO' : 'SLOT ' + n
      txt(ctx, (sel ? '> ' : '  ') + label, 70, y + 5, sel ? HI : INK, 'bold 9px monospace')
      txt(ctx, present ? 'DATA PRESENT' : 'EMPTY', VIEW_W - 70, y + 5, present ? GREEN : DEAD, '8px monospace', 'right')
      txt(ctx, present ? 'overwrite with the current run' : 'blank sectors, waiting', 70, y + 15, DEAD, '7px monospace')
    }
  }
}
