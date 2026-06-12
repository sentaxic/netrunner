// overworld.js — the living city. Owns the player, NPCs, camera, weather, the
// in-game clock, warps/triggers, and the slim HUD. ARCHITECTURE.md §5.
//
// Render order each frame:
//   backdrop / parallax skyline -> ground tiles -> actors (y-sorted) -> over
//   tiles -> weather particles -> day/night tint -> fog -> Kernel glitch
//   bursts (when sister_gone) -> HUD.
//
// Dialogue trees live in story/dialogues.js (resolveDialogue(key) -> nodes) and
// are loaded lazily so this module never hard-fails if that file lags behind.

import { Scene, scenes } from '../core/scenes.js'
import { G, flag, autosave } from '../core/state.js'
import { input } from '../core/input.js'
import { bus } from '../core/events.js'
import { audio } from '../core/audio.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { PAL, mix, rgba } from '../assets/palette.js'
import { TILE } from '../assets/tiles.js'
import { Particles, glitchRect } from '../assets/vfx.js'
import { say } from '../ui/dialogue.js'
import { MAPS } from './maps.js'
import { TileMap } from './tilemap.js'
import { Actor } from './actor.js'

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const WALK_SPEED = 4.4
const RUN_SPEED = 7.2
const RAIN_TARGET = 170

// Day/night overlay keyframes: hour -> [r,g,b,alpha]. Lerped, wraps at 24.
const DAY_LUT = [
  [0.0, [8, 10, 34, 0.50]],
  [5.0, [8, 10, 34, 0.50]],
  [6.5, [140, 70, 110, 0.26]],
  [8.0, [255, 170, 110, 0.10]],
  [11.0, [160, 190, 255, 0.04]],
  [15.0, [170, 190, 255, 0.05]],
  [17.5, [255, 120, 80, 0.16]],
  [19.5, [110, 40, 100, 0.30]],
  [21.0, [8, 10, 34, 0.50]],
  [24.0, [8, 10, 34, 0.50]],
]

// What an NPC says when its dialogue tree isn't wired up (yet).
const AMBIENT = [
  'Rough night out there.',
  'Keep your hood up. The cameras itch tonight.',
  'Grid\'s been twitchy all week. Don\'t look at it wrong.',
  '...',
]

// deterministic 0..1 hash — keeps the skyline hand-placed-looking but stable
function hsh(a, b, s = 0) {
  const n = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function parseRgba(str) {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s/]*([\d.]*)\)/.exec(str || '')
  if (!m) return { r: 120, g: 150, b: 200, a: 0.08 }
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === '' ? 1 : +m[4] }
}

export class OverworldScene extends Scene {
  constructor() {
    super()
    this.dlg = null           // lazily-loaded story/dialogues.js module
    this._dlgWanted = false
  }

