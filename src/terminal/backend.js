// ============================================================================
// NETRUNNER · src/terminal/backend.js — the two interchangeable jack-in shells
// behind one interface. ARCHITECTURE.md §9.
//
//   const be = await makeBackend('sim'|'real', mission)
//   be.write(data)       raw xterm key data in
//   be.onData(cb)        terminal output out (CRLF/ANSI strings)
//   be.resize(cols,rows) terminal geometry hint
//   be.check()           → bool | Promise<bool>: mission objective met?
//   be.dispose()         tear everything down
//   be.banner            ANSI banner string for jackin to print on connect
//   -- extras (optional, jackin feature-detects) --
//   be.noise()           heat units accrued since last call (trace bursts)
//   be.exited()          player voluntarily closed the session (clean jack-out)
//   be.mode              'sim' | 'real'
//
// 'sim'  — SimShell over the mission's in-memory fs. Always available, no
//          cross-origin isolation required. THE fallback; correctness first.
// 'real' — CheerpX x86 Linux VM (lazy-loaded from the npm package, engine +
//          base disk image stream from the leaningtech CDN). Boots a Debian
//          root from a CloudDevice with an IndexedDB overlay (writes persist
//          locally, the base image is read-only), replays the mission fs into
//          the VM via a generated setup script, then attaches an interactive
//          bash to the terminal. Requires COOP/COEP (crossOriginIsolated) —
//          if anything is missing this function THROWS with a clear message
//          and jackin.js falls back to 'sim'.
// ============================================================================

import { SimShell } from './sim-shell.js'

export async function makeBackend(mode, mission) {
  if (!mission) throw new Error('makeBackend: no mission supplied')
  if (mode === 'sim') return makeSimBackend(mission)
  if (mode === 'real') return await makeRealBackend(mission)
  throw new Error(`makeBackend: unknown mode "${mode}"`)
}

// ---------------------------------------------------------------------------
// banner
// ---------------------------------------------------------------------------
const C = '\x1b[38;2;41;243;226m'   // neon cyan
const M = '\x1b[38;2;255;46;136m'   // magenta
const Y = '\x1b[38;2;255;181;71m'   // amber
const D = '\x1b[38;2;120;150;200m'  // dim ink
const R = '\x1b[0m'
const B = '\x1b[1m'

function makeBanner(mission, mode) {
  const rule = `${C}────────────────────────────────────────────────────────────${R}`
  const link = mode === 'real'
    ? `${M}${B}FULL DIVE${R} ${D}· live x86 linux vm (CheerpX)${R}`
    : `${C}${B}LOCAL MIRROR${R} ${D}· sandboxed in-memory sim${R}`
  return [
    '',
    rule,
    `  ${B}${C}NETLINK 4.0.2${R} ${D}· carrier locked · crypt layer up${R}`,
    `  ${D}target    :${R} ${Y}${mission.host}${R}`,
    `  ${D}link      :${R} ${link}`,
    `  ${D}objective :${R} ${mission.objective}`,
    `  ${D}deck      :${R} ${C}help${R}${D} lists commands · ${R}${C}man <cmd>${R}${D} explains them${R}`,
    rule,
    '',
  ].join('\r\n')
}

// ---------------------------------------------------------------------------
// mode 'sim'
// ---------------------------------------------------------------------------
function makeSimBackend(mission) {
  const shell = new SimShell(mission.fs, {
    host: mission.host,
    user: mission.user || 'runner',
    hosts: mission.hosts || {},
    cwd: mission.cwd,
  })
  const cbs = []
  let disposed = false
  shell.onOutput(d => { for (const cb of cbs) cb(d) })
  // First prompt lands right after jackin prints the banner (it attaches
  // onData synchronously after makeBackend resolves).
  queueMicrotask(() => { if (!disposed) shell.prompt() })

  return {
    mode: 'sim',
    banner: makeBanner(mission, 'sim'),
    shell, // exposed for debugging / automated verification (window.NR poking)
    write(data) { if (!disposed) shell.input(data) },
    onData(cb) { cbs.push(cb) },
    resize(cols, rows) { shell.resize(cols, rows) },
    check() {
      if (disposed) return false
      try { return !!mission.check(shell.state) } catch { return false }
    },
    noise() { return shell.drainNoise() },
    exited() { return shell.exited },
    dispose() { disposed = true; shell.dispose() },
  }
}

// ---------------------------------------------------------------------------
// mode 'real' — CheerpX
// ---------------------------------------------------------------------------
const CX_DISK_URL = 'wss://disks.webvm.io/debian_large_20230522_5044875331.ext2'
const CX_ENV = [
  'HOME=/home/user', 'USER=user', 'SHELL=/bin/bash', 'TERM=xterm',
  'EDITOR=vim', 'LANG=en_US.UTF-8',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
]

