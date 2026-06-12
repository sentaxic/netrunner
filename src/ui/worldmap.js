// ============================================================================
// NETRUNNER · src/ui/worldmap.js — the rail network as a living neon node graph.
//
// Contract (ARCHITECTURE.md §7):
//   export class WorldMapScene extends Scene
//
// Cursor moves between unlocked nodes (G.citiesUnlocked), confirm boards the
// train (switch to overworld at that city's entry map), Esc/back returns.
// Locked future cities sit dimmed on the line, waiting.
// ============================================================================

import { Scene, scenes } from '../core/scenes.js'
import { G } from '../core/state.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { audio } from '../core/audio.js'
import { bus } from '../core/events.js'
import { PAL, mix, rgba } from '../assets/palette.js'
import { glitchRect } from '../assets/vfx.js'

const P = PAL.aster
const CYAN = P.neon1
const MAGENTA = P.neon2
const AMBER = P.accent
const INK = P.ink
const HI = P.hi
const DIM = '#5b6c8e'
const DEAD = '#27304a'

// ---- the network ------------------------------------------------------------

const CITIES = [
  { id: 'aster', name: 'ASTER CITY', sub: 'THE HUB · WHERE IT STARTED', x: 168, y: 152, map: 'aster_street', sx: 6, sy: 7, col: CYAN },
  { id: 'forge', name: 'FORGE TOWN', sub: 'INDUSTRIAL BELT · ALWAYS BURNING', x: 308, y: 104, map: 'forge_street', sx: 6, sy: 7, col: AMBER },
  // future stops — dimmed, dreaming
  { id: 'meridian', name: 'MERIDIAN SPIRE', sub: 'NO SIGNAL', x: 404, y: 168, future: true },
  { id: 'sodium', name: 'SODIUM FLATS', sub: 'NO SIGNAL', x: 84, y: 92, future: true },
  { id: 'undertow', name: 'UNDERTOW', sub: 'NO SIGNAL', x: 236, y: 226, future: true },
]

const EDGES = [
  ['aster', 'forge'],
  ['forge', 'meridian'],
  ['aster', 'sodium'],
  ['aster', 'undertow'],
]

const MAP_CITY = {
  apartment: 'aster', sister_room: 'aster', aster_street: 'aster',
  underground: 'aster', rail_station: 'aster',
  forge_street: 'forge', forge_plant: 'forge',
}

const city = id => CITIES.find(c => c.id === id)
const unlocked = c => !c.future && G.citiesUnlocked.includes(c.id)

function hsh(a, b, s = 0) {
  let n = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function act(e) {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': return 'left'
    case 'ArrowRight': case 'KeyD': return 'right'
    case 'ArrowUp': case 'KeyW': return 'up'
    case 'ArrowDown': case 'KeyS': return 'down'
    case 'Enter': case 'KeyZ': case 'Space': return 'confirm'
    case 'Escape': case 'KeyX': case 'KeyM': return 'cancel'
    default: return null
  }
}

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

// a gentle sag between stations, like real cable
function edgeMid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 14 }
}

function pointOnEdge(a, b, k) {
  const m = edgeMid(a, b)
  const u = 1 - k
  return { // quadratic bezier
    x: u * u * a.x + 2 * u * k * m.x + k * k * b.x,
    y: u * u * a.y + 2 * u * k * m.y + k * k * b.y,
  }
}

// ============================================================================

export class WorldMapScene extends Scene {
  enter() {
    this.t = 0
    const here = MAP_CITY[G.player.map] || 'aster'
    const options = CITIES.filter(unlocked)
    this.sel = Math.max(0, options.findIndex(c => c.id === here))
  }

  update(dt) { this.t += dt }

