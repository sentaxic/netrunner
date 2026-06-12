// portraits.js — expressive dialogue busts, drawn as code at 32×40 native pixels
// and blitted up with crisp nearest-neighbour scaling.
//
// Contract (ARCHITECTURE.md §4):
//   export function drawPortrait(ctx, id, x, y, scale, emotion)
//   ids: 'a' 'b' 'c' 'sister' 'glitch' 'vex' 'boss_forge' 'kernel'
//   emotion: 'neutral' | 'happy' | 'worried' | 'angry' | 'glitch'
//   (also honored: 'fade' — the erasure motif, made for Mara but works on anyone)
//
// kernel is abstract geometric light. It has no face. That is the point.

import { PAL, mix, rgba } from './palette.js'
import { ACTORS } from './sprites.js'

const PW = 32, PH = 40

// lazy offscreen working canvas: portrait drawn native-res, then scaled in one blit
let oc = null, og = null
function off() {
  if (!oc) {
    oc = document.createElement('canvas')
    oc.width = PW
    oc.height = PH
    og = oc.getContext('2d')
    og.imageSmoothingEnabled = false
  }
  return og
}

function R(o, x, y, w, h, c) { o.fillStyle = c; o.fillRect(x, y, w, h) }

// ---------------------------------------------------------------- shared anatomy
// head x8..23 (16 wide), y5..22 · eyes y14 · mouth y21 · shoulders from y28
function bust(o, top, topDark, topLit) {
  R(o, 8, 28, 16, 2, top)
  R(o, 5, 30, 22, 2, top)
  R(o, 3, 32, 26, 8, top)
  R(o, 3, 32, 2, 8, topDark)
  R(o, 27, 32, 2, 8, topDark)
  R(o, 5, 30, 22, 1, topLit)
}

function neck(o, skin, shade) {
  R(o, 13, 22, 6, 7, skin)
  R(o, 13, 22, 6, 2, shade) // jaw shadow
}

function head(o, skin, shade) {
  R(o, 8, 5, 16, 18, skin)
  R(o, 9, 4, 14, 1, skin)
  R(o, 9, 23, 14, 1, skin)          // chin
  R(o, 21, 6, 3, 17, shade)         // form shadow, right side
  R(o, 6, 12, 2, 4, skin)           // ears
  R(o, 24, 12, 2, 4, shade)
}

