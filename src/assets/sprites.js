// sprites.js — every walking character in NETRUNNER, drawn live as code.
// 16×24 px humanoids at integer (x,y) top-left. Four facings, walk cycle, idle.
//
// drawActor(ctx, x, y, { look, dir, frame, tint })
//   look  : key into ACTORS (defaults to 'a')
//   dir   : 'down' | 'up' | 'left' | 'right'
//   frame : 0 idle/contact · 1 stride A · 2 stride B · 3 passing (any int is masked &3)
//   tint  : brightness of neon trim (player glow); 1 = normal, 0 = dead, ~2 = blown out
//
// Silhouette language: players read by glowing hood rim + headset; sister by warm
// scarf + long hair; Glitch by floor-length coat + cyan visor; Vex by sharp shoulders
// + magenta studs; the Forge boss by hardhat + rig bulk. Kid is genuinely small.

import { mix } from './palette.js'

const EYE = '#0a0d16'

export const ACTORS = {
  // ---- player looks (hoodie + headset, neon trim) -------------------------
  a: { skin: '#e3b394', hair: '#2a3350', style: 'hood', top: '#1f2742', bottom: '#141b30', boot: '#0b101e', trim: '#29f3e2', features: ['headset'] },
  b: { skin: '#9c6b4b', hair: '#11141f', style: 'hood', top: '#2b1f3e', bottom: '#191325', boot: '#0d0a14', trim: '#ff2e88', features: ['headset'] },
  c: { skin: '#f2d2b0', hair: '#c96a3a', style: 'hood', top: '#163230', bottom: '#102420', boot: '#081410', trim: '#ffb547', features: ['headset'] },
  // ---- story cast ----------------------------------------------------------
  sister:     { skin: '#ecc09e', hair: '#7a4630', style: 'long',  top: '#a85a40', bottom: '#3c2b38', boot: '#221823', trim: '#ffb547', scarf: '#ff6a4d', features: ['scarf'] },
  glitch:     { skin: '#d9af90', hair: '#161a26', style: 'short', top: '#10141f', bottom: '#0c0f18', boot: '#06080d', trim: '#29f3e2', features: ['coat', 'visor'] },
  vex:        { skin: '#cfa284', hair: '#e6e9f2', style: 'slick', top: '#331233', bottom: '#1c1126', boot: '#120a18', trim: '#ff2e88', features: ['jacket'] },
  boss_forge: { skin: '#c98e64', hair: '#3a2c20', style: 'buzz',  top: '#4a3a26', bottom: '#332818', boot: '#1c140c', trim: '#ffb547', features: ['hardhat', 'rig'] },
  // ---- ambient city --------------------------------------------------------
  npc_commuter: { skin: '#d4ab8d', hair: '#222637', style: 'short', top: '#26304a', bottom: '#181f33', boot: '#0e1322', trim: '#7ad7ff', features: ['coat'] },
  npc_vendor:   { skin: '#b98a62', hair: '#2c2018', style: 'buzz',  top: '#39303f', bottom: '#241c28', boot: '#140e18', trim: '#ffb547', apron: '#cdb892', cap: '#5a2330', features: ['cap', 'apron'] },
  npc_kid:      { small: true, skin: '#e9bd9c', hair: '#36284a', style: 'short', top: '#2456c8', bottom: '#1a2238', boot: '#0d1322', trim: '#6dff7a', features: [] },
}

// Derived shades, computed once at module load.
for (const k in ACTORS) {
  const a = ACTORS[k]
  a.skinShade = mix(a.skin, '#000000', 0.3)
  a.topLit = mix(a.top, '#ffffff', 0.16)
  a.topDark = mix(a.top, '#000000', 0.35)
  a.bottomDark = mix(a.bottom, '#000000', 0.3)
  a.bootDark = mix(a.boot, '#000000', 0.3)
  a.hairDark = mix(a.hair, '#000000', 0.3)
  if (a.scarf) a.scarfDark = mix(a.scarf, '#000000', 0.3)
  if (a.cap) a.capDark = mix(a.cap, '#000000', 0.35)
  if (a.apron) a.apronDark = mix(a.apron, '#000000', 0.25)
}

