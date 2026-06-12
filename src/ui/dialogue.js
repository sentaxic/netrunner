// ============================================================================
// NETRUNNER · src/ui/dialogue.js — queue-based dialogue rendered ON the canvas.
//
// Contract (ARCHITECTURE.md §7):
//   say(nodes)            nodes: array OR single node
//   dialogueActive()      bool
//   updateDialogue(dt)    typewriter reveal (honors G.settings.textSpeed)
//   renderDialogue(ctx,t) neon frame + portrait + name tag + advance arrow
//   dialogueKey(e)        raw keydown routed here by main.js while active
//
// Node: { id?, who, portrait, emotion, text,
//         choices?: [{label, goto?(index|id), action?(fn)}],
//         goto?(index|id), action?(fn) }
//
// Emits bus 'dialogue:start'(node) / 'dialogue:end'. Ducks music while talking.
// ============================================================================

import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { G } from '../core/state.js'
import { bus } from '../core/events.js'
import { audio } from '../core/audio.js'
import { drawPortrait } from '../assets/portraits.js'
import { rgba, mix } from '../assets/palette.js'

// ---- palette shorthand ------------------------------------------------------
const CYAN = '#29f3e2'
const MAGENTA = '#ff2e88'
const AMBER = '#ffb547'
const INK = '#cfe3ff'
const HI = '#e8f4ff'
const DIM = '#5b6c8e'
const BG = 'rgba(4,6,13,0.93)'

// chars/second per G.settings.textSpeed (1 slow · 2 normal · 3 fast)
const CPS = { 1: 16, 2: 36, 3: 72 }

// ---- box geometry -----------------------------------------------------------
const BOX = { x: 6, y: VIEW_H - 76, w: VIEW_W - 12, h: 70 }
const PORTRAIT_SCALE = 1.5 // 32x40 native -> 48x60
const LINE_H = 10

// ---- state ------------------------------------------------------------------
let list = null      // current array of nodes (null = inactive)
let idx = 0          // index into list
let queue = []       // node-arrays waiting behind the current conversation
let shown = 0        // revealed character count (float)
let done = false     // current node fully revealed
let choice = 0       // selected choice index
let wrapCacheKey = null
let wrapCacheLines = null

// ---- public API ---------------------------------------------------------------

export function say(nodes) {
  const arr = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean)
  if (!arr.length) return
  if (list) { queue.push(arr); return } // already talking — chain it
  list = arr
  idx = 0
  startNode()
  audio.duck(true)
  bus.emit('dialogue:start', list[0])
}

export function dialogueActive() { return !!list }

export function updateDialogue(dt) {
  if (!list) return
  const text = list[idx].text || ''
  if (done) return
  const cps = CPS[G.settings.textSpeed] || CPS[2]
  const prev = Math.floor(shown)
  shown = Math.min(text.length, shown + cps * dt)
  const now = Math.floor(shown)
  // a soft key-clack every few characters (never on whitespace)
  if (now > prev && ((now / 3) | 0) !== ((prev / 3) | 0) && text[now - 1] !== ' ') {
    audio.sfx('blip')
  }
  if (shown >= text.length) done = true
}

export function dialogueKey(e) {
  if (!list) return
  const node = list[idx]
  const c = e.code
  const confirm = c === 'Enter' || c === 'KeyZ' || c === 'Space'
  const cancel = c === 'Escape' || c === 'KeyX'
  const up = c === 'ArrowUp' || c === 'KeyW'
  const down = c === 'ArrowDown' || c === 'KeyS'

  if (!done) { // still typing — confirm/cancel slams the full line in
    if (confirm || cancel) { shown = (node.text || '').length; done = true }
    return
  }

  const ch = node.choices
  if (ch && ch.length) {
    if (up) { choice = (choice + ch.length - 1) % ch.length; audio.sfx('blip'); return }
    if (down) { choice = (choice + 1) % ch.length; audio.sfx('blip'); return }
    if (confirm) {
      const picked = ch[choice]
      audio.sfx('confirm')
      if (picked.action) { try { picked.action() } catch (err) { console.error('[dialogue choice]', err) } }
      if (!list) return // the action may have torn the conversation down
      if (picked.goto != null) jump(picked.goto)
      else next()
    }
    return
  }

  if (confirm) {
    audio.sfx('confirm')
    if (node.action) { try { node.action() } catch (err) { console.error('[dialogue action]', err) } }
    if (!list) return
    if (node.goto != null) jump(node.goto)
    else next()
  }
}

// ---- flow -------------------------------------------------------------------

function startNode() {
  const node = list[idx]
  shown = 0
  done = !(node.text && node.text.length)
  choice = 0
  wrapCacheKey = null
  wrapCacheLines = null
}

function jump(ref) {
  let j = -1
  if (typeof ref === 'number') j = ref
  else j = list.findIndex(n => n && n.id === ref)
  if (j < 0 || j >= list.length) { next(); return }
  idx = j
  startNode()
}

function next() {
  idx++
  if (idx < list.length) { startNode(); return }
  if (queue.length) { list = queue.shift(); idx = 0; startNode(); return }
  list = null
  queue = []
  audio.duck(false)
  bus.emit('dialogue:end')
}

// ---- render -----------------------------------------------------------------