// ---------------------------------------------------------------- the face
// c: {skin, shade, brow, lip, smirk?}  em: emotion string
function face(o, c, em) {
  const WHITE = '#e9f0fb', PUPIL = '#10141f'
  const brow = c.brow, lip = c.lip

  // ---- eyes
  if (em === 'angry') {
    R(o, 11, 15, 3, 1, WHITE); R(o, 12, 15, 1, 1, PUPIL)
    R(o, 18, 15, 3, 1, WHITE); R(o, 19, 15, 1, 1, PUPIL)
  } else if (em === 'happy') {
    R(o, 11, 14, 3, 2, WHITE); R(o, 12, 14, 1, 1, PUPIL)
    R(o, 18, 14, 3, 2, WHITE); R(o, 19, 14, 1, 1, PUPIL)
    R(o, 11, 16, 3, 1, c.shade)     // lifted lower lids
    R(o, 18, 16, 3, 1, c.shade)
  } else {
    R(o, 11, 14, 3, 2, WHITE); R(o, 12, 14, 1, 2, PUPIL)
    R(o, 18, 14, 3, 2, WHITE); R(o, 19, 14, 1, 2, PUPIL)
  }

  // ---- brows
  if (em === 'angry') {
    R(o, 11, 11, 1, 1, brow); R(o, 12, 12, 1, 1, brow); R(o, 13, 13, 1, 1, brow)
    R(o, 20, 11, 1, 1, brow); R(o, 19, 12, 1, 1, brow); R(o, 18, 13, 1, 1, brow)
    R(o, 11, 12, 1, 1, brow); R(o, 20, 12, 1, 1, brow)
  } else if (em === 'worried' || em === 'glitch') {
    R(o, 11, 13, 1, 1, brow); R(o, 12, 12, 2, 1, brow)
    R(o, 18, 12, 2, 1, brow); R(o, 20, 13, 1, 1, brow)
  } else if (em === 'happy') {
    R(o, 11, 11, 3, 1, brow); R(o, 18, 11, 3, 1, brow)
  } else {
    R(o, 11, 12, 3, 1, brow); R(o, 18, 12, 3, 1, brow)
  }

  // ---- nose
  R(o, 16, 17, 1, 2, c.shade)

  // ---- mouth
  if (em === 'happy') {
    R(o, 12, 20, 1, 1, lip); R(o, 19, 20, 1, 1, lip)
    R(o, 13, 21, 6, 1, '#efe6da')   // open smile, teeth
    R(o, 13, 22, 6, 1, lip)
  } else if (em === 'angry') {
    R(o, 12, 21, 8, 2, '#2a1016')   // gritted
    R(o, 13, 21, 6, 1, '#d8cfc2')
    R(o, 12, 20, 1, 1, lip); R(o, 19, 20, 1, 1, lip)
  } else if (em === 'worried' || em === 'glitch') {
    R(o, 14, 21, 4, 1, lip)
    R(o, 13, 22, 1, 1, lip); R(o, 18, 22, 1, 1, lip) // corners down
  } else if (c.smirk) {
    R(o, 13, 21, 5, 1, lip); R(o, 18, 20, 1, 1, lip) // one corner knows something
  } else {
    R(o, 13, 21, 6, 1, lip)
  }
}

function faceCfg(a) {
  return {
    skin: a.skin,
    shade: a.skinShade,
    brow: a.hairDark || mix(a.hair, '#000000', 0.3),
    lip: mix(a.skin, '#5a2030', 0.55)
  }
}

// ---------------------------------------------------------------- painters
function pPlayer(o, em, a) {
  const hoodDark = mix(a.top, '#000000', 0.35)
  bust(o, a.top, hoodDark, a.topLit)
  // hood bunched on the shoulders, raised around the head
  R(o, 4, 24, 24, 6, a.top)
  R(o, 4, 24, 24, 1, hoodDark)
  R(o, 5, 2, 22, 4, a.top)
  R(o, 5, 5, 3, 18, a.top)
  R(o, 24, 5, 3, 18, a.top)
  R(o, 24, 6, 3, 17, hoodDark)
  neck(o, a.skin, a.skinShade)
  head(o, a.skin, a.skinShade)
  R(o, 9, 5, 14, 3, a.hair)                       // fringe under the hood
  R(o, 9, 8, 3, 1, a.hair); R(o, 19, 8, 4, 1, a.hair)
  // glowing hood rim — the player's signature
  o.save()
  o.shadowColor = a.trim
  o.shadowBlur = 5
  o.fillStyle = mix(a.trim, '#ffffff', 0.25)
  o.fillRect(7, 4, 1, 16)
  o.fillRect(24, 4, 1, 16)
  o.fillRect(7, 3, 18, 1)
  o.restore()
  // headset earcup + mic
  R(o, 4, 12, 3, 6, '#10141f')
  o.save(); o.shadowColor = a.trim; o.shadowBlur = 3
  R(o, 5, 14, 1, 2, a.trim)
  o.restore()
  R(o, 6, 19, 5, 1, '#39414f')
  R(o, 11, 19, 1, 1, a.trim)
  // hoodie front: zipper + drawcords
  R(o, 15, 30, 2, 10, hoodDark)
  R(o, 11, 29, 1, 5, mix(a.trim, a.top, 0.5))
  R(o, 20, 29, 1, 5, mix(a.trim, a.top, 0.5))
  face(o, faceCfg(a), em)
}

