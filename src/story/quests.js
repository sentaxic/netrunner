// ============================================================================
// NETRUNNER · src/story/quests.js — the story spine. ARCHITECTURE.md §8.
//
// Registers bus listeners that advance G.quests, set canonical flags (§3.6),
// unlock the rail/cities, grant kit/codex, and autosave at the moments that
// matter. Pure logic — nothing here renders. Imported for side effects by
// main.js (`import './story/quests.js'`).
//
// Stage numbers line up with ui/hud.js QUEST_DB:
//   q_find_terminal  0..4 (done at 4)
//   q_underground    0..3 (done at 3)
//   q_forge_plant    0..4 (done at 4)
//
// Everything is idempotent and save-safe: stages only move forward, rewards
// dedup, one-shot payouts are guarded by flags, so replayed events (loaded
// saves, re-fired triggers, double emits) never double-advance anything.
// ============================================================================

import { bus } from '../core/events.js'
import { G, setFlag, flag, autosave } from '../core/state.js'
import { say, dialogueActive } from '../ui/dialogue.js'
import { resolveDialogue } from './dialogues.js'

// ---- quest tables -----------------------------------------------------------

const QUEST_NAMES = {
  q_find_terminal: 'STATIC WHERE SHE STOOD',
  q_underground: 'DOORS BENEATH THE CITY',
  q_forge_plant: 'HEAT AND PRESSURE',
}
const QUEST_DONE = { q_find_terminal: 4, q_underground: 3, q_forge_plant: 4 }

// Forward-only stage setter. Returns true when something actually changed.
function qSet(id, stage) {
  stage = stage | 0
  const cur = (id in G.quests) ? (G.quests[id] | 0) : -1
  if (stage <= cur) return false
  G.quests[id] = stage
  const name = QUEST_NAMES[id] || id.toUpperCase()
  if (cur < 0) bus.emit('toast', 'NEW THREAD · ' + name)
  else if (stage >= (QUEST_DONE[id] ?? Infinity)) bus.emit('toast', 'THREAD CLOSED · ' + name)
  else bus.emit('toast', 'THREAD · ' + name)
  return true
}

// ---- inventory / codex helpers (dedup; return true when newly added) ---------

const pretty = id => String(id).replace(/^(prog_|cx_|key_|q_)/, '').replace(/[_-]+/g, ' ').toUpperCase()

function addKit(id) {
  if (!id || G.kit.includes(id)) return false
  G.kit.push(id)
  return true
}

function addCodex(id) {
  if (!id || G.codex.includes(id)) return false
  G.codex.push(id)
  return true
}

// Grant + announce (no double toast if it already exists).
function grantCodex(id) { if (addCodex(id)) bus.emit('codex:add', id) }

function unlockCity(id) {
  if (!G.citiesUnlocked.includes(id)) {
    G.citiesUnlocked.push(id)
    bus.emit('toast', pretty(id) + ' — STATION LIVE')
  }
}

// One-shot guard stored in flags so it survives save/load.
function once(key) {
  if (G.flags[key]) return false
  G.flags[key] = true
  return true
}

function talk(key) {
  if (dialogueActive()) return
  const nodes = resolveDialogue(key)
  if (nodes && nodes.length) say(nodes)
}

// ============================================================================
// Flag-driven progression — the canonical chain (§3.6).
// ============================================================================

bus.on('flag', ({ k, v }) => {
  if (!v) return
  switch (k) {

    case 'intro_blackout_seen':
      qSet('q_find_terminal', 0)
      grantCodex('the_blackout')
      break

    case 'sister_gone':
      qSet('q_find_terminal', 1)
      grantCodex('mara')
      break

    case 'found_terminal':
      qSet('q_find_terminal', 3)
      break

    case 'jackin1_done':
      qSet('q_find_terminal', 4)        // the thread leads under the city
      qSet('q_underground', 0)          // find the way into the Underground
      grantCodex('the_grid')
      grantCodex('the_kernel')
      break

    case 'met_vex':
      qSet('q_underground', 1)          // earn the doorkeeper's trust
      maybeOpenUnderground()
      break

    case 'met_glitch':
      qSet('q_underground', 2)          // meet Glitch below the rail line
      grantCodex('runners_code')
      maybeOpenUnderground()
      break

    case 'underground_unlocked':
      qSet('q_underground', 3)          // you run with the Underground now
      if (!flag('rail_unlocked')) setFlag('rail_unlocked')
      break

    case 'rail_unlocked':
      unlockCity('forge')
      qSet('q_forge_plant', 0)          // ride the rail to Forge Town
      grantCodex('rail')
      bus.emit('toast', 'RAIL GATE OPEN — SECTOR K STATION')
      bus.emit('toast', 'WORLD MAP ONLINE')
      autosave()
      break

    case 'forge_boss_done':
      qSet('q_forge_plant', 4)          // the Forge breathes again
      grantCodex('access_keys')
      if (once('rwd_forge_rep')) {
        G.rep += 5
        bus.emit('toast', 'REP +5')
      }
      break
  }
})

