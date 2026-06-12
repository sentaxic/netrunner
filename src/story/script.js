// ============================================================================
// NETRUNNER · src/story/script.js — IntroScene. ARCHITECTURE.md §8.
//
// The cinematic opening, fully playable: a step-driven guided sequence that
// renders real maps (TileMap + Actors) with letterboxing, scripted walks,
// captions, fades and the blackout — then hands off to the first jack-in.
//
// Beats:
//   1. Morning in the apartment — breakfast with Mara.        (sister_breakfast)
//   2. Aster Street — brief free movement, then THE BLACKOUT: shake, glitch,
//      every display reads ERROR 404: HUMAN OVERRIDE NOT FOUND, the city
//      freezes, resets.                                       (intro_blackout_seen)
//   3. Night — she leaves and never returns; the world forgets.   (sister_gone)
//   4. Her room — the terminal under the rug. "YOU ARE BEING WATCHED."
//      -> jack-in m_find_underground.                         (found_terminal)
//
// Confirm advances dialogue and skips waits/captions, so it never drags.
// Registered as 'intro' by main.js; entered from NewGameScene.
// ============================================================================

import { Scene, scenes } from '../core/scenes.js'
import { G, setFlag, flag } from '../core/state.js'
import { input } from '../core/input.js'
import { bus } from '../core/events.js'
import { audio } from '../core/audio.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { PAL, rgba, mix } from '../assets/palette.js'
import { TILE } from '../assets/tiles.js'
import { Particles, glitchRect } from '../assets/vfx.js'
import { say, dialogueActive } from '../ui/dialogue.js'
import { MAPS } from '../world/maps.js'
import { TileMap } from '../world/tilemap.js'
import { Actor } from '../world/actor.js'
import { resolveDialogue } from './dialogues.js'

const BAR_H = 22            // cinematic letterbox bars
const CAP_CPS = 30          // caption typewriter speed
const WALK_SPEED = 4.4
const RUN_SPEED = 7.2
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

// Display-ish tiles that the blackout corrupts.
const DISPLAY_TILES = new Set(['billboard', 'neon', 'terminal', 'server'])

// ---- tiny step builders ------------------------------------------------------
const D = fn => ({ kind: 'do', fn })
const W = t => ({ kind: 'wait', t })
const F = (to, dur) => ({ kind: 'fade', to, dur })
const C = (text, sub, hold, black) => ({ kind: 'caption', text, sub, hold, black: !!black })
const SAY = key => ({ kind: 'say', key })
const WALK = (who, x, y, dir) => ({ kind: 'walk', who, x, y, dir })
const FREE = (t, hint) => ({ kind: 'free', t, hint })

export class IntroScene extends Scene {

  // ------------------------------------------------------------------ enter
  enter() {
    // world holders
    this.mapId = null
    this.map = null
    this.tilemap = null
    this.pal = PAL.aster
    this.player = null
    this.sister = null
    this.npcs = []
    this.displays = []
    this.particles = new Particles()
    this.cam = { x: 0, y: 0 }

    // presentation state
    this.black = 1                  // 0 clear .. 1 full black
    this.blackTarget = 1
    this.fadeSpeed = 1
    this.tint = [10, 14, 40, 0.4]   // scripted day/night wash [r,g,b,a]
    this.cap = null                 // active caption {text,sub,black}
    this.freeze = false             // city frozen (blackout)
    this.bo = null                  // blackout timeline {t}
    this.boSfx = 0
    this.resumeFlash = 0
    this.glitchy = false            // post-erasure corruption bursts
    this.gT = 2.5
    this.gA = 0
    this.visT = Math.random() * 60  // render-side clock (keeps breathing in dialogue)
    this._lastRender = performance.now()
    this._ticked = false
    this.stepParity = 0

    // the script
    this.steps = this.buildScript()
    this.si = -1
    this.st = null                  // current step
    this.stT = 0                    // time inside current step
    this._advance()
  }

  exit() {
    if (this.player && this.mapId) {
      G.player.map = this.mapId
      G.player.x = this.player.tx
      G.player.y = this.player.ty
      G.player.dir = this.player.dir
    }
  }

