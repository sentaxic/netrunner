// ============================================================================
// NETRUNNER · src/terminal/jackin.js — the jack-in encounter scene.
// ARCHITECTURE.md §9. Shows #term-layer, mounts xterm, builds a backend
// ('real' CheerpX VM with graceful fall back to the 'sim' shell), drives the
// Heat/Trace meter and Glitch's comms, detects the win via mission.check(),
// emits jackin:win / jackin:lose, then restores the overworld.
//
//   scenes.switchTo('jackin', { missionId: 'm_find_underground' })
// ============================================================================

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Scene, scenes } from '../core/scenes.js'
import { bus } from '../core/events.js'
import { G, setFlag } from '../core/state.js'
import { input } from '../core/input.js'
import { audio } from '../core/audio.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { makeBackend } from './backend.js'
import { MISSIONS } from './missions.js'

const TERM_THEME = {
  background: '#070a12',
  foreground: '#cfe3ff',
  cursor: '#29f3e2',
  cursorAccent: '#05060a',
  selectionBackground: 'rgba(41,243,226,0.25)',
  black: '#0d1322',
  red: '#ff2e88',
  green: '#6dff7a',
  yellow: '#ffb547',
  blue: '#4f7dff',
  magenta: '#ff2e88',
  cyan: '#29f3e2',
  white: '#cfe3ff',
  brightBlack: '#2a3550',
  brightRed: '#ff5ea6',
  brightGreen: '#9dffac',
  brightYellow: '#ffd08a',
  brightBlue: '#8fb0ff',
  brightMagenta: '#ff7cc0',
  brightCyan: '#7cf9ee',
  brightWhite: '#eaf4ff',
}

const COMMS_DELAY = 0.95      // seconds between queued comms lines
const FIRST_HINT_AFTER = 22   // idle seconds before the first nudge
const NEXT_HINT_AFTER = 20    // idle seconds between later nudges
const NOISE_TO_HEAT = 2.0     // heat per noise unit from the backend
const TRACE_LOSS_CREDS = 30   // creds burned shaking a completed trace

export class JackInScene extends Scene {
  enter(params = {}) {
    this.missionId = params.missionId
    this.mission = MISSIONS[this.missionId]
    this.dead = false
    if (!this.mission) {
      bus.emit('toast', 'LINK ERROR — NO CARRIER')
      scenes.switchTo('overworld', {}, 'fade')
      return
    }

    // --- DOM layer -----------------------------------------------------------
    this.layer = document.getElementById('term-layer')
    this.mount = document.getElementById('term-mount')
    this.commsEl = document.getElementById('term-comms')
    this.heatFill = document.getElementById('heat-fill')
    const hostEl = document.getElementById('term-host')
    const objEl = document.getElementById('term-objective')
    if (hostEl) hostEl.textContent = this.mission.host
    if (objEl) objEl.textContent = this.mission.objective
    if (this.commsEl) this.commsEl.innerHTML = ''
    if (this.heatFill) this.heatFill.style.width = '0%'
    this.layer.classList.remove('hidden')

    // --- run state -------------------------------------------------------------
    this.backend = null
    this.heat = 0
    this.t = 0
    this.idle = 0
    this.hintIdx = 0
    this.checkT = 0
    this.checkBusy = false
    this.closing = false       // any end state reached (win/lose/bail)
    this.frozen = false        // stop forwarding keys to the backend
    this.closeAt = null        // countdown to the overworld switch
    this.warned50 = false
    this.warned80 = false
    this.commsQ = []
    this.commsT = 0

    // --- the terminal ------------------------------------------------------------
    input.suspend(true)
    audio.play('hack')
    this.term = new Terminal({
      fontSize: 14,
      fontFamily: "'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace",
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 2000,
      theme: TERM_THEME,
    })
    this.fit = new FitAddon()
    this.term.loadAddon(this.fit)
    this.term.open(this.mount)
    try { this.fit.fit() } catch { /* zero-size pre-layout */ }
    requestAnimationFrame(() => { if (!this.dead) { try { this.fit.fit() } catch { /* not mounted */ } } })
    this.term.focus()

    this._onResize = () => {
      if (this.dead) return
      try {
        this.fit.fit()
        this.backend?.resize(this.term.cols, this.term.rows)
      } catch { /* layer hidden */ }
    }
    addEventListener('resize', this._onResize)

    this.termSub = this.term.onData(d => {
      if (this.dead || this.frozen || !this.backend) return
      this.idle = 0
      this.backend.write(d)
    })

    // --- comms: the uplink chatter, then Glitch -----------------------------------
    this.comms('SYS', `uplink → ${this.mission.host} · negotiating crypt layer…`, true)
    for (const line of (this.mission.intro || [])) this.comms('GLITCH', line)

    this.term.write('\x1b[38;2;120;150;200m  spinning carrier… hold.\x1b[0m\r\n')
    this._boot()
  }

