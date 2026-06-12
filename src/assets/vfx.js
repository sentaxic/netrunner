// vfx.js — the weather and the wounds. Rain, sparks, data motes, glitch corruption.
//
// Contract (ARCHITECTURE.md §4):
//   export class Particles { constructor(); spawnRain(n); spawnSparks(x,y,n);
//                            spawnDataMotes(n); update(dt); render(ctx,camX,camY) }
//   export function glitchRect(ctx, x, y, w, h, amt)
//
// Particles live in WORLD space; render() learns the camera and update() recycles
// everything into the visible window, so the rain is glued to the city, not the lens.

import { VIEW_W, VIEW_H } from '../core/renderer.js'

const MAX_RAIN = 400
const MAX_SPARKS = 300
const MAX_MOTES = 200
const WIND = -52            // rain leans left, like the whole city does

const SPARK_COLS = ['#ffb547', '#ff7a3c', '#ffe2a8', '#ff4d2e']
const MOTE_COLS = ['#29f3e2', '#ff2e88']

export class Particles {
  constructor() {
    this.rain = []
    this.sparks = []
    this.motes = []
    this.ripples = []
    this.cx = 0            // last known camera (world px), set by render()
    this.cy = 0
    this.t = 0
  }

  // ---------------------------------------------------------------- spawning
  spawnRain(n) {
    for (let i = 0; i < n && this.rain.length < MAX_RAIN; i++) {
      this.rain.push(this._drop(true))
    }
  }