  onKey(e) {
    const a = act(e)
    if (!a) return
    const options = CITIES.filter(unlocked)
    if (a === 'cancel') { audio.sfx('cancel'); scenes.switchTo('overworld', {}, 'none'); return }
    if (a === 'confirm') { this.travel(options[this.sel]); return }
    // directional pick: nearest unlocked node in roughly that direction
    const dx = a === 'left' ? -1 : a === 'right' ? 1 : 0
    const dy = a === 'up' ? -1 : a === 'down' ? 1 : 0
    const cur = options[this.sel]
    let best = -1
    let bestScore = Infinity
    options.forEach((c, i) => {
      if (i === this.sel) return
      const vx = c.x - cur.x
      const vy = c.y - cur.y
      const along = vx * dx + vy * dy
      if (along <= 0) return // wrong way
      const cross = Math.abs(vx * dy - vy * dx)
      const score = along + cross * 2
      if (score < bestScore) { bestScore = score; best = i }
    })
    if (best >= 0) { this.sel = best; audio.sfx('blip') }
  }

  travel(dest) {
    if (!dest) return
    const here = MAP_CITY[G.player.map] || 'aster'
    if (dest.id === here) {
      audio.sfx('cancel')
      bus.emit('toast', 'ALREADY DOCKED · ' + dest.name)
      return
    }
    audio.sfx('train')
    G.player.map = dest.map
    G.player.x = dest.sx
    G.player.y = dest.sy
    G.player.dir = 'down'
    bus.emit('toast', 'RAIL · ' + dest.name)
    scenes.switchTo('overworld', { map: dest.map, x: dest.sx, y: dest.sy, spawn: 'default', fromRail: true }, 'fade')
  }

