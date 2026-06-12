// ============================================================================
// NETRUNNER · src/terminal/jackin.js — the jack-in encounter scene.
// ARCHITECTURE.md §9. Shows #term-layer, plays the BlackArch deck boot, mounts a
// bulletproof DOM terminal (native <input> — keyboard can't bug out), builds a
// line-oriented backend ('real' CheerpX VM with graceful fall back to 'sim'),
// drives the Heat/Trace meter and Glitch's comms, detects the win via
// backend.check(), emits jackin:win / jackin:lose, then restores the overworld.
//
//   scenes.switchTo('jackin', { missionId: 'm_find_underground' })
// ============================================================================

import { Scene, scenes } from '../core/scenes.js'
import { bus } from '../core/events.js'
import { G, setFlag } from '../core/state.js'
import { input } from '../core/input.js'
import { audio } from '../core/audio.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'
import { makeBackend } from './backend.js'
import { MISSIONS } from './missions.js'
import { DomTerm } from './domterm.js'
import { playBoot } from './boot.js'

const COMMS_DELAY = 0.95      // seconds between queued comms lines
const FIRST_HINT_AFTER = 24   // idle seconds before the first nudge
const NEXT_HINT_AFTER = 22    // idle seconds between later nudges
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

    // --- run state -----------------------------------------------------------
    this.backend = null
    this.unsub = null
    this.heat = 0
    this.t = 0
    this.idle = 0
    this.hintIdx = 0
    this.checkT = 0
    this.checkBusy = false
    this.closing = false
    this.closeAt = null
    this.warned50 = false
    this.warned80 = false
    this.commsQ = []
    this.commsT = 0
    this.lineBusy = false

    // --- the terminal --------------------------------------------------------
    input.suspend(true)
    audio.play('hack')
    this.term = new DomTerm()
    this.term.mount(this.mount)
    this.term.setInputEnabled(false) // locked until the deck finishes booting
    this.term.onLine(line => this._submit(line))
    this.term.onTab(v => this._complete(v))

    // --- comms: the uplink chatter, then Glitch ------------------------------
    this.comms('SYS', `cold-starting deck → ${this.mission.host}…`, true)
    for (const line of (this.mission.intro || [])) this.comms('GLITCH', line)

    this._start()
  }

  // Boot the deck (BlackArch sequence), then resolve a backend and go live.
  async _start() {
    try { await playBoot(this.term, { host: this.mission.host, skipKeyEl: window }) }
    catch { /* boot is cosmetic */ }
    if (this.dead) return

    const want = G.settings.vmMode === 'sim' ? ['sim'] : ['real', 'sim']
    if (want[0] === 'real') {
      this.term.write('\x1b[38;2;120;150;200m  full dive — streaming a live linux. first dive can take a moment…\x1b[0m\n')
    }
    let backend = null
    let realErr = null
    for (const mode of want) {
      try {
        backend = mode === 'real'
          ? await withTimeout(makeBackend('real', this.mission), 25000)
          : await makeBackend('sim', this.mission)
        break
      } catch (err) { if (mode === 'real') realErr = err }
    }
    if (this.dead) { try { backend?.dispose() } catch { /* raced exit */ } return }
    if (!backend) {
      this.comms('SYS', 'uplink failed on every carrier — pulling you out.', true)
      this.closing = true
      this.closeAt = 1.6
      return
    }

    this.backend = backend
    this.unsub = backend.onOutput(s => { if (!this.dead) this.term.write(s) })

    if (realErr) {
      this.comms('SYS', `full dive unavailable (${trim(realErr.message, 70)})`, true)
      this.comms('GLITCH', 'No real iron tonight — spun you a local mirror. Sandboxed copy, same rules, same commands.')
    }
    this.comms('SYS', backend.mode === 'real'
      ? 'LINK: FULL DIVE — live x86 vm. as real as it feels.'
      : 'LINK: LOCAL MIRROR — sandboxed sim of the target.', true)

    this.term.write(backend.banner || '')
    this.term.setPrompt(backend.promptStr())
    this.term.setInputEnabled(true)
    this.term.focus()
  }

  async _submit(line) {
    if (this.dead || this.closing || !this.backend) return
    this.idle = 0
    if (line === '\x03') { // Ctrl-C between commands
      this.term.write('^C\n')
      this.term.setPrompt(this.backend.promptStr())
      return
    }
    // echo the typed command into the scrollback, then run it
    this.term.echoCommand(this.backend.promptStr(), line)
    if (this.lineBusy) return
    this.lineBusy = true
    this.term.setInputEnabled(false)
    try { await this.backend.runLine(line) }
    catch { /* backend reports its own faults */ }
    this.lineBusy = false
    if (this.dead || this.closing) return
    this.term.setPrompt(this.backend.promptStr())
    this.term.setInputEnabled(true)
    if (this.backend.exited && this.backend.exited()) { this._bailOut(); return }
  }

  _complete(value) {
    if (!this.backend) return value
    try {
      const r = this.backend.complete(value)
      if (r && r.suggestions && r.suggestions.length) {
        this.term.write('\x1b[38;2;120;150;200m' + r.suggestions.join('   ') + '\x1b[0m\n')
        this.term.setPrompt(this.backend.promptStr())
      }
      return r ? r.line : value
    } catch { return value }
  }

  update(dt) {
    if (this.dead) return
    this.t += dt

    this.commsT -= dt
    if (this.commsT <= 0 && this.commsQ.length) {
      this._flushComms(this.commsQ.shift())
      this.commsT = COMMS_DELAY
    }

    if (this.closeAt !== null) {
      this.closeAt -= dt
      if (this.closeAt <= 0) {
        this.closeAt = null
        scenes.switchTo('overworld', {}, 'glitch')
      }
      return
    }

    if (!this.backend || this.closing) return

    // ---- heat / trace -------------------------------------------------------
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

    if (this.backend.exited && this.backend.exited()) { this._bailOut(); return }

    // ---- idle hints ---------------------------------------------------------
    this.idle += dt
    const hints = this.mission.hints || []
    const wait = this.hintIdx === 0 ? FIRST_HINT_AFTER : NEXT_HINT_AFTER
    if (this.idle > wait && this.hintIdx < hints.length) {
      this.comms('GLITCH', hints[this.hintIdx++])
      this.idle = 0
    }

    // ---- throttled win polling ----------------------------------------------
    this.checkT += dt
    const interval = this.backend.mode === 'real' ? 4 : 1.0
    if (this.checkT >= interval && !this.checkBusy && !this.lineBusy) {
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

  // ---- end states ---------------------------------------------------------
  _win() {
    this.closing = true
    this.term.setInputEnabled(false)
    audio.sfx('win')
    audio.play('victory')
    const m = this.mission
    setFlag(m.onWin)
    const r = m.reward || {}
    if (r.creds) { G.creds += r.creds; bus.emit('toast', `+${r.creds}c`) }
    for (const id of r.kit || []) if (!G.kit.includes(id)) { G.kit.push(id); bus.emit('kit:add', id) }
    for (const id of r.codex || []) if (!G.codex.includes(id)) { G.codex.push(id); bus.emit('codex:add', id) }
    if (m.boss) bus.emit('toast', 'ACCESS-KEY GET')
    bus.emit('jackin:win', this.missionId)

    this.term.write(
      '\n\x1b[1;38;2;109;255;122m ▓▓ OBJECTIVE COMPLETE — LINK SECURED ▓▓\x1b[0m\n' +
      '\x1b[38;2;120;150;200m closing carrier… footprints scrubbed.\x1b[0m\n'
    )
    this.comms('SYS', 'OBJECTIVE COMPLETE — closing carrier.', true)
    const outro = m.outro || ['Clean work. Pull out.']
    for (const line of outro) this.comms('GLITCH', line)
    this.closeAt = 1.4 + COMMS_DELAY * outro.length + 1.2
  }

  _traceOut() {
    this.closing = true
    this.term.setInputEnabled(false)
    audio.sfx('glitch')
    audio.sfx('error')
    G.heatLosses++
    const loss = Math.min(G.creds, TRACE_LOSS_CREDS)
    G.creds -= loss

    this.term.write(
      '\n\x1b[1;31m ▒▒ TRACE LOCK — COUNTER-INTRUSION INBOUND ▒▒\x1b[0m\n' +
      '\x1b[38;2;255;46;136m carrier severed by remote host.\x1b[0m\n'
    )
    this.comms('SYS', 'TRACE COMPLETE — position compromised. severing link.', true)
    this.comms('GLITCH', `TRACED — pull out, pull out NOW.${loss ? ` Burning ${loss}c to scatter your shadow. GO.` : ' GO.'}`, true)
    bus.emit('toast', loss ? `TRACED · -${loss}c` : 'TRACED')
    bus.emit('jackin:lose', this.missionId)
    this.closeAt = 2.4
  }

  _bailOut() {
    this.closing = true
    this.term.setInputEnabled(false)
    audio.sfx('cancel')
    this.comms('GLITCH', 'Clean disconnect. No trace, no trophy. We can come back at it.', true)
    this.closeAt = 1.3
  }

  // ---- comms --------------------------------------------------------------
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

  // ---- canvas behind the translucent layer: drifting data motes -----------
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
    try { this.unsub?.() } catch { /* gone */ }
    try { this.backend?.dispose() } catch { /* gone */ }
    this.backend = null
    try { this.term?.dispose() } catch { /* gone */ }
    this.term = null
    if (this.layer) this.layer.classList.add('hidden')
    input.suspend(false)
    const map = G.player.map || ''
    audio.play(map.startsWith('forge') ? 'forge' : map === 'underground' ? 'underground' : 'aster')
  }
}

function trim(s, n) {
  s = String(s || '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Resolve a promise or reject after `ms`, so a stalled full-dive boot can't hang
// the encounter forever — _start catches the rejection and falls back to sim.
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`link timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