// Both keys to the den turn at once: Glitch's trust and Vex's.
function maybeOpenUnderground() {
  if (flag('met_glitch') && flag('met_vex') && !flag('underground_unlocked')) {
    setFlag('underground_unlocked')
  }
}

// ============================================================================
// Jack-in outcomes. jackin.js already sets mission.onWin and pays the listed
// reward before emitting — everything here is a guarded backstop plus the
// pieces only the story knows about (rep, autosave).
// ============================================================================

bus.on('jackin:win', missionId => {
  if (missionId === 'm_find_underground') {
    if (!flag('jackin1_done')) setFlag('jackin1_done')
    if (once('rwd_jackin1_rep')) {
      G.rep += 1
      bus.emit('toast', 'REP +1')
    }
    autosave()
  } else if (missionId === 'm_forge_plant') {
    if (!flag('forge_boss_done')) setFlag('forge_boss_done')
    // Backstop the boss payout (dedup — normally jackin.js granted these).
    if (addKit('prog_tablesaw')) bus.emit('kit:add', 'prog_tablesaw')
    if (addCodex('cx_sql_joins')) bus.emit('codex:add', 'cx_sql_joins')
    if (addCodex('key_forge_works')) {
      bus.emit('codex:add', 'key_forge_works')
      bus.emit('toast', 'ACCESS-KEY GET')
    }
    autosave()
  }
})

bus.on('jackin:lose', missionId => {
  if (missionId === 'm_find_underground' && flag('found_terminal')) {
    bus.emit('toast', 'THE DECK IS STILL THERE. SO IS SHE.')
  }
})

// ============================================================================
// Kit / Codex acquisition — any module may emit these; we own the state.
// (jackin.js pushes before emitting, so the add is a no-op there — the toast
// is the part everyone relies on us for.)
// ============================================================================

bus.on('kit:add', id => {
  addKit(id)
  bus.emit('toast', 'KIT GET · ' + pretty(id))
})

bus.on('codex:add', id => {
  addCodex(id)
  bus.emit('toast', 'CODEX · ' + pretty(id))
})

// ============================================================================
// Map triggers (world/maps.js trigger event names).
// ============================================================================

// Apartment spawn tile — the warm beginning, if the cinematic didn't cover it.
bus.on('intro_breakfast', () => {
  if (flag('intro_breakfast_done') || flag('sister_gone')) return
  talk('sister_breakfast')
})

// The rug in Mara's room. once:false — this is also the retry path after a
// traced-out first dive, and a quiet place to stand afterwards.
bus.on('inspect_terminal', () => {
  if (dialogueActive()) return
  if (!flag('sister_gone')) { talk('rug_before'); return }
  if (!flag('found_terminal')) { talk('terminal_discovery'); return } // its last action launches the dive
  if (!flag('jackin1_done')) { talk('terminal_rejack'); return }
  talk('terminal_after')
})

// City entrances: banner + autosave, plus the stage bumps geography implies.
bus.on('enter_aster_street', () => {
  if (once('seen_aster_street')) bus.emit('toast', 'ASTER CITY — SECTOR K')
  autosave()
})

bus.on('enter_underground', () => {
  if (once('seen_underground')) bus.emit('toast', 'THE UNDERGROUND')
  autosave()
})

bus.on('enter_rail_station', () => {
  if (once('seen_rail_station')) bus.emit('toast', 'SECTOR K STATION')
  autosave()
})

bus.on('enter_forge', () => {
  if (once('seen_forge')) bus.emit('toast', 'FORGE TOWN — INDUSTRIAL BELT')
  qSet('q_forge_plant', 1)              // find out why the plant is failing
  autosave()
})

bus.on('enter_forge_plant', () => {
  if (once('seen_forge_plant')) bus.emit('toast', 'WORKS No.3')
  qSet('q_forge_plant', 2)              // get inside the plant network
  autosave()
})

// ============================================================================
// External advance requests (dialogue choices, future content). Forward-only.
// ============================================================================

bus.on('quest:advance', ({ id, stage } = {}) => {
  if (!id) return
  qSet(id, stage | 0)
})

// Mark the dive stage the moment a boss jack-in begins, so the journal reads
// right even mid-encounter.
bus.on('jackin:start', missionId => {
  if (missionId === 'm_forge_plant') qSet('q_forge_plant', 3)
})

// Exported for tests / debugging; importing this module wires everything.
export const QUESTS = { names: QUEST_NAMES, done: QUEST_DONE }
export default QUESTS