// Body geometry: face top, torso top, torso height, leg top, leg height.
const GEO = { fy: 3, ty: 9, th: 8, ly: 17, lh: 4 }
const GEOK = { fy: 7, ty: 13, th: 5, ly: 18, lh: 2 } // kid: big head, short everything

function R(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h) }
const has = (c, f) => c.features.indexOf(f) >= 0

// Neon trim helper: returns the trim fill (brightness-scaled) and arms the glow.
function neonOn(ctx, col, tint) {
  const t = Math.max(0, tint)
  ctx.shadowColor = col
  ctx.shadowBlur = 3 * Math.min(2, t)
  if (t >= 1) return mix(col, '#ffffff', Math.min(1, t - 1) * 0.7)
  return mix('#141a2c', col, Math.max(0.15, t))
}
function neonOff(ctx) { ctx.shadowBlur = 0 }

export function drawActor(ctx, x, y, opts = {}) {
  const c = ACTORS[opts.look] || ACTORS.a
  const dir = opts.dir || 'down'
  const f = opts.frame == null ? 0 : (Math.abs(opts.frame | 0) & 3)
  const tint = opts.tint == null ? 1 : opts.tint
  const g = c.small ? GEOK : GEO
  ctx.save()
  ctx.translate(Math.round(x), Math.round(y))
  if (dir === 'left') { ctx.translate(16, 0); ctx.scale(-1, 1) }
  R(ctx, 4, 22, 8, 2, 'rgba(0,0,0,0.35)') // ground contact shadow
  if (dir === 'up') back(ctx, c, g, f, tint)
  else if (dir === 'left' || dir === 'right') side(ctx, c, g, f, tint)
  else front(ctx, c, g, f, tint)
  ctx.restore()
}

