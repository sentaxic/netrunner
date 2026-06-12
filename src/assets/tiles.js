// tiles.js — every 16×16 tile in NETRUNNER, drawn live as code. No bitmaps.
//
// Contract (ARCHITECTURE.md §4):
//   export const TILES            id -> { draw(ctx, px, py, {t, anim}) }
//   export function drawTile(ctx, id, px, py, anim)   anim = time in seconds
//
// Extra (safe to ignore): setTilePalette(city) switches the active PAL biome so the
// same tile ids re-skin per city (aster / underground / forge). Defaults to aster.
//
// Animated tiles (neon, water, puddle, billboard, vent, server, terminal) read the
// time arg. Static variation (which window glows, puddle shape) hashes the pixel
// position so the world looks hand-placed but is fully deterministic.

import { PAL, mix, rgba } from './palette.js'

export const TILE = 16

// ---------------------------------------------------------------- palette state
let P = PAL.aster
let D = null

export function setTilePalette(city) {
  P = PAL[city] || PAL.aster
  D = derive(P)
}

function derive(p) {
  return {
    // exterior ground
    floor: mix(p.road, p.wall, 0.45),
    floorLine: mix(mix(p.road, p.wall, 0.45), '#000000', 0.3),
    floorLit: mix(mix(p.road, p.wall, 0.45), '#ffffff', 0.06),
    roadDark: mix(p.road, '#000000', 0.3),
    roadLit: mix(p.road, '#ffffff', 0.05),
    side: mix(p.wall, p.ink, 0.12),
    sideLine: mix(mix(p.wall, p.ink, 0.12), '#000000', 0.32),
    sideLit: mix(mix(p.wall, p.ink, 0.12), '#ffffff', 0.08),
    // walls
    wallTop: mix(p.wall, '#ffffff', 0.16),
    wallSeam: mix(p.wall, '#000000', 0.35),
    wallFoot: mix(p.wall, '#000000', 0.5),
    // water
    water: mix(p.bg, p.neon1, 0.07),
    waterDeep: mix(p.bg, '#000000', 0.3),
    // interior
    intWall: mix(p.wall, p.accent, 0.1),
    intWallLit: mix(mix(p.wall, p.accent, 0.1), '#ffffff', 0.12),
    intWallDark: mix(mix(p.wall, p.accent, 0.1), '#000000', 0.4),
    // misc metals
    metal: mix(p.wall, '#8a93a5', 0.3),
    metalDark: mix(mix(p.wall, '#8a93a5', 0.3), '#000000', 0.4),
    metalLit: mix(mix(p.wall, '#8a93a5', 0.3), '#ffffff', 0.18)
  }
}
setTilePalette('aster')

// ------------------------------------------------------------------- helpers
function R(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h) }

// Deterministic 0..1 hash of a position (+ salt). Stable per world spot.
function hsh(a, b, s = 0) {
  let n = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}
const tq = v => Math.floor(v / 16) // tile-quantize a pixel coord

// pull the time out of the opts object ({t, anim})
function tm(o) {
  if (o == null) return 0
  if (typeof o === 'number') return o
  return (o.anim != null ? o.anim : o.t) || 0
}

// fixed colors shared across biomes (interiors stay interiors everywhere)
const WOOD = '#3a2c1e'
const WOOD_D = '#281d12'
const WOOD_L = '#4c3a26'
const TERM_SCREEN = '#52ffba'
const TERM_DARK = '#04140e'

