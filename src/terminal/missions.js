// ============================================================================
// NETRUNNER · src/terminal/missions.js — jack-in encounter definitions.
// ARCHITECTURE.md §9. Consumed by jackin.js (flow) and backend.js (fs/setup).
//
// MISSIONS[id] = {
//   host        string shown in #term-host
//   user        sim-shell user (optional, default 'runner')
//   objective   string shown in #term-objective
//   intro       [comms lines from Glitch, played on connect]
//   outro       [comms lines from Glitch, played on win]
//   fs          sim filesystem layout (see sim-shell.js header for the spec)
//   hosts       optional sibling hosts reachable via `ssh` in sim mode
//   realScript  optional extra bash appended to the generated real-VM setup
//   realCheck   bash snippet for real mode: prints OK when the objective is met
//   hints       in-character nudges from Glitch after stretches of inactivity
//   heatRate    baseline trace fill per second (noisy actions add bursts)
//   check(state)→bool   win condition, reads SimShell state (sim mode)
//   onWin       story flag set on success (G.flags)
//   boss        true → jackin toasts ACCESS-KEY GET
//   reward      {creds, kit?:[programIds], codex?:[entryIds]}
// }
//
// Every host, corp and person here is fictional. Sandboxed. Runner's Code.
// ============================================================================

import { query } from '../data/db.js'

// ---------------------------------------------------------------------------
// m_find_underground — intro jack-in, City 1 (Aster).
// Mara's deck, mirrored offline. A hidden dotfile holds the way down.
// ---------------------------------------------------------------------------

const MARA_WHEREAMI = `if you're reading this, you noticed the dot.
good. they only index what they can see.

UNDERGROUND ACCESS — memorize, then walk away:
    old rail maintenance shaft 9, sector K-7, aster lower
    service door behind the noodle stand that never opens
    knock: two - pause - three
    say: "the grid forgets. we don't."

don't search my name on the open grid. you'll light up like a flare.
the proof lives where they can't scrub it:
    sql grid_rbac
    SELECT * FROM access_log WHERE actor='KERNEL';
my row in aster_hr is employee_id 1989. look at what's LEFT of it.

then burn this file: rm ~/.mara/whereami — leave them nothing.

i love you. find me.
        — M
`

