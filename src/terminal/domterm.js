// ============================================================================
// NETRUNNER · src/terminal/domterm.js — a bulletproof DOM terminal.
//
// Why not xterm.js? Its key pipeline proved flaky in this embed (keystrokes
// dropped / "bugging out"). This terminal uses a real native <input> for the
// command line — the single most reliable keyboard surface a browser has — plus
// an append-only scrollback <div>. Line editing (caret, selection, IME, repeat,
// modifiers) is the browser's job, so it cannot bug out. We just hand whole
// submitted lines to the shell and render its output.
//
// Output is text with a subset of ANSI SGR (color + bold) which we translate to
// styled spans; cursor / in-place-redraw codes are stripped (a native input
// owns the live line, so the shell never needs to repaint it).
//
//   const t = new DomTerm()
//   t.mount(el)
//   t.setPrompt(ansiPromptString)
//   t.onLine(line => { ... })          // user pressed Enter
//   t.onTab(value => completedString)  // optional tab completion
//   t.write(ansiText)                  // shell output -> scrollback
//   t.echoCommand(promptAnsi, cmd)     // echo a submitted command into scrollback
//   t.focus() / t.clear() / t.setInputEnabled(bool) / t.dispose()
// ============================================================================

const SGR_BASIC = {
  30: '#0d1322', 31: '#ff2e88', 32: '#6dff7a', 33: '#ffb547',
  34: '#4f7dff', 35: '#ff2e88', 36: '#29f3e2', 37: '#cfe3ff',
  90: '#5b6c8e', 91: '#ff5ea6', 92: '#9dffac', 93: '#ffd08a',
  94: '#8fb0ff', 95: '#ff7cc0', 96: '#7cf9ee', 97: '#eaf4ff',
}

export class DomTerm {
  constructor() {
    this.root = document.createElement('div')
    this.root.className = 'dt'

    this.scroll = document.createElement('div')
    this.scroll.className = 'dt-scroll'

    this.lineEl = document.createElement('div')
    this.lineEl.className = 'dt-line'
    this.promptEl = document.createElement('span')
    this.promptEl.className = 'dt-prompt'
    this.input = document.createElement('input')
    this.input.className = 'dt-input'
    this.input.type = 'text'
    this.input.setAttribute('autocomplete', 'off')
    this.input.setAttribute('autocapitalize', 'off')
    this.input.setAttribute('autocorrect', 'off')
    this.input.setAttribute('spellcheck', 'false')
    this.input.setAttribute('aria-label', 'terminal input')
    this.lineEl.append(this.promptEl, this.input)

    this.root.append(this.scroll, this.lineEl)

    this.history = []
    this.hp = 0
    this.draft = ''
    this._lineCb = null
    this._tabCb = null
    this._sgr = { color: null, bold: false } // SGR state carried across write() calls

    this._onKey = e => this._key(e)
    this.input.addEventListener('keydown', this._onKey)
    // Clicking anywhere in the frame refocuses the input — focus can never get
    // stranded on the canvas behind the layer.
    this._onDown = e => { if (e.target !== this.input) { e.preventDefault(); this.input.focus() } }
    this.root.addEventListener('mousedown', this._onDown)
  }

  mount(el) {
    el.innerHTML = ''
    el.appendChild(this.root)
    // focus after the layer is actually visible/laid out
    requestAnimationFrame(() => this.focus())
  }

  focus() { try { this.input.focus({ preventScroll: true }) } catch { this.input.focus() } }
  onLine(cb) { this._lineCb = cb }
  onTab(cb) { this._tabCb = cb }

  setPrompt(ansi) {
    this.promptEl.replaceChildren(...ansiToNodes(ansi, { color: null, bold: false }))
  }

  setInputEnabled(on) {
    this.input.disabled = !on
    this.lineEl.style.visibility = on ? 'visible' : 'hidden'
    if (on) this.focus()
  }

  clear() { this.scroll.replaceChildren() }

