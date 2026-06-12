// Global game state + save/load. The single source of truth is `G`.
//
// Saves now live in a real local database (IndexedDB) via src/data/savedb.js —
// on-theme, and sturdier than a localStorage JSON blob. save/load/hasSave/
// autosave are therefore ASYNC. Settings stay in localStorage: they're small,
// must be read synchronously at boot (before first render), and never need the
// DB. A synchronous `hasSaveCached(n)` mirrors slot presence for per-frame UI
// (menu CONTINUE, pause Save tab) that cannot await.
import { bus } from './events.js'
import { putSave, getSave, hasSaveDB, deleteSave, listSaves } from '../data/savedb.js'

const DEFAULT_SETTINGS = {
  crt: true,
  textSpeed: 2,        // 1 slow, 2 normal, 3 fast
  musicVol: 0.7,
  sfxVol: 0.8,
  colorblind: false,
  trace: true,         // jack-in Heat/Trace pressure; false = relaxed (no timer) for newcomers
  // 'sim' = instant in-browser shell (default; works offline, same real commands).
  // 'real' = CheerpX full-dive x86 Linux (streams a ~600MB image from CDN; opt-in
  // via Options). 'ask' tries real first then falls back to sim.
  vmMode: 'sim',
}

export const G = {
  player: { name: 'RUNNER', look: 'a', map: 'apartment', x: 5, y: 6, dir: 'down' },
  flags: {},                 // story flags — see ARCHITECTURE.md §3.6
  quests: {},                // questId -> stage number
  kit: [],                   // program ids the player has collected
  codex: [],                 // unlocked codex entry ids
  creds: 0,
  rep: 0,
  heatLosses: 0,
  citiesUnlocked: ['aster'],
  clock: { minutes: 7 * 60 + 30, day: 1 },  // in-game time, 0..1439
  weather: 'rain',           // 'rain' | 'clear'
  settings: { ...DEFAULT_SETTINGS },
}

export function setFlag(k, v = true) { G.flags[k] = v; bus.emit('flag', { k, v }) }
export function flag(k) { return !!G.flags[k] }

const SLOT = n => `netrunner_save_${n}` // legacy localStorage key (migration only)

// ---- synchronous presence cache --------------------------------------------
// IndexedDB reads are async, but the menu/pause UI tests slot presence every
// frame. We keep a small cache of which slots hold data, refreshed at boot and
// after every save/delete, and expose it synchronously via hasSaveCached().
const _saveCache = [false, false, false]

function _setCache(n, present) {
  if (n >= 0 && n < _saveCache.length) _saveCache[n] = !!present
}

// Re-probe all slots from the DB and update the sync cache.
export async function refreshSaveCache() {
  try {
    const rows = await listSaves()
    for (let n = 0; n < _saveCache.length; n++) _saveCache[n] = false
    for (const r of rows) _setCache(r.slot, true)
  } catch { /* leave cache as-is on failure */ }
  return _saveCache.slice()
}

// Synchronous, per-frame-safe presence check (reads the cache).
export function hasSaveCached(n = 0) { return !!_saveCache[n] }

// Build the small meta summary stored alongside each save (for slot lists).
function saveMeta() {
  return {
    name: G.player.name, map: G.player.map,
    day: G.clock.day, creds: G.creds, rep: G.rep,
  }
}

// Persist the live state (minus settings) to the DB. Async; resolves to bool.
export async function save(n = 0) {
  const { settings, ...rest } = G
  // Deep-clone via JSON so we store a plain serializable snapshot, not live refs.
  let data
  try { data = JSON.parse(JSON.stringify(rest)) } catch { data = rest }
  const ok = await putSave(n, data, saveMeta())
  if (ok) _setCache(n, true)
  return ok
}

// Definitive (async) presence check against the DB.
export async function hasSave(n = 0) { return hasSaveDB(n) }

// Load a slot into G. Async; resolves true on success, false if absent/error.
export async function load(n = 0) {
  const data = await getSave(n)
  if (!data) return false
  Object.assign(G, data)
  G.settings = loadSettings() // settings live in localStorage, never in the save blob
  return true
}

// Remove a slot. Async; keeps the sync cache in step.
export async function deleteSlot(n = 0) {
  const ok = await deleteSave(n)
  if (ok) _setCache(n, false)
  return ok
}

// Lightweight slot list for UI: [{slot, ts, meta}].
export async function listSaveSlots() { return listSaves() }

export async function autosave() {
  const ok = await save(0)
  bus.emit('toast', 'AUTOSAVED')
  return ok
}

export function newGame(name, look) {
  Object.assign(G, {
    player: { name, look, map: 'apartment', x: 5, y: 6, dir: 'down' },
    flags: {}, quests: {}, kit: [], codex: [],
    creds: 40, rep: 0, heatLosses: 0,
    citiesUnlocked: ['aster'],
    clock: { minutes: 7 * 60 + 30, day: 1 },
    weather: 'rain',
  })
}

export function saveSettings() { localStorage.setItem('netrunner_settings', JSON.stringify(G.settings)) }
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('netrunner_settings') || '{}') } }
  catch { return { ...DEFAULT_SETTINGS } }
}
G.settings = loadSettings() // synchronous, before first render — must stay sync

// ---- boot: one-time migration + sync-cache priming ------------------------
// Import any legacy localStorage saves into the DB once (only if the DB slot is
// still empty), then prime the synchronous presence cache. The localStorage
// copy is left in place — harmless.
async function _migrateLegacySaves() {
  for (let n = 0; n < _saveCache.length; n++) {
    let raw
    try { raw = localStorage.getItem(SLOT(n)) } catch { raw = null }
    if (!raw) continue
    try {
      if (await hasSaveDB(n)) continue // DB already has this slot — don't clobber
      const data = JSON.parse(raw)
      await putSave(n, data, {
        name: data?.player?.name, map: data?.player?.map,
        day: data?.clock?.day, creds: data?.creds, rep: data?.rep,
      })
    } catch { /* skip a corrupt legacy slot */ }
  }
}

// Kick the boot probe off immediately (non-blocking). The cache starts all-false,
// so CONTINUE is greyed until this resolves a frame or two later — correct, since
// at that point we genuinely don't yet know if a save exists.
;(async () => {
  await _migrateLegacySaves()
  await refreshSaveCache()
})()