function pSister(o, em) {
  const a = ACTORS.sister
  const hairLit = mix(a.hair, '#ffffff', 0.18)
  // hair mass behind everything, spilling past the shoulders
  R(o, 5, 3, 22, 28, a.hair)
  R(o, 4, 8, 2, 18, a.hair)
  R(o, 26, 8, 2, 18, a.hairDark)
  bust(o, a.top, mix(a.top, '#000000', 0.35), mix(a.top, '#ffffff', 0.16))
  R(o, 4, 26, 5, 12, a.hair)                      // strands over the shoulders
  R(o, 23, 26, 5, 12, a.hairDark)
  neck(o, a.skin, a.skinShade)
  head(o, a.skin, a.skinShade)
  // parted fringe
  R(o, 8, 4, 7, 4, a.hair)
  R(o, 17, 4, 7, 4, a.hair)
  R(o, 15, 4, 2, 2, a.hairDark)                   // the part
  R(o, 8, 8, 2, 4, a.hair); R(o, 22, 8, 2, 4, a.hairDark)
  R(o, 9, 4, 5, 1, hairLit)                       // shine
  // warm scarf, knotted
  R(o, 8, 25, 16, 5, a.scarf)
  R(o, 8, 25, 16, 1, mix(a.scarf, '#ffffff', 0.2))
  R(o, 17, 29, 5, 4, a.scarfDark)
  R(o, 18, 33, 3, 4, a.scarf)
  // tiny amber earring — the detail he remembers
  o.save(); o.shadowColor = '#ffb547'; o.shadowBlur = 3
  R(o, 6, 16, 1, 2, '#ffb547')
  o.restore()
  const c = faceCfg(a)
  face(o, c, em)
  if (em === 'happy') {                            // blush
    o.globalAlpha = 0.4
    R(o, 9, 17, 2, 1, '#ff6a8a'); R(o, 20, 17, 2, 1, '#ff6a8a')
    o.globalAlpha = 1
  }
}

function pGlitch(o, em) {
  const a = ACTORS.glitch
  const coat = '#10141f', coatLit = '#1d2434'
  bust(o, coat, '#090c13', coatLit)
  // high collar climbing past the jaw
  R(o, 4, 20, 6, 10, coat); R(o, 4, 20, 6, 1, coatLit); R(o, 9, 20, 1, 10, '#090c13')
  R(o, 22, 20, 6, 10, coat); R(o, 22, 20, 6, 1, coatLit); R(o, 22, 20, 1, 10, '#090c13')
  neck(o, a.skin, a.skinShade)
  head(o, a.skin, a.skinShade)
  // short dark hair, swept
  R(o, 8, 3, 16, 4, a.hair)
  R(o, 8, 7, 3, 3, a.hair); R(o, 21, 7, 3, 3, a.hairDark)
  R(o, 10, 3, 9, 1, mix(a.hair, '#8a93a5', 0.25))
  // old scar down the cheek
  R(o, 22, 17, 1, 4, mix(a.skin, '#7a2a3a', 0.5))
  // the visor: a cyan band where eyes should be
  R(o, 8, 12, 16, 5, '#070b12')
  o.save()
  o.shadowColor = a.trim
  o.shadowBlur = 6
  o.fillStyle = a.trim
  if (em === 'angry') {
    o.fillRect(11, 15, 3, 1); o.fillRect(12, 14, 2, 1)   // slanted glare glyphs
    o.fillRect(18, 14, 2, 1); o.fillRect(18, 15, 3, 1)
  } else if (em === 'happy') {
    o.fillRect(11, 13, 3, 1); o.fillRect(11, 14, 1, 1); o.fillRect(13, 14, 1, 1)
    o.fillRect(18, 13, 3, 1); o.fillRect(18, 14, 1, 1); o.fillRect(20, 14, 1, 1)
  } else if (em === 'worried' || em === 'glitch') {
    o.fillRect(12, 14, 1, 2); o.fillRect(19, 14, 1, 2)   // pinpricks
  } else {
    o.fillRect(11, 13, 3, 2); o.fillRect(18, 13, 3, 2)
  }
  o.restore()
  o.globalAlpha = 0.25
  R(o, 9, 12, 4, 1, '#cfe3ff')                    // glass streak
  o.globalAlpha = 1
  // stubble
  o.globalAlpha = 0.5
  for (let i = 0; i < 8; i++) R(o, 10 + ((i * 5) % 11), 20 + (i % 3), 1, 1, a.skinShade)
  o.globalAlpha = 1
  // mouth only — the visor does the rest of the talking
  const c = faceCfg(a)
  if (em === 'happy') { R(o, 13, 21, 5, 1, c.lip); R(o, 12, 20, 1, 1, c.lip); R(o, 18, 20, 1, 1, c.lip) }
  else if (em === 'angry') { R(o, 12, 21, 8, 1, '#2a1016'); R(o, 13, 21, 6, 1, '#bfb6aa') }
  else if (em === 'worried' || em === 'glitch') { R(o, 14, 21, 4, 1, c.lip); R(o, 13, 22, 1, 1, c.lip) }
  else R(o, 13, 21, 5, 1, c.lip)
  R(o, 16, 17, 1, 2, a.skinShade)                 // nose
}