  // Append shell output, honoring SGR color/bold; strip cursor + redraw codes.
  write(str) {
    if (str == null) return
    let s = String(str)
    if (s.includes('\x1b[2J') || s.includes('\x1b[3J')) {
      this.clear()
      s = s.replace(/\x1b\[[0-9;]*J/g, '').replace(/\x1b\[H/g, '')
    }
    // drop in-place line redraws (\r + clear-to-eol) and bare CRs and cursor moves
    s = s
      .replace(/\r\x1b\[K/g, '')
      .replace(/\x1b\[\d*[A-DGK]/g, '')
      .replace(/\x1b\[\d*D/g, '')
      .replace(/\x07/g, '')
      .replace(/\r(?!\n)/g, '')
    const frag = document.createDocumentFragment()
    for (const node of ansiToNodes(s, this._sgr)) frag.appendChild(node)
    this.scroll.appendChild(frag)
    this._trim()
    this._toEnd()
  }

  writeLine(str = '') { this.write(str + '\n') }

  echoCommand(promptAnsi, cmd) {
    const row = document.createElement('div')
    row.className = 'dt-echo'
    row.append(...ansiToNodes(promptAnsi, { color: null, bold: false }))
    const c = document.createElement('span')
    c.className = 'dt-cmd'
    c.textContent = ' ' + cmd
    row.appendChild(c)
    this.scroll.appendChild(row)
    this._toEnd()
  }

  _trim() {
    // keep the scrollback bounded so long sessions stay snappy
    const max = 4000
    while (this.scroll.childNodes.length > max) this.scroll.removeChild(this.scroll.firstChild)
  }

  _toEnd() { this.scroll.scrollTop = this.scroll.scrollHeight }

  _key(e) {
    // Never let terminal keys reach the global game handler.
    e.stopPropagation()
    const k = e.key
    if (k === 'Enter') {
      e.preventDefault()
      const v = this.input.value
      this.input.value = ''
      if (v.trim() && this.history[this.history.length - 1] !== v) this.history.push(v)
      this.hp = this.history.length
      this.draft = ''
      this._lineCb && this._lineCb(v)
    } else if (k === 'ArrowUp') {
      e.preventDefault()
      if (this.hp > 0) {
        if (this.hp === this.history.length) this.draft = this.input.value
        this.hp--
        this.input.value = this.history[this.hp] || ''
        caretEnd(this.input)
      }
    } else if (k === 'ArrowDown') {
      e.preventDefault()
      if (this.hp < this.history.length) {
        this.hp++
        this.input.value = this.hp === this.history.length ? this.draft : (this.history[this.hp] || '')
        caretEnd(this.input)
      }
    } else if (k === 'Tab') {
      e.preventDefault()
      if (this._tabCb) {
        const out = this._tabCb(this.input.value)
        if (out != null) { this.input.value = out; caretEnd(this.input) }
      }
    } else if ((k === 'l' || k === 'L') && e.ctrlKey) {
      e.preventDefault()
      this.clear()
    } else if ((k === 'c' || k === 'C') && e.ctrlKey) {
      e.preventDefault()
      this.input.value = ''
      this._lineCb && this._lineCb('\x03')
    }
    // every other key (printable, backspace, arrows-left/right, home/end…) is
    // handled natively by the <input>. Nothing to do — and nothing can break.
  }

  dispose() {
    this.input.removeEventListener('keydown', this._onKey)
    this.root.removeEventListener('mousedown', this._onDown)
    this.root.remove()
    this._lineCb = this._tabCb = null
  }
}

// ---- ANSI SGR -> DOM nodes ---------------------------------------------------
// Handles: reset(0), bold(1), 38;2;r;g;b truecolor, 38;5;n (approx -> ink),
// basic 30-37/90-97, 39 (default fg). Newlines become <br>. `state` is mutated
// so color spanning multiple write() calls is preserved.
function ansiToNodes(str, state) {
  const nodes = []
  const re = /\x1b\[([0-9;]*)m/g
  let last = 0
  let m
  const emit = text => {
    if (!text) return
    const parts = text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        const span = document.createElement('span')
        if (state.color) span.style.color = state.color
        if (state.bold) span.style.fontWeight = '700'
        span.textContent = parts[i]
        nodes.push(span)
      }
      if (i < parts.length - 1) nodes.push(document.createElement('br'))
    }
  }
  while ((m = re.exec(str))) {
    emit(str.slice(last, m.index))
    applySgr(m[1], state)
    last = re.lastIndex
  }
  emit(str.slice(last))
  return nodes
}

function applySgr(params, state) {
  const codes = (params === '' ? '0' : params).split(';').map(Number)
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) { state.color = null; state.bold = false }
    else if (c === 1) state.bold = true
    else if (c === 22) state.bold = false
    else if (c === 39) state.color = null
    else if (c === 38) {
      if (codes[i + 1] === 2) { state.color = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4 }
      else if (codes[i + 1] === 5) { state.color = '#cfe3ff'; i += 2 }
    } else if (SGR_BASIC[c]) state.color = SGR_BASIC[c]
  }
}

function caretEnd(input) {
  const n = input.value.length
  try { input.setSelectionRange(n, n) } catch { /* type may not support it */ }
}