export function renderDialogue(ctx, t) {
  if (!list) return
  const node = list[idx]
  const hasPortrait = !!node.portrait
  ctx.save()
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // dim the world a touch so the words own the frame
  ctx.fillStyle = 'rgba(2,3,8,0.25)'
  ctx.fillRect(0, 0, VIEW_W, VIEW_H)

  // ---- frame
  ctx.fillStyle = BG
  ctx.fillRect(BOX.x, BOX.y, BOX.w, BOX.h)
  const pulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2))
  ctx.shadowColor = CYAN
  ctx.shadowBlur = 7 * pulse
  ctx.strokeStyle = rgba(CYAN, 0.55 + 0.3 * pulse)
  ctx.lineWidth = 1
  ctx.strokeRect(BOX.x + 0.5, BOX.y + 0.5, BOX.w - 1, BOX.h - 1)
  ctx.shadowBlur = 0
  // magenta corner ticks — the frame feels wired, not printed
  ctx.fillStyle = rgba(MAGENTA, 0.8)
  for (const [cx, cy] of [[BOX.x, BOX.y], [BOX.x + BOX.w - 5, BOX.y], [BOX.x, BOX.y + BOX.h - 2], [BOX.x + BOX.w - 5, BOX.y + BOX.h - 2]]) {
    ctx.fillRect(cx, cy, 5, 1)
  }

  // ---- portrait
  let textX = BOX.x + 10
  if (hasPortrait) {
    const px = BOX.x + 8
    const py = BOX.y + 6
    ctx.fillStyle = '#070a14'
    ctx.fillRect(px - 2, py - 2, 52, 62)
    drawPortrait(ctx, node.portrait, px, py, PORTRAIT_SCALE, node.emotion || 'neutral')
    ctx.strokeStyle = rgba(CYAN, 0.35)
    ctx.strokeRect(px - 1.5, py - 1.5, 51, 61)
    textX = px + 56
  }

  // ---- name tag
  if (node.who) {
    ctx.font = 'bold 8px monospace'
    const nw = ctx.measureText(node.who).width + 12
    const nx = textX
    const ny = BOX.y - 11
    ctx.fillStyle = 'rgba(4,6,13,0.95)'
    ctx.fillRect(nx, ny, nw, 12)
    ctx.shadowColor = MAGENTA
    ctx.shadowBlur = 6
    ctx.strokeStyle = rgba(MAGENTA, 0.85)
    ctx.strokeRect(nx + 0.5, ny + 0.5, nw - 1, 11)
    ctx.shadowBlur = 0
    ctx.fillStyle = HI
    ctx.fillText(node.who, nx + 6, ny + 2)
  }

  // ---- body text (typewriter)
  const maxW = BOX.x + BOX.w - 12 - textX
  ctx.font = '8px monospace'
  const lines = wrapped(ctx, node.text || '', maxW)
  let budget = Math.floor(shown)
  let ty = BOX.y + 9
  for (const line of lines) {
    if (budget <= 0) break
    const slice = line.length <= budget ? line : line.slice(0, budget)
    ctx.fillStyle = INK
    ctx.fillText(slice, textX, ty)
    budget -= line.length + 1 // +1 swallows the space the wrap ate
    ty += LINE_H
  }

  // ---- choices (only once the line has landed)
  const ch = node.choices
  if (done && ch && ch.length) {
    ctx.font = '8px monospace'
    let widest = 0
    for (const o of ch) widest = Math.max(widest, ctx.measureText(o.label).width)
    const cw = widest + 22
    const chH = ch.length * LINE_H + 8
    const cx = BOX.x + BOX.w - cw - 8
    const cy = BOX.y + BOX.h - chH - 6
    ctx.fillStyle = 'rgba(3,5,11,0.95)'
    ctx.fillRect(cx, cy, cw, chH)
    ctx.strokeStyle = rgba(AMBER, 0.6)
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, chH - 1)
    ch.forEach((o, i) => {
      const oy = cy + 4 + i * LINE_H
      const sel = i === choice
      if (sel) {
        ctx.fillStyle = rgba(CYAN, 0.12)
        ctx.fillRect(cx + 2, oy - 1, cw - 4, LINE_H)
        ctx.shadowColor = CYAN
        ctx.shadowBlur = 5
        ctx.fillStyle = CYAN
        ctx.fillText('>', cx + 5 + Math.round(Math.sin(t * 6) * 1), oy)
        ctx.shadowBlur = 0
      }
      ctx.fillStyle = sel ? HI : DIM
      ctx.fillText(o.label, cx + 14, oy)
    })
  }

  // ---- blinking advance arrow
  if (done && !(ch && ch.length) && Math.sin(t * 5.5) > -0.25) {
    const ax = BOX.x + BOX.w - 13
    const ay = BOX.y + BOX.h - 9 + Math.round(Math.sin(t * 4) * 1)
    ctx.shadowColor = CYAN
    ctx.shadowBlur = 5
    ctx.fillStyle = CYAN
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax + 7, ay)
    ctx.lineTo(ax + 3.5, ay + 4)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
  }

  ctx.restore()
}

// word-wrap with a tiny cache (re-wraps only when the node/text changes)
function wrapped(ctx, text, maxW) {
  const key = idx + '|' + text + '|' + maxW
  if (wrapCacheKey === key) return wrapCacheLines
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w
    if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  wrapCacheKey = key
  wrapCacheLines = lines
  return lines
}

// quiet default export for convenience; named exports are the contract
export default say
