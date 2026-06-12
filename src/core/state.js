// Global game state + save/load. The single source of truth is `G`.
import { bus } from './events.js'

const DEFAULT_SETTINGS = {
  crt: true,
  textSpeed: 2,        // 1 slow, 2 normal, 3 fast
  musicVol: 0.7,
  sfxVol: 0.8,
  vmMode: 'ask',       // 'ask' | 'real' (CheerpX full dive) | 'sim' (local sandbox)
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

const SLOT = n => `netrunner_save_${n}`

export function save(n = 0) {
  const { settings, ...rest } = G
  localStorage.setItem(SLOT(n), JSON.stringify(rest))
}
export function hasSave(n = 0) { return !!localStorage.getItem(SLOT(n)) }
export function load(n = 0) {
  const raw = localStorage.getItem(SLOT(n))
  if (!raw) return false
  try {
    const data = JSON.parse(raw)
    Object.assign(G, data)
    G.settings = loadSettings()
    return true
  } catch { return false }
}
export function autosave() { save(0); bus.emit('toast', 'AUTOSAVED') }

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
G.settings = loadSettings()
