// ============================================================================
// NETRUNNER · src/terminal/backend.js — the two interchangeable jack-in shells
// behind one LINE-ORIENTED interface (the DOM terminal submits whole lines).
//
//   const be = await makeBackend('sim'|'real', mission)
//   be.mode                 'sim' | 'real'
//   be.banner               ANSI banner string to print on connect
//   be.onOutput(cb)         cb(str): shell output (ANSI/newlines) -> terminal
//   be.promptStr()          current prompt string (ANSI) — reflects cwd / sql mode
//   be.runLine(line)        execute a submitted command line  -> Promise
//   be.complete(line)       -> { line, suggestions } for tab completion
//   be.check()              -> bool | Promise<bool>: objective met?
//   be.noise()              heat units accrued since last call (trace bursts)
//   be.exited()             player typed exit/logout — clean jack-out
//   be.dispose()            tear everything down
//
// 'sim'  — SimShell over the mission's in-memory fs, run in line mode. Always
//          available, no cross-origin isolation, instant. The default.
// 'real' — CheerpX x86 Linux VM. Each submitted line runs as `bash -lc` with a
//          persisted working directory, so it behaves like a real session while
//          staying line-oriented (and never depending on a fragile key pipe).
//          Requires COOP/COEP (crossOriginIsolated); throws clearly otherwise so
//          jackin.js falls back to 'sim'.
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
    `  ${D}deck      :${R} ${C}help${R}${D} lists commands · ${R}${C}man <cmd>${R}${D} explains them · ${R}${C}exit${R}${D} jacks out${R}`,
    rule,
    '',
  ].join('\n')
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
  let disposed = false
  return {
    mode: 'sim',
    banner: makeBanner(mission, 'sim'),
    shell, // exposed for debugging / automated verification
    onOutput(cb) { return shell.onOutput(cb) },
    promptStr() { return shell.promptStr() },
    runLine(line) { return disposed ? Promise.resolve() : shell.execLine(line) },
    complete(line) { return shell.complete(line) },
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
// mode 'real' — CheerpX, line-oriented
// ---------------------------------------------------------------------------
const CX_DISK_URL = 'wss://disks.webvm.io/debian_large_20230522_5044875331.ext2'
const CX_ENV = [
  'HOME=/home/user', 'USER=user', 'SHELL=/bin/bash', 'TERM=dumb',
  'EDITOR=vim', 'LANG=en_US.UTF-8',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
]

async function makeRealBackend(mission) {
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    throw new Error('full dive needs cross-origin isolation (COOP/COEP) — not satisfied here')
  }

  let CX
  try { CX = await import('@leaningtech/cheerpx') }
  catch (err) { throw new Error(`CheerpX engine failed to load: ${(err && err.message) || err}`) }

  let cloud, overlayIdb, overlay, dataDev, checksDev, vm
  const disposables = []
  try {
    cloud = await CX.CloudDevice.create(CX_DISK_URL)
    overlayIdb = await CX.IDBDevice.create('netrunner_vm_overlay')
    overlay = await CX.OverlayDevice.create(cloud, overlayIdb)
    dataDev = await CX.DataDevice.create()
    checksDev = await CX.IDBDevice.create('netrunner_vm_checks')
    disposables.push(cloud, overlayIdb, overlay, dataDev, checksDev)
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
    for (const d of disposables) { try { d.delete() } catch { /* gone */ } }
    throw new Error(`full dive boot failed: ${(err && err.message) || err}`)
  }

  const cbs = []
  const decoder = new TextDecoder()
  // All VM stdout/stderr funnels here and out to the terminal.
  vm.setCustomConsole(buf => {
    const s = decoder.decode(buf, { stream: true })
    for (const cb of cbs) cb(s)
  }, 120, 40)

  // Replay the mission layout into the VM.
  const setup = buildSetupScript(mission)
  await dataDev.writeFile('/setup.sh', setup)
  try {
    await vm.run('/bin/bash', ['/data/setup.sh'], { env: CX_ENV.slice(), cwd: '/' })
  } catch (err) {
    throw new Error(`full dive mission setup failed: ${(err && err.message) || err}`)
  }

  let cwd = '/home/user'
  let exitedFlag = false
  let disposed = false
  let keyNoise = 0
  let running = false

  const sh = q => `'${String(q).replace(/'/g, `'\\''`)}'`

  async function runLine(line) {
    if (disposed) return
    const raw = String(line == null ? '' : line)
    if (raw === '\x03') return
    const trimmed = raw.trim()
    if (trimmed === 'exit' || trimmed === 'logout') { exitedFlag = true; return }
    if (!trimmed) return
    keyNoise += raw.length * 0.02
    running = true
    // Run in a fresh bash but restore cwd first, then persist the new cwd. Output
    // streams to the custom console; we only side-channel the resulting pwd.
    const script = `cd ${sh(cwd)} 2>/dev/null\n${raw}\npwd > /checks/.cwd 2>/dev/null`
    try {
      await vm.run('/bin/bash', ['-lc', script], { env: CX_ENV.slice(), cwd, uid: 1000, gid: 1000 })
      try {
        const blob = await checksDev.readFileAsBlob('/.cwd')
        const next = (await blob.text()).trim()
        if (next) cwd = next
      } catch { /* pwd capture optional */ }
    } catch (err) {
      for (const cb of cbs) cb(`\x1b[38;2;255;46;136mdeck fault: ${(err && err.message) || err}\x1b[0m\n`)
    } finally {
      running = false
    }
  }

  let checking = false
  async function realCheck() {
    if (disposed || checking || running || !mission.realCheck) return false
    checking = true
    try {
      const cmd = `rm -f /checks/result; { ${mission.realCheck} ; } > /checks/result 2>/dev/null || true`
      await vm.run('/bin/bash', ['-c', cmd], { env: CX_ENV.slice(), cwd: '/' })
      const blob = await checksDev.readFileAsBlob('/result')
      return (await blob.text()).trim().includes('OK')
    } catch { return false }
    finally { checking = false }
  }

  const tilde = p => (p === '/home/user' ? '~' : p.startsWith('/home/user/') ? '~' + p.slice(10) : p)

  return {
    mode: 'real',
    banner: makeBanner(mission, 'real'),
    onOutput(cb) { cbs.push(cb); return () => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1) } },
    promptStr() { return `${B}${C}user@${mission.host}${R}:${Y}${tilde(cwd)}${R}$ ` },
    runLine,
    complete(line) { return { line, suggestions: [] } }, // real bash completion offline is out of scope
    check() { return realCheck() },
    noise() { const n = keyNoise; keyNoise = 0; return n },
    exited() { return exitedFlag },
    dispose() {
      disposed = true
      cbs.length = 0
      try { vm.delete() } catch { /* torn down */ }
      for (const d of disposables) { try { d.delete() } catch { /* gone */ } }
    },
  }
}

// Turn the mission's sim fs spec into a bash script that recreates the same
// layout inside the real VM (heredocs, perms), then appends mission.realScript.
function buildSetupScript(mission) {
  const lines = ['#!/bin/bash', 'set -e']
  const roots = new Set()
  let fileNo = 0

  const permsToOctal = perms => {
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

  for (const root of roots) {
    if (root === '/etc' || root === '/tmp') continue
    lines.push(`chown -R 1000:1000 '${root}' 2>/dev/null || true`)
  }
  if (mission.realScript) lines.push(mission.realScript)
  lines.push('touch /tmp/.nr_ready')
  lines.push('exit 0')
  return lines.join('\n') + '\n'
}