  // ------------------------------------------------------------------ script
  buildScript() {
    const S = []

    // ---- beat 1: morning ------------------------------------------------------
    S.push(D(() => {
      this.loadMap('apartment', 5, 6, 'up', { npcs: false })
      this.spawnSister(2, 2, 'up')
      this.tint = [255, 176, 120, 0.07]
      this.black = 1
      this.blackTarget = 1
      audio.play('sister')
    }))
    S.push(C('ASTER CITY', 'year 2189 · the rain is older than you', 2.8, true))
    S.push(F(0, 1.2))
    S.push(W(0.7))
    S.push(D(() => { this.sister.facePoint(this.player.tx, this.player.ty) }))
    S.push(SAY('sister_breakfast'))
    S.push(D(() => { if (!flag('intro_breakfast_done')) setFlag('intro_breakfast_done') }))
    S.push(W(0.5))
    S.push(F(1, 0.9))
    S.push(C('LATER.', null, 1.6, true))

    // ---- beat 2: the street, then the blackout --------------------------------
    S.push(D(() => {
      this.loadMap('aster_street', 4, 5, 'down', { npcs: true })
      this.tint = [160, 190, 255, 0.05]
      audio.play('aster')
    }))
    S.push(F(0, 1.0))
    S.push(FREE(8, 'ARROWS / WASD — WALK'))
    S.push(D(() => this.startBlackout()))
    S.push(W(6.4))
    S.push(D(() => this.endBlackout()))
    S.push(W(1.0))
    S.push(SAY('blackout_react'))
    S.push(C('By dinner, nobody mentions it. The city has agreed it never happened.', null, 3.2, false))

    // ---- beat 3: night — she leaves -------------------------------------------
    S.push(F(1, 1.1))
    S.push(C('THAT NIGHT.', null, 2.0, true))
    S.push(D(() => {
      this.loadMap('apartment', 5, 6, 'down', { npcs: false })
      this.spawnSister(6, 7, 'up')
      this.tint = [10, 14, 40, 0.42]
      audio.play('sister')
    }))
    S.push(F(0, 1.0))
    S.push(D(() => { this.sister.facePoint(this.player.tx, this.player.ty) }))
    S.push(SAY('sister_leaving'))
    S.push(WALK('sister', 6, 8, 'down'))
    S.push(D(() => { this.sister.hidden = true; audio.sfx('step') }))
    S.push(W(1.0))
    S.push(F(1, 1.4))
    S.push(C('You wake at 03:14 to every screen in the building breathing.', null, 3.0, true))
    S.push(C('She is not home by breakfast.', null, 2.4, true))
    S.push(C('She is not home by night.', null, 2.4, true))
    S.push(C('On the third day you stop saying her name out loud. The walls feel like they report it.', null, 3.4, true))
    S.push(D(() => {
      if (!flag('sister_gone')) setFlag('sister_gone')
      this.loadMap('apartment', 5, 6, 'up', { npcs: false }) // her chair is just a chair now
      this.tint = [10, 14, 40, 0.46]
      this.glitchy = true
      audio.play('sister')
    }))
    S.push(F(0, 1.2))
    S.push(SAY('world_forgot'))
    S.push(W(0.4))

    // ---- beat 4: her room, the rug, the deck -----------------------------------
    S.push(F(1, 0.8))
    S.push(C('Her room, then.', null, 1.8, true))
    S.push(D(() => {
      this.loadMap('sister_room', 3, 5, 'up', { npcs: false })
      this.tint = [10, 14, 40, 0.46]
    }))
    S.push(F(0, 0.8))
    S.push(W(0.4))
    S.push(WALK('player', 3, 4, 'up'))
    S.push(W(0.6))
    S.push(SAY('terminal_discovery')) // its final action sets found_terminal + launches the dive
    S.push(D(() => {
      // failsafe: if the tree could not resolve, launch the dive directly
      if (!flag('found_terminal')) {
        setFlag('found_terminal')
        G.player.map = 'sister_room'
        G.player.x = 3
        G.player.y = 4
        G.player.dir = 'up'
        bus.emit('jackin:start', 'm_find_underground')
        scenes.switchTo('jackin', { missionId: 'm_find_underground' }, 'glitch')
      }
    }))
    return S
  }