// =============================================================== TILE TABLE
export const TILES = {

  // ---- exterior concrete plaza / generic ground ---------------------------
  floor: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, D.floor)
    R(ctx, px, py + 15, 16, 1, D.floorLine)
    R(ctx, px + 15, py, 1, 16, D.floorLine)
    const h = hsh(tq(px), tq(py))
    if (h > 0.6) R(ctx, px + 2 + ((h * 11) | 0), py + 3 + ((h * 7) | 0), 2, 1, h > 0.8 ? D.floorLine : D.floorLit)
    if (h < 0.18) R(ctx, px + 4, py + 9, 1, 1, D.floorLit) // chip
  } },

  // ---- exterior building face ----------------------------------------------
  wall: { draw(ctx, px, py, o) {
    const t = tm(o), h = hsh(tq(px), tq(py))
    R(ctx, px, py, 16, 16, P.wall)
    R(ctx, px, py, 16, 2, D.wallTop)               // lit cornice
    R(ctx, px, py + 14, 16, 2, D.wallFoot)         // grime footer
    R(ctx, px + 7, py + 2, 1, 12, D.wallSeam)      // panel seam
    R(ctx, px, py + 8, 16, 1, D.wallSeam)          // course line
    if (h > 0.72) {                                 // a lit window, somewhere up there
      const wx = px + 2 + ((h * 9) | 0), wy = py + 3
      const col = h > 0.88 ? P.neon2 : (h > 0.8 ? P.neon1 : P.accent)
      const br = 0.55 + 0.45 * Math.sin(t * 0.8 + h * 40)
      R(ctx, wx, wy, 3, 4, '#05060a')
      ctx.globalAlpha = 0.35 + 0.45 * br
      R(ctx, wx + 1, wy + 1, 1, 2, col)
      ctx.globalAlpha = 1
    } else if (h < 0.12) {
      R(ctx, px + 3, py + 10, 5, 1, mix(P.neon2, P.wall, 0.6)) // graffiti scrawl
      R(ctx, px + 6, py + 11, 3, 1, mix(P.neon1, P.wall, 0.6))
    }
  } },

  // ---- wet asphalt with neon reflections ------------------------------------
  road: { draw(ctx, px, py, o) {
    const t = tm(o), tx = tq(px), ty = tq(py)
    R(ctx, px, py, 16, 16, P.road)
    R(ctx, px, py + ((hsh(tx, ty, 3) * 14) | 0), 16, 1, D.roadDark) // patch seam
    // wet sheen: vertical neon smears, shimmering
    for (let i = 0; i < 2; i++) {
      const h = hsh(tx, ty, i + 1)
      if (h < 0.45) continue
      const col = h > 0.82 ? P.neon2 : h > 0.62 ? P.neon1 : P.accent
      const x = px + ((h * 14) | 0)
      ctx.globalAlpha = 0.05 + 0.05 * (1 + Math.sin(t * 1.7 + h * 20))
      R(ctx, x, py, 1 + (h > 0.7 ? 1 : 0), 16, col)
      ctx.globalAlpha = 1
    }
    if (hsh(tx, ty, 9) > 0.85) R(ctx, px + 3, py + 6, 2, 1, D.roadLit) // gravel glint
  } },

  // ---- sidewalk slabs --------------------------------------------------------
  sidewalk: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, D.side)
    R(ctx, px, py, 16, 1, D.sideLit)
    R(ctx, px, py + 7, 16, 1, D.sideLine)
    R(ctx, px + 7, py, 1, 16, D.sideLine)
    R(ctx, px, py + 15, 16, 1, D.sideLine)
    const h = hsh(tq(px), tq(py), 2)
    if (h > 0.75) R(ctx, px + 2 + ((h * 10) | 0), py + 10, 2, 2, D.sideLine) // crack pit
  } },

  // ---- neon signage (the flicker is the city breathing) ---------------------
  neon: { draw(ctx, px, py, o) {
    const t = tm(o), h = hsh(tq(px), tq(py))
    R(ctx, px, py, 16, 16, mix(P.wall, '#000000', 0.45)) // backing panel
    R(ctx, px, py, 16, 1, D.wallSeam)
    R(ctx, px, py + 15, 16, 1, D.wallSeam)
    const col = h > 0.5 ? P.neon1 : P.neon2
    let br = 0.7 + 0.3 * Math.sin(t * 11 + h * 50)
    if (Math.sin(t * 7.3 + h * 31) > 0.95) br *= 0.2 // dying-tube dropout
    ctx.save()
    ctx.shadowColor = col
    ctx.shadowBlur = 7 * br
    ctx.fillStyle = mix(col, '#ffffff', 0.25 * br)
    ctx.globalAlpha = 0.35 + 0.65 * br
    const v = (h * 3) | 0
    if (v === 0) {            // double bar
      ctx.fillRect(px + 2, py + 4, 12, 2)
      ctx.fillRect(px + 2, py + 9, 12, 2)
    } else if (v === 1) {     // ring sign
      ctx.fillRect(px + 4, py + 3, 8, 2)
      ctx.fillRect(px + 4, py + 11, 8, 2)
      ctx.fillRect(px + 3, py + 5, 2, 6)
      ctx.fillRect(px + 11, py + 5, 2, 6)
    } else {                  // zigzag glyph
      ctx.fillRect(px + 3, py + 3, 9, 2)
      ctx.fillRect(px + 9, py + 5, 2, 3)
      ctx.fillRect(px + 4, py + 8, 7, 2)
      ctx.fillRect(px + 4, py + 10, 2, 3)
    }
    ctx.restore()
    ctx.globalAlpha = 0.07 * br                    // halo wash on the panel
    R(ctx, px, py, 16, 16, col)
    ctx.globalAlpha = 1
  } },

  // ---- canal water -----------------------------------------------------------
  water: { draw(ctx, px, py, o) {
    const t = tm(o), tx = tq(px), ty = tq(py)
    R(ctx, px, py, 16, 16, D.water)
    R(ctx, px, py, 16, 3, D.waterDeep)
    for (let i = 0; i < 3; i++) {                  // drifting shimmer lines
      const h = hsh(tx, ty, i + 4)
      const yy = py + 3 + i * 5
      const xo = (Math.sin(t * (0.9 + h) + h * 9 + i) * 4) | 0
      ctx.globalAlpha = 0.1 + 0.1 * Math.sin(t * 2 + i * 2 + h * 6)
      R(ctx, px + 2 + xo + ((h * 4) | 0), yy, 6, 1, P.glow)
      ctx.globalAlpha = 1
    }
    const h2 = hsh(tx, ty, 8)                      // a neon reflection on the surface
    if (h2 > 0.6) {
      ctx.globalAlpha = 0.07 + 0.05 * Math.sin(t * 1.3 + h2 * 12)
      R(ctx, px + ((h2 * 12) | 0), py, 2, 16, h2 > 0.8 ? P.neon2 : P.neon1)
      ctx.globalAlpha = 1
    }
  } },

  // ---- doorway ---------------------------------------------------------------
  door: { draw(ctx, px, py, o) {
    const t = tm(o)
    R(ctx, px, py, 16, 16, P.wall)
    R(ctx, px + 2, py + 1, 12, 15, D.wallFoot)     // frame recess
    R(ctx, px + 3, py + 2, 10, 14, P.bg)           // dark opening
    R(ctx, px + 2, py + 1, 12, 1, D.wallTop)       // lintel
    R(ctx, px + 7, py + 9, 1, 2, D.metalLit)       // handle
    const br = 0.6 + 0.4 * Math.sin(t * 2.4)       // keypad standby blink
    ctx.save()
    ctx.shadowColor = P.neon1
    ctx.shadowBlur = 4 * br
    ctx.globalAlpha = 0.5 + 0.5 * br
    R(ctx, px + 13, py + 7, 1, 1, P.neon1)
    ctx.restore()
    ctx.globalAlpha = 1
    R(ctx, px + 3, py + 15, 10, 1, D.floorLit)     // threshold
  } },

  // ---- maglev rail (runs horizontally) ----------------------------------------
  rail: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, D.roadDark)             // ballast bed
    const h = hsh(tq(px), tq(py), 5)
    R(ctx, px + ((h * 12) | 0), py + 13, 2, 1, D.roadLit)
    for (let i = 0; i < 3; i++) R(ctx, px + 1 + i * 6, py + 2, 3, 12, WOOD_D) // ties
    R(ctx, px, py + 4, 16, 2, D.metal)             // twin rails
    R(ctx, px, py + 4, 16, 1, D.metalLit)
    R(ctx, px, py + 10, 16, 2, D.metal)
    R(ctx, px, py + 10, 16, 1, D.metalLit)
    ctx.globalAlpha = 0.12
    R(ctx, px, py + 5, 16, 1, P.neon1)             // mag-strip glow trace
    ctx.globalAlpha = 1
  } },

  // ---- dim park turf -----------------------------------------------------------
  grass: { draw(ctx, px, py, o) {
    const tx = tq(px), ty = tq(py)
    const base = mix('#1d3a24', P.bg, 0.35)
    R(ctx, px, py, 16, 16, ((tx + ty) & 1) ? base : mix(base, '#000000', 0.12))
    for (let i = 0; i < 5; i++) {
      const h = hsh(tx, ty, i + 6)
      R(ctx, px + ((h * 15) | 0), py + ((hsh(ty, tx, i) * 14) | 0), 1, 2, mix('#2e5c38', base, 0.3))
    }
    if (hsh(tx, ty, 12) > 0.9) {                   // rare toxic-bright blade
      ctx.globalAlpha = 0.6
      R(ctx, px + 9, py + 5, 1, 2, '#6dff7a')
      ctx.globalAlpha = 1
    }
  } },

  // ---- interior: desk surface ----------------------------------------------------
  desk: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, '#3c3550')              // synth-resin top
    R(ctx, px, py, 16, 1, '#564e72')
    R(ctx, px, py + 12, 16, 4, '#241f33')          // front edge drop
    R(ctx, px, py + 12, 16, 1, '#171326')
    R(ctx, px + 2, py + 3, 5, 1, '#4c4566')        // wear sheen
    const h = hsh(tq(px), tq(py), 7)
    if (h > 0.5) R(ctx, px + 9, py + 5, 4, 3, '#2b2640') // datapad left on it
  } },

  // ---- interior: live terminal -----------------------------------------------------
  terminal: { draw(ctx, px, py, o) {
    const t = tm(o), h = hsh(tq(px), tq(py))
    R(ctx, px, py, 16, 16, '#3c3550')              // sits on desk surface
    R(ctx, px, py + 12, 16, 4, '#241f33')
    R(ctx, px + 1, py, 14, 11, '#10141f')          // monitor shell
    R(ctx, px + 1, py, 14, 1, '#222a3d')
    const br = 0.8 + 0.2 * Math.sin(t * 3 + h * 9)
    ctx.save()
    ctx.shadowColor = TERM_SCREEN
    ctx.shadowBlur = 5 * br
    R(ctx, px + 2, py + 1, 12, 9, TERM_DARK)       // phosphor screen
    ctx.globalAlpha = 0.75 * br
    R(ctx, px + 3, py + 2, 7, 1, TERM_SCREEN)      // output lines
    R(ctx, px + 3, py + 4, 9, 1, mix(TERM_SCREEN, TERM_DARK, 0.45))
    R(ctx, px + 3, py + 6, 5, 1, mix(TERM_SCREEN, TERM_DARK, 0.45))
    if (((t * 2) | 0) & 1) R(ctx, px + 3 + (((h * 4) | 0) * 2), py + 8, 2, 1, TERM_SCREEN) // cursor
    ctx.restore()
    ctx.globalAlpha = 1
    R(ctx, px + 3, py + 12, 10, 3, '#1a2030')      // keyboard
    for (let i = 0; i < 4; i++) R(ctx, px + 4 + i * 2, py + 13, 1, 1, '#39414f')
  } },

  // ---- interior: bed ------------------------------------------------------------------
  bed: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, WOOD_D)                 // frame
    R(ctx, px + 1, py + 1, 14, 14, '#2c3a5c')      // blanket
    R(ctx, px + 1, py + 1, 14, 1, '#3c4e76')
    R(ctx, px + 1, py + 8, 14, 1, '#22304e')       // fold line
    R(ctx, px + 1, py + 12, 14, 1, '#22304e')
    R(ctx, px + 3, py + 2, 10, 4, '#aab6cc')       // pillow
    R(ctx, px + 3, py + 5, 10, 1, '#7e8aa3')
  } },

  // ---- interior: rug --------------------------------------------------------------------
  rug: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, '#5a2330')
    R(ctx, px, py, 16, 2, '#7e3343'); R(ctx, px, py + 14, 16, 2, '#7e3343')
    R(ctx, px, py, 2, 16, '#7e3343'); R(ctx, px + 14, py, 2, 16, '#7e3343')
    R(ctx, px + 7, py + 6, 2, 1, '#c98a4a')        // woven diamond motif
    R(ctx, px + 6, py + 7, 1, 2, '#c98a4a'); R(ctx, px + 9, py + 7, 1, 2, '#c98a4a')
    R(ctx, px + 7, py + 9, 2, 1, '#c98a4a')
    R(ctx, px + 3, py + 3, 1, 1, '#8a4a3a'); R(ctx, px + 12, py + 12, 1, 1, '#8a4a3a')
  } },

  // ---- interior: shop counter --------------------------------------------------------------
  counter: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 8, WOOD_L)                  // worktop
    R(ctx, px, py, 16, 1, mix(WOOD_L, '#ffffff', 0.18))
    R(ctx, px, py + 7, 16, 1, WOOD_D)
    R(ctx, px, py + 8, 16, 8, WOOD)                // front face
    R(ctx, px + 5, py + 8, 1, 8, WOOD_D)           // plank seams
    R(ctx, px + 10, py + 8, 1, 8, WOOD_D)
    R(ctx, px, py + 15, 16, 1, mix(WOOD, '#000000', 0.4))
    const h = hsh(tq(px), tq(py), 11)
    if (h > 0.55) R(ctx, px + 3, py + 2, 3, 2, '#2b2640') // wares on the top
  } },

  // ---- interior wall -----------------------------------------------------------------------
  wall_int: { draw(ctx, px, py, o) {
    R(ctx, px, py, 16, 16, D.intWall)
    R(ctx, px, py, 16, 2, D.intWallLit)
    R(ctx, px, py + 10, 16, 1, D.intWallDark)      // rail line
    R(ctx, px, py + 13, 16, 3, D.intWallDark)      // baseboard
    R(ctx, px, py + 13, 16, 1, mix(D.intWallDark, '#ffffff', 0.1))
    R(ctx, px + 7, py + 2, 1, 8, mix(D.intWall, '#000000', 0.18)) // soft panel seam
  } },

  // ---- interior floorboards -------------------------------------------------------------------
  floor_int: { draw(ctx, px, py, o) {
    const tx = tq(px), ty = tq(py)
    R(ctx, px, py, 16, 16, WOOD)
    for (let r = 0; r < 4; r++) {
      const yy = py + r * 4
      R(ctx, px, yy + 3, 16, 1, WOOD_D)            // plank gap
      R(ctx, px, yy, 16, 1, mix(WOOD, '#ffffff', 0.05))
      const j = ((hsh(tx, ty + r, 13) * 14) | 0)   // staggered joint
      R(ctx, px + j, yy, 1, 3, WOOD_D)
    }
    if (hsh(tx, ty, 14) > 0.85) R(ctx, px + 11, py + 6, 1, 1, WOOD_D) // knot
  } },

  // ---- rain puddle (mirror of the city) -----------------------------------------------------------
  puddle: { draw(ctx, px, py, o) {
    const t = tm(o), tx = tq(px), ty = tq(py), h = hsh(tx, ty)
    TILES.sidewalk.draw(ctx, px, py, o)            // sits on pavement
    const mirror = mix(P.bg, P.glow, 0.16)
    // irregular blob from overlapping rects
    R(ctx, px + 3, py + 5, 10, 7, mirror)
    R(ctx, px + 2, py + 7, 12, 4, mirror)
    R(ctx, px + 5, py + 4, 6, 9, mirror)
    if (h > 0.5) R(ctx, px + 1, py + 8, 3, 2, mirror)
    R(ctx, px + 3, py + 12, 10, 1, mix(D.side, '#ffffff', 0.18)) // lit rim
    // neon laid down on the water
    const col = h > 0.55 ? P.neon2 : P.neon1
    ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 2.2 + h * 16)
    R(ctx, px + 5 + ((h * 4) | 0), py + 5, 2, 7, col)
    ctx.globalAlpha = 0.1
    R(ctx, px + 9, py + 6, 1, 5, P.accent)
    ctx.globalAlpha = 1
    // raindrop ripple ring, expanding then gone
    const ph = (t * 0.8 + h * 3) % 1
    if (ph < 0.55) {
      const r = 1 + ph * 8
      ctx.strokeStyle = rgba(P.glow, (1 - ph / 0.55) * 0.45)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(px + 8, py + 8, r, r * 0.45, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  } },

  // ---- steam vent -----------------------------------------------------------------------------------
  vent: { draw(ctx, px, py, o) {
    const t = tm(o), h = hsh(tq(px), tq(py))
    R(ctx, px + 1, py + 1, 14, 14, D.metal)        // grate plate
    R(ctx, px + 1, py + 1, 14, 1, D.metalLit)
    R(ctx, px + 1, py + 14, 14, 1, D.metalDark)
    for (let i = 0; i < 4; i++) {                  // slats
      R(ctx, px + 3, py + 3 + i * 3, 10, 1, '#05060a')
      R(ctx, px + 3, py + 4 + i * 3, 10, 1, D.metalLit)
    }
    R(ctx, px + 2, py + 2, 1, 1, D.metalDark); R(ctx, px + 13, py + 2, 1, 1, D.metalDark)
    R(ctx, px + 2, py + 13, 1, 1, D.metalDark); R(ctx, px + 13, py + 13, 1, 1, D.metalDark)
    // steam: two staggered puffs rising and fattening
    for (let k = 0; k < 2; k++) {
      const ph = (t * 0.45 + h * 0.7 + k * 0.5) % 1
      const a = (1 - ph) * 0.22
      if (a <= 0.02) continue
      const sx = px + 8 + Math.sin(ph * 6 + h * 9 + k * 3) * 3
      const sy = py + 7 - ph * 13
      ctx.fillStyle = `rgba(215,222,235,${a.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(sx, sy, 1.5 + ph * 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  } },

  // ---- cargo crate -------------------------------------------------------------------------------------
  crate: { draw(ctx, px, py, o) {
    const h = hsh(tq(px), tq(py))
    R(ctx, px + 1, py + 1, 14, 14, WOOD_L)
    R(ctx, px + 1, py + 1, 14, 2, mix(WOOD_L, '#ffffff', 0.15))
    R(ctx, px + 1, py + 13, 14, 2, WOOD_D)
    R(ctx, px + 1, py + 1, 2, 14, WOOD); R(ctx, px + 13, py + 1, 2, 14, WOOD)
    for (let i = 0; i < 9; i++) R(ctx, px + 3 + i, py + 3 + i, 1, 1, WOOD_D) // diagonal brace
    if (h > 0.5) {                                  // corp stamp or hazard band
      R(ctx, px + 4, py + 5, 4, 3, '#1a2238')
      R(ctx, px + 5, py + 6, 2, 1, P.neon1)
    } else {
      for (let i = 0; i < 4; i++) R(ctx, px + 3 + i * 3, py + 11, 2, 1, P.accent)
    }
  } },

  // ---- server rack (the underground hums) ------------------------------------------------------------------
  server: { draw(ctx, px, py, o) {
    const t = tm(o), tx = tq(px), ty = tq(py)
    R(ctx, px + 1, py, 14, 16, '#0c0f16')          // cabinet
    R(ctx, px + 1, py, 14, 1, '#222a3d')
    R(ctx, px + 1, py + 15, 14, 1, '#04050a')
    for (let u = 0; u < 4; u++) {                  // 4 rack units
      R(ctx, px + 2, py + 2 + u * 3, 12, 2, '#141a26')
      R(ctx, px + 3, py + 2 + u * 3, 4, 1, '#1e2738')   // vent slits
      for (let l = 0; l < 3; l++) {                // LEDs, each on its own heartbeat
        const h = hsh(tx + u, ty + l, 17)
        const on = Math.sin(t * (2 + h * 5) + h * 40) > (h > 0.7 ? 0.4 : -0.2)
        const col = h > 0.85 ? '#ff2e58' : h > 0.5 ? '#6dff7a' : h > 0.25 ? P.accent : P.neon1
        if (on) {
          ctx.save()
          ctx.shadowColor = col
          ctx.shadowBlur = 3
          R(ctx, px + 9 + l * 2, py + 2 + u * 3, 1, 1, col)
          ctx.restore()
        } else {
          R(ctx, px + 9 + l * 2, py + 2 + u * 3, 1, 1, '#0a0d14')
        }
      }
    }
    ctx.globalAlpha = 0.05                          // warm spill at the base
    R(ctx, px, py + 13, 16, 3, '#6dff7a')
    ctx.globalAlpha = 1
  } },

  // ---- scrolling ad billboard ------------------------------------------------------------------------------------
  billboard: { draw(ctx, px, py, o) {
    const t = tm(o), h = hsh(tq(px), tq(py))
    R(ctx, px, py, 16, 16, '#0a0d14')              // housing
    R(ctx, px, py, 16, 1, '#222a3d'); R(ctx, px, py + 15, 16, 1, '#04050a')
    const colA = h > 0.5 ? P.neon2 : P.neon1
    const colB = h > 0.5 ? P.neon1 : P.accent
    const scroll = Math.floor(t * 7 + h * 16)
    ctx.save()
    ctx.beginPath()
    ctx.rect(px + 2, py + 2, 12, 12)
    ctx.clip()
    for (let r = 0; r < 6; r++) {                  // content bands scroll upward
      const band = ((r + scroll) % 5 + 5) % 5
      const yy = py + 2 + ((r * 3 - (((t * 7 + h * 16) % 1) * 3)) | 0)
      if (band === 0) { ctx.globalAlpha = 0.85; R(ctx, px + 2, yy, 12, 2, colA) }
      else if (band === 2) { ctx.globalAlpha = 0.7; R(ctx, px + 2, yy, 7, 2, colB) }
      else if (band === 3) {                       // glyph dashes — ad copy you can't read
        ctx.globalAlpha = 0.8
        R(ctx, px + 3, yy, 3, 1, P.ink); R(ctx, px + 7, yy, 2, 1, P.ink); R(ctx, px + 10, yy, 3, 1, P.ink)
      } else { ctx.globalAlpha = 0.9; R(ctx, px + 2, yy, 12, 2, '#070a12') }
    }
    ctx.globalAlpha = 0.16                          // sweeping refresh line
    R(ctx, px + 2, py + 2 + (((t * 15 + h * 7) % 12) | 0), 12, 1, '#ffffff')
    ctx.restore()
    ctx.globalAlpha = 1
    if (Math.sin(t * 1.9 + h * 23) > 0.985) {       // signal stutter
      R(ctx, px + 2, py + 4 + ((h * 8) | 0), 12, 1, '#cfe3ff')
    }
    ctx.save()                                      // glow cast into the street
    ctx.shadowColor = colA
    ctx.shadowBlur = 6
    ctx.globalAlpha = 0.1
    R(ctx, px + 1, py + 1, 14, 14, colA)
    ctx.restore()
    ctx.globalAlpha = 1
  } }
}

// =============================================================== drawTile
export function drawTile(ctx, id, px, py, anim) {
  const t = TILES[id]
  const o = { t: anim || 0, anim: anim || 0 }
  if (t) {
    if (typeof t === 'function') t(ctx, px, py, o)
    else t.draw(ctx, px, py, o)
    return
  }
  // unknown id: quiet dark fill with a marker pixel so it's findable, not fatal
  R(ctx, px, py, 16, 16, P.bg)
  R(ctx, px + 7, py + 7, 2, 2, P.neon2)
}

export default TILES