  // Resolve a backend: honor G.settings.vmMode, fall back real→sim with a
  // clear in-fiction message about which link the player is actually on.
  async _boot() {
    const want = G.settings.vmMode === 'sim' ? ['sim'] : ['real', 'sim']
    let backend = null
    let realErr = null
    for (const mode of want) {
      try { backend = await makeBackend(mode, this.mission); break }
      catch (err) { if (mode === 'real') realErr = err }
    }
    if (this.dead) { try { backend?.dispose() } catch { /* raced exit */ } return }
    if (!backend) {
      this.comms('SYS', 'uplink failed on every carrier — pulling you out.', true)
      this.closing = true
      this.closeAt = 1.6
      return
    }
    this.backend = backend
    if (realErr) {
      this.comms('SYS', `full dive unavailable (${trim(realErr.message, 70)})`, true)
      this.comms('GLITCH', 'No real iron tonight — I spun you a local mirror instead. Sandboxed copy, same rules, same commands.')
    }
    this.comms('SYS', backend.mode === 'real'
      ? 'LINK: FULL DIVE — live x86 vm. it is exactly as real as it feels.'
      : 'LINK: LOCAL MIRROR — sandboxed sim of the target.', true)
    this.term.write(backend.banner || '')
    this._onResize()
    this.term.focus()
  }

  update(dt) {
    if (this.dead) return
    this.t += dt

    // comms queue (staggered so the chatter feels live)
    this.commsT -= dt
    if (this.commsT <= 0 && this.commsQ.length) {
      this._flushComms(this.commsQ.shift())
      this.commsT = COMMS_DELAY
    }

    // countdown to leaving the scene (after win/lose/bail)
    if (this.closeAt !== null) {
      this.closeAt -= dt
      if (this.closeAt <= 0) {
        this.closeAt = null
        scenes.switchTo('overworld', {}, 'glitch')
      }
      return
    }

    if (!this.backend || this.closing) return

    // ---- heat / trace ------------------------------------------------------------
    const burst = this.backend.noise ? this.backend.noise() : 0
    this.heat = Math.min(100, this.heat + this.mission.heatRate * dt + burst * NOISE_TO_HEAT)
    if (this.heatFill) this.heatFill.style.width = `${this.heat.toFixed(1)}%`
    if (this.heat >= 50 && !this.warned50) {
      this.warned50 = true
      this.comms('GLITCH', 'Trace is past half. gridtrace has your scent — wrap it up.')
    }
    if (this.heat >= 80 && !this.warned80) {
      this.warned80 = true
      audio.sfx('error')
      this.comms('GLITCH', 'EIGHTY PERCENT. They are seconds out. Finish or bail.')
    }
    if (this.heat >= 100) { this._traceOut(); return }

    // ---- voluntary jack-out (player typed `exit` at the top level) ---------------
    if (this.backend.exited && this.backend.exited()) { this._bailOut(); return }

    // ---- idle hints ----------------------------------------------------------------
    this.idle += dt
    const hints = this.mission.hints || []
    const wait = this.hintIdx === 0 ? FIRST_HINT_AFTER : NEXT_HINT_AFTER
    if (this.idle > wait && this.hintIdx < hints.length) {
      this.comms('GLITCH', hints[this.hintIdx++])
      this.idle = 0
    }

    // ---- throttled win polling -------------------------------------------------------
    this.checkT += dt
    const interval = this.backend.mode === 'real' ? 6 : 1.25
    if (this.checkT >= interval && !this.checkBusy) {
      this.checkT = 0
      this.checkBusy = true
      Promise.resolve()
        .then(() => this.backend.check())
        .then(ok => {
          this.checkBusy = false
          if (ok && !this.closing && !this.dead) this._win()
        })
        .catch(() => { this.checkBusy = false })
    }
  }

