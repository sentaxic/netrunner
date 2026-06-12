// Scene manager with a glitch-wipe transition between scenes.
import { bus } from './events.js'
import { VIEW_W, VIEW_H } from './renderer.js'

const registry = new Map()
let current = null
let transition = null // { phase:'out'|'in', t, dur, next:{name,params} }

export class Scene {
  enter(params) {}
  exit() {}
  update(dt) {}
  render(ctx) {}
  onKey(e) {}
}

export const scenes = {
  register(name, scene) { registry.set(name, scene); scene.sceneName = name },
  get(name) { return registry.get(name) },
  get current() { return current },
  get transitioning() { return !!transition },

  // mode: 'glitch' (default), 'fade', 'none'
  switchTo(name, params = {}, mode = 'glitch') {
    if (mode === 'none') { doSwitch(name, params); return }
    if (transition) { doSwitch(name, params); transition = null; return }
    transition = { phase: 'out', t: 0, dur: mode === 'glitch' ? 0.45 : 0.3, mode, next: { name, params } }
  },

  update(dt) {
    if (transition) {
      transition.t += dt
      if (transition.phase === 'out' && transition.t >= transition.dur) {
        doSwitch(transition.next.name, transition.next.params)
        transition.phase = 'in'
        transition.t = 0
      } else if (transition.phase === 'in' && transition.t >= transition.dur) {
        transition = null
      }
    }
    current?.update(dt)
  },

  render(ctx) { current?.render(ctx) },
  renderTransition(ctx) { if (transition) drawTransition(ctx, transition) },
  onKey(e) { if (!transition) current?.onKey(e) },
}

function doSwitch(name, params) {
  const next = registry.get(name)
  if (!next) { console.error('[scenes] unknown scene:', name); return }
  current?.exit()
  current = next
  current.enter(params)
  bus.emit('scene:switch', name)
}

function drawTransition(ctx, tr) {
  const p = Math.min(1, tr.t / tr.dur)
  const k = tr.phase === 'out' ? p : 1 - p
  ctx.save()
  ctx.fillStyle = `rgba(2,3,8,${(k * 0.92).toFixed(3)})`
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)
  if (tr.mode === 'glitch') {
    const seed = Math.floor(tr.t * 600)
    const slices = Math.floor(k * 14)
    for (let i = 0; i < slices; i++) {
      const y = (i * 97 + seed * 31) % VIEW_H
      const h = 2 + ((i * 13) % 6)
      const off = (((i * 53) % 23) - 11) * k * 2
      ctx.drawImage(ctx.canvas, 0, y, VIEW_W, h, off, y, VIEW_W, h)
    }
    ctx.globalAlpha = k * 0.25
    ctx.fillStyle = '#29f3e2'; ctx.fillRect(0, (tr.t * 240) % VIEW_H, VIEW_W, 1)
    ctx.fillStyle = '#ff2e88'; ctx.fillRect(0, (tr.t * 187 + 60) % VIEW_H, VIEW_W, 1)
  }
  ctx.restore()
  ctx.globalAlpha = 1
}
