// palette.js — per-city palettes. All values are hex strings (or rgba() for fog).
// Dark neon-noir from BRIEF.md. Three biomes share a deep blue-black DNA but diverge in mood:
//   aster      = rain neon noir (cyan/magenta on blue-black)
//   underground= warm amber + server-glow on near-black
//   forge      = industrial steam, amber + toxic-green
//
// Contract (ARCHITECTURE.md §4): PAL[city] = {bg,wall,road,neon1,neon2,accent,fog}
// Extra keys (sky, shade, glow, ink, hi) are provided for richer art and are safe to ignore.

export const PAL = {
  aster: {
    bg:    '#05060a', // deep blue-black base
    sky:   '#070a12',
    wall:  '#1a2238', // cool slab concrete
    shade: '#0e1426', // wall shadow / recess
    road:  '#0d1322', // wet asphalt
    neon1: '#29f3e2', // cyan signage
    neon2: '#ff2e88', // magenta signage
    accent:'#ffb547', // amber sodium light
    glow:  '#7ad7ff', // reflected sky on wet ground
    ink:   '#cfe3ff', // detail / text
    hi:    '#e8f4ff', // brightest highlight
    fog:   'rgba(120,150,200,0.08)'
  },

  underground: {
    bg:    '#060402', // black with a brown undertone
    sky:   '#0b0805',
    wall:  '#241a10', // dim brick / packed earth
    shade: '#140d07',
    road:  '#100a05', // dirt-dark walkway
    neon1: '#ffb547', // warm amber strip-light
    neon2: '#6dff7a', // toxic-green terminal glow
    accent:'#ff7a3c', // ember orange
    glow:  '#ffcf8a', // server / candle warmth
    ink:   '#f0dcc0', // warm parchment detail
    hi:    '#fff2dc',
    fog:   'rgba(160,120,70,0.10)'
  },

  forge: {
    bg:    '#08070a', // soot black
    sky:   '#0e0b08',
    wall:  '#2a221a', // rusted plate
    shade: '#160f0a',
    road:  '#161210', // oil-stained floor
    neon1: '#ffb547', // hazard amber
    neon2: '#6dff7a', // toxic green chemical glow
    accent:'#ff4d2e', // furnace red
    glow:  '#ffd089', // steam lit by furnace
    ink:   '#e6d6c2',
    hi:    '#fff0d8',
    fog:   'rgba(150,140,120,0.13)' // steam haze, heavier
  }
}

// Tiny helper: blend two hex colors (t in 0..1). Used by art for shading/day-night mixing.
export function mix(a, b, t) {
  const pa = hx(a), pb = hx(b)
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t)
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t)
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t)
  return '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')
}

// hex -> rgba() string, alpha 0..1. Handy for glows.
export function rgba(hex, a) {
  const [r, g, b] = hx(hex)
  return `rgba(${r},${g},${b},${a})`
}

function hx(h) {
  let s = h.replace('#', '')
  if (s.length === 3) s = s.split('').map(c => c + c).join('')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

export default PAL