// ---------------------------------------------------------------- facing: down
function front(ctx, c, g, f, tint) {
  const bob = (f === 1 || f === 2) ? -1 : 0
  const lL = f === 1 ? -1 : 0
  const lR = f === 2 ? -1 : 0
  const ty = g.ty + bob
  const fy = g.fy + bob
  const feet = g.ly + g.lh

  // legs + boots
  R(ctx, 5, g.ly, 3, g.lh + lL, c.bottom)
  R(ctx, 8, g.ly, 3, g.lh + lR, c.bottomDark)
  R(ctx, 5, feet + lL, 3, 2, c.boot)
  R(ctx, 8, feet + lR, 3, 2, c.boot)

  // torso
  R(ctx, 4, ty, 8, g.th, c.top)
  R(ctx, 10, ty, 2, g.th, c.topDark)
  R(ctx, 4, ty, 8, 1, c.topLit)
  R(ctx, 4, ty + g.th - 1, 8, 1, c.topDark)

  // arms + hands
  R(ctx, 3, ty + 1, 1, g.th - 3, c.topDark)
  R(ctx, 12, ty + 1, 1, g.th - 3, c.topDark)
  R(ctx, 3, ty + g.th - 2, 1, 1, c.skin)
  R(ctx, 12, ty + g.th - 2, 1, 1, c.skin)

  // long coat covers legs to the boots
  if (has(c, 'coat')) {
    R(ctx, 4, ty + g.th, 8, feet - (ty + g.th), c.top)
    R(ctx, 8, ty + 3, 1, feet - (ty + 3), c.topDark) // front split
    R(ctx, 4, feet - 1, 8, 1, c.topDark)
  }

  // head
  R(ctx, 5, fy, 6, 6, c.skin)
  R(ctx, 10, fy, 1, 6, c.skinShade)
  if (!has(c, 'visor')) { R(ctx, 6, fy + 3, 1, 1, EYE); R(ctx, 9, fy + 3, 1, 1, EYE) }

  // hair / hood
  if (c.style === 'hood') {
    R(ctx, 4, fy - 1, 8, 2, c.top)
    R(ctx, 4, fy + 1, 1, 4, c.top)
    R(ctx, 11, fy + 1, 1, 4, c.top)
    const tc = neonOn(ctx, c.trim, tint)
    R(ctx, 4, fy + 1, 1, 4, tc)
    R(ctx, 11, fy + 1, 1, 4, tc)
    neonOff(ctx)
  } else if (c.style === 'long') {
    R(ctx, 4, fy - 1, 8, 2, c.hair)
    R(ctx, 4, fy + 1, 1, 6, c.hair)
    R(ctx, 11, fy + 1, 1, 6, c.hair)
    R(ctx, 5, fy + 1, 1, 1, c.hair)
    R(ctx, 9, fy + 1, 1, 1, c.hairDark)
  } else if (c.style === 'slick') {
    R(ctx, 5, fy - 2, 6, 1, c.hair)
    R(ctx, 4, fy - 1, 8, 2, c.hair)
    R(ctx, 4, fy + 1, 1, 2, c.hair)
    R(ctx, 11, fy + 1, 1, 2, c.hair)
    R(ctx, 6, fy - 1, 3, 1, mix(c.hair, '#ffffff', 0.2))
  } else if (c.style === 'buzz') {
    R(ctx, 4, fy - 1, 8, 1, c.hair)
    R(ctx, 4, fy, 1, 2, c.hair)
    R(ctx, 11, fy, 1, 2, c.hair)
  } else { // short
    R(ctx, 4, fy - 1, 8, 2, c.hair)
    R(ctx, 4, fy + 1, 1, 3, c.hair)
    R(ctx, 11, fy + 1, 1, 3, c.hair)
    R(ctx, 6, fy + 1, 2, 1, c.hair)
  }

  // features
  if (has(c, 'visor')) {
    const vc = neonOn(ctx, c.trim, tint)
    R(ctx, 5, fy + 3, 6, 1, vc)
    neonOff(ctx)
  }
  if (has(c, 'headset')) {
    R(ctx, 4, fy - 1, 8, 1, '#10141f')
    const hc = neonOn(ctx, c.trim, tint)
    R(ctx, 4, fy + 3, 1, 2, hc)
    R(ctx, 11, fy + 3, 1, 2, hc)
    neonOff(ctx)
  }
  if (has(c, 'scarf')) {
    R(ctx, 4, fy + 6, 8, 2, c.scarf)
    R(ctx, 9, fy + 8, 2, 3, c.scarfDark)
  }
  if (has(c, 'jacket')) {
    R(ctx, 3, ty, 2, 1, c.topLit)
    R(ctx, 11, ty, 2, 1, c.topLit)
    R(ctx, 7, ty + 1, 2, 2, c.topDark)
    const jc = neonOn(ctx, c.trim, tint * 0.8)
    R(ctx, 6, ty, 1, 1, jc)
    R(ctx, 9, ty, 1, 1, jc)
    neonOff(ctx)
  }
  if (has(c, 'apron')) {
    R(ctx, 5, ty + 2, 6, g.th - 2, c.apron)
    R(ctx, 5, ty + 2, 6, 1, c.apronDark)
  }
  if (has(c, 'rig')) {
    R(ctx, 2, ty, 2, 2, '#5a5146')
    R(ctx, 12, ty, 2, 2, '#5a5146')
    for (let i = 0; i < 5; i++) R(ctx, 5 + i, ty + 1 + i, 1, 1, '#6a4a2a')
  }
  if (has(c, 'hardhat')) {
    R(ctx, 4, fy - 1, 8, 3, '#ffb547')
    R(ctx, 5, fy - 1, 6, 1, '#ffd089')
    R(ctx, 3, fy + 2, 10, 1, '#b97a2a')
  }
  if (has(c, 'cap')) {
    R(ctx, 4, fy - 1, 8, 2, c.cap)
    R(ctx, 4, fy + 1, 8, 1, c.capDark)
  }
}