function pVex(o, em) {
  const a = ACTORS.vex
  bust(o, a.top, mix(a.top, '#000000', 0.35), mix(a.top, '#ffffff', 0.16))
  // razor shoulders
  R(o, 1, 29, 6, 3, a.top); R(o, 1, 29, 6, 1, mix(a.top, '#ffffff', 0.25))
  R(o, 25, 29, 6, 3, a.top); R(o, 25, 29, 6, 1, mix(a.top, '#ffffff', 0.25))
  // lapel V + dark undershirt
  R(o, 13, 30, 6, 10, '#0c0a14')
  R(o, 11, 30, 2, 8, mix(a.top, '#ffffff', 0.12))
  R(o, 19, 30, 2, 8, mix(a.top, '#ffffff', 0.12))
  neck(o, a.skin, a.skinShade)
  head(o, a.skin, a.skinShade)
  // slick white hair, swept hard back
  R(o, 8, 2, 16, 4, a.hair)
  R(o, 22, 4, 4, 8, a.hair)
  R(o, 24, 5, 2, 7, '#b8bdcc')
  R(o, 8, 6, 2, 2, a.hair)
  R(o, 15, 6, 2, 1, a.hair)                       // widow's peak
  R(o, 9, 2, 10, 1, '#ffffff')                    // shine
  // magenta studs down the collar
  o.save(); o.shadowColor = a.trim; o.shadowBlur = 4
  o.fillStyle = a.trim
  o.fillRect(10, 31, 1, 1); o.fillRect(8, 34, 1, 1)
  o.fillRect(21, 31, 1, 1); o.fillRect(23, 34, 1, 1)
  o.fillRect(25, 16, 1, 2)                        // earring
  o.restore()
  const c = faceCfg(a)
  c.brow = '#9aa2b5'
  c.smirk = true
  face(o, c, em)
}

