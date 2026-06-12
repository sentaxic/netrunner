// ============================================================================
// NETRUNNER · src/terminal/sim-shell.js — pure-JS POSIX-ish shell over an
// in-memory filesystem. The always-available jack-in backend: no cross-origin
// isolation, no network, boots instantly. ARCHITECTURE.md §9.
//
//   new SimShell(fs, opts?)   fs = nested {name: {...children} | "contents"}
//                             file w/ metadata: {__file:"contents", __perms:"-rw-------", __date:"Jun  7 03:14"}
//                             dir  w/ metadata: {__perms:"drwx------", ...children}
//                             opts = {host, user, hosts:{hostname: fsSpec|{user,fs}}, cwd}
//
//   shell.onOutput(cb)        cb(str) receives terminal-ready output (CRLF, ANSI)
//   shell.input(data)         feed raw xterm key data (printable, \x7f, ESC seqs,
//                             Tab, Ctrl-C/D/L/A/E/U/K/W, Enter)
//   shell.prompt()            print the prompt (backend calls once after wiring)
//   shell.resize(cols, rows)  hint for listing widths
//   shell.drainNoise()        heat units accrued since last drain (jackin meter)
//   shell.state               snapshot the mission check() reads: {cwd, lastExit,
//                             history, readFiles, dbState, exited, noiseTotal,
//                             exists(p), isFile(p), isDir(p), readFile(p), snapshot()}
//   shell.dispose()
//
// Emits nothing on the bus — jackin.js drives it through backend.js.
// All hosts/targets are fictional and fully sandboxed in memory.
// ============================================================================

import { openDB, query } from '../data/db.js'

// ---- ANSI helpers ----------------------------------------------------------
const A = {
  reset: '\x1b[0m',
  cyan: '\x1b[38;2;41;243;226m',
  magenta: '\x1b[38;2;255;46;136m',
  amber: '\x1b[38;2;255;181;71m',
  green: '\x1b[38;2;109;255;122m',
  dim: '\x1b[38;2;120;150;200m',
  red: '\x1b[1;31m',
  bold: '\x1b[1m',
}

const DEFAULT_FILE_PERMS = '-rw-r--r--'
const DEFAULT_DIR_PERMS = 'drwxr-xr-x'
const DEFAULT_DATE = 'Jun  9 21:30'
const HIST_MAX = 200

// ---- FS spec normalization --------------------------------------------------
function makeFile(content, perms, date) {
  return { type: 'file', content: String(content), perms: perms || DEFAULT_FILE_PERMS, date: date || DEFAULT_DATE }
}

function isFileSpec(v) {
  return v && typeof v === 'object' && typeof v.__file === 'string'
}

function normalizeDir(spec, perms, date) {
  const node = {
    type: 'dir',
    perms: perms || (spec && spec.__perms) || DEFAULT_DIR_PERMS,
    date: date || (spec && spec.__date) || DEFAULT_DATE,
    children: new Map(),
  }
  if (!spec || typeof spec !== 'object') return node
  for (const key of Object.keys(spec)) {
    if (key === '__perms' || key === '__date') continue
    const v = spec[key]
    if (typeof v === 'string') node.children.set(key, makeFile(v))
    else if (isFileSpec(v)) node.children.set(key, makeFile(v.__file, v.__perms, v.__date))
    else if (v && typeof v === 'object') node.children.set(key, normalizeDir(v))
  }
  return node
}

function snapDir(node) {
  if (node.type === 'file') return node.content
  const o = {}
  for (const [k, v] of node.children) o[k] = snapDir(v)
  return o
}

