// maps.js — every overworld map in NETRUNNER, hand-drawn as ASCII and compiled
// to the contract shape (ARCHITECTURE.md §5):
//
//   MAPS[id] = { w, h, tileset, layers:{ground:[ids...], over:[ids...]},
//                collide:[0/1...], warps:[{x,y,to,tx,ty}], triggers:[{x,y,event,once}],
//                npcs:[{id,x,y,path?,script?}], spawns:{default:{x,y}},
//                music, palette, weatherLock? }
//
// Arrays are row-major, length w*h. Tile ids reference assets/tiles.js TILES.
// Pure data — no imports — so it can be loaded and validated anywhere.
//
// Extra (documented, safe) keys consumed by overworld.js:
//   sky        rows of open skyline at the top of exterior maps (parallax band)
//   interior   true = roofed; day/night tint is softened, no rain
//   warps[].lock / warps[].lockMsg   flag gate on a warp (rail station)
//   npcs[].look / .dir / .unless     sprite key, initial facing, hide-if-flag

// ---------------------------------------------------------------- legend kit
const L = (g, c = 0, o = null) => ({ g, c, o })

// Shared character vocabulary. Maps may override entries (interiors swap '.'/'#').
const BASE = {
  ' ': L(null, 1),          // open sky — skyline band shows through, not walkable
  '#': L('wall', 1),
  'W': L('wall_int', 1),
  '.': L('floor_int'),
  'f': L('floor'),
  's': L('sidewalk'),
  'p': L('puddle'),
  'r': L('road'),
  'g': L('grass'),
  'w': L('water', 1),
  'n': L('neon', 1),
  'b': L('billboard', 1),
  'D': L('door'),           // walkable; a warp usually sits on it
  'R': L('rail', 1),
  'Z': L('rail', 1, 'server'), // train car: rail under, dark hull (over layer) on top
  'X': L('rail', 1, 'crate'),  // train end-cap / cargo car
  'S': L('server', 1),
  'C': L('counter', 1),
  'c': L('crate', 1),
  'd': L('desk', 1),
  'T': L('terminal', 1),
  'B': L('bed', 1),         // beds are save points (overworld handles interact)
  'u': L('rug'),
  'v': L('vent'),           // walkable grate, steam rises
}

// Compile ASCII rows -> {w,h,layers,collide}. Throws loudly on ragged rows so a
// typo in the art never ships silently.
function grid(id, rows, overrides = {}) {
  const legend = { ...BASE, ...overrides }
  const h = rows.length
  const w = rows[0].length
  const ground = new Array(w * h)
  const over = new Array(w * h)
  const collide = new Array(w * h)
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      throw new Error(`[maps] ${id}: row ${y} is ${rows[y].length} chars, expected ${w}`)
    }
    for (let x = 0; x < w; x++) {
      const cell = legend[rows[y][x]]
      if (!cell) throw new Error(`[maps] ${id}: unknown glyph '${rows[y][x]}' at ${x},${y}`)
      const i = y * w + x
      ground[i] = cell.g
      over[i] = cell.o
      collide[i] = cell.c ? 1 : 0
    }
  }
  return { w, h, layers: { ground, over }, collide }
}

const INT = { '#': L('wall_int', 1), '.': L('floor_int') } // homely interiors
const HARD = { '.': L('floor') }                            // concrete interiors