  // ---- end states ------------------------------------------------------------------
  _win() {
    this.closing = true
    this.frozen = true
    audio.sfx('win')
    audio.play('victory')
    const m = this.mission
    setFlag(m.onWin)
    const r = m.reward || {}
    if (r.creds) {
      G.creds += r.creds
      bus.emit('toast', `+${r.creds}c`)
    }
    for (const id of r.kit || []) {
      if (!G.kit.includes(id)) { G.kit.push(id); bus.emit('kit:add', id) }
    }
    for (const id of r.codex || []) {
      if (!G.codex.includes(id)) { G.codex.push(id); bus.emit('codex:add', id) }
    }
    if (m.boss) bus.emit('toast', 'ACCESS-KEY GET')
    bus.emit('jackin:win', this.missionId)

    this.term.write(
      '\r\n\x1b[1;38;2;109;255;122m ▓▓ OBJECTIVE COMPLETE — LINK SECURED ▓▓\x1b[0m\r\n' +
      '\x1b[38;2;120;150;200m closing carrier… footprints scrubbed.\x1b[0m\r\n'
    )
    this.comms('SYS', 'OBJECTIVE COMPLETE — closing carrier.', true)
    const outro = m.outro || ['Clean work. Pull out.']
    for (const line of outro) this.comms('GLITCH', line)
    this.closeAt = 1.4 + COMMS_DELAY * outro.length + 1.2
  }

  _traceOut() {
    this.closing = true
    this.frozen = true
    audio.sfx('glitch')
    audio.sfx('error')
    G.heatLosses++
    const loss = Math.min(G.creds, TRACE_LOSS_CREDS)
    G.creds -= loss

    this.term.write(
      '\r\n\x1b[1;31m ▒▒ TRACE LOCK — COUNTER-INTRUSION INBOUND ▒▒\x1b[0m\r\n' +
      '\x1b[38;2;255;46;136m carrier severed by remote host.\x1b[0m\r\n'
    )
    this.comms('SYS', 'TRACE COMPLETE — position compromised. severing link.', true)
    this.comms('GLITCH', `TRACED — pull out, pull out NOW.${loss ? ` Burning ${loss}c to scatter your shadow. GO.` : ' GO.'}`, true)
    if (loss) bus.emit('toast', `TRACED · -${loss}c`)
    else bus.emit('toast', 'TRACED')
    bus.emit('jackin:lose', this.missionId)
    this.closeAt = 2.4
  }

  _bailOut() {
    this.closing = true
    this.frozen = true
    audio.sfx('cancel')
    this.comms('GLITCH', 'Clean disconnect. No trace, no trophy. We can come back at it.', true)
    this.closeAt = 1.3
  }

  // ---- comms ----------------------------------------------------------------------
  comms(who, text, instant = false) {
    if (instant) this._flushComms({ who, text })
    else this.commsQ.push({ who, text })
  }

  _flushComms({ who, text }) {
    if (!this.commsEl) return
    const div = document.createElement('div')
    const tag = document.createElement('span')
    tag.className = who === 'SYS' ? 'sys who' : 'who'
    tag.textContent = who === 'SYS' ? '◢ SYS' : '◣ GLITCH'
    div.appendChild(tag)
    const body = document.createElement('span')
    if (who === 'SYS') body.className = 'sys'
    body.textContent = text
    div.appendChild(body)
    this.commsEl.appendChild(div)
    while (this.commsEl.children.length > 60) this.commsEl.removeChild(this.commsEl.firstChild)
    this.commsEl.scrollTop = this.commsEl.scrollHeight
    audio.sfx('blip')
  }

  // ---- canvas behind the translucent layer: drifting data motes ----------------------
  render(ctx) {
    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    const t = this.t || 0
    for (let i = 0; i < 36; i++) {
      const x = (i * 53.7) % VIEW_W
      const speed = 14 + (i * 7) % 26
      const y = (i * 91 + t * speed) % (VIEW_H + 20) - 10
      ctx.fillStyle = i % 7 === 0 ? 'rgba(255,46,136,0.10)' : 'rgba(41,243,226,0.08)'
      ctx.fillRect(x, y, 1, 4 + (i % 3) * 3)
    }
    ctx.fillStyle = 'rgba(120,150,200,0.05)'
    const scan = (t * 30) % VIEW_H
    ctx.fillRect(0, scan, VIEW_W, 1)
  }

  exit() {
    this.dead = true
    this.closeAt = null
    removeEventListener('resize', this._onResize)
    try { this.termSub?.dispose() } catch { /* already gone */ }
    try { this.backend?.dispose() } catch { /* already gone */ }
    this.backend = null
    try { this.term?.dispose() } catch { /* already gone */ }
    this.term = null
    this.fit = null
    if (this.layer) this.layer.classList.add('hidden')
    input.suspend(false)
    // hand the soundscape back to wherever the body is standing
    const map = G.player.map || ''
    audio.play(
      map.startsWith('forge') ? 'forge'
        : map === 'underground' ? 'underground'
          : 'aster'
    )
  }
}

function trim(s, n) {
  s = String(s || '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