  // ------------------------------------------------------------------ enter
  enter(params = {}) {
    const cameFrom = G.player.map
    const mapId = params.map || G.player.map
    const map = MAPS[mapId] || MAPS.apartment
    this.mapId = MAPS[mapId] ? mapId : 'apartment'
    this.map = map
    this.tilemap = new TileMap(map)
    this.pal = PAL[map.palette] || PAL.aster
    this.fogC = parseRgba(this.pal.fog)

    // -- spawn point: explicit > named spawn > arriving from elsewhere > saved pos
    let sx, sy
    if (params.x != null && params.y != null) { sx = params.x; sy = params.y }
    else if (params.spawn && map.spawns[params.spawn]) ({ x: sx, y: sy } = map.spawns[params.spawn])
    else if (params.map && params.map !== cameFrom) ({ x: sx, y: sy } = map.spawns.default)
    else { sx = G.player.x; sy = G.player.y }
    if (this.tilemap.isSolid(sx, sy)) ({ x: sx, y: sy } = map.spawns.default)

    G.player.map = this.mapId
    G.player.x = sx
    G.player.y = sy

    this.player = new Actor({
      id: 'player', x: sx, y: sy, dir: G.player.dir || 'down',
      look: G.player.look, speed: WALK_SPEED,
    })

    // -- NPCs (flag-conditional entries supported via unless/requires)
    this.npcs = (map.npcs || [])
      .filter(n => !(n.unless && flag(n.unless)) && !(n.requires && !flag(n.requires)))
      .map(n => {
        const a = new Actor({
          id: n.id, x: n.x, y: n.y, dir: n.dir || 'down', look: n.look,
          path: n.path, script: n.script,
          speed: n.look === 'npc_kid' ? 3.0 : 1.9 + Math.random() * 0.6,
        })
        a.idle = !a.path // stationary NPCs glance around
        return a
      })

    // -- camera: center on the player, clamped (small maps letterbox-center)
    this.cam = { x: 0, y: 0 }
    this.snapCamera()

    // -- particles: rain sheet + neon data-dust, seeded around the camera
    this.particles = new Particles()
    this.particles.cx = this.cam.x
    this.particles.cy = this.cam.y
    if (this.weather() === 'rain') this.particles.spawnRain(RAIN_TARGET)
    this.particles.spawnDataMotes(flag('sister_gone') ? 46 : (map.interior ? 10 : 18))

    // -- steam vents spit sparks now and then (Forge Town breathes fire)
    this.vents = []
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (map.layers.ground[ty * map.w + tx] === 'vent') this.vents.push({ x: tx, y: ty })
      }
    }
    this.sparkT = 1 + Math.random() * 2

    // -- timers / state
    this.frozen = false           // true while a warp wipe is in flight
    this.clockAcc = 0
    this.visT = Math.random() * 90 // visual time: neon, billboards, skyline
    this._lastRender = performance.now()
    this._ticked = false
    this.toastCool = 0
    this.stepParity = 0
    this.burstT = 4 + Math.random() * 6   // Kernel glitch cadence
    this.burstA = 0
    this.brownT = 7 + Math.random() * 9   // city brown-out cadence
    this.brownA = 0

    audio.play(map.music)

    // dialogue trees: optional at runtime, never block the world
    if (!this.dlg && !this._dlgWanted) {
      this._dlgWanted = true
      import('../story/dialogues.js')
        .then(m => { this.dlg = m })
        .catch(() => { this.dlg = null })
    }

    // entry trigger under the spawn tile (e.g. intro_breakfast)
    const t0 = (map.triggers || []).find(t => t.x === sx && t.y === sy)
    if (t0) this.fireTrigger(t0)
  }

  exit() {
    G.player.x = this.player.tx
    G.player.y = this.player.ty
    G.player.dir = this.player.dir
  }

  // ------------------------------------------------------------------ helpers
  weather() { return this.map.weatherLock || G.weather }

  warpAt(tx, ty) { return (this.map.warps || []).find(w => w.x === tx && w.y === ty) }
  triggerAt(tx, ty) { return (this.map.triggers || []).find(t => t.x === tx && t.y === ty) }
  npcAt(tx, ty) { return this.npcs.find(n => !n.hidden && n.occupies(tx, ty)) }

  playerBlocked = (nx, ny) => {
    const w = this.warpAt(nx, ny)
    if (w && w.lock && !flag(w.lock)) {
      if (this.toastCool <= 0) {
        bus.emit('toast', w.lockMsg || 'SEALED')
        audio.sfx('error')
        this.toastCool = 1.4
      }
      return true
    }
    return this.npcs.some(n => !n.hidden && n.occupies(nx, ny))
  }

  npcBlocked = (nx, ny, self) => {
    if (this.player.occupies(nx, ny)) return true
    if (this.warpAt(nx, ny)) return true // NPCs don't loiter in doorways
    return this.npcs.some(n => n !== self && !n.hidden && n.occupies(nx, ny))
  }

  fireTrigger(trig) {
    if (trig.once) {
      const key = `trig:${this.mapId}:${trig.x},${trig.y}`
      if (G.flags[key]) return
      G.flags[key] = true
    }
    bus.emit(trig.event, { map: this.mapId, x: trig.x, y: trig.y })
  }

  doWarp(w) {
    this.frozen = true
    G.player.map = w.to
    G.player.x = w.tx
    G.player.y = w.ty
    audio.sfx('confirm')
    scenes.switchTo('overworld', { map: w.to, x: w.tx, y: w.ty }, 'glitch')
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this._ticked = true

    // -- player input ---------------------------------------------------------
    if (!this.frozen) {
      this.player.speed = input.isDown('run') ? RUN_SPEED : WALK_SPEED
      const d = input.dir()
      if (!this.player.moving && (d.x || d.y)) {
        // axis priority: keep momentum on the current facing, slide on the other
        const vertFirst = d.y && (!d.x || this.player.dir === 'up' || this.player.dir === 'down')
        const order = vertFirst ? [[0, d.y], [d.x, 0]] : [[d.x, 0], [0, d.y]]
        for (const [dx, dy] of order) {
          if (!dx && !dy) continue
          if (this.player.tryStep(dx, dy, this.tilemap, this.playerBlocked)) {
            if ((this.stepParity++ & 1) === 0) audio.sfx('step')
            break
          }
        }
      }
    }

    this.player.update(dt, this.tilemap, this.playerBlocked)
    G.player.x = this.player.tx
    G.player.y = this.player.ty
    G.player.dir = this.player.dir

    // -- arriving on a tile: warps, then triggers --------------------------------
    if (!this.frozen && this.player.justArrived) {
      const { tx, ty } = this.player
      const w = this.warpAt(tx, ty)
      if (w && !(w.lock && !flag(w.lock))) {
        this.doWarp(w)
      } else {
        const trig = this.triggerAt(tx, ty)
        if (trig) this.fireTrigger(trig)
      }
    }

    // -- NPCs wander their routes -------------------------------------------------
    for (const n of this.npcs) n.update(dt, this.tilemap, this.npcBlocked)

    // -- weather particles ----------------------------------------------------------
    this.particles.update(dt)
    const raining = this.weather() === 'rain'
    if (raining && this.particles.rain.length < RAIN_TARGET) this.particles.spawnRain(4)
    if (!raining && this.particles.rain.length) {
      this.particles.rain.splice(0, Math.max(1, Math.ceil(dt * 140)))
    }

    // forge steam vents cough up sparks
    if (this.vents.length) {
      this.sparkT -= dt
      if (this.sparkT <= 0) {
        const v = this.vents[(Math.random() * this.vents.length) | 0]
        this.particles.spawnSparks(v.x * TILE + 8, v.y * TILE + 6, 4 + ((Math.random() * 5) | 0))
        this.sparkT = 0.8 + Math.random() * 2.2
      }
    }

    // -- the clock: ~1 game-minute per real second ------------------------------------
    this.clockAcc += dt
    while (this.clockAcc >= 1) {
      this.clockAcc -= 1
      G.clock.minutes++
      if (G.clock.minutes >= 1440) { G.clock.minutes = 0; G.clock.day++ }
      bus.emit('time:tick', { minutes: G.clock.minutes, day: G.clock.day })
      // weather drifts every three game-hours (exteriors only)
      if (G.clock.minutes % 180 === 0 && !this.map.weatherLock && Math.random() < 0.35) {
        G.weather = G.weather === 'rain' ? 'clear' : 'rain'
        bus.emit('toast', G.weather === 'rain' ? 'RAIN MOVING IN' : 'RAIN EASING OFF')
      }
    }

    // -- camera smooth-follow, clamped to map bounds ------------------------------------
    const k = Math.min(1, dt * 7)
    const tgt = this.camTarget()
    this.cam.x += (tgt.x - this.cam.x) * k
    this.cam.y += (tgt.y - this.cam.y) * k

    // -- keys: interact / pause / world map -----------------------------------------------
    if (!this.frozen) {
      if (input.wasPressed('confirm') && !this.player.moving) this.interact()
      if (input.wasPressed('menu')) scenes.switchTo('pause')
      if (input.wasPressed('map')) {
        if (flag('rail_unlocked')) scenes.switchTo('worldmap', {}, 'fade')
        else if (this.toastCool <= 0) {
          bus.emit('toast', 'NO RAIL ACCESS')
          audio.sfx('cancel')
          this.toastCool = 1.2
        }
      }
    }

    this.toastCool -= dt
  }

  camTarget() {
    const cx = this.player.px + TILE / 2 - VIEW_W / 2
    const cy = this.player.py + 4 - VIEW_H / 2
    const maxX = this.tilemap.pxW - VIEW_W
    const maxY = this.tilemap.pxH - VIEW_H
    return {
      x: maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, cx)),
      y: maxY <= 0 ? maxY / 2 : Math.max(0, Math.min(maxY, cy)),
    }
  }

  snapCamera() { this.cam = this.camTarget() }

  // ------------------------------------------------------------------ interact
  interact() {
    const [dx, dy] = DIRS[this.player.dir]
    const fx = this.player.tx + dx
    const fy = this.player.ty + dy

    // an NPC one tile ahead
    let npc = this.npcAt(fx, fy)
    // ...or one standing behind a counter / desk / terminal (shopkeep reach-over)
    if (!npc && this.tilemap.isSolid(fx, fy)) {
      const id = this.tilemap.tileAt(fx, fy)
      if (id === 'counter' || id === 'desk' || id === 'terminal') npc = this.npcAt(fx + dx, fy + dy)
    }
    if (npc) {
      npc.facePoint(this.player.tx, this.player.ty)
      npc.pause(3)
      this.talk(npc)
      return
    }

    const trig = this.triggerAt(fx, fy)
    if (trig) { this.fireTrigger(trig); return }

    if (this.tilemap.tileAt(fx, fy) === 'bed') { // beds are save points
      audio.sfx('confirm')
      autosave()
    }
  }

  talk(npc) {
    audio.sfx('blip')
    let nodes = null
    try { nodes = this.dlg?.resolveDialogue?.(npc.script) } catch { nodes = null }
    if (!nodes || (Array.isArray(nodes) && nodes.length === 0)) {
      const who = (npc.id || '???').replace(/_/g, ' ').toUpperCase()
      nodes = [{ who, text: AMBIENT[(hsh(npc.tx, npc.ty, G.clock.day) * AMBIENT.length) | 0] }]
    }
    if (typeof say === 'function') say(nodes)
  }

  // ------------------------------------------------------------------ render
  render(ctx) {
    // visual clock keeps breathing even while dialogue pauses update()
    const now = performance.now()
    const rdt = Math.min(0.05, (now - this._lastRender) / 1000)
    this._lastRender = now
    this.visT += rdt
    if (!this._ticked) this.particles.update(rdt) // rain doesn't stop for talk
    this._ticked = false

    const cam = { x: Math.round(this.cam.x), y: Math.round(this.cam.y) }
    const P = this.pal

    // -- backdrop + parallax skyline -----------------------------------------------
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    if (this.map.sky) this.drawSkyline(ctx, cam)

    // -- world: ground -> actors (y-sorted) -> over ----------------------------------
    this.tilemap.render(ctx, cam, this.visT, 'ground')
    this.player.tint = 1 + 0.08 * Math.sin(this.visT * 2.2)
    const cast = [this.player, ...this.npcs.filter(n => !n.hidden)]
    cast.sort((a, b) => a.py - b.py)
    for (const a of cast) a.draw(ctx, cam)
    this.tilemap.render(ctx, cam, this.visT, 'over')

    // -- weather ------------------------------------------------------------------------
    this.particles.render(ctx, cam.x, cam.y)

    // -- day/night tint (roofed maps barely feel it) ---------------------------------------
    const [r, g, b, a] = this.dayTint()
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(a * (this.map.interior ? 0.45 : 1)).toFixed(3)})`
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)

    // -- drifting ground fog -----------------------------------------------------------------
    this.drawFog(ctx)

    // -- city brown-out: the grid stutters, everything dips ------------------------------------
    this.brownT -= rdt
    if (this.brownT <= 0) { this.brownA = 0.12 + Math.random() * 0.1; this.brownT = 7 + Math.random() * 9 }
    if (this.brownA > 0) {
      this.brownA = Math.max(0, this.brownA - rdt * 0.9)
      ctx.fillStyle = `rgba(0,0,0,${(this.brownA * 1.4).toFixed(3)})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }

    // -- Kernel corruption: after the erasure, reality tears at the edges ------------------------
    if (flag('sister_gone')) {
      this.burstT -= rdt
      if (this.burstT <= 0) {
        this.burstA = 0.22 + Math.random() * 0.2
        this.burstT = 4 + Math.random() * 7
        if (Math.random() < 0.35) audio.sfx('glitch')
      }
      if (this.burstA > 0) {
        this.burstA -= rdt
        const gw = 60 + Math.random() * 160
        const gh = 24 + Math.random() * 70
        glitchRect(ctx, Math.random() * (VIEW_W - gw), Math.random() * (VIEW_H - gh), gw, gh, 0.25 + Math.random() * 0.4)
      }
    }

    // -- vignette + HUD ---------------------------------------------------------------------------
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.5, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.72)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.32)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)

    this.drawHUD(ctx)
  }

  // Far skyline behind the open rows of exterior maps. Two parallax bands of
  // towers, blinking windows, a beacon or two, and the occasional aircar.
  drawSkyline(ctx, cam) {
    const horizon = this.map.sky * TILE - cam.y
    if (horizon <= 0) return
    const P = this.pal
    const sky = ctx.createLinearGradient(0, 0, 0, horizon + 28)
    sky.addColorStop(0, P.bg)
    sky.addColorStop(1, mix(P.bg, P.sky || P.wall, 0.8))
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, VIEW_W, horizon + 28)

    // stars only show deep at night
    const hour = G.clock.minutes / 60
    if (hour < 5.5 || hour > 20.5) {
      for (let i = 0; i < 26; i++) {
        const x = (hsh(i, 1) * VIEW_W) | 0
        const y = (hsh(i, 2) * Math.max(8, horizon - 16)) | 0
        ctx.globalAlpha = 0.25 + 0.3 * Math.sin(this.visT * (0.6 + hsh(i, 3)) + i)
        ctx.fillStyle = '#cfe3ff'
        ctx.fillRect(x, y, 1, 1)
      }
      ctx.globalAlpha = 1
    }

    // far band — pale, slow
    const farCol = mix(P.bg, P.glow || P.wall, 0.1)
    for (let i = 0; i < 22; i++) {
      const w = 12 + hsh(i, 4) * 22
      const span = VIEW_W + 80
      const x = ((((i * 47 - cam.x * 0.25) % span) + span) % span) - 40
      const h = 12 + hsh(i, 5) * Math.max(10, horizon * 0.8)
      ctx.fillStyle = farCol
      ctx.fillRect(x | 0, (horizon - h) | 0, w | 0, (h + 28) | 0)
    }

    // near band — darker silhouettes with lit windows and beacons
    const nearCol = mix(P.bg, P.wall, 0.55)
    for (let i = 0; i < 14; i++) {
      const w = 18 + hsh(i, 6) * 30
      const span = VIEW_W + 120
      const x = ((((i * 83 - cam.x * 0.5) % span) + span) % span) - 60
      const h = 18 + hsh(i, 7) * Math.max(14, horizon * 1.05)
      const top = horizon - h
      ctx.fillStyle = nearCol
      ctx.fillRect(x | 0, top | 0, w | 0, (h + 28) | 0)
      // windows
      for (let wy = 0; wy < 4; wy++) {
        for (let wx = 0; wx < 3; wx++) {
          const hh = hsh(i, 8 + wx + wy * 3)
          if (hh < 0.55) continue
          const blink = 0.4 + 0.6 * Math.max(0, Math.sin(this.visT * (0.3 + hh) + hh * 30))
          ctx.globalAlpha = 0.5 * blink
          ctx.fillStyle = hh > 0.9 ? P.neon2 : hh > 0.75 ? P.neon1 : P.accent
          ctx.fillRect((x + 3 + wx * 5) | 0, (top + 4 + wy * 6) | 0, 2, 2)
        }
      }
      ctx.globalAlpha = 1
      if (hsh(i, 20) > 0.75) { // rooftop beacon
        const pulse = 0.5 + 0.5 * Math.sin(this.visT * 2 + i)
        ctx.globalAlpha = 0.5 + 0.5 * pulse
        ctx.fillStyle = '#ff2e58'
        ctx.fillRect((x + w / 2) | 0, (top - 2) | 0, 1, 1)
        ctx.globalAlpha = 1
      }
    }

    // an aircar threading the towers
    const span = VIEW_W + 140
    const ax = ((this.visT * 26) % span) - 70
    const ay = 10 + Math.max(4, horizon * 0.35) + Math.sin(this.visT * 0.8) * 5
    ctx.globalAlpha = 0.7
    ctx.fillStyle = '#ff2e58'
    ctx.fillRect(ax | 0, ay | 0, 2, 1)
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#cfe3ff'
    ctx.fillRect((ax - 5) | 0, ay | 0, 5, 1)
    ctx.globalAlpha = 1
  }

  drawFog(ctx) {
    const { r, g, b, a } = this.fogC
    const c = al => `rgba(${r},${g},${b},${Math.min(0.5, al).toFixed(3)})`
    // ground fog pooling low
    const fg = ctx.createLinearGradient(0, VIEW_H * 0.45, 0, VIEW_H)
    fg.addColorStop(0, c(0))
    fg.addColorStop(1, c(a * 2.4))
    ctx.fillStyle = fg
    ctx.fillRect(0, VIEW_H * 0.45, VIEW_W, VIEW_H * 0.55)
    // a slow drifting bank
    const bandY = VIEW_H * 0.4 + Math.sin(this.visT * 0.07) * 34
    const bg2 = ctx.createLinearGradient(0, bandY - 22, 0, bandY + 22)
    bg2.addColorStop(0, c(0))
    bg2.addColorStop(0.5, c(a * 1.3))
    bg2.addColorStop(1, c(0))
    ctx.fillStyle = bg2
    ctx.fillRect(0, bandY - 22, VIEW_W, 44)
  }

  dayTint() {
    const hour = (G.clock.minutes / 60) % 24
    for (let i = 0; i < DAY_LUT.length - 1; i++) {
      const [h0, c0] = DAY_LUT[i]
      const [h1, c1] = DAY_LUT[i + 1]
      if (hour >= h0 && hour <= h1) {
        const k = h1 === h0 ? 0 : (hour - h0) / (h1 - h0)
        return c0.map((v, j) => v + (c1[j] - v) * k)
      }
    }
    return DAY_LUT[0][1]
  }

  drawHUD(ctx) {
    const m = G.clock.minutes
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    const left = `¢${G.creds}`
    const right = `REP ${G.rep}  ${hh}:${mm} D${G.clock.day}`
    ctx.save()
    ctx.font = '8px monospace'
    ctx.textBaseline = 'top'
    const wL = ctx.measureText(left).width
    const wR = ctx.measureText(right).width
    ctx.fillStyle = 'rgba(3,5,12,0.62)'
    ctx.fillRect(4, 4, wL + wR + 16, 12)
    ctx.fillStyle = this.pal.accent || '#ffb547'
    ctx.fillText(left, 8, 6)
    ctx.fillStyle = 'rgba(207,227,255,0.88)'
    ctx.fillText(right, 8 + wL + 8, 6)
    if (this.weather() === 'rain' && !this.map.interior) { // tiny rain tick
      ctx.fillStyle = 'rgba(122,215,255,0.8)'
      ctx.fillRect(wL + wR + 14, 7, 1, 3)
      ctx.fillRect(wL + wR + 12, 10, 1, 3)
    }
    ctx.restore()
  }
}

export default OverworldScene