// =================================================================== MAPS
export const MAPS = {

  // ---- apartment — the warm start of everything ---------------------------
  // Kitchen nook top-left (sister at the counter), bed = save point, rug corner,
  // east door to Mara's room, south door down to Aster Street.
  apartment: {
    ...grid('apartment', [
      '#############',
      '#CCC#....d..#',
      '#...#.......#',
      '#...........#',
      '#B......uu..#',
      '#B......uu..D',
      '#...........#',
      '#...........#',
      '######D######',
    ], INT),
    tileset: 'aster',
    palette: 'aster',
    music: 'sister',
    interior: true,
    weatherLock: 'clear',
    spawns: { default: { x: 5, y: 6 } },
    warps: [
      { x: 12, y: 5, to: 'sister_room', tx: 3, ty: 5 },
      { x: 6, y: 8, to: 'aster_street', tx: 4, ty: 5 },
    ],
    triggers: [
      { x: 5, y: 6, event: 'intro_breakfast', once: true },
    ],
    npcs: [
      { id: 'sister', look: 'sister', x: 2, y: 2, dir: 'up', script: 'sister_morning', unless: 'sister_gone' },
    ],
  },

  // ---- sister_room — small, hers, wrong now --------------------------------
  // The rug hides her terminal: the trigger on the rug tile is the first jack-in.
  sister_room: {
    ...grid('sister_room', [
      '########',
      '#Bd....#',
      '#B.....#',
      '#..uu..#',
      '#......#',
      '#......#',
      '###D####',
    ], INT),
    tileset: 'aster',
    palette: 'aster',
    music: 'sister',
    interior: true,
    weatherLock: 'clear',
    spawns: { default: { x: 3, y: 5 } },
    warps: [
      { x: 3, y: 6, to: 'apartment', tx: 11, ty: 5 },
    ],
    triggers: [
      { x: 3, y: 3, event: 'inspect_terminal', once: false },
    ],
    npcs: [],
  },

  // ---- aster_street — the alive hub -----------------------------------------
  // Two sky rows for the parallax skyline. North block holds the apartment door
  // and a recessed noodle bar (vendor behind the counters). Avenue runs east to
  // the rail station gate (flag-locked). South block hides the Underground door;
  // an alley drops to the canal promenade where the kid plays.
  aster_street: {
    ...grid('aster_street', [
      '                              ',
      '                              ',
      '##b##n####b###nn##b####n###b##',
      '#n###b##n###n###b###n##b###n##',
      '#n##D#####fff##b####n####n####',
      '#sspssssssCCCsssssspsssssspss#',
      '#ssssssssssssssssssssssspssss#',
      '#rrrrrrrrrrrrrrrrrrrrrrrrrrrr#',
      '#rrrrrrrrrrrrrrrrrrrrrrrrrrrrD',
      '#rrrrrrrrrrrrrrrrrrrrrrrrrrrr#',
      '#ssssspsssssssssssssssspsssss#',
      '#sssssssssssspsssssssssssssss#',
      '######f######n###b##D####n####',
      '######f#######################',
      '#ffffffffffffffffffffffffffff#',
      '#gggggggggggggggggggggggggggg#',
      'wwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
    ]),
    tileset: 'aster',
    palette: 'aster',
    music: 'aster',
    sky: 2,
    spawns: { default: { x: 4, y: 5 } },
    warps: [
      { x: 4, y: 4, to: 'apartment', tx: 6, ty: 7 },
      { x: 20, y: 12, to: 'underground', tx: 2, ty: 2 },
      { x: 29, y: 8, to: 'rail_station', tx: 2, ty: 5, lock: 'rail_unlocked', lockMsg: 'STATION GATE SEALED — GRID LOCKDOWN' },
    ],
    triggers: [
      { x: 4, y: 5, event: 'enter_aster_street', once: true },
    ],
    npcs: [
      { id: 'vendor', look: 'npc_vendor', x: 11, y: 4, dir: 'down', script: 'vendor_noodles' },
      { id: 'commuter_a', look: 'npc_commuter', x: 5, y: 6, script: 'aster_commuter', path: [{ x: 2, y: 6 }, { x: 27, y: 6 }] },
      { id: 'commuter_b', look: 'npc_commuter', x: 22, y: 11, script: 'aster_commuter_2', path: [{ x: 26, y: 11 }, { x: 2, y: 11 }] },
      { id: 'kid', look: 'npc_kid', x: 8, y: 14, script: 'aster_kid', path: [{ x: 2, y: 14 }, { x: 13, y: 14 }, { x: 8, y: 15 }] },
      { id: 'watcher', look: 'npc_commuter', x: 27, y: 10, dir: 'right', script: 'aster_watcher' },
    ],
  },

  // ---- underground — the hacker den ------------------------------------------
  // Warm amber palette. Glitch lives at the center rig; Vex runs the bar.
  // Server racks hum along the walls; a crash cot doubles as a save point.
  underground: {
    ...grid('underground', [
      '######################',
      '##D##nSS##n##SS##n#S##',
      '#....................#',
      '#.cc......dTd.....SS.#',
      '#.cc.................#',
      '#.............uu.....#',
      '#..CC.........uu.....#',
      '#....................#',
      '#.B..................#',
      '#..........cc....dT..#',
      '#....................#',
      '#..S..S..S.........S.#',
      '######################',
    ], HARD),
    tileset: 'underground',
    palette: 'underground',
    music: 'underground',
    interior: true,
    weatherLock: 'clear',
    spawns: { default: { x: 2, y: 2 } },
    warps: [
      { x: 2, y: 1, to: 'aster_street', tx: 20, ty: 11 },
    ],
    triggers: [
      { x: 2, y: 2, event: 'enter_underground', once: true },
    ],
    npcs: [
      { id: 'glitch', look: 'glitch', x: 11, y: 4, dir: 'down', script: 'glitch_hub' },
      { id: 'vex', look: 'vex', x: 3, y: 7, dir: 'up', script: 'vex_hub', path: [{ x: 3, y: 7 }, { x: 5, y: 7 }] },
    ],
  },

  // ---- rail_station — the way out of Aster -------------------------------------
  // Open platform under the skyline; a maglev waits on the lower track.
  // Worldmap fast-travel drops arrivals at spawns.default.
  rail_station: {
    ...grid('rail_station', [
      '                          ',
      '                          ',
      '##n###bb###n###bb###n#####',
      '#........................#',
      '#........................#',
      'D........................#',
      '#........................#',
      'ssssssssssssssssssssssssss',
      'RRRRRRRRRRRRRRRRRRRRRRRRRR',
      'RRRRXZZZZZZZZZZZXRRRRRRRRR',
      'RRRRRRRRRRRRRRRRRRRRRRRRRR',
      '##########################',
    ], HARD),
    tileset: 'aster',
    palette: 'aster',
    music: 'aster',
    sky: 2,
    spawns: { default: { x: 4, y: 5 } },
    warps: [
      { x: 0, y: 5, to: 'aster_street', tx: 28, ty: 8 },
    ],
    triggers: [
      { x: 2, y: 5, event: 'enter_rail_station', once: true },
    ],
    npcs: [
      { id: 'conductor', look: 'npc_commuter', x: 8, y: 6, dir: 'down', script: 'conductor', path: [{ x: 4, y: 6 }, { x: 20, y: 6 }] },
    ],
  },

  // ---- forge_street — Forge Town, industrial entry -------------------------------
  // Steam vents, cargo, hazard signage. The plant door is the center of the face.
  // A rail stub enters from the west; the foreman paces under the plant gate.
  forge_street: {
    ...grid('forge_street', [
      '                          ',
      '                          ',
      '###bb####n#####nn####b####',
      '##n###########b######n####',
      '############D#############',
      'ffffffvffffffffffvffffffff',
      'ffcfffffffffffffffffffcfff',
      'ffcfffffvffffffffffffffcff',
      'RRRffffffffffffffvffffffff',
      'ffffffvfffffffffffffffffff',
      'ffffffffffffcfffffvfffffff',
      'fffffffffffccfffffffffffff',
      '####nn############bb######',
      '##########################',
    ], HARD),
    tileset: 'forge',
    palette: 'forge',
    music: 'forge',
    sky: 2,
    weatherLock: 'clear',
    spawns: { default: { x: 3, y: 8 } },
    warps: [
      { x: 12, y: 4, to: 'forge_plant', tx: 3, ty: 10 },
    ],
    triggers: [
      { x: 3, y: 8, event: 'enter_forge', once: true },
    ],
    npcs: [
      { id: 'foreman', look: 'npc_commuter', x: 14, y: 7, dir: 'left', script: 'forge_worker', path: [{ x: 10, y: 7 }, { x: 18, y: 7 }] },
    ],
  },

  // ---- forge_plant — inside the failing plant --------------------------------------
  // Machine rows, vents bleeding steam, a control rig up top. The boss stands at
  // the rig; their script ('boss_forge') leads into the m_forge_plant jack-in.
  forge_plant: {
    ...grid('forge_plant', [
      '####################',
      '#SS##nn##SS##nn##SS#',
      '#..................#',
      '#..cc....dTd....cc.#',
      '#..cc..............#',
      '#.v......vv......v.#',
      '#..................#',
      '#.SS....SS....SS...#',
      '#.SS....SS....SS...#',
      '#.........v........#',
      '#..................#',
      '###D################',
    ], HARD),
    tileset: 'forge',
    palette: 'forge',
    music: 'forge',
    interior: true,
    weatherLock: 'clear',
    spawns: { default: { x: 3, y: 10 } },
    warps: [
      { x: 3, y: 11, to: 'forge_street', tx: 12, ty: 5 },
    ],
    triggers: [
      { x: 3, y: 10, event: 'enter_forge_plant', once: true },
    ],
    npcs: [
      { id: 'boss_forge', look: 'boss_forge', x: 10, y: 4, dir: 'down', script: 'boss_forge' },
    ],
  },
}

export default MAPS
