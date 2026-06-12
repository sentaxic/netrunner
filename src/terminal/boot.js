// ============================================================================
// NETRUNNER · src/terminal/boot.js — the cyberdeck cold-start.
//
// A black-screen BlackArch Linux boot sequence (kernel ring buffer + systemd
// [ OK ] units) that plays into the DOM terminal before the deck shell wires
// up. BlackArch is the real Arch-based penetration-testing distro — fitting
// firmware for a runner's deck. Skippable with any key.
//
//   await playBoot(domterm, { host, mode })
// ============================================================================

const OK = '\x1b[38;2;109;255;122m[  OK  ]\x1b[0m'
const RUN = '\x1b[38;2;255;181;71m[ ** ]\x1b[0m'
const C = '\x1b[38;2;41;243;226m'
const M = '\x1b[38;2;255;46;136m'
const D = '\x1b[38;2;120;150;200m'
const W = '\x1b[38;2;234;244;255m'
const R = '\x1b[0m'

const ART = [
  `${M}      ▄▄▄· ▄▄▌   ▄▄▄·  ▄▄· ▄ •▄ ▄▄▄·▄▄▄  ▄▄· ▄ .▄${R}`,
  `${M}     ▐█ ▀█ ██•  ▐█ ▀█ ▐█ ▌▪█▌▄▌▪▐█ ▀█▀▄ █·▐█ ▌▪██▪▐█${R}`,
  `${M}     ▄█▀▀█ ██▪  ▄█▀▀█ ██ ▄▄▐▀▀▄·▄█▀▀█▐▀▀▄ ██ ▄▄██▀▀█${R}`,
  `${M}     ▐█▪ ▐▌▐█▌▐▌▐█▪ ▐▌▐███▌▐█.█▌▐█▪ ▐▌▐█•█▌▐███▌██▌▐▀${R}`,
  `${M}      ▀  ▀ .▀▀▀  ▀  ▀ ·▀▀▀ ·▀  ▀ ▀  ▀ .▀  ▀·▀▀▀ ▀▀▀ ·${R}`,
  `${D}     blackarch linux · deck firmware · salvaged build${R}`,
]

// each step: [text, delayMsAfter]
function script(host) {
  return [
    [`${D}SeaBIOS (version cyberdeck-1)${R}`, 60],
    [`${D}Booting from Hard Disk...${R}`, 200],
    ['', 40],
    [`${D}[    0.000000]${R} Linux version 6.9.4-blackarch1 (runner@deck) #1 SMP PREEMPT_DYNAMIC`, 70],
    [`${D}[    0.118231]${R} Command line: BOOT_IMAGE=/boot/vmlinuz-linux-zen quiet runner.deck=1`, 50],
    [`${D}[    0.342900]${R} Memory: 256K reserved, neon coprocessor detected`, 40],
    [`${D}[    0.661004]${R} cheerpx: x86 translation layer online`, 60],
    [`${D}[    1.029771]${R} EXT2-fs (overlay): mounting root, read-mostly`, 40],
    ['', 30],
    [`${OK} Started ${W}Network Tunnel to District Zero${R}`, 55],
    [`${OK} Mounted ${W}/home/runner${R} (encrypted)`, 45],
    [`${OK} Reached target ${W}Local File Systems${R}`, 45],
    [`${RUN} Starting ${W}Trace-Evasion Daemon${R}...`, 80],
    [`${OK} Started ${W}Trace-Evasion Daemon${R}`, 40],
    [`${OK} Started ${W}Crypt Carrier (NETLINK)${R}`, 45],
    [`${RUN} Negotiating uplink to ${C}${host}${R}...`, 110],
    [`${OK} Reached target ${W}Jack-In Ready${R}`, 60],
    ['', 50],
    ...ART.map(l => [l, 14]),
    ['', 40],
    [`${C}  deck online.${R} ${D}handing you the shell —${R}`, 240],
    ['', 30],
  ]
}

export function playBoot(term, { host = 'relay-7', skipKeyEl = null } = {}) {
  return new Promise(resolve => {
    const steps = script(host)
    let i = 0
    let skipped = false
    let timer = null

    const finish = () => {
      if (timer) { clearTimeout(timer); timer = null }
      cleanup()
      resolve()
    }
    const dumpRest = () => {
      // print everything remaining at once, then finish
      for (; i < steps.length; i++) term.write(steps[i][0] + '\n')
      finish()
    }
    const onSkip = () => { if (!skipped) { skipped = true; dumpRest() } }

    const target = skipKeyEl || term.input
    const cleanup = () => { target && target.removeEventListener('keydown', onSkip) }
    target && target.addEventListener('keydown', onSkip)

    const tick = () => {
      if (skipped) return
      if (i >= steps.length) { finish(); return }
      const [text, delay] = steps[i++]
      term.write(text + '\n')
      timer = setTimeout(tick, delay)
    }
    // first line on next frame so the layer is laid out
    timer = setTimeout(tick, 120)
  })
}