function pBossForge(o, em) {
  const a = ACTORS.boss_forge
  const jacket = a.top, jacketD = mix(a.top, '#000000', 0.35)
  bust(o, jacket, jacketD, mix(a.top, '#ffffff', 0.14))
  // rig shoulder plates + crossing strap with buckle
  R(o, 2, 28, 7, 4, '#5a5146'); R(o, 2, 28, 7, 1, '#766b5c')
  R(o, 23, 28, 7, 4, '#5a5146'); R(o, 23, 28, 7, 1, '#766b5c')
  for (let i = 0; i < 10; i++) R(o, 8 + i, 31 + i, 2, 1, '#6a4a2a')
  for (let i = 0; i < 10; i++) R(o, 22 - i, 31 + i, 2, 1, '#5c401f')
  R(o, 14, 35, 4, 3, '#8a8378'); R(o, 15, 36, 2, 1, '#39414f')
  // thick neck, wide head, heavy jaw
  R(o, 12, 22, 8, 7, a.skin); R(o, 12, 22, 8, 2, a.skinShade)
  R(o, 7, 5, 18, 18, a.skin)
  R(o, 8, 23, 16, 2, a.skin)                      // jaw mass
  R(o, 22, 6, 3, 19, a.skinShade)
  R(o, 5, 13, 2, 4, a.skin); R(o, 25, 13, 2, 4, a.skinShade)
  // stubble field
  o.globalAlpha = 0.45
  for (let i = 0; i < 14; i++) R(o, 9 + ((i * 7) % 14), 19 + ((i * 3) % 5), 1, 1, a.skinShade)
  o.globalAlpha = 1
  // hardhat + brim, scuffed
  R(o, 6, 2, 20, 5, '#ffb547')
  R(o, 8, 1, 16, 2, '#ffd089')
  R(o, 4, 7, 24, 2, '#b97a2a')
  R(o, 10, 3, 4, 1, '#8a5a1e')                    // dent
  R(o, 8, 9, 16, 1, a.skinShade)                  // brim shadow on the brow
  // heavy brows regardless of mood, angled by it
  const c = faceCfg(a)
  face(o, c, em)
  R(o, 10, em === 'angry' ? 12 : 11, 4, 1, c.brow)
  R(o, 18, em === 'angry' ? 12 : 11, 4, 1, c.brow)
  // grease smudge
  o.globalAlpha = 0.3
  R(o, 9, 18, 3, 1, '#2a2018')
  o.globalAlpha = 1
}

// THE KERNEL — geometry pretending to be a mind. No face. Reads your save file instead.
function pKernel(o, em) {
  const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000
  let col = PAL.aster.neon1
  if (em === 'angry') col = '#ff2e58'
  else if (em === 'worried') col = '#ffb547'
  else if (em === 'happy') col = '#6dff7a'
  const col2 = mix(col, '#ffffff', 0.35)

  // faint carrier beam down the whole bust
  o.fillStyle = rgba(col, 0.07)
  o.fillRect(14, 0, 4, PH)
  o.fillRect(6, 34, 20, 1)

  o.save()
  o.translate(16, 18)
  o.lineWidth = 1

  // outer diamond, slow spin
  o.save(); o.rotate(t * 0.35 + Math.PI / 4)
  o.strokeStyle = rgba(col, 0.8); o.shadowColor = col; o.shadowBlur = 6
  o.strokeRect(-9.5, -9.5, 19, 19)
  o.restore()

  // mid square, counter-spin
  o.save(); o.rotate(-t * 0.55)
  o.strokeStyle = rgba(col2, 0.85); o.shadowColor = col; o.shadowBlur = 4
  o.strokeRect(-6, -6, 12, 12)
  o.restore()

  // inner triangle, fast
  o.save(); o.rotate(t * 0.9)
  o.strokeStyle = rgba(col2, 0.9); o.shadowColor = col2; o.shadowBlur = 4
  o.beginPath()
  for (let i = 0; i < 3; i++) {
    const a2 = i * (Math.PI * 2 / 3) - Math.PI / 2
    const px2 = Math.cos(a2) * 4.5, py2 = Math.sin(a2) * 4.5
    i === 0 ? o.moveTo(px2, py2) : o.lineTo(px2, py2)
  }
  o.closePath(); o.stroke()
  o.restore()

  // the core — too bright to look at
  o.shadowColor = col; o.shadowBlur = 9
  o.fillStyle = mix(col, '#ffffff', 0.75)
  o.fillRect(-2, -2, 4, 4)
  o.fillStyle = '#ffffff'
  o.fillRect(-1, -1, 2, 2)

  // orbiting process dots
  o.shadowBlur = 3
  for (let i = 0; i < 3; i++) {
    const a3 = t * 1.3 + i * (Math.PI * 2 / 3)
    o.fillStyle = i === 1 ? PAL.aster.neon2 : col
    o.fillRect(Math.round(Math.cos(a3) * 13) - 1, Math.round(Math.sin(a3) * 13 * 0.8), 1, 1)
  }
  o.restore()

  if (em === 'glitch') {                          // it stutters when it lies
    for (let i = 0; i < 4; i++) {
      const yy = (Math.random() * PH) | 0
      o.globalAlpha = 0.5
      R(o, ((Math.random() * 10) | 0), yy, 12 + ((Math.random() * 10) | 0), 1,
        Math.random() < 0.5 ? col : PAL.aster.neon2)
      o.globalAlpha = 1
    }
  }
}