  // ------------------------------------------------------------------ staging
  loadMap(id, px, py, dir = 'down', opts = {}) {
    const map = MAPS[id]
    this.mapId = id
    this.map = map
    this.tilemap = new TileMap(map)
    this.pal = PAL[map.palette] || PAL.aster
    this.sister = null
    this.glitchy = false

    this.player = new Actor({
      id: 'player', x: px, y: py, dir,
      look: G.player.look, speed: WALK_SPEED,
    })
    G.player.map = id
    G.player.x = px
    G.player.y = py

    // ambient cast (street beat) — flag-aware, same filter the overworld uses
    this.npcs = []
    if (opts.npcs) {
      for (const n of map.npcs || []) {
        if (n.unless && flag(n.unless)) continue
        if (n.requires && !flag(n.requires)) continue
        if (n.id === 'sister') continue // the cinematic stages her itself
        const a = new Actor({
          id: n.id, x: n.x, y: n.y, dir: n.dir || 'down', look: n.look,
          path: n.path, script: n.script,
          speed: n.look === 'npc_kid' ? 3.0 : 1.9 + Math.random() * 0.6,
        })
        a.idle = !a.path
        this.npcs.push(a)
      }
    }

    // displays for the blackout to corrupt
    this.displays = []
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (DISPLAY_TILES.has(map.layers.ground[ty * map.w + tx])) {
          this.displays.push({ x: tx * TILE, y: ty * TILE })
        }
      }
    }

    // weather
    this.particles = new Particles()
    const raining = !map.interior && (map.weatherLock || G.weather) === 'rain'
    this.cam = this.camTarget()
    this.particles.cx = this.cam.x
    this.particles.cy = this.cam.y
    if (raining) this.particles.spawnRain(160)
    this.particles.spawnDataMotes(map.interior ? 8 : 16)
  }

  spawnSister(x, y, dir = 'down') {
    this.sister = new Actor({ id: 'sister', x, y, dir, look: 'sister', speed: 3.2 })
  }

  cast() {
    const c = [this.player]
    if (this.sister && !this.sister.hidden) c.push(this.sister)
    for (const n of this.npcs) if (!n.hidden) c.push(n)
    return c
  }

  actorByName(who) { return who === 'sister' ? this.sister : this.player }

  blockedFor(self) {
    return (nx, ny) => this.cast().some(a => a !== self && a.occupies(nx, ny))
  }

  camTarget() {
    if (!this.tilemap || !this.player) return { x: 0, y: 0 }
    const cx = this.player.px + TILE / 2 - VIEW_W / 2
    const cy = this.player.py + 4 - VIEW_H / 2
    const maxX = this.tilemap.pxW - VIEW_W
    const maxY = this.tilemap.pxH - VIEW_H
    return {
      x: maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, cx)),
      y: maxY <= 0 ? maxY / 2 : Math.max(0, Math.min(maxY, cy)),
    }
  }

  // ------------------------------------------------------------------ blackout
  startBlackout() {
    this.bo = { t: 0 }
    this.freeze = true
    this.boSfx = 1.2
    audio.sfx('glitch')
    audio.sfx('error')
  }

  endBlackout() {
    this.bo = null
    this.freeze = false
    this.resumeFlash = 0.5
    if (!flag('intro_blackout_seen')) setFlag('intro_blackout_seen')
    audio.sfx('glitch')
  }

  // ------------------------------------------------------------------ steps
  _advance() {
    for (;;) {
      this.si++
      this.st = this.steps[this.si] || null
      this.stT = 0
      if (!this.st) return                      // script exhausted — idle out
      if (this.st.kind === 'do') {
        try { this.st.fn() } catch (err) { console.error('[intro]', err) }
        continue                                // instant — chain to the next
      }
      if (this.st.kind === 'fade') {
        this.blackTarget = this.st.to
        this.fadeSpeed = 1 / Math.max(0.05, this.st.dur)
        return
      }
      if (this.st.kind === 'caption') {
        this.cap = { text: this.st.text, sub: this.st.sub, black: this.st.black }
        return
      }
      if (this.st.kind === 'say') {
        const nodes = resolveDialogue(this.st.key)
        this.st.started = true
        if (nodes && nodes.length) say(nodes)
        return
      }
      return                                    // wait / walk / free start ticking
    }
  }

  _finishStep() {
    if (this.st && this.st.kind === 'caption') this.cap = null
    this._advance()
  }

  skipStep() {
    const st = this.st
    if (!st) return
    switch (st.kind) {
      case 'wait':
      case 'caption':
      case 'free':
        audio.sfx('blip')
        this._finishStep()
        break
      case 'fade':
        this.black = this.blackTarget
        this._finishStep()
        break
      case 'walk': {
        const a = this.actorByName(st.who)
        if (a) { a.moveTo(st.x, st.y); if (st.dir) a.face(st.dir) }
        audio.sfx('blip')
        this._finishStep()
        break
      }
      // 'say' is advanced by the dialogue layer itself
    }
  }

  onKey(e) {
    const c = e.code
    const confirm = c === 'Enter' || c === 'KeyZ' || c === 'Space'
    const cancel = c === 'Escape' || c === 'KeyX'
    if (confirm || cancel) this.skipStep()
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this._ticked = true

    // fades
    if (this.black !== this.blackTarget) {
      const d = Math.sign(this.blackTarget - this.black) * this.fadeSpeed * dt
      this.black += d
      if ((d > 0 && this.black >= this.blackTarget) || (d < 0 && this.black <= this.blackTarget)) {
        this.black = this.blackTarget
      }
    }

    // blackout timeline sounds
    if (this.bo) {
      this.bo.t += dt
      this.boSfx -= dt
      if (this.boSfx <= 0 && this.bo.t < 5.4) {
        audio.sfx(Math.random() < 0.5 ? 'error' : 'glitch')
        this.boSfx = 1.1 + Math.random() * 0.9
      }
    }
    if (this.resumeFlash > 0) this.resumeFlash -= dt

    // the world breathes (unless frozen)
    if (this.player && !this.freeze) {
      this.player.update(dt, this.tilemap, this.blockedFor(this.player))
      if (this.sister) this.sister.update(dt, this.tilemap, this.blockedFor(this.sister))
      for (const n of this.npcs) n.update(dt, this.tilemap, this.blockedFor(n))
    }
    this.particles.update(dt)
    if (this.player) {
      G.player.x = this.player.tx
      G.player.y = this.player.ty
      G.player.dir = this.player.dir
    }

    // camera
    const tgt = this.camTarget()
    const k = Math.min(1, dt * 7)
    this.cam.x += (tgt.x - this.cam.x) * k
    this.cam.y += (tgt.y - this.cam.y) * k

    // ---- current step ----------------------------------------------------------
    const st = this.st
    if (!st) return
    this.stT += dt

    switch (st.kind) {
      case 'wait':
        if (this.stT >= st.t) this._finishStep()
        break

      case 'fade':
        if (this.black === this.blackTarget) this._finishStep()
        break

      case 'caption': {
        const reveal = (st.text || '').length / CAP_CPS
        if (this.stT >= reveal + st.hold) this._finishStep()
        break
      }

      case 'say':
        // update() only runs while no dialogue is active, so reaching here
        // after start means the conversation ended (or never resolved).
        if (st.started && !dialogueActive()) this._finishStep()
        break

      case 'walk': {
        const a = this.actorByName(st.who)
        if (!a) { this._finishStep(); break }
        if (!a.moving && a.tx === st.x && a.ty === st.y) {
          if (st.dir) a.face(st.dir)
          this._finishStep()
          break
        }
        if (!a.moving) {
          const dx = Math.sign(st.x - a.tx)
          const dy = Math.sign(st.y - a.ty)
          const horizFirst = Math.abs(st.x - a.tx) >= Math.abs(st.y - a.ty)
          const order = horizFirst ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]]
          let ok = false
          for (const [mx, my] of order) {
            if (!mx && !my) continue
            if (a.tryStep(mx, my, this.tilemap, this.blockedFor(a))) { ok = true; break }
          }
          st.stuck = ok ? 0 : (st.stuck || 0) + dt
          if (st.stuck > 2.5) { a.moveTo(st.x, st.y); if (st.dir) a.face(st.dir); this._finishStep() }
        }
        break
      }

      case 'free': {
        if (!this.freeze && this.player) {
          this.player.speed = input.isDown('run') ? RUN_SPEED : WALK_SPEED
          const d = input.dir()
          if (!this.player.moving && (d.x || d.y)) {
            const vertFirst = d.y && (!d.x || this.player.dir === 'up' || this.player.dir === 'down')
            const order = vertFirst ? [[0, d.y], [d.x, 0]] : [[d.x, 0], [0, d.y]]
            for (const [mx, my] of order) {
              if (!mx && !my) continue
              if (this.player.tryStep(mx, my, this.tilemap, this.blockedFor(this.player))) {
                if ((this.stepParity++ & 1) === 0) audio.sfx('step')
                break
              }
            }
          }
        }
        if (this.stT >= st.t) this._finishStep()
        break
      }
    }
  }

  // ------------------------------------------------------------------ render
  render(ctx) {
    const now = performance.now()
    const rdt = Math.min(0.05, (now - this._lastRender) / 1000)
    this._lastRender = now
    this.visT += rdt
    if (!this._ticked) this.particles.update(rdt) // rain keeps falling through dialogue
    this._ticked = false

    const P = this.pal

    // ---- world ------------------------------------------------------------------
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)

    if (this.tilemap && this.black < 1) {
      // blackout shake
      let ox = 0, oy = 0
      if (this.bo && this.bo.t < 1.0) {
        const amp = (1 - this.bo.t) * 3 + 1
        ox = (Math.random() * 2 - 1) * amp
        oy = (Math.random() * 2 - 1) * amp
      }
      const cam = { x: Math.round(this.cam.x + ox), y: Math.round(this.cam.y + oy) }

      // simple sky band on exterior maps
      if (this.map.sky) {
        const horizon = this.map.sky * TILE - cam.y
        if (horizon > 0) {
          const sky = ctx.createLinearGradient(0, 0, 0, horizon + 24)
          sky.addColorStop(0, P.bg)
          sky.addColorStop(1, mix(P.bg, P.wall, 0.7))
          ctx.fillStyle = sky
          ctx.fillRect(0, 0, VIEW_W, horizon + 24)
        }
      }

      this.tilemap.render(ctx, cam, this.visT, 'ground')
      const cast = this.cast().slice().sort((a, b) => a.py - b.py)
      for (const a of cast) a.draw(ctx, cam)
      this.tilemap.render(ctx, cam, this.visT, 'over')
      this.particles.render(ctx, cam.x, cam.y)

      // scripted wash
      const [r, g, b, a] = this.tint
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)

      // ---- THE BLACKOUT ----------------------------------------------------------
      if (this.bo) this.renderBlackout(ctx, cam)

      // lights snapping back
      if (this.resumeFlash > 0) {
        ctx.fillStyle = `rgba(207,227,255,${(this.resumeFlash * 0.5).toFixed(3)})`
        ctx.fillRect(0, 0, VIEW_W, VIEW_H)
        if (Math.random() < 0.4) glitchRect(ctx, Math.random() * 300, Math.random() * 200, 120, 40, 0.3)
      }

      // post-erasure corruption bursts
      if (this.glitchy && !this.bo) {
        this.gT -= rdt
        if (this.gT <= 0) {
          this.gA = 0.25 + Math.random() * 0.2
          this.gT = 2.5 + Math.random() * 4
          if (Math.random() < 0.3) audio.sfx('glitch')
        }
        if (this.gA > 0) {
          this.gA -= rdt
          const gw = 50 + Math.random() * 140
          const gh = 20 + Math.random() * 60
          glitchRect(ctx, Math.random() * (VIEW_W - gw), Math.random() * (VIEW_H - gh), gw, gh, 0.25 + Math.random() * 0.35)
        }
      }

      // vignette
      const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.5, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.72)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.34)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }

    // ---- fade to/from black --------------------------------------------------------
    if (this.black > 0) {
      ctx.fillStyle = `rgba(2,3,8,${(this.black * 0.985).toFixed(3)})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }

    // ---- letterbox -------------------------------------------------------------------
    ctx.fillStyle = '#020308'
    ctx.fillRect(0, 0, VIEW_W, BAR_H)
    ctx.fillRect(0, VIEW_H - BAR_H, VIEW_W, BAR_H)

    // ---- caption ---------------------------------------------------------------------
    if (this.cap && this.st && this.st.kind === 'caption') this.renderCaption(ctx)

    // ---- free-walk hint ----------------------------------------------------------------
    if (this.st && this.st.kind === 'free' && this.st.hint) {
      ctx.save()
      ctx.font = '8px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const blink = 0.45 + 0.3 * Math.sin(this.visT * 3)
      ctx.fillStyle = rgba('#5b6c8e', blink)
      ctx.fillText(this.st.hint, VIEW_W / 2, VIEW_H - BAR_H + 7)
      ctx.restore()
    }
  }

  renderBlackout(ctx, cam) {
    const t = this.bo.t
    const settled = t >= 1.0

    // darkness ramps in, then holds heavy
    const dark = settled ? 0.78 : 0.3 + 0.3 * Math.abs(Math.sin(t * 21))
    ctx.fillStyle = `rgba(1,2,5,${dark.toFixed(3)})`
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)

    // tearing
    const tears = settled ? 2 : 5
    for (let i = 0; i < tears; i++) {
      const gw = 70 + Math.random() * 180
      const gh = 10 + Math.random() * 50
      glitchRect(ctx, Math.random() * (VIEW_W - gw), Math.random() * (VIEW_H - gh), gw, gh, settled ? 0.25 : 0.55)
    }

    // every display in town shows the same thing
    ctx.save()
    ctx.font = 'bold 7px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const dsp of this.displays) {
      const sx = dsp.x - cam.x
      const sy = dsp.y - cam.y
      if (sx < -TILE || sx > VIEW_W || sy < -TILE || sy > VIEW_H) continue
      ctx.fillStyle = 'rgba(2,3,8,0.95)'
      ctx.fillRect(sx, sy + 3, TILE, 10)
      if (Math.random() > 0.12) {
        ctx.fillStyle = Math.random() < 0.85 ? '#ff2e58' : '#ff2e88'
        ctx.fillText('404', sx + TILE / 2, sy + 5)
      }
    }
    ctx.restore()

    // the message, center frame
    if (t > 0.5) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const jx = (Math.random() * 2 - 1) * (settled ? 0.7 : 2)
      const jy = (Math.random() * 2 - 1) * (settled ? 0.7 : 2)
      const a = settled ? 0.85 + Math.random() * 0.15 : Math.random()
      ctx.font = 'bold 18px monospace'
      ctx.shadowColor = '#ff2e58'
      ctx.shadowBlur = 12
      ctx.fillStyle = rgba('#ff2e58', a)
      ctx.fillText('ERROR 404', VIEW_W / 2 + jx, VIEW_H / 2 - 10 + jy)
      ctx.font = 'bold 9px monospace'
      ctx.shadowBlur = 8
      ctx.fillStyle = rgba('#cfe3ff', a * 0.9)
      ctx.fillText('HUMAN OVERRIDE NOT FOUND', VIEW_W / 2 - jx, VIEW_H / 2 + 8 - jy)
      ctx.shadowBlur = 0
      // roaming scanlines
      ctx.fillStyle = rgba('#29f3e2', 0.18)
      ctx.fillRect(0, (t * 230) % VIEW_H, VIEW_W, 1)
      ctx.fillStyle = rgba('#ff2e88', 0.14)
      ctx.fillRect(0, (t * 161 + 80) % VIEW_H, VIEW_W, 1)
      ctx.restore()
    }
  }

  renderCaption(ctx) {
    const cap = this.cap
    if (cap.black) {
      ctx.fillStyle = '#020308'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }
    const shown = Math.floor(this.stT * CAP_CPS)
    const text = (cap.text || '').slice(0, shown)
    const y = cap.black ? VIEW_H / 2 - 8 : VIEW_H - BAR_H - 34
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (!cap.black) {
      ctx.font = '9px monospace'
      const w = ctx.measureText(cap.text).width + 20
      ctx.fillStyle = 'rgba(4,6,13,0.82)'
      ctx.fillRect(VIEW_W / 2 - w / 2, y - 9, w, 18)
    }
    ctx.font = cap.black ? 'bold 12px monospace' : '9px monospace'
    ctx.shadowColor = '#29f3e2'
    ctx.shadowBlur = cap.black ? 8 : 4
    ctx.fillStyle = '#cfe3ff'
    ctx.fillText(text, VIEW_W / 2, y)
    ctx.shadowBlur = 0
    if (cap.sub && shown >= (cap.text || '').length) {
      ctx.font = '8px monospace'
      ctx.fillStyle = rgba('#5b6c8e', 0.9)
      ctx.fillText(cap.sub, VIEW_W / 2, y + 16)
    }
    ctx.restore()
  }
}

export default IntroScene
