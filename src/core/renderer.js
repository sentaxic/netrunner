// Fixed 480x270 pixel canvas, integer-scaled to the window. 16px tiles -> 30x17 tiles visible.
export const VIEW_W = 480
export const VIEW_H = 270

let canvas, ctx

export function initRenderer(c) {
  canvas = c
  canvas.width = VIEW_W
  canvas.height = VIEW_H
  ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const fit = () => {
    const s = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H)))
    canvas.style.width = VIEW_W * s + 'px'
    canvas.style.height = VIEW_H * s + 'px'
  }
  addEventListener('resize', fit)
  fit()
  return ctx
}

export function getCtx() { return ctx }

// Main loop helper. cb(dt seconds [clamped to 50ms], t seconds since origin).
export function frame(cb) {
  let last = performance.now()
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    cb(dt, now / 1000)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

export function setCRT(on) { document.body.classList.toggle('crt', !!on) }