async function makeRealBackend(mission) {
  // --- preconditions: COOP/COEP + SharedArrayBuffer ------------------------
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    throw new Error('full dive needs cross-origin isolation (COOP/COEP headers) — not satisfied here')
  }

  // --- lazy engine load ------------------------------------------------------
  let CX
  try {
    CX = await import('@leaningtech/cheerpx')
  } catch (err) {
    throw new Error(`CheerpX engine failed to load: ${(err && err.message) || err}`)
  }

  // --- devices: cloud base image + IDB overlay + data/checks side channels ---
  let cloud, overlayIdb, overlay, dataDev, checksDev, vm
  const dispoables = []
  try {
    cloud = await CX.CloudDevice.create(CX_DISK_URL)
    overlayIdb = await CX.IDBDevice.create('netrunner_vm_overlay')
    overlay = await CX.OverlayDevice.create(cloud, overlayIdb)
    dataDev = await CX.DataDevice.create()       // JS -> VM (setup script)
    checksDev = await CX.IDBDevice.create('netrunner_vm_checks') // VM -> JS (check results)
    dispoables.push(cloud, overlayIdb, overlay, dataDev, checksDev)

    vm = await CX.Linux.create({
      mounts: [
        { type: 'ext2', path: '/', dev: overlay },
        { type: 'dir', path: '/data', dev: dataDev },
        { type: 'dir', path: '/checks', dev: checksDev },
        { type: 'devs', path: '/dev' },
        { type: 'proc', path: '/proc' },
      ],
    })
  } catch (err) {
    for (const d of dispoables) { try { d.delete() } catch { /* already gone */ } }
    throw new Error(`full dive boot failed: ${(err && err.message) || err}`)
  }

  // --- console plumbing -------------------------------------------------------
  const cbs = []
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  // Geometry is fixed at console creation; jackin's fit() generally lands in
  // this ballpark. Full-screen TUI apps may disagree by a column — acceptable.
  const kbWrite = vm.setCustomConsole((buf) => {
    const s = decoder.decode(buf, { stream: true })
    for (const cb of cbs) cb(s)
  }, 110, 30)

  // --- replay the mission layout into the VM ----------------------------------
  const setup = buildSetupScript(mission)
  await dataDev.writeFile('/setup.sh', setup)
  try {
    await vm.run('/bin/bash', ['/data/setup.sh'], { env: CX_ENV.slice(), cwd: '/' })
  } catch (err) {
    throw new Error(`full dive mission setup failed: ${(err && err.message) || err}`)
  }

  // --- interactive shell (not awaited: lives as long as the session) ----------
  let exitedFlag = false
  let disposed = false
  vm.run('/bin/bash', ['--login'], { env: CX_ENV.slice(), cwd: '/home/user', uid: 1000, gid: 1000 })
    .then(() => { exitedFlag = true })
    .catch(() => { exitedFlag = true })

  // --- check: run the mission's verification snippet, read the sentinel -------
  let checking = false
  async function realCheck() {
    if (disposed || checking) return false
    if (!mission.realCheck) return false
    checking = true
    try {
      const cmd = `rm -f /checks/result; { ${mission.realCheck} ; } > /checks/result 2>/dev/null || true`
      await vm.run('/bin/bash', ['-c', cmd], { env: CX_ENV.slice(), cwd: '/' })
      const blob = await checksDev.readFileAsBlob('/result')
      const txt = (await blob.text()).trim()
      return txt.includes('OK')
    } catch {
      return false
    } finally {
      checking = false
    }
  }

  let keyNoise = 0
  return {
    mode: 'real',
    banner: makeBanner(mission, 'real'),
    write(data) {
      if (disposed) return
      keyNoise += data.length * 0.02
      for (const byte of encoder.encode(data)) kbWrite(byte)
    },
    onData(cb) { cbs.push(cb) },
    resize() { /* console geometry fixed at creation — documented no-op */ },
    check() { return realCheck() },
    noise() { const n = keyNoise; keyNoise = 0; return n },
    exited() { return exitedFlag },
    dispose() {
      disposed = true
      cbs.length = 0
      try { vm.delete() } catch { /* vm already torn down */ }
      for (const d of dispoables) { try { d.delete() } catch { /* already gone */ } }
    },
  }
}

// Turn the mission's sim fs spec into a bash script that recreates the same
// layout inside the real VM (heredocs, perms), then appends mission.realScript.
function buildSetupScript(mission) {
  const lines = ['#!/bin/bash', 'set -e']
  const roots = new Set()
  let fileNo = 0

  const permsToOctal = (perms) => {
    // 'drwxr-x---' -> '750'
    let oct = ''
    for (let c = 0; c < 3; c++) {
      const bits = perms.slice(1 + c * 3, 4 + c * 3)
      oct += String((bits[0] === 'r' ? 4 : 0) + (bits[1] === 'w' ? 2 : 0) + (bits[2] === 'x' ? 1 : 0))
    }
    return oct
  }

  const walk = (spec, path) => {
    for (const key of Object.keys(spec)) {
      if (key === '__perms' || key === '__date') continue
      const v = spec[key]
      const p = `${path}/${key}`
      if (path === '') roots.add(`/${key}`)
      if (typeof v === 'string' || (v && typeof v === 'object' && typeof v.__file === 'string')) {
        const content = typeof v === 'string' ? v : v.__file
        const perms = typeof v === 'object' && v.__perms ? v.__perms : null
        const eof = `NR_EOF_${fileNo++}`
        lines.push(`mkdir -p '${path === '' ? '/' : path}'`)
        lines.push(`cat > '${p}' <<'${eof}'`)
        lines.push(content.endsWith('\n') ? content.slice(0, -1) : content)
        lines.push(eof)
        if (perms) lines.push(`chmod ${permsToOctal(perms)} '${p}'`)
      } else if (v && typeof v === 'object') {
        lines.push(`mkdir -p '${p}'`)
        if (v.__perms) lines.push(`chmod ${permsToOctal(v.__perms)} '${p}'`)
        walk(v, p)
      }
    }
  }
  walk(mission.fs || {}, '')

  // Hand the mission tree to the interactive (uid 1000) user.
  for (const root of roots) {
    if (root === '/etc' || root === '/tmp') continue
    lines.push(`chown -R 1000:1000 '${root}' 2>/dev/null || true`)
  }
  if (mission.realScript) lines.push(mission.realScript)
  lines.push('touch /tmp/.nr_ready')
  lines.push('exit 0')
  return lines.join('\n') + '\n'
}