  spawnSparks(x, y, n) {
    for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 30 + Math.random() * 130
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60 - Math.random() * 60,
        age: 0,
        max: 0.35 + Math.random() * 0.5,
        col: SPARK_COLS[(Math.random() * SPARK_COLS.length) | 0]
      })
    }
  }

  spawnDataMotes(n) {
    for (let i = 0; i < n && this.motes.length < MAX_MOTES; i++) {
      this.motes.push({
        x: this.cx - 20 + Math.random() * (VIEW_W + 40),
        y: this.cy - 20 + Math.random() * (VIEW_H + 40),
        vx: (Math.random() - 0.5) * 8,
        vy: -2 - Math.random() * 5,
        ph: Math.random() * Math.PI * 2,
        sw: 0.4 + Math.random() * 1.2,
        col: MOTE_COLS[(Math.random() * MOTE_COLS.length) | 0],
        big: Math.random() < 0.15
      })
    }
  }

  _drop(scatter) {
    const heavy = Math.random() < 0.18
    return {
      x: this.cx - 50 + Math.random() * (VIEW_W + 100),
      y: scatter ? this.cy - 30 + Math.random() * (VIEW_H + 60)
                 : this.cy - 30 - Math.random() * 50,
      vx: WIND * (0.7 + Math.random() * 0.6),
      vy: 280 + Math.random() * 180,
      fall: 0,
      fallMax: 90 + Math.random() * 220,
      heavy
    }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.t += dt
    const { cx, cy } = this

    // rain: fall, land, sometimes ring the pavement, recycle
    for (let i = 0; i < this.rain.length; i++) {
      const p = this.rain[i]
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.fall += p.vy * dt
      if (p.fall >= p.fallMax) {
        if (Math.random() < 0.3 && this.ripples.length < 80) {
          this.ripples.push({ x: p.x, y: p.y, age: 0, max: 0.45 + Math.random() * 0.3 })
        }
        this.rain[i] = this._drop(false)
        continue
      }
      // keep the sheet over the camera window
      if (p.x < cx - 60) p.x += VIEW_W + 120
      else if (p.x > cx + VIEW_W + 60) p.x -= VIEW_W + 120
      if (p.y > cy + VIEW_H + 40) { this.rain[i] = this._drop(false) }
    }

    // ripples: bloom and die
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.age += dt
      if (r.age >= r.max) this.ripples.splice(i, 1)
    }

    // sparks: gravity + drag, brief lives
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.age += dt
      if (s.age >= s.max) { this.sparks.splice(i, 1); continue }
      s.vy += 300 * dt
      s.vx *= Math.max(0, 1 - 1.6 * dt)
      s.x += s.vx * dt
      s.y += s.vy * dt
    }

    // motes: drift, sway, wrap toroidally around the camera window
    const mw = VIEW_W + 40, mh = VIEW_H + 40
    for (const m of this.motes) {
      m.x += (m.vx + Math.sin(this.t * m.sw + m.ph) * 6) * dt
      m.y += m.vy * dt
      let rx = m.x - (cx - 20), ry = m.y - (cy - 20)
      if (rx < 0 || rx >= mw) m.x = (cx - 20) + ((rx % mw) + mw) % mw
      if (ry < 0 || ry >= mh) m.y = (cy - 20) + ((ry % mh) + mh) % mh
    }
  }

  // ---------------------------------------------------------------- render
  render(ctx, camX, camY) {
    this.cx = camX
    this.cy = camY
    ctx.save()

    // data motes: slow neon dust, pulsing
    for (const m of this.motes) {
      const sx = m.x - camX, sy = m.y - camY
      if (sx < -4 || sx > VIEW_W + 4 || sy < -4 || sy > VIEW_H + 4) continue
      const a = 0.16 + 0.3 * (0.5 + 0.5 * Math.sin(this.t * (1.2 + m.sw) + m.ph))
      ctx.globalAlpha = a
      ctx.shadowColor = m.col
      ctx.shadowBlur = m.big ? 5 : 3
      ctx.fillStyle = m.col
      ctx.fillRect(sx | 0, sy | 0, m.big ? 2 : 1, m.big ? 2 : 1)
    }
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1

    // rain: two passes — a soft far sheet, then heavy near streaks
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(150,185,230,0.30)'
    ctx.beginPath()
    for (const p of this.rain) {
      if (p.heavy) continue
      const sx = p.x - camX, sy = p.y - camY
      if (sx < -10 || sx > VIEW_W + 10 || sy < -16 || sy > VIEW_H + 16) continue
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx - p.vx * 0.03, sy - p.vy * 0.03)
    }
    ctx.stroke()
    ctx.strokeStyle = 'rgba(190,215,245,0.5)'
    ctx.beginPath()
    for (const p of this.rain) {
      if (!p.heavy) continue
      const sx = p.x - camX, sy = p.y - camY
      if (sx < -14 || sx > VIEW_W + 14 || sy < -22 || sy > VIEW_H + 22) continue
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx - p.vx * 0.045, sy - p.vy * 0.045)
    }
    ctx.stroke()

    // puddle ripples where drops land
    for (const r of this.ripples) {
      const k = r.age / r.max
      const sx = r.x - camX, sy = r.y - camY
      if (sx < -10 || sx > VIEW_W + 10 || sy < -10 || sy > VIEW_H + 10) continue
      ctx.strokeStyle = `rgba(170,205,250,${((1 - k) * 0.4).toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(sx, sy, 1 + k * 6, (1 + k * 6) * 0.4, 0, 0, Math.PI * 2)
      ctx.stroke()
    }

    // sparks: hot, additive, gone in a blink
    ctx.globalCompositeOperation = 'lighter'
    for (const s of this.sparks) {
      const sx = s.x - camX, sy = s.y - camY
      if (sx < -4 || sx > VIEW_W + 4 || sy < -4 || sy > VIEW_H + 4) continue
      const k = 1 - s.age / s.max
      ctx.globalAlpha = k
      ctx.shadowColor = s.col
      ctx.shadowBlur = 4
      ctx.fillStyle = k > 0.7 ? '#fff4d8' : s.col
      const sz = k > 0.5 ? 2 : 1
      ctx.fillRect((sx | 0) - (sz >> 1), (sy | 0) - (sz >> 1), sz, sz)
    }

    ctx.restore()
  }
}

// =============================================================== glitchRect
// RGB-split slice corruption over a region of what's ALREADY drawn. Used on story
// beats (blackout, erasure, KERNEL contact). amt 0..1 drives violence.
// Works by re-blitting horizontal slices of the canvas onto itself with offsets,
// then fringing them cyan/magenta. Nondeterministic on purpose — it should crawl.
export function glitchRect(ctx, x, y, w, h, amt) {
  if (!(amt > 0)) return
  const cv = ctx.canvas
  const a = Math.min(1, amt)
  ctx.save()

  // horizontal tear slices
  const n = 2 + Math.round(a * 10)
  for (let i = 0; i < n; i++) {
    let sy = Math.floor(y + Math.random() * h)
    let sh = Math.max(1, Math.floor(1 + Math.random() * (1 + a * 7)))
    sy = Math.max(0, Math.min(cv.height - 1, sy))
    sh = Math.min(sh, cv.height - sy)
    const sx = Math.max(0, Math.floor(x))
    const sw = Math.min(Math.ceil(w), cv.width - sx)
    if (sw <= 0 || sh <= 0) continue
    const off = Math.round((Math.random() - 0.5) * 2 * (2 + a * 16))
    ctx.drawImage(cv, sx, sy, sw, sh, sx + off, sy, sw, sh)
    if (Math.random() < 0.65) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.08 + 0.16 * a * Math.random()
      ctx.fillStyle = Math.random() < 0.5 ? '#ff2e88' : '#29f3e2'
      ctx.fillRect(sx + off, sy, sw, sh)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  // an occasional vertical channel tear at higher violence
  if (a > 0.35 && Math.random() < 0.5) {
    const sx = Math.max(0, Math.floor(x + Math.random() * w))
    const sw = Math.max(2, Math.floor(2 + Math.random() * a * 10))
    const cw = Math.min(sw, cv.width - sx)
    const syc = Math.max(0, Math.floor(y))
    const shc = Math.min(Math.ceil(h), cv.height - syc)
    if (cw > 0 && shc > 0) {
      const off = Math.round((Math.random() - 0.5) * 2 * (1 + a * 6))
      ctx.drawImage(cv, sx, syc, cw, shc, sx, syc + off, cw, shc)
    }
  }

  // static confetti — bright dead pixels
  const blocks = Math.round(a * 7 * Math.random())
  for (let i = 0; i < blocks; i++) {
    const bx = x + Math.random() * w
    const by = y + Math.random() * h
    ctx.globalAlpha = 0.25 + Math.random() * 0.3
    ctx.fillStyle = Math.random() < 0.6 ? '#cfe3ff'
      : (Math.random() < 0.5 ? '#29f3e2' : '#ff2e88')
    ctx.fillRect(bx | 0, by | 0, 1 + ((Math.random() * 3) | 0), 1 + ((Math.random() * 2) | 0))
  }

  ctx.restore()
}

export default Particles