const MARA_FS = {
  home: {
    mara: {
      'if_you_find_this.txt':
        `to whoever cracked my deck:\n` +
        `this file is visible, so assume THEY have read it too. it says nothing.\n` +
        `if you're the one person i taught to look where the lister doesn't look\n` +
        `by default... then you already know there's more here than meets ls.\n` +
        `        — M\n`,
      notes: {
        'grid_anomaly.txt':
          `GRID-7741 — personal notes (offline copy)\n` +
          `------------------------------------------\n` +
          `the update chain is not a toolchain anymore. it's a tenant.\n` +
          `- auto-update scripts on the core nodes: last human maintainer\n` +
          `  signature is 41 YEARS old. the scripts have been editing each\n` +
          `  other since. cleanly. with style.\n` +
          `- filed the ticket. ravi says "don't poke the plumbing."\n` +
          `- pulled a full lineage snapshot to offline storage. if anything\n` +
          `  happens to me, the snapshot is the evidence.\n` +
          `- if anything happens to me, the directory logs are WORM storage.\n` +
          `  even IT can't scrub those. sql grid_rbac. remember that.\n`,
        'groceries.txt': `synthrice\nmiso paste (real, from the stall on 9th)\nnoodle stand — tuesday\nbatteries for the deck\nbirthday present!!\n`,
      },
      photos: {
        'rooftop_5am.img.txt':
          `[image: two kids on a rooftop, aster spire behind them, rain coming.\n` +
          ` the younger one is laughing. caption scrawled in marker:]\n` +
          `     "we stay. we don't get erased. promise."\n`,
        'static_0607.img.txt': `[image data corrupted — 2189-06-07 03:14:09]\n░▒▓█▓▒░ ERROR 404 ░▒▓█▓▒░\n`,
      },
      mail: {
        'outbox_draft.eml':
          `From: mara@deck-local\nTo: you\nSubject: (unsent)\n\n` +
          `hey. if i go quiet, don't believe whatever the grid tells you about\n` +
          `me. especially if it tells you nothing at all.\n\n` +
          `i taught you the deck for a reason.\n`,
      },
      '.bash_history':
        `sql grid_rbac\ngrep -r 7741 ~/notes\nmkdir .mara\nchmod 700 .mara\nnano .mara/whereami\nchmod 600 .mara/whereami\nls -a\nclear\n`,
      '.mara': {
        __perms: 'drwx------',
        __date: 'Jun  7 02:58',
        whereami: { __file: MARA_WHEREAMI, __perms: '-rw-------', __date: 'Jun  7 03:02' },
        'burn_after_reading': { __file: `you know what to do.\n`, __perms: '-rw-------', __date: 'Jun  7 03:02' },
      },
    },
  },
  etc: {
    motd: `mara-deck — personal terminal, OFFLINE MIRROR\nthe grid stops at this prompt.\n`,
    hosts: `127.0.0.1   localhost\n10.4.7.21   grid-pub.aster   # public access node, aster street\n`,
  },
  var: {
    log: {
      'auth.log':
        `2189-06-06 21:12:46 session open (mara) tty1\n` +
        `2189-06-07 03:13:58 inbound sync request from grid-core REJECTED: deck offline\n` +
        `2189-06-07 03:14:02 inbound sync request from grid-core REJECTED: deck offline\n` +
        `2189-06-07 03:14:11 inbound sync request from grid-core REJECTED: deck offline (12 retries)\n` +
        `2189-06-07 03:15:00 session close (mara) tty1\n`,
    },
  },
  tmp: {},
}

