// Global pub/sub bus. Event names are listed in ARCHITECTURE.md §6.
const listeners = new Map()

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set())
    listeners.get(evt).add(fn)
    return () => listeners.get(evt)?.delete(fn)
  },
  off(evt, fn) { listeners.get(evt)?.delete(fn) },
  emit(evt, payload) {
    listeners.get(evt)?.forEach(fn => {
      try { fn(payload) } catch (err) { console.error(`[bus:${evt}]`, err) }
    })
  },
}