// ------------------------------------------------------------------ facing: up
function back(ctx, c, g, f, tint) {
  const bob = (f === 1 || f === 2) ? -1 : 0
  const lL = f === 1 ? -1 : 0
  const lR = f === 2 ? -1 : 0
  const ty = g.ty + bob
  const fy = g.fy + bob
  const feet = g.ly + g.lh

  R(ctx, 5, g.ly, 3, g.lh + lL, c.bottom)
  R(ctx, 8, g.ly, 3, g.lh + lR, c.bottomDark)
  R(ctx, 5, feet + lL, 3, 2, c.boot)
  R(ctx, 8, feet + lR, 3, 2, c.boot)

  R(ctx, 4, ty, 8, g.th, c.top)
  R(ctx, 10, ty, 2, g.th, c.topDark)
  R(ctx, 4, ty, 8, 1, c.topLit)
  R(ctx, 4, ty + g.th - 1, 8, 1, c.topDark)
  R(ctx, 3, ty + 1, 1, g.th - 3, c.topDark)
  R(ctx, 12, ty + 1, 1, g.th - 3, c.topDark)
  R(ctx, 3, ty + g.th - 2, 1, 1, c.skin)
  R(ctx, 12, ty + g.th - 2, 1, 1, c.skin)

  if (has(c, 'coat')) {
    R(ctx, 4, ty + g.th, 8, feet - (ty + g.th), c.top)
    R(ctx, 8, ty + 4, 1, feet - (ty + 4), c.topDark) // back vent
    R(ctx, 4, feet - 1, 8, 1, c.topDark)
  }

  // back of head
  R(ctx, 5, fy, 6, 6, c.skin)
  if (c.style === 'hood') {
    R(ctx, 4, fy - 1, 8, 7, c.top)
    R(ctx, 10, fy, 2, 6, c.topDark)
    const tc = neonOn(ctx, c.trim, tint)
    R(ctx, 7, fy + 1, 1, 4, tc) // glowing seam down the hood
    neonOff(ctx)
  } else if (c.style === 'long') {
    R(ctx, 4, fy - 1, 8, 9, c.hair)
    R(ctx, 10, fy, 2, 8, c.hairDark)
  } else if (c.style === 'buzz') {
    R(ctx, 4, fy - 1, 8, 5, c.hair)
    R(ctx, 10, fy, 2, 4, c.hairDark)
  } else { // short, slick
    R(ctx, 4, fy - 1, 8, 6, c.hair)
    R(ctx, 10, fy, 2, 5, c.hairDark)
    if (c.style === 'slick') R(ctx, 5, fy - 1, 5, 1, mix(c.hair, '#ffffff', 0.2))
  }

  if (has(c, 'headset')) {
    R(ctx, 4, fy - 1, 8, 1, '#10141f')
    const hc = neonOn(ctx, c.trim, tint)
    R(ctx, 4, fy + 3, 1, 2, hc)
    R(ctx, 11, fy + 3, 1, 2, hc)
    neonOff(ctx)
  }
  if (has(c, 'scarf')) {
    R(ctx, 4, fy + 6, 8, 2, c.scarf)
    R(ctx, 7, fy + 8, 2, 3, c.scarfDark) // knot tail down the back
  }
  if (has(c, 'rig')) {
    R(ctx, 2, ty, 2, 2, '#5a5146')
    R(ctx, 12, ty, 2, 2, '#5a5146')
    R(ctx, 5, ty + 1, 6, 1, '#6a4a2a') // back strap
  }
  if (has(c, 'hardhat')) {
    R(ctx, 4, fy - 1, 8, 3, '#ffb547')
    R(ctx, 5, fy - 1, 6, 1, '#ffd089')
    R(ctx, 3, fy + 2, 10, 1, '#b97a2a')
  }
  if (has(c, 'cap')) R(ctx, 4, fy - 1, 8, 2, c.cap)
}