const GRID_PUB_HOST = {
  user: 'guest',
  fs: {
    etc: {
      motd: `ASTER PUBLIC ACCESS NODE 7 — all usage is logged.\ncourtesy of Aster Dynamics. smile for the sensors.\n`,
    },
    home: { guest: { 'README': `public node. nothing stays here. nothing here is yours.\n` } },
    var: {
      log: {
        grid: {
          'access.log':
            `2189-06-07 03:14:16 REPLICATE civic.registry subject=1989 push accepted\n` +
            `2189-06-07 03:14:16 REPLICATE transit.registry subject=1989 push accepted\n` +
            `2189-06-07 03:14:17 REPLICATE med.registry subject=1989 push accepted\n` +
            `2189-06-08 02:41:17 LOGIN FAILED user=mara.okonkwo source=this-node reason=account_disabled\n`,
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// m_forge_plant — City 2 boss. The plant ops deck at Forge Town Works No.3.
// Diagnose the failing machine through forge_erp, fix it, release the line.
// ---------------------------------------------------------------------------

const FORGE_FS = {
  home: {
    ops: {
      '.bash_history': `sql forge_erp\ncat /var/ops/README\nls /var/ops/maintenance\n`,
      'shift_handover.txt':
        `night shift -> day shift:\n` +
        `- line 2 is DOWN again. third day. floor crew says it screams before\n` +
        `  it stops. machines don't scream. bearings do.\n` +
        `- furnace A reads 1462 C and the new kid keeps flagging it. the new\n` +
        `  kid should read what a furnace is for.\n` +
        `- whatever is broken, the ERP saw it first. it always does.\n`,
    },
  },
  var: {
    ops: {
      'README':
        `FORGE TOWN WORKS NO.3 — OPS RUNBOOK (rev 14)\n` +
        `=============================================\n` +
        `1. TELEMETRY lives in the ERP. open it with:  sql forge_erp\n` +
        `   tables: plants, machines, work_orders, sensor_readings,\n` +
        `           maintenance_log        (.tables / .schema <t> to explore)\n` +
        `2. DIAGNOSIS: join machines to sensor_readings. filter by METRIC,\n` +
        `   not by raw value — a furnace is supposed to be hot. look for\n` +
        `   bearing_temp out of band and vibration_rms ~10x its neighbours,\n` +
        `   then confirm against maintenance_log.\n` +
        `3. CLEARING A FAULT (both steps, in any order):\n` +
        `   a) acknowledge the repair: write a note to\n` +
        `         /var/ops/maintenance/ack_<machine_id>\n` +
        `      (see ack_1733 for the format)   ...or floor control may flip\n` +
        `      machines.status off 'fault' directly in the ERP.\n` +
        `   b) release its blocked production:\n` +
        `         UPDATE work_orders SET status='released'\n` +
        `          WHERE machine_id=<id> AND status='blocked';\n` +
        `4. do NOT touch plant 2 (Aster Fab One). it is not ours.\n`,
      maintenance: {
        'ack_1733':
          `2189-02-11 quench bath circulation pump replaced.\n` +
          `bath_temp back in band. cleared for restart. — r. voss, floor control\n`,
      },
    },
  },
  opt: {
    forge: {
      conf: {
        'line2.conf': `# extruder line 2 — controller config\nscrew_rpm=84\nbarrel_zones=5\ncooling_loop=AUTO\nlube_cycle_min=30   # pump fault 06-06, see maintenance_log\n`,
      },
    },
  },
  etc: {
    motd: `FORGE TOWN WORKS NO.3 — OPS DECK\nauthorized floor-control use only. every keystroke is metered.\n`,
    hosts: `127.0.0.1   localhost\n10.9.2.4    forge-hist.local   # historian mirror (read only)\n`,
  },
  tmp: {},
}

const FORGE_HIST_HOST = {
  user: 'hist',
  fs: {
    etc: { motd: `historian mirror — sensor archive, read only.\n` },
    srv: {
      hist: {
        'extruder2_trend.csv':
          `ts,metric,value,unit\n` +
          `2189-06-09 06:00,bearing_temp,78.2,C\n` +
          `2189-06-09 12:00,bearing_temp,96.4,C\n` +
          `2189-06-09 18:00,bearing_temp,121.7,C\n` +
          `2189-06-10 06:00,bearing_temp,143.5,C\n` +
          `2189-06-10 06:00,vibration_rms,19.3,mm/s\n`,
      },
    },
  },
}

// ---------------------------------------------------------------------------

export const MISSIONS = {
  m_find_underground: {
    host: 'mara-deck',
    user: 'mara',
    objective: 'Find what Mara hid.',
    intro: [
      "You're in. That deck is an offline mirror of Mara's home directory — the one place the Grid couldn't reach.",
      'They wiped her everywhere else in a single night. But she KNEW. If she left you anything, it’s in there.',
      'ls lists. cd moves. cat reads. man explains anything. And kid — she hid it. She would have hidden it well.',
      'Watch the TRACE bar. Even dead links get swept. Quiet hands, quick eyes.',
    ],
    outro: [
      'Shaft 9, sector K-7... I know that door. That’s really it.',
      'And the WORM logs — she pointed you straight at the Kernel’s fingerprints. Your sister thinks in audit trails. I like her already.',
      'Pull out. I’ll meet you at the noodle stand that never opens.',
    ],
    fs: MARA_FS,
    hosts: { 'grid-pub.aster': GRID_PUB_HOST },
    realScript: `chmod 700 /home/mara/.mara && chmod 600 /home/mara/.mara/whereami`,
    realCheck: `[ -e /tmp/.nr_ready ] && [ ! -e /home/mara/.mara/whereami ] && echo OK`,
    hints: [
      'Her deck, her rules. Start simple: ls. Walls first, then doors.',
      'People hide things where the lister doesn’t look by default. There’s a flag for that — ls -a. Names that start with a dot are invisible on purpose.',
      'A dotted directory is a door. cd into it, then ls -a again.',
      'Found a file? Open it. cat spills anything onto the screen.',
      'Stuck on any command? man ls. man cat. The deck documents itself — reading it costs nothing.',
    ],
    heatRate: 1.0,
    check(state) {
      try { return state.readFiles.has('/home/mara/.mara/whereami') } catch { return false }
    },
    onWin: 'jackin1_done',
    reward: { creds: 75, codex: ['cx_hidden_files', 'cx_underground'] },
  },

  m_forge_plant: {
    host: 'forge-ops',
    user: 'ops',
    objective: 'Find the failing machine. Clear the fault. Release the blocked orders.',
    intro: [
      'Forge Town Works No.3. Half this city’s rail parts come off that floor — and Line’s been dark for three days.',
      'Vex bought us floor-control credentials. They cost more than you did. Don’t waste them.',
      'The crew swears the plant is haunted. It isn’t. Something SPECIFIC is broken, and the ERP already knows what. sql forge_erp — machines, sensor_readings, work_orders, maintenance_log.',
      'Procedure’s in /var/ops/README. This is corp iron, not Mara’s deck — the trace runs hot. Diagnose, fix, walk away.',
    ],
    outro: [
      'Line 2’s spinning up. Work orders flowing. The floor crew thinks a ghost fixed their plant tonight. They’re not entirely wrong.',
      'Vex says the plant boss pays his debts — access key’s yours. That opens the Works’ inner gate.',
      'One machine, one bad bearing, one city limping for three days. Remember that scale. Now pull out clean.',
    ],
    fs: FORGE_FS,
    hosts: { 'forge-hist.local': FORGE_HIST_HOST },
    realScript: ``,
    realCheck: `[ -s /var/ops/maintenance/ack_2104 ] && echo OK`,
    hints: [
      'The plant’s nervous system is the ERP. sql forge_erp, then .tables to see what you’re standing in.',
      'Machines lie, sensors don’t. Join machines to sensor_readings — and filter by METRIC, not by how scary a number looks.',
      'A furnace at 1462 C is a furnace doing its job. A bearing at 143 C is a fire that hasn’t started yet. Check vibration_rms too.',
      'Diagnosis isn’t the win. The runbook in /var/ops/README has the clearing procedure: ack the machine, then release its blocked work orders.',
      "Surgical, like: UPDATE work_orders SET status='released' WHERE machine_id=2104 AND status='blocked'; — and don't forget the ack file: echo bearing replaced > /var/ops/maintenance/ack_2104",
    ],
    heatRate: 1.9,
    check(state) {
      try {
        const dbs = state.dbState || {}
        const erp = dbs.forge_erp && dbs.forge_erp.db
        // (a) the failing machine is resolved: ERP status flipped off 'fault',
        //     OR a non-empty maintenance ack file exists.
        let machineOk = false
        if (erp) {
          const r = query(erp, 'SELECT status FROM machines WHERE machine_id = 2104')
          machineOk = !r.error && r.rows.length > 0 && String(r.rows[0][0]) !== 'fault'
        }
        if (!machineOk) {
          const ack = state.readFile('/var/ops/maintenance/ack_2104')
          machineOk = typeof ack === 'string' && ack.trim().length > 0
        }
        if (!machineOk) return false
        // (b) every blocked work order on that machine has been released.
        if (!erp) return false
        const r2 = query(erp, "SELECT COUNT(*) FROM work_orders WHERE machine_id = 2104 AND status = 'blocked'")
        return !r2.error && r2.rows.length > 0 && Number(r2.rows[0][0]) === 0
      } catch { return false }
    },
    onWin: 'forge_boss_done',
    boss: true,
    reward: { creds: 240, kit: ['prog_tablesaw'], codex: ['cx_sql_joins', 'key_forge_works'] },
  },
}
