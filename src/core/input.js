// Keyboard input. Actions are abstract; scenes poll isDown/wasPressed each frame.
// While the jack-in terminal owns the keyboard, call input.suspend(true).
const down = new Set()
const pressed = new Set()

const MAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  confirm: ['Enter', 'KeyZ', 'Space'],
  cancel: ['Escape', 'KeyX'],
  menu: ['KeyI'],
  map: ['KeyM'],
  run: ['ShiftLeft', 'ShiftRight'],
}

export const input = {
  suspended: false,
  init() {
    addEventListener('keydown', e => { if (!e.repeat) { down.add(e.code); pressed.add(e.code) } })
    addEventListener('keyup', e => down.delete(e.code))
    addEventListener('blur', () => down.clear())
  },
  suspend(on) { this.suspended = on; if (on) { down.clear(); pressed.clear() } },
  isDown(action) { return !this.suspended && (MAP[action] || [action]).some(c => down.has(c)) },
  wasPressed(action) { return !this.suspended && (MAP[action] || [action]).some(c => pressed.has(c)) },
  dir() {
    return {
      x: (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0),
      y: (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0),
    }
  },
  endFrame() { pressed.clear() },
}
