// ============================================================================
// NETRUNNER · src/data/savedb.js — saves as records in a real local database.
//
// On-theme: the game is about databases, so the saves live in one. This is a
// tiny promise-based IndexedDB wrapper. DB 'netrunner', object store 'saves'
// keyed on 'slot' (0..2; 0 = autosave).
//
// Every export swallows its own errors and resolves to a safe value
// (null / false / []). It NEVER rejects, so callers can `await` without try.
// ============================================================================

const DB_NAME = 'netrunner'
const DB_VERSION = 1
const STORE = 'saves'

let _dbPromise = null

// Open (and lazily create) the database. Memoized — the upgrade only runs once.
// Resolves to an IDBDatabase, or null if IndexedDB is unavailable / blocked.
export function dbReady() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'slot' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  // If the open fails outright, allow a later retry rather than caching null forever.
  return _dbPromise.then(db => {
    if (!db) _dbPromise = null
    return db
  })
}

// Run fn(store) inside a transaction and resolve with `result` once the
// transaction commits (for writes) or with the request value (for reads).
function withStore(mode, fn) {
  return dbReady().then(db => {
    if (!db) return null
    return new Promise(resolve => {
      let out = null
      try {
        const tx = db.transaction(STORE, mode)
        const store = tx.objectStore(STORE)
        // fn may set `out` synchronously or via a request's onsuccess.
        out = fn(store, v => { out = v })
        tx.oncomplete = () => resolve(out)
        tx.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }).catch(() => null)
}

// Store a save. `data` is the serializable game state; `meta` is a small
// summary for menus/UI so we don't have to load the whole blob to list slots.
export async function putSave(slot, data, meta = {}) {
  const record = {
    slot,
    data,
    ts: Date.now(),
    meta: {
      name: meta.name ?? data?.player?.name ?? 'RUNNER',
      map: meta.map ?? data?.player?.map ?? '',
      day: meta.day ?? data?.clock?.day ?? 1,
      creds: meta.creds ?? data?.creds ?? 0,
      rep: meta.rep ?? data?.rep ?? 0,
    },
  }
  const ok = await withStore('readwrite', store => { store.put(record); return true })
  return ok === true
}

// Read a slot's game state. Resolves to `data` or null if absent / on error.
export async function getSave(slot) {
  return withStore('readonly', (store, set) => {
    const req = store.get(slot)
    req.onsuccess = () => set(req.result ? req.result.data : null)
    req.onerror = () => set(null)
    return null
  })
}

// Full record for a slot (incl. ts + meta), or null.
export async function getRecord(slot) {
  return withStore('readonly', (store, set) => {
    const req = store.get(slot)
    req.onsuccess = () => set(req.result || null)
    req.onerror = () => set(null)
    return null
  })
}

// List every save as lightweight {slot, ts, meta} rows for the UI. Sorted by slot.
export async function listSaves() {
  const rows = await withStore('readonly', (store, set) => {
    const req = store.getAll()
    req.onsuccess = () => set(req.result || [])
    req.onerror = () => set([])
    return []
  })
  if (!rows) return []
  return rows
    .map(r => ({ slot: r.slot, ts: r.ts, meta: r.meta || {} }))
    .sort((a, b) => a.slot - b.slot)
}

// Remove a slot. Resolves true on success, false otherwise.
export async function deleteSave(slot) {
  const ok = await withStore('readwrite', store => { store.delete(slot); return true })
  return ok === true
}

// Definitive presence check for a slot.
export async function hasSaveDB(slot) {
  const key = await withStore('readonly', (store, set) => {
    // getKey avoids deserializing the whole blob just to test existence.
    if (store.getKey) {
      const req = store.getKey(slot)
      req.onsuccess = () => set(req.result != null ? true : false)
      req.onerror = () => set(false)
    } else {
      const req = store.get(slot)
      req.onsuccess = () => set(!!req.result)
      req.onerror = () => set(false)
    }
    return false
  })
  return key === true
}