  render(ctx) {
    const t = this.t
    const options = CITIES.filter(unlocked)
    const selCity = options[this.sel] || options[0]
    const hereId = MAP_CITY[G.player.map] || 'aster'

    // ---- backdrop: deep night + survey grid + static stars
    ctx.fillStyle = '#030409'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.strokeStyle = 'rgba(41,243,226,0.045)'
    ctx.lineWidth = 1
    for (let x = 0; x < VIEW_W; x += 30) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, VIEW_H); ctx.stroke() }
    for (let y = 0; y < VIEW_H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(VIEW_W, y + 0.5); ctx.stroke() }
    for (let i = 0; i < 60; i++) {
      const sx = (hsh(i, 1) * VIEW_W) | 0
      const sy = (hsh(i, 2) * VIEW_H) | 0
      const tw = 0.25 + 0.5 * Math.abs(Math.sin(t * (0.6 + hsh(i, 3)) + i))
      ctx.fillStyle = rgba('#7896c8', tw * 0.3)
      ctx.fillRect(sx, sy, 1, 1)
    }
    // radar sweep
    const sweepY = (t * 34) % (VIEW_H + 60) - 30
    const grad = ctx.createLinearGradient(0, sweepY - 18, 0, sweepY)
    grad.addColorStop(0, 'rgba(41,243,226,0)')
    grad.addColorStop(1, 'rgba(41,243,226,0.05)')
    ctx.fillStyle = grad
    ctx.fillRect(0, sweepY - 18, VIEW_W, 18)

    // ---- edges
    for (const [aId, bId] of EDGES) {
      const a = city(aId)
      const b = city(bId)
      const live = unlocked(a) && unlocked(b)
      const m = edgeMid(a, b)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.quadraticCurveTo(m.x, m.y, b.x, b.y)
      if (live) {
        ctx.shadowColor = CYAN
        ctx.shadowBlur = 4
        ctx.strokeStyle = rgba(CYAN, 0.35 + 0.1 * Math.sin(t * 2 + a.x))
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.shadowBlur = 0
        // rail pulses riding the line both ways
        for (let p = 0; p < 2; p++) {
          const k = (t * 0.22 + p * 0.5 + (aId.length % 3) * 0.17) % 1
          const pos = pointOnEdge(a, b, p === 0 ? k : 1 - k)
          ctx.shadowColor = p === 0 ? CYAN : MAGENTA
          ctx.shadowBlur = 6
          ctx.fillStyle = p === 0 ? HI : MAGENTA
          ctx.fillRect((pos.x - 1) | 0, (pos.y - 1) | 0, 2, 2)
          ctx.shadowBlur = 0
        }
      } else {
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = rgba('#3a4458', 0.5)
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // ---- nodes
    for (const c of CITIES) {
      const isOpen = unlocked(c)
      const isSel = selCity && c.id === selCity.id
      const isHere = c.id === hereId
      const col = isOpen ? (c.col || CYAN) : DEAD
      // outer pulse ring
      if (isOpen) {
        const ring = 7 + 2.5 * (0.5 + 0.5 * Math.sin(t * 2.4 + c.x * 0.1))
        ctx.strokeStyle = rgba(col, 0.35)
        ctx.shadowColor = col
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(c.x, c.y, ring, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      // core
      ctx.fillStyle = '#070a14'
      ctx.beginPath()
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = col
      ctx.shadowBlur = isOpen ? 7 : 0
      ctx.fillStyle = isOpen ? col : DEAD
      ctx.beginPath()
      ctx.arc(c.x, c.y, isOpen ? 3 : 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      // selection reticle — four ticks orbiting the chosen station
      if (isSel) {
        const r = 11
        for (let k = 0; k < 4; k++) {
          const ang = t * 1.6 + k * Math.PI / 2
          const cx = c.x + Math.cos(ang) * r
          const cy = c.y + Math.sin(ang) * r
          ctx.shadowColor = HI
          ctx.shadowBlur = 5
          ctx.fillStyle = HI
          ctx.fillRect((cx - 1) | 0, (cy - 1) | 0, 2, 2)
          ctx.shadowBlur = 0
        }
      }

      // labels
      const ly = c.y + 12
      if (isOpen) {
        glowTxt(ctx, c.name, c.x, ly, isSel ? HI : mix(col, INK, 0.4), 'bold 8px monospace', 'center', isSel ? 6 : 0)
      } else {
        txt(ctx, '?????', c.x, ly, DEAD, 'bold 8px monospace', 'center')
        txt(ctx, 'NO SIGNAL', c.x, ly + 9, DEAD, '7px monospace', 'center')
      }
      if (isHere) {
        glowTxt(ctx, 'YOU', c.x, c.y - 19 + Math.round(Math.sin(t * 3) * 1.5), AMBER, 'bold 7px monospace', 'center', 5)
        ctx.fillStyle = AMBER
        ctx.beginPath()
        ctx.moveTo(c.x - 3, c.y - 12)
        ctx.lineTo(c.x + 3, c.y - 12)
        ctx.lineTo(c.x, c.y - 8)
        ctx.closePath()
        ctx.fill()
      }
    }

    // ---- chrome
    ctx.fillStyle = 'rgba(8,11,20,0.92)'
    ctx.fillRect(0, 0, VIEW_W, 22)
    ctx.fillStyle = rgba(CYAN, 0.5)
    ctx.fillRect(0, 22, VIEW_W, 1)
    glowTxt(ctx, 'TRANSIT GRID // RAIL NETWORK', 10, 7, CYAN, 'bold 9px monospace', 'left', 6)
    txt(ctx, options.length + '/' + CITIES.length + ' STATIONS LIVE', VIEW_W - 10, 7, DIM, '8px monospace', 'right')

    // footer: selected station + controls
    ctx.fillStyle = 'rgba(8,11,20,0.92)'
    ctx.fillRect(0, VIEW_H - 26, VIEW_W, 26)
    ctx.fillStyle = rgba(MAGENTA, 0.4)
    ctx.fillRect(0, VIEW_H - 27, VIEW_W, 1)
    if (selCity) {
      glowTxt(ctx, selCity.name, 10, VIEW_H - 20, selCity.col || CYAN, 'bold 9px monospace', 'left', 5)
      txt(ctx, selCity.sub || '', 10, VIEW_H - 10, DIM, '7px monospace')
    }
    txt(ctx, 'ENTER · BOARD TRAIN     ESC · BACK', VIEW_W - 10, VIEW_H - 16, INK, '8px monospace', 'right')

    // the map is a tapped feed too
    if (hsh((t * 2.2) | 0, 9) > 0.95) glitchRect(ctx, 0, 24, VIEW_W, VIEW_H - 50, 0.14)
    ctx.textAlign = 'left'
  }
}

export default WorldMapScene