const PAINTERS = {
  a: (o, em) => pPlayer(o, em, ACTORS.a),
  b: (o, em) => pPlayer(o, em, ACTORS.b),
  c: (o, em) => pPlayer(o, em, ACTORS.c),
  sister: pSister,
  glitch: pGlitch,
  vex: pVex,
  boss_forge: pBossForge,
  kernel: pKernel
}

export const PORTRAIT_IDS = Object.keys(PAINTERS)

// ---------------------------------------------------------------- drawPortrait
export function drawPortrait(ctx, id, x, y, scale, emotion) {
  const paint = PAINTERS[id] || PAINTERS.a
  const em = emotion || 'neutral'
  const s = scale || 2
  const o = off()
  o.clearRect(0, 0, PW, PH)
  // 'fade'/'glitch' corrupt the BLIT; the face underneath goes worried
  const faceEm = (em === 'fade') ? 'worried' : em
  paint(o, faceEm)

  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.save()

  if (em === 'fade') {
    // the erasure motif: she's still here, but the world disagrees
    const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000
    const base = 0.5 + 0.08 * Math.sin(now * 2.6)
    // cyan ghost echo, slightly displaced
    ctx.globalAlpha = 0.14
    ctx.drawImage(oc, x + Math.round(s), y, PW * s, PH * s)
    // body drawn row by row; some rows just... aren't there anymore
    for (let r = 0; r < PH; r++) {
      const gap = Math.sin(r * 1.7 + now * 3.2) > 0.82
      ctx.globalAlpha = gap ? base * 0.15 : base * (0.8 + 0.2 * Math.sin(r * 0.6 + now))
      ctx.drawImage(oc, 0, r, PW, 1, x, y + r * s, PW * s, s)
    }
    ctx.globalAlpha = 1
  } else if (em === 'glitch') {
    const amt = 0.7
    ctx.drawImage(oc, x, y, PW * s, PH * s)
    for (let i = 0; i < 6; i++) {                  // sliced re-blits with chroma fringe
      const sy = (Math.random() * PH) | 0
      const sh = 1 + ((Math.random() * 4) | 0)
      const offp = Math.round((Math.random() - 0.5) * 2 * amt * s * 4)
      ctx.drawImage(oc, 0, sy, PW, Math.min(sh, PH - sy),
        x + offp, y + sy * s, PW * s, Math.min(sh, PH - sy) * s)
      if (Math.random() < 0.6) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.12
        ctx.fillStyle = Math.random() < 0.5 ? '#ff2e88' : '#29f3e2'
        ctx.fillRect(x + offp, y + sy * s, PW * s, Math.min(sh, PH - sy) * s)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    }
    if (Math.random() < 0.25) {                    // a band drops out entirely
      ctx.clearRect(x, y + ((Math.random() * (PH - 4)) | 0) * s, PW * s, 2 * s)
    }
  } else {
    ctx.drawImage(oc, x, y, PW * s, PH * s)
  }

  ctx.restore()
  ctx.imageSmoothingEnabled = prevSmooth
}

export default drawPortrait