// ---------------------------------------------------- facing: right (left = flip)
function side(ctx, c, g, f, tint) {
  const bob = (f === 1 || f === 2) ? -1 : 0
  const sw = f === 1 ? 2 : f === 2 ? -2 : 0 // stride scissor
  const ty = g.ty + bob
  const fy = g.fy + bob
  const feet = g.ly + g.lh

  // far leg first (darker), near leg over it
  R(ctx, 6 - sw, g.ly, 3, g.lh, c.bottomDark)
  R(ctx, 6 - sw, feet, 3, 2, c.bootDark)
  R(ctx, 6 + sw, g.ly, 3, g.lh, c.bottom)
  R(ctx, 6 + sw, feet, 3, 2, c.boot)

  // torso (narrow)
  R(ctx, 5, ty, 6, g.th, c.top)
  R(ctx, 5, ty, 1, g.th, c.topDark)
  R(ctx, 10, ty, 1, g.th, c.topLit)
  R(ctx, 5, ty + g.th - 1, 6, 1, c.topDark)

  if (has(c, 'coat')) {
    R(ctx, 5, ty + g.th, 6, feet - (ty + g.th), c.top)
    R(ctx, 4, ty + g.th, 1, feet - (ty + g.th) - 1, c.topDark) // tail flares behind
    R(ctx, 5, feet - 1, 6, 1, c.topDark)
  }

  // near arm swings counter to legs
  const ax = 7 - (sw > 0 ? 1 : sw < 0 ? -1 : 0)
  R(ctx, ax, ty + 1, 2, g.th - 3, c.topDark)
  R(ctx, ax, ty + g.th - 2, 2, 1, c.skin)

  // head, profile
  R(ctx, 5, fy, 6, 6, c.skin)
  R(ctx, 11, fy + 3, 1, 1, c.skin) // nose
  if (!has(c, 'visor')) R(ctx, 9, fy + 3, 1, 1, EYE)

  if (c.style === 'hood') {
    R(ctx, 4, fy - 1, 7, 2, c.top)
    R(ctx, 4, fy + 1, 2, 5, c.top)
    const tc = neonOn(ctx, c.trim, tint)
    R(ctx, 10, fy - 1, 1, 3, tc) // glowing front rim
    neonOff(ctx)
  } else if (c.style === 'long') {
    R(ctx, 4, fy - 1, 7, 2, c.hair)
    R(ctx, 4, fy + 1, 2, 7, c.hair)
    R(ctx, 10, fy + 1, 1, 1, c.hair)
  } else if (c.style === 'slick') {
    R(ctx, 4, fy - 1, 7, 2, c.hair)
    R(ctx, 3, fy, 2, 2, c.hair) // swept back
    R(ctx, 5, fy - 1, 4, 1, mix(c.hair, '#ffffff', 0.2))
  } else if (c.style === 'buzz') {
    R(ctx, 4, fy - 1, 7, 1, c.hair)
    R(ctx, 4, fy, 2, 3, c.hair)
  } else { // short
    R(ctx, 4, fy - 1, 7, 2, c.hair)
    R(ctx, 4, fy + 1, 2, 4, c.hair)
    R(ctx, 9, fy + 1, 2, 1, c.hair)
  }

  if (has(c, 'visor')) {
    const vc = neonOn(ctx, c.trim, tint)
    R(ctx, 8, fy + 3, 4, 1, vc) // wraps past the brow
    neonOff(ctx)
  }
  if (has(c, 'headset')) {
    R(ctx, 5, fy - 1, 6, 1, '#10141f')
    R(ctx, 5, fy + 3, 2, 2, '#10141f') // ear cup
    const hc = neonOn(ctx, c.trim, tint)
    R(ctx, 5, fy + 4, 1, 1, hc)
    neonOff(ctx)
    R(ctx, 7, fy + 5, 2, 1, '#39414f') // mic arm
  }
  if (has(c, 'scarf')) {
    R(ctx, 5, fy + 6, 6, 2, c.scarf)
    R(ctx, 3, fy + 7, 2, 4, c.scarfDark) // tail trailing behind
  }
  if (has(c, 'jacket')) {
    R(ctx, 5, ty, 6, 1, c.topLit)
    const jc = neonOn(ctx, c.trim, tint * 0.8)
    R(ctx, 9, ty + 1, 1, 1, jc)
    neonOff(ctx)
  }
  if (has(c, 'apron')) R(ctx, 8, ty + 2, 3, g.th - 2, c.apron)
  if (has(c, 'rig')) {
    R(ctx, 6, ty, 4, 2, '#5a5146')
    R(ctx, 7, ty + 2, 1, 3, '#6a4a2a')
  }
  if (has(c, 'hardhat')) {
    R(ctx, 4, fy - 1, 8, 3, '#ffb547')
    R(ctx, 5, fy - 1, 5, 1, '#ffd089')
    R(ctx, 10, fy + 2, 3, 1, '#b97a2a') // brim forward
    R(ctx, 3, fy + 2, 1, 1, '#b97a2a')
  }
  if (has(c, 'cap')) {
    R(ctx, 4, fy - 1, 7, 2, c.cap)
    R(ctx, 10, fy + 1, 2, 1, c.capDark) // bill
  }
}

export default drawActor