function globToRegex(pat) {
  const src = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${src}$`)
}

const canRead = n => !n.perms || n.perms[1] === 'r'
const canWrite = n => !n.perms || n.perms[2] === 'w'

// ---- line lexer (quotes, |, >, >>) ------------------------------------------
// Tokens: {t:text, q:wasQuoted, op:null|'|'|'>'|'>>'} — quoted tokens are never
// glob-expanded; ops split pipelines / mark redirection.
function lexLine(line) {
  const toks = []
  let cur = '', q = null, started = false, quoted = false
  const flush = () => { if (started) toks.push({ t: cur, q: quoted, op: null }); cur = ''; started = false; quoted = false }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === q) q = null
      else cur += ch
      continue
    }
    if (ch === "'" || ch === '"') { q = ch; started = true; quoted = true; continue }
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; started = true; continue }
    if (ch === ' ' || ch === '\t') { flush(); continue }
    if (ch === '|') { flush(); toks.push({ t: '|', q: false, op: '|' }); continue }
    if (ch === '>') {
      flush()
      if (line[i + 1] === '>') { toks.push({ t: '>>', q: false, op: '>>' }); i++ } else toks.push({ t: '>', q: false, op: '>' })
      continue
    }
    cur += ch; started = true
  }
  flush()
  return toks
}

// ---- man pages ---------------------------------------------------------------
const MAN = {
  ls: `LS(1)                            Deck Commands

NAME
    ls - list directory contents

SYNOPSIS
    ls [-a] [-l] [path...]

DESCRIPTION
    List information about files (the current directory by default).
    Entries whose names begin with '.' are hidden unless -a is given.

OPTIONS
    -a    do not ignore entries starting with .
    -l    use a long listing format (permissions, owner, size, date)

EXAMPLES
    ls -a          show everything, including dotfiles
    ls -la /etc    long listing of /etc, hidden entries included`,
  cd: `CD(1)                            Deck Commands

NAME
    cd - change the working directory

SYNOPSIS
    cd [dir]

DESCRIPTION
    Change the current directory to dir. With no argument, change to the
    home directory. 'cd -' returns to the previous directory.
    '..' is the parent directory, '.' is the current one, '~' is home.`,
  pwd: `PWD(1)                           Deck Commands

NAME
    pwd - print name of current working directory

SYNOPSIS
    pwd

DESCRIPTION
    Print the full path of the current working directory.`,
  cat: `CAT(1)                           Deck Commands

NAME
    cat - concatenate files and print on the standard output

SYNOPSIS
    cat [file...]

DESCRIPTION
    Concatenate file(s) to standard output. With no file, read standard
    input (useful at the end of a pipe).

EXAMPLES
    cat notes.txt
    cat a.txt b.txt > merged.txt`,
  echo: `ECHO(1)                          Deck Commands

NAME
    echo - display a line of text

SYNOPSIS
    echo [-n] [string...]

DESCRIPTION
    Echo the string(s) to standard output.

OPTIONS
    -n    do not output the trailing newline

EXAMPLES
    echo bearing replaced > maintenance/ack_2104`,
  grep: `GREP(1)                          Deck Commands

NAME
    grep - print lines that match patterns

SYNOPSIS
    grep [-i] [-n] [-r] pattern [file...]

DESCRIPTION
    Search for pattern in each file (or standard input). Pattern is a
    regular expression; if it does not compile it is matched literally.

OPTIONS
    -i    ignore case distinctions
    -n    prefix each matching line with its line number
    -r    read all files under each directory, recursively

EXAMPLES
    grep -i kernel /var/log/auth.log
    grep -rn 7741 ~/notes`,
  find: `FIND(1)                          Deck Commands

NAME
    find - search for files in a directory hierarchy

SYNOPSIS
    find [path...] [-name pattern] [-type f|d]

DESCRIPTION
    Walk the file tree rooted at each path (default: .) and print every
    entry that matches all given tests.

OPTIONS
    -name pattern   base name matches shell pattern (* and ? wildcards)
    -type f|d       entry is a regular file (f) or directory (d)

EXAMPLES
    find / -name '*.log'
    find ~ -type d`,
  head: `HEAD(1)                          Deck Commands

NAME
    head - output the first part of files

SYNOPSIS
    head [-n N] [file...]

DESCRIPTION
    Print the first 10 lines of each file (or standard input).

OPTIONS
    -n N    print the first N lines instead of 10`,
  tail: `TAIL(1)                          Deck Commands

NAME
    tail - output the last part of files

SYNOPSIS
    tail [-n N] [file...]

DESCRIPTION
    Print the last 10 lines of each file (or standard input).

OPTIONS
    -n N    print the last N lines instead of 10

EXAMPLES
    tail -n 3 /var/log/auth.log`,
  cp: `CP(1)                            Deck Commands

NAME
    cp - copy files and directories

SYNOPSIS
    cp [-r] source... dest

DESCRIPTION
    Copy source to dest, or multiple sources into the directory dest.

OPTIONS
    -r    copy directories recursively`,
  mv: `MV(1)                            Deck Commands

NAME
    mv - move (rename) files

SYNOPSIS
    mv source... dest

DESCRIPTION
    Rename source to dest, or move source(s) into the directory dest.`,
  rm: `RM(1)                            Deck Commands

NAME
    rm - remove files or directories

SYNOPSIS
    rm [-r] [-f] file...

DESCRIPTION
    Remove each specified file. Directories require -r.

OPTIONS
    -r    remove directories and their contents recursively
    -f    ignore nonexistent files, never prompt

CAUTION
    There is no undelete on a deck. There is rarely one anywhere else.`,
  mkdir: `MKDIR(1)                         Deck Commands

NAME
    mkdir - make directories

SYNOPSIS
    mkdir [-p] dir...

OPTIONS
    -p    make parent directories as needed; no error if existing`,
  touch: `TOUCH(1)                         Deck Commands

NAME
    touch - create empty files / update timestamps

SYNOPSIS
    touch file...

DESCRIPTION
    Create each file that does not exist, empty.`,
  chmod: `CHMOD(1)                         Deck Commands

NAME
    chmod - change file mode bits

SYNOPSIS
    chmod [-R] mode file...

DESCRIPTION
    Change the permissions of each file. Mode is either an octal number
    (e.g. 600, 755) or symbolic (e.g. +x, u+rw, go-r).

OPTIONS
    -R    operate recursively

EXAMPLES
    chmod 600 .mara/whereami     owner read/write only
    chmod +x runme.sh`,
  whoami: `WHOAMI(1)                        Deck Commands

NAME
    whoami - print effective user name

SYNOPSIS
    whoami`,
  ps: `PS(1)                            Deck Commands

NAME
    ps - report a snapshot of current processes

SYNOPSIS
    ps

DESCRIPTION
    Print the process table of this host. Worth a look: anything you do
    not recognize may be looking back at you.`,
  history: `HISTORY(1)                       Deck Commands

NAME
    history - display the command history list

SYNOPSIS
    history

DESCRIPTION
    Numbered list of commands entered this session. Remember: a host's
    history file is exactly how OTHER people find out what YOU did.`,
  clear: `CLEAR(1)                         Deck Commands

NAME
    clear - clear the terminal screen

SYNOPSIS
    clear`,
  help: `HELP(1)                          Deck Commands

NAME
    help - list available deck commands

SYNOPSIS
    help`,
  man: `MAN(1)                           Deck Commands

NAME
    man - reference manuals

SYNOPSIS
    man command

DESCRIPTION
    Display the manual page for a command. Every command on this deck is
    documented. Reading is free; guessing costs trace heat.`,
  sql: `SQL(1)                           Deck Commands

NAME
    sql - open a query bridge to a corp database

SYNOPSIS
    sql <corp>

DESCRIPTION
    Open an interactive SQL session against a corp host. Statements end
    with ';'. Known corp hosts: aster_hr, grid_rbac, forge_erp.

SESSION COMMANDS
    .tables           list tables and views
    .schema [table]   show CREATE statements
    .help             session help
    .quit             disconnect

EXAMPLES
    sql grid_rbac
      SELECT * FROM access_log WHERE actor='KERNEL';`,
  ssh: `SSH(1)                           Deck Commands

NAME
    ssh - connect to a sibling host

SYNOPSIS
    ssh [user@]hostname

DESCRIPTION
    Open a session on another reachable host. 'exit' or Ctrl-D returns
    to the previous host. /etc/hosts usually knows who is reachable.`,
  exit: `EXIT(1)                          Deck Commands

NAME
    exit - leave the current session

SYNOPSIS
    exit

DESCRIPTION
    Close the current ssh session, or — at the top level — jack out of
    the link entirely. Voluntary disconnects are clean disconnects.`,
}

const HELP_TEXT = `deck commands — 'man <cmd>' for the full page:
  ls cd pwd cat echo grep find head tail        look around, read, search
  cp mv rm mkdir touch chmod                    move, make, remove, permit
  whoami ps history clear                       who/what/when
  sql <corp>                                    query bridge (aster_hr, grid_rbac, forge_erp)
  ssh [user@]host                               hop to a sibling host
  exit                                          leave session / jack out
pipes and redirection work:  grep KERNEL log | head -n 5,  echo hi > note.txt`

// ============================================================================
export class SimShell {
  constructor(fs, opts = {}) {
    this.user = opts.user || 'runner'
    this.host = opts.host || 'deck-local'
    this.root = normalizeDir(fs || {})
    this.hostsSpec = opts.hosts || {}
    this._hostCache = new Map()
    this.sshStack = []

    const home = `/home/${this.user}`
    this.cwdPath = opts.cwd && this._node(opts.cwd) ? opts.cwd
      : this._node(home) ? home : '/'
    this.oldCwd = this.cwdPath

    this.cbs = []
    this.buffer = ''
    this.cursor = 0
    this.hist = []
    this.histIdx = null
    this.histSaved = ''
    this.cols = 80
    this.busy = false
    this.exited = false
    this.lastExit = 0
    this.readFiles = new Set()
    this.dbState = {}
    this._noise = 0
    this.noiseTotal = 0

    this.mode = 'shell'        // 'shell' | 'sql'
    this.sql = null            // {corp, db, buf}

    this.commands = this._buildCommands()
  }

  // ---- wiring ---------------------------------------------------------------
  onOutput(cb) { this.cbs.push(cb); return () => { this.cbs = this.cbs.filter(f => f !== cb) } }
  resize(cols, rows) { if (cols > 0) this.cols = cols; this.rows = rows }
  dispose() { this.cbs = [] }
  drainNoise() { const n = this._noise; this._noise = 0; return n }
  addNoise(n) { this._noise += n; this.noiseTotal += n }

  out(s) { for (const cb of this.cbs) cb(s) }
  write(s) { this.out(String(s).replace(/\r?\n/g, '\r\n')) }

  // ---- mission-readable state -------------------------------------------------
  get state() {
    const sh = this
    return {
      cwd: this.cwdPath,
      lastExit: this.lastExit,
      history: this.hist.slice(),
      readFiles: new Set(this.readFiles),
      dbState: this.dbState,
      exited: this.exited,
      host: this.host,
      user: this.user,
      noiseTotal: this.noiseTotal,
      exists: p => !!sh._node(sh._abs(p)),
      isFile: p => { const n = sh._node(sh._abs(p)); return !!n && n.type === 'file' },
      isDir: p => { const n = sh._node(sh._abs(p)); return !!n && n.type === 'dir' },
      readFile: p => { const n = sh._node(sh._abs(p)); return n && n.type === 'file' ? n.content : null },
      snapshot: () => snapDir(sh.root),
    }
  }

  // ---- path / node helpers ------------------------------------------------------
  _abs(p) {
    let path = String(p || '')
    if (path === '~') path = `/home/${this.user}`
    else if (path.startsWith('~/')) path = `/home/${this.user}/${path.slice(2)}`
    if (!path.startsWith('/')) path = `${this.cwdPath}/${path}`
    const parts = path.split('/')
    const stack = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    return '/' + stack.join('/')
  }

  _node(absPath) {
    if (absPath === '/') return this.root
    let cur = this.root
    for (const part of absPath.split('/').filter(Boolean)) {
      if (!cur || cur.type !== 'dir') return null
      cur = cur.children.get(part) || null
    }
    return cur
  }

  _parent(absPath) {
    const idx = absPath.lastIndexOf('/')
    const dirPath = idx <= 0 ? '/' : absPath.slice(0, idx)
    const base = absPath.slice(idx + 1)
    const dir = this._node(dirPath)
    return { dir, base, dirPath }
  }

  _tilde(p) {
    const home = `/home/${this.user}`
    if (p === home) return '~'
    if (p.startsWith(home + '/')) return '~' + p.slice(home.length)
    return p
  }

  // ---- prompt -------------------------------------------------------------------
  promptStr() {
    if (this.mode === 'sql') {
      const cont = this.sql && this.sql.buf.trim().length > 0
      return `${A.amber}${this.sql.corp}${cont ? '-> ' : '=> '}${A.reset}`
    }
    return `${A.bold}${A.cyan}${this.user}@${this.host}${A.reset}:${A.amber}${this._tilde(this.cwdPath)}${A.reset}$ `
  }

  prompt() {
    if (this.exited) return
    this.out(this.promptStr())
  }

  _redraw() {
    this.out('\r\x1b[K' + this.promptStr() + this.buffer)
    const back = this.buffer.length - this.cursor
    if (back > 0) this.out(`\x1b[${back}D`)
  }

  _setLine(s) {
    this.buffer = s
    this.cursor = s.length
    this._redraw()
  }

  // ---- raw key input ---------------------------------------------------------------
  input(data) {
    if (this.exited) return
    if (this.busy) { if (data.includes('\x03')) this._interrupt = true; return }
    let i = 0
    while (i < data.length) {
      const ch = data[i]
      if (ch === '\x1b') {
        const used = this._escSeq(data, i)
        i += used
        continue
      }
      this._char(ch)
      i++
    }
  }

  _escSeq(data, i) {
    // CSI: ESC [ params final;  SS3: ESC O x
    const rest = data.slice(i + 1)
    if (rest[0] === '[') {
      let j = 1
      while (j < rest.length && !/[@-~]/.test(rest[j])) j++
      if (j >= rest.length) return data.length - i // incomplete; swallow
      const seq = rest.slice(1, j), fin = rest[j]
      if (fin === 'A') this._histPrev()
      else if (fin === 'B') this._histNext()
      else if (fin === 'C') { if (this.cursor < this.buffer.length) { this.cursor++; this.out('\x1b[C') } }
      else if (fin === 'D') { if (this.cursor > 0) { this.cursor--; this.out('\x1b[D') } }
      else if (fin === 'H' || (fin === '~' && seq === '1')) { this.cursor = 0; this._redraw() }
      else if (fin === 'F' || (fin === '~' && seq === '4')) { this.cursor = this.buffer.length; this._redraw() }
      else if (fin === '~' && seq === '3') { // Delete
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1)
          this._redraw()
        }
      }
      return j + 2
    }
    if (rest[0] === 'O' && rest.length >= 2) {
      if (rest[1] === 'H') { this.cursor = 0; this._redraw() }
      else if (rest[1] === 'F') { this.cursor = this.buffer.length; this._redraw() }
      return 3
    }
    return 1 // lone ESC — ignore
  }

  _char(ch) {
    switch (ch) {
      case '\r': case '\n': this._enter(); return
      case '\x7f': case '\b':
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor)
          this.cursor--
          this._redraw()
        }
        return
      case '\t': this._complete(); return
      case '\x03': // Ctrl-C
        this.out('^C\r\n')
        this.buffer = ''; this.cursor = 0; this.histIdx = null
        if (this.mode === 'sql' && this.sql) this.sql.buf = ''
        this.prompt()
        return
      case '\x04': // Ctrl-D on empty line
        if (this.buffer.length === 0) {
          if (this.mode === 'sql') { this.out('\r\n'); this._sqlLeave() ; this.prompt() }
          else { this.out('\r\n'); this._exitSession() }
        }
        return
      case '\x0c': // Ctrl-L
        this.out('\x1b[2J\x1b[3J\x1b[H')
        this._redraw()
        return
      case '\x15': // Ctrl-U
        this.buffer = this.buffer.slice(this.cursor); this.cursor = 0; this._redraw(); return
      case '\x0b': // Ctrl-K
        this.buffer = this.buffer.slice(0, this.cursor); this._redraw(); return
      case '\x17': { // Ctrl-W
        const left = this.buffer.slice(0, this.cursor).replace(/\S+\s*$/, '')
        this.buffer = left + this.buffer.slice(this.cursor)
        this.cursor = left.length
        this._redraw(); return
      }
      case '\x01': this.cursor = 0; this._redraw(); return
      case '\x05': this.cursor = this.buffer.length; this._redraw(); return
      default:
        if (ch >= ' ') {
          this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor)
          this.cursor++
          this._redraw()
        }
    }
  }

  _enter() {
    this.out('\r\n')
    const line = this.buffer
    this.buffer = ''; this.cursor = 0; this.histIdx = null
    const trimmed = line.trim()
    if (trimmed && (this.hist.length === 0 || this.hist[this.hist.length - 1] !== trimmed)) {
      this.hist.push(trimmed)
      if (this.hist.length > HIST_MAX) this.hist.shift()
    }
    const p = this.mode === 'sql' ? this._sqlLine(trimmed) : this._runLine(line)
    this.busy = true
    Promise.resolve(p)
      .catch(err => this.write(`${A.red}deck fault: ${err && err.message || err}${A.reset}\n`))
      .then(() => { this.busy = false; this._interrupt = false; if (!this.exited) this.prompt() })
  }

  // ---- history nav ------------------------------------------------------------------
  _histPrev() {
    if (!this.hist.length) return
    if (this.histIdx === null) { this.histSaved = this.buffer; this.histIdx = this.hist.length }
    if (this.histIdx > 0) this.histIdx--
    this._setLine(this.hist[this.histIdx] ?? '')
  }

  _histNext() {
    if (this.histIdx === null) return
    this.histIdx++
    if (this.histIdx >= this.hist.length) { this.histIdx = null; this._setLine(this.histSaved) }
    else this._setLine(this.hist[this.histIdx])
  }

  // ---- tab completion -----------------------------------------------------------------
  _complete() {
    if (this.mode === 'sql') { this.out('\x07'); return }
    const upto = this.buffer.slice(0, this.cursor)
    // token start = after last unquoted whitespace
    let start = 0, q = null
    for (let i = 0; i < upto.length; i++) {
      const ch = upto[i]
      if (q) { if (ch === q) q = null; continue }
      if (ch === "'" || ch === '"') { q = ch; continue }
      if (ch === ' ' || ch === '\t' || ch === '|' || ch === '>') start = i + 1
    }
    const prefix = upto.slice(start)
    const isFirst = upto.slice(0, start).trim().replace(/.*[|]/, '').trim() === ''

    let candidates = []
    let dirPart = ''
    if (isFirst && !prefix.includes('/')) {
      candidates = Object.keys(this.commands).filter(c => c.startsWith(prefix)).sort().map(c => ({ ins: c, label: c, dir: false }))
    } else {
      const slash = prefix.lastIndexOf('/')
      dirPart = slash >= 0 ? prefix.slice(0, slash + 1) : ''
      const base = slash >= 0 ? prefix.slice(slash + 1) : prefix
      const dirNode = this._node(this._abs(dirPart === '' ? '.' : dirPart))
      if (!dirNode || dirNode.type !== 'dir') { this.out('\x07'); return }
      const names = [...dirNode.children.keys()].sort()
      for (const name of names) {
        if (!name.startsWith(base)) continue
        if (name.startsWith('.') && !base.startsWith('.')) continue
        const child = dirNode.children.get(name)
        candidates.push({ ins: dirPart + name, label: name + (child.type === 'dir' ? '/' : ''), dir: child.type === 'dir' })
      }
    }

    if (!candidates.length) { this.out('\x07'); return }
    if (candidates.length === 1) {
      const c = candidates[0]
      const completion = c.ins + (c.dir ? '/' : ' ')
      this.buffer = this.buffer.slice(0, start) + completion + this.buffer.slice(this.cursor)
      this.cursor = start + completion.length
      this._redraw()
      return
    }
    // longest common prefix
    let lcp = candidates[0].ins
    for (const c of candidates) {
      while (!c.ins.startsWith(lcp)) lcp = lcp.slice(0, -1)
    }
    if (lcp.length > prefix.length) {
      this.buffer = this.buffer.slice(0, start) + lcp + this.buffer.slice(this.cursor)
      this.cursor = start + lcp.length
      this._redraw()
    } else {
      this.out('\r\n' + candidates.map(c => (c.dir ? A.cyan + c.label + A.reset : c.label)).join('  ') + '\r\n')
      this._redraw()
    }
  }

  // ---- shell line execution -------------------------------------------------------------
  async _runLine(line) {
    if (!line.trim()) return
    this.addNoise(0.15)
    const toks = lexLine(line)
    if (!toks.length) return

    // split into pipeline segments
    const segs = [[]]
    for (const tk of toks) {
      if (tk.op === '|') segs.push([])
      else segs[segs.length - 1].push(tk)
    }

    let stdin = null
    let code = 0
    for (let s = 0; s < segs.length; s++) {
      // peel off redirection
      const argvToks = []
      let redir = null
      const seg = segs[s]
      for (let i = 0; i < seg.length; i++) {
        if (seg[i].op === '>' || seg[i].op === '>>') {
          const target = seg[i + 1]
          if (!target || target.op) { this.write(`bash: syntax error near unexpected token \`newline'\n`); this.lastExit = 2; return }
          redir = { append: seg[i].op === '>>', target: target.t }
          i++
        } else argvToks.push(seg[i])
      }
      if (!argvToks.length) { this.write(`bash: syntax error near unexpected token \`|'\n`); this.lastExit = 2; return }

      const name = argvToks[0].t
      const args = this._expandGlobs(argvToks.slice(1))
      const fn = this.commands[name]
      let res
      if (!fn) res = { out: '', err: `bash: ${name}: command not found`, code: 127 }
      else {
        try { res = await fn.call(this, args, stdin) }
        catch (err) { res = { out: '', err: `${name}: ${err && err.message || err}`, code: 1 } }
      }
      res = res || { out: '', code: 0 }
      if (res.clear) this.out('\x1b[2J\x1b[3J\x1b[H')
      if (res.err) this.write(res.err.endsWith('\n') ? res.err : res.err + '\n')
      code = res.code || 0

      let outText = res.out || ''
      if (redir) {
        const werr = this._writeRedir(redir, outText)
        if (werr) { this.write(werr + '\n'); code = 1 }
        stdin = ''
      } else {
        stdin = outText
      }
      if (this.exited) break
    }
    if (stdin) this.write(stdin.endsWith('\n') ? stdin : stdin + '\n')
    this.lastExit = code
    if (code !== 0) this.addNoise(0.35)
  }

  _expandGlobs(toks) {
    const out = []
    for (const tk of toks) {
      if (tk.q || !/[*?]/.test(tk.t)) { out.push(tk.t); continue }
      const slash = tk.t.lastIndexOf('/')
      const dirPart = slash >= 0 ? tk.t.slice(0, slash + 1) : ''
      const base = slash >= 0 ? tk.t.slice(slash + 1) : tk.t
      if (/[*?]/.test(dirPart)) { out.push(tk.t); continue }
      const dirNode = this._node(this._abs(dirPart === '' ? '.' : dirPart))
      if (!dirNode || dirNode.type !== 'dir') { out.push(tk.t); continue }
      const re = globToRegex(base)
      const matches = [...dirNode.children.keys()]
        .filter(n => re.test(n) && (base.startsWith('.') || !n.startsWith('.')))
        .sort()
        .map(n => dirPart + n)
      if (matches.length) out.push(...matches)
      else out.push(tk.t)
    }
    return out
  }

  _writeRedir(redir, text) {
    const abs = this._abs(redir.target)
    const existing = this._node(abs)
    if (existing && existing.type === 'dir') return `bash: ${redir.target}: Is a directory`
    if (existing && !canWrite(existing)) return `bash: ${redir.target}: Permission denied`
    const { dir, base } = this._parent(abs)
    if (!dir || dir.type !== 'dir') return `bash: ${redir.target}: No such file or directory`
    if (!base) return `bash: ${redir.target}: Invalid path`
    this.addNoise(0.3)
    if (existing) {
      existing.content = redir.append ? existing.content + text : text
    } else {
      dir.children.set(base, makeFile(text))
    }
    return null
  }

  _recordRead(absPath) { this.readFiles.add(absPath) }

  _readFileChecked(pathArg, cmdName) {
    const abs = this._abs(pathArg)
    const node = this._node(abs)
    if (!node) return { err: `${cmdName}: ${pathArg}: No such file or directory` }
    if (node.type === 'dir') return { err: `${cmdName}: ${pathArg}: Is a directory` }
    if (!canRead(node)) return { err: `${cmdName}: ${pathArg}: Permission denied` }
    this._recordRead(abs)
    return { content: node.content }
  }

  _walk(absPath, node, visit) {
    visit(absPath, node)
    if (node.type === 'dir') {
      for (const name of [...node.children.keys()].sort()) {
        const childPath = absPath === '/' ? '/' + name : absPath + '/' + name
        this._walk(childPath, node.children.get(name), visit)
      }
    }
  }

  // ---- the commands table -----------------------------------------------------------------
  _buildCommands() {
    const sh = this
    const parseFlags = (args, known) => {
      const flags = new Set(), rest = []
      for (const a of args) {
        if (/^-[a-zA-Z]+$/.test(a) && [...a.slice(1)].every(c => known.includes(c))) {
          for (const c of a.slice(1)) flags.add(c)
        } else rest.push(a)
      }
      return { flags, rest }
    }

    return {
      // -------- navigation / reading ------------------------------------------------
      ls(args) {
        const { flags, rest } = parseFlags(args, 'al')
        const paths = rest.length ? rest : ['.']
        const all = flags.has('a'), long = flags.has('l')
        const outLines = []
        let code = 0
        const fmtName = (name, node) =>
          node.type === 'dir' ? `${A.bold}${A.cyan}${name}${A.reset}`
            : node.perms && node.perms[3] === 'x' ? `${A.green}${name}${A.reset}`
              : name
        const listDir = (node) => {
          let names = [...node.children.keys()].sort((a, b) => a.localeCompare(b))
          if (all) names = ['.', '..', ...names]
          else names = names.filter(n => !n.startsWith('.'))
          if (long) {
            const lines = [`total ${names.length}`]
            for (const n of names) {
              const child = n === '.' ? node : n === '..' ? node : node.children.get(n)
              const size = child.type === 'file' ? child.content.length : 4096
              const links = child.type === 'dir' ? Math.max(2, child.children.size) : 1
              lines.push(`${child.perms} ${String(links).padStart(2)} ${sh.user.padEnd(8)} grid ${String(size).padStart(7)} ${child.date} ${fmtName(n, child)}`)
            }
            return lines.join('\n')
          }
          return names.map(n => {
            const child = n === '.' || n === '..' ? node : node.children.get(n)
            return fmtName(n, child)
          }).join('  ')
        }
        for (const p of paths) {
          const node = sh._node(sh._abs(p))
          if (!node) { outLines.push(`ls: cannot access '${p}': No such file or directory`); code = 2; continue }
          if (node.type === 'file') {
            outLines.push(long
              ? `${node.perms}  1 ${sh.user.padEnd(8)} grid ${String(node.content.length).padStart(7)} ${node.date} ${p}`
              : p)
            continue
          }
          if (paths.length > 1) outLines.push(`${p}:`)
          const listing = listDir(node)
          if (listing) outLines.push(listing)
        }
        return { out: outLines.join('\n') + (outLines.length ? '\n' : ''), code }
      },

      cd(args) {
        let target = args[0]
        if (!target) target = `/home/${sh.user}`
        if (target === '-') target = sh.oldCwd
        const abs = sh._abs(target)
        const node = sh._node(abs)
        if (!node) return { out: '', err: `bash: cd: ${args[0] || target}: No such file or directory`, code: 1 }
        if (node.type !== 'dir') return { out: '', err: `bash: cd: ${args[0]}: Not a directory`, code: 1 }
        sh.oldCwd = sh.cwdPath
        sh.cwdPath = abs
        return { out: '', code: 0 }
      },

      pwd() { return { out: sh.cwdPath + '\n', code: 0 } },

      cat(args, stdin) {
        if (!args.length) return { out: stdin || '', code: 0 }
        let out = '', err = '', code = 0
        for (const p of args) {
          const r = sh._readFileChecked(p, 'cat')
          if (r.err) { err += r.err + '\n'; code = 1; continue }
          out += r.content
          if (out && !out.endsWith('\n')) out += '\n'
        }
        return { out, err: err.trimEnd(), code }
      },

      echo(args) {
        const noNl = args[0] === '-n'
        const text = (noNl ? args.slice(1) : args).join(' ')
        return { out: text + (noNl ? '' : '\n'), code: 0 }
      },

      grep(args, stdin) {
        const { flags, rest } = parseFlags(args, 'irn')
        if (!rest.length) return { out: '', err: 'usage: grep [-i] [-n] [-r] pattern [file...]', code: 2 }
        const pat = rest[0]
        let files = rest.slice(1)
        let re
        try { re = new RegExp(pat, flags.has('i') ? 'i' : '') }
        catch { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.has('i') ? 'i' : '') }
        const hi = new RegExp(re.source, re.flags.replace('g', '') + 'g')

        const sources = [] // {label, content}
        let err = '', code = 1
        if (flags.has('r')) {
          sh.addNoise(1.5)
          const roots = files.length ? files : ['.']
          for (const rootArg of roots) {
            const abs = sh._abs(rootArg)
            const node = sh._node(abs)
            if (!node) { err += `grep: ${rootArg}: No such file or directory\n`; continue }
            if (node.type === 'file') { sources.push({ label: rootArg, content: node.content }); continue }
            sh._walk(abs, node, (p, n) => {
              if (n.type === 'file' && canRead(n)) sources.push({ label: p, content: n.content })
            })
          }
        } else if (files.length) {
          for (const f of files) {
            const r = sh._readFileChecked(f, 'grep')
            if (r.err) { err += r.err + '\n'; continue }
            sources.push({ label: f, content: r.content })
          }
        } else if (stdin !== null && stdin !== undefined) {
          sources.push({ label: null, content: stdin })
        } else {
          return { out: '', err: 'usage: grep [-i] [-n] [-r] pattern [file...]', code: 2 }
        }

        const showName = flags.has('r') || sources.length > 1
        const lines = []
        for (const src of sources) {
          const srcLines = src.content.split('\n')
          for (let i = 0; i < srcLines.length; i++) {
            if (!re.test(srcLines[i])) continue
            code = 0
            const text = srcLines[i].replace(hi, m => `${A.red}${m}${A.reset}`)
            const prefix = (showName && src.label ? `${A.magenta}${src.label}${A.reset}:` : '')
              + (flags.has('n') ? `${A.green}${i + 1}${A.reset}:` : '')
            lines.push(prefix + text)
            if (lines.length >= 500) break
          }
          if (lines.length >= 500) { lines.push('grep: output truncated at 500 lines'); break }
        }
        return { out: lines.length ? lines.join('\n') + '\n' : '', err: err.trimEnd(), code: err ? 2 : code }
      },

      find(args) {
        sh.addNoise(0.8)
        const paths = []
        let namePat = null, typeFilter = null
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-name') namePat = args[++i]
          else if (args[i] === '-type') typeFilter = args[++i]
          else if (args[i].startsWith('-')) return { out: '', err: `find: unknown predicate '${args[i]}'`, code: 1 }
          else paths.push(args[i])
        }
        if (typeFilter && typeFilter !== 'f' && typeFilter !== 'd') {
          return { out: '', err: `find: invalid argument '${typeFilter}' to -type (use f or d)`, code: 1 }
        }
        const re = namePat ? globToRegex(namePat) : null
        if (!paths.length) paths.push('.')
        const lines = []
        let err = '', code = 0
        for (const p of paths) {
          const abs = sh._abs(p)
          const node = sh._node(abs)
          if (!node) { err += `find: '${p}': No such file or directory\n`; code = 1; continue }
          sh._walk(abs, node, (walkPath, n) => {
            const display = p === '.' ? ('.' + (walkPath === abs ? '' : walkPath.slice(abs === '/' ? 0 : abs.length)))
              : (walkPath === abs ? p : p.replace(/\/+$/, '') + walkPath.slice(abs === '/' ? 0 : abs.length))
            const base = walkPath === '/' ? '/' : walkPath.slice(walkPath.lastIndexOf('/') + 1)
            if (re && !re.test(base)) return
            if (typeFilter === 'f' && n.type !== 'file') return
            if (typeFilter === 'd' && n.type !== 'dir') return
            lines.push(display)
          })
        }
        return { out: lines.length ? lines.join('\n') + '\n' : '', err: err.trimEnd(), code }
      },

      head(args, stdin) { return sh._headTail(args, stdin, true) },
      tail(args, stdin) { return sh._headTail(args, stdin, false) },

      // -------- file manipulation ---------------------------------------------------
      cp(args) {
        sh.addNoise(0.4)
        const { flags, rest } = parseFlags(args, 'r')
        if (rest.length < 2) return { out: '', err: 'cp: missing file operand', code: 1 }
        const dstArg = rest[rest.length - 1]
        const srcs = rest.slice(0, -1)
        const dstAbs = sh._abs(dstArg)
        const dstNode = sh._node(dstAbs)
        const intoDir = dstNode && dstNode.type === 'dir'
        if (srcs.length > 1 && !intoDir) return { out: '', err: `cp: target '${dstArg}' is not a directory`, code: 1 }
        const clone = n => n.type === 'file'
          ? makeFile(n.content, n.perms, n.date)
          : { type: 'dir', perms: n.perms, date: n.date, children: new Map([...n.children].map(([k, v]) => [k, clone(v)])) }
        let err = '', code = 0
        for (const src of srcs) {
          const sAbs = sh._abs(src)
          const sNode = sh._node(sAbs)
          if (!sNode) { err += `cp: cannot stat '${src}': No such file or directory\n`; code = 1; continue }
          if (sNode.type === 'dir' && !flags.has('r')) { err += `cp: -r not specified; omitting directory '${src}'\n`; code = 1; continue }
          let destDir, destName
          if (intoDir) { destDir = dstNode; destName = sAbs.slice(sAbs.lastIndexOf('/') + 1) }
          else {
            const { dir, base } = sh._parent(dstAbs)
            if (!dir || dir.type !== 'dir') { err += `cp: cannot create '${dstArg}': No such file or directory\n`; code = 1; continue }
            destDir = dir; destName = base
          }
          destDir.children.set(destName, clone(sNode))
        }
        return { out: '', err: err.trimEnd(), code }
      },

      mv(args) {
        sh.addNoise(0.6)
        if (args.length < 2) return { out: '', err: 'mv: missing file operand', code: 1 }
        const dstArg = args[args.length - 1]
        const srcs = args.slice(0, -1)
        const dstAbs = sh._abs(dstArg)
        const dstNode = sh._node(dstAbs)
        const intoDir = dstNode && dstNode.type === 'dir'
        if (srcs.length > 1 && !intoDir) return { out: '', err: `mv: target '${dstArg}' is not a directory`, code: 1 }
        let err = '', code = 0
        for (const src of srcs) {
          const sAbs = sh._abs(src)
          const { dir: sDir, base: sBase } = sh._parent(sAbs)
          const sNode = sDir && sDir.type === 'dir' ? sDir.children.get(sBase) : null
          if (!sNode) { err += `mv: cannot stat '${src}': No such file or directory\n`; code = 1; continue }
          let destDir, destName
          if (intoDir) { destDir = dstNode; destName = sBase }
          else {
            const { dir, base } = sh._parent(dstAbs)
            if (!dir || dir.type !== 'dir') { err += `mv: cannot move '${src}' to '${dstArg}': No such file or directory\n`; code = 1; continue }
            destDir = dir; destName = base
          }
          sDir.children.delete(sBase)
          destDir.children.set(destName, sNode)
        }
        return { out: '', err: err.trimEnd(), code }
      },

      rm(args) {
        sh.addNoise(1.2)
        const { flags, rest } = parseFlags(args, 'rf')
        if (!rest.length) return { out: '', err: 'rm: missing operand', code: 1 }
        let err = '', code = 0
        for (const p of rest) {
          const abs = sh._abs(p)
          const { dir, base } = sh._parent(abs)
          const node = dir && dir.type === 'dir' ? dir.children.get(base) : null
          if (!node) {
            if (!flags.has('f')) { err += `rm: cannot remove '${p}': No such file or directory\n`; code = 1 }
            continue
          }
          if (node.type === 'dir' && !flags.has('r')) { err += `rm: cannot remove '${p}': Is a directory\n`; code = 1; continue }
          dir.children.delete(base)
        }
        return { out: '', err: err.trimEnd(), code }
      },

      mkdir(args) {
        const { flags, rest } = parseFlags(args, 'p')
        if (!rest.length) return { out: '', err: 'mkdir: missing operand', code: 1 }
        let err = '', code = 0
        for (const p of rest) {
          const abs = sh._abs(p)
          if (sh._node(abs)) {
            if (!flags.has('p')) { err += `mkdir: cannot create directory '${p}': File exists\n`; code = 1 }
            continue
          }
          if (flags.has('p')) {
            let cur = sh.root, curPath = ''
            for (const part of abs.split('/').filter(Boolean)) {
              curPath += '/' + part
              let next = cur.children.get(part)
              if (!next) { next = normalizeDir({}); cur.children.set(part, next) }
              if (next.type !== 'dir') { err += `mkdir: cannot create directory '${p}': Not a directory\n`; code = 1; break }
              cur = next
            }
          } else {
            const { dir, base } = sh._parent(abs)
            if (!dir || dir.type !== 'dir') { err += `mkdir: cannot create directory '${p}': No such file or directory\n`; code = 1; continue }
            dir.children.set(base, normalizeDir({}))
          }
        }
        return { out: '', err: err.trimEnd(), code }
      },

      touch(args) {
        if (!args.length) return { out: '', err: 'touch: missing file operand', code: 1 }
        let err = '', code = 0
        for (const p of args) {
          const abs = sh._abs(p)
          if (sh._node(abs)) continue
          const { dir, base } = sh._parent(abs)
          if (!dir || dir.type !== 'dir') { err += `touch: cannot touch '${p}': No such file or directory\n`; code = 1; continue }
          dir.children.set(base, makeFile(''))
        }
        return { out: '', err: err.trimEnd(), code }
      },

      chmod(args) {
        sh.addNoise(0.8)
        const { flags, rest } = parseFlags(args, 'R')
        if (rest.length < 2) return { out: '', err: 'chmod: missing operand', code: 1 }
        const mode = rest[0]
        const apply = (node) => {
          const typeCh = node.type === 'dir' ? 'd' : '-'
          if (/^[0-7]{3,4}$/.test(mode)) {
            const oct = mode.slice(-3)
            let perms = typeCh
            for (const d of oct) {
              const v = parseInt(d, 8)
              perms += (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (v & 1 ? 'x' : '-')
            }
            node.perms = perms
            return true
          }
          const m = mode.match(/^([ugoa]*)([+\-=])([rwx]+)$/)
          if (!m) return false
          const who = m[1] || 'a'
          const op = m[2]
          const bits = m[3]
          const cls = []
          if (who.includes('a')) cls.push(0, 1, 2)
          else {
            if (who.includes('u')) cls.push(0)
            if (who.includes('g')) cls.push(1)
            if (who.includes('o')) cls.push(2)
          }
          const arr = node.perms.split('')
          for (const c of cls) {
            for (const bitCh of ['r', 'w', 'x']) {
              const idx = 1 + c * 3 + ['r', 'w', 'x'].indexOf(bitCh)
              if (op === '=') arr[idx] = bits.includes(bitCh) ? bitCh : '-'
              else if (op === '+' && bits.includes(bitCh)) arr[idx] = bitCh
              else if (op === '-' && bits.includes(bitCh)) arr[idx] = '-'
            }
          }
          node.perms = arr.join('')
          return true
        }
        let err = '', code = 0
        for (const p of rest.slice(1)) {
          const abs = sh._abs(p)
          const node = sh._node(abs)
          if (!node) { err += `chmod: cannot access '${p}': No such file or directory\n`; code = 1; continue }
          let ok = apply(node)
          if (ok && flags.has('R') && node.type === 'dir') sh._walk(abs, node, (_, n) => apply(n))
          if (!ok) { err += `chmod: invalid mode: '${mode}'\n`; code = 1; break }
        }
        return { out: '', err: err.trimEnd(), code }
      },

      // -------- identity / introspection ------------------------------------------------
      whoami() { return { out: sh.user + '\n', code: 0 } },

      ps() {
        const rows = [
          '  PID TTY          TIME CMD',
          '    1 ?        00:00:04 init',
          '   58 ?        00:02:31 netlinkd',
          '   77 ?        00:00:12 cryptarbiter',
          '  102 ?        00:00:00 watchdogd',
          `  666 ?        00:00:39 ${A.magenta}gridtrace${A.reset}`,
          '  900 tty1     00:00:01 sh',
          '  901 tty1     00:00:00 ps',
        ]
        return { out: rows.join('\n') + '\n', code: 0 }
      },

      history() {
        return { out: sh.hist.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n') + (sh.hist.length ? '\n' : ''), code: 0 }
      },

      clear() { return { out: '', code: 0, clear: true } },

      help() { return { out: HELP_TEXT + '\n', code: 0 } },

      man(args) {
        if (!args.length) return { out: '', err: 'What manual page do you want?\nFor example, try: man ls', code: 1 }
        const page = MAN[args[0]]
        if (!page) return { out: '', err: `No manual entry for ${args[0]}`, code: 16 }
        return { out: A.dim + page + A.reset + '\n', code: 0 }
      },

      // -------- bridges ------------------------------------------------------------------
      async sql(args) {
        if (!args.length) {
          return { out: '', err: 'usage: sql <corp>   (known hosts: aster_hr, grid_rbac, forge_erp)', code: 1 }
        }
        const corp = args[0]
        sh.addNoise(1.0)
        let db
        try { db = await openDB(corp) }
        catch (err) { return { out: '', err: `sql: ${err && err.message || err}`, code: 1 } }
        if (!sh.dbState[corp]) sh.dbState[corp] = { db, statements: [], writes: 0, lastError: null }
        sh.mode = 'sql'
        sh.sql = { corp, db, buf: '' }
        return {
          out: `${A.cyan}NETLINK SQL bridge — connected to ${A.amber}${corp}${A.cyan} (SQLite dialect)${A.reset}\n` +
            `${A.dim}end statements with ;   .tables  .schema [table]  .help   .quit disconnects${A.reset}\n`,
          code: 0,
        }
      },

      ssh(args) {
        if (!args.length) return { out: '', err: 'usage: ssh [user@]hostname', code: 255 }
        sh.addNoise(2.5)
        let [userPart, hostPart] = args[0].includes('@') ? args[0].split('@') : [null, args[0]]
        const spec = sh.hostsSpec[hostPart]
        if (!spec) return { out: '', err: `ssh: Could not resolve hostname ${hostPart}: Name or service not known`, code: 255 }
        let hostFs, hostUser
        if (spec.fs) { hostFs = spec.fs; hostUser = userPart || spec.user || 'guest' }
        else { hostFs = spec; hostUser = userPart || 'guest' }
        let root = sh._hostCache.get(hostPart)
        if (!root) { root = normalizeDir(hostFs); sh._hostCache.set(hostPart, root) }
        sh.sshStack.push({ root: sh.root, cwd: sh.cwdPath, oldCwd: sh.oldCwd, host: sh.host, user: sh.user })
        sh.root = root
        sh.host = hostPart
        sh.user = hostUser
        const home = `/home/${hostUser}`
        sh.cwdPath = sh._node(home) ? home : '/'
        sh.oldCwd = sh.cwdPath
        const motd = sh._node('/etc/motd')
        return {
          out: `${A.dim}negotiating cipher... session keys exchanged... channel open${A.reset}\n` +
            `Welcome to ${hostPart} (GridOS 7.3 LTS)\n` +
            (motd && motd.type === 'file' ? motd.content + (motd.content.endsWith('\n') ? '' : '\n') : ''),
          code: 0,
        }
      },

      exit() { sh._exitSession(); return { out: '', code: 0 } },
      logout() { sh._exitSession(); return { out: '', code: 0 } },
    }
  }

  _headTail(args, stdin, isHead) {
    const name = isHead ? 'head' : 'tail'
    let n = 10
    const files = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '-n') { n = parseInt(args[++i], 10) }
      else if (/^-n\d+$/.test(a)) n = parseInt(a.slice(2), 10)
      else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10)
      else files.push(a)
    }
    if (!Number.isFinite(n) || n < 0) return { out: '', err: `${name}: invalid number of lines`, code: 1 }
    const take = (content) => {
      const lines = content.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      const part = isHead ? lines.slice(0, n) : lines.slice(Math.max(0, lines.length - n))
      return part.join('\n') + (part.length ? '\n' : '')
    }
    if (!files.length) return { out: take(stdin || ''), code: 0 }
    let out = '', err = '', code = 0
    for (const f of files) {
      const r = this._readFileChecked(f, name)
      if (r.err) { err += r.err + '\n'; code = 1; continue }
      if (files.length > 1) out += `==> ${f} <==\n`
      out += take(r.content)
    }
    return { out, err: err.trimEnd(), code }
  }

  _exitSession() {
    if (this.sshStack.length) {
      const prev = this.sshStack.pop()
      const closedHost = this.host
      this.root = prev.root
      this.cwdPath = prev.cwd
      this.oldCwd = prev.oldCwd
      this.host = prev.host
      this.user = prev.user
      this.write(`logout\nConnection to ${closedHost} closed.\n`)
      if (!this.busy) this.prompt()
      return
    }
    this.write(`logout\n${A.dim}[carrier dropped — link closed by deck]${A.reset}\n`)
    this.exited = true
  }

  // ---- SQL sub-prompt -------------------------------------------------------------------
  _sqlLeave() {
    const corp = this.sql ? this.sql.corp : ''
    this.mode = 'shell'
    this.sql = null
    this.write(`${A.dim}disconnected from ${corp}${A.reset}\n`)
  }

  async _sqlLine(line) {
    const s = this.sql
    if (!s) { this.mode = 'shell'; return }
    const trimmed = line.trim()

    if (!s.buf && /^(\.quit|\.exit|quit|exit)$/i.test(trimmed)) { this._sqlLeave(); return }
    if (!s.buf && trimmed.startsWith('.')) {
      const [cmd, arg] = trimmed.split(/\s+/)
      if (cmd === '.help') {
        this.write(`.tables           list tables and views\n.schema [table]   show CREATE statements\n.quit             disconnect\nstatements end with ;\n`)
      } else if (cmd === '.tables') {
        const r = query(s.db, `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        if (r.error) this.write(`${A.red}ERROR: ${r.error}${A.reset}\n`)
        else this.write(r.rows.map(row => row[0]).join('  ') + '\n')
      } else if (cmd === '.schema') {
        const r = arg
          ? query(s.db, `SELECT sql FROM sqlite_master WHERE name='${arg.replace(/'/g, "''")}' AND sql IS NOT NULL`)
          : query(s.db, `SELECT sql FROM sqlite_master WHERE sql IS NOT NULL`)
        if (r.error) this.write(`${A.red}ERROR: ${r.error}${A.reset}\n`)
        else if (!r.rows.length) this.write(`-- no schema found${arg ? ` for '${arg}'` : ''}\n`)
        else this.write(r.rows.map(row => row[0] + ';').join('\n') + '\n')
      } else {
        this.write(`unknown command: ${cmd} — try .help\n`)
      }
      return
    }

    if (!trimmed && !s.buf) return
    s.buf += (s.buf ? '\n' : '') + line
    if (!/;\s*$/.test(s.buf)) return // continuation prompt shown by promptStr()

    const sqlText = s.buf
    s.buf = ''
    const rec = this.dbState[s.corp]
    const res = query(s.db, sqlText)
    rec.statements.push(sqlText.trim())
    if (res.error) {
      rec.lastError = res.error
      this.addNoise(0.5)
      this.write(`${A.red}ERROR: ${res.error}${A.reset}\n`)
      return
    }
    rec.lastError = null
    if (!res.columns.length) {
      const changes = res.changes || 0
      if (changes > 0) { rec.writes++; this.addNoise(3.0) }
      this.write(`${A.green}OK${A.reset} — ${changes} row(s) modified\n`)
      return
    }
    this.write(this._formatTable(res))
  }

  _formatTable(res) {
    const MAXW = 48
    const cell = v => {
      const s = v === null || v === undefined ? 'NULL' : String(v)
      return s.length > MAXW ? s.slice(0, MAXW - 1) + '…' : s
    }
    const cols = res.columns
    const rows = res.rows.map(r => r.map(cell))
    const widths = cols.map((c, i) => Math.max(c.length, ...rows.map(r => r[i].length), 1))
    const line = (cells, color) => cells.map((c, i) => (color || '') + c.padEnd(widths[i]) + (color ? A.reset : '')).join('  ')
    let out = line(cols, A.cyan) + '\n'
    out += widths.map(w => '-'.repeat(w)).join('  ') + '\n'
    for (const r of rows) out += line(r) + '\n'
    out += `${A.dim}(${rows.length} row${rows.length === 1 ? '' : 's'}${res.truncated ? ', truncated' : ''})${A.reset}\n`
    return out
  }
}
