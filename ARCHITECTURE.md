# NETRUNNER — Architecture Contract

A 2D top-down cyberpunk RPG that teaches real Linux. Vite + vanilla ES modules, single
fixed-size canvas (480×270, integer-scaled). The ONLY DOM UI is the jack-in terminal
(xterm.js). Everything else is drawn on the canvas.

Modules must conform EXACTLY to the signatures below so independently-built files link up.

## 1. Boot / loop  (src/main.js — DONE)
- `initRenderer(canvas)` → ctx. Loop via `frame((dt,t)=>…)`; dt clamped to 0.05s.
- Each frame: update current scene (or dialogue if active) → render scene → render dialogue
  overlay → render toasts → render transition.
- Global `window.NR = { G, scenes, bus, audio }` for debugging + automated verification.

## 2. Core engine (src/core/*) — DONE
- `events.js`  → `bus.on(evt,fn)→off`, `bus.emit(evt,payload)`.
- `state.js`   → `G` (live state), `setFlag/flag`, `save/load/hasSave/autosave/newGame`,
  `saveSettings/loadSettings`. Save slots 0..2; slot 0 = autosave.
- `input.js`   → `input.isDown(action)`, `wasPressed(action)`, `dir()→{x,y}`, `suspend(bool)`.
  Actions: left/right/up/down/confirm/cancel/menu/map/run.
- `renderer.js`→ `VIEW_W=480, VIEW_H=270`, `getCtx()`, `frame(cb)`, `setCRT(bool)`.
- `scenes.js`  → `Scene` base class {enter,exit,update,render,onKey}. `scenes.register(name,obj)`,
  `scenes.switchTo(name,params,mode)` mode∈'glitch'|'fade'|'none'.

## 3. State shape (G)
```
player:{name,look,map,x,y,dir}  flags:{}  quests:{id:stage}  kit:[progId]
codex:[entryId]  creds  rep  heatLosses  citiesUnlocked:[cityId]
clock:{minutes,day}  weather:'rain'|'clear'  settings:{crt,textSpeed,musicVol,sfxVol,vmMode}
```
### 3.6 Canonical story flags (string keys on G.flags)
`intro_breakfast_done` `intro_blackout_seen` `sister_gone` `found_terminal`
`jackin1_done` `met_glitch` `met_vex` `underground_unlocked` `rail_unlocked`
`forge_boss_done` `aster_boss_done`. Quests keyed in §8.

## 4. Assets (src/assets/* — generated, no binaries)
All art is CODE: functions that draw to a canvas ctx. No PNG files.
- `sprites.js` → `drawActor(ctx,x,y,{look,dir,frame,tint})` 16×24 humanoid;
  `ACTORS` table (player a/b/c, sister, glitch, vex, boss_*, npc_*).
- `tiles.js` → `TILES` map id→`draw(ctx,px,py,{t,anim})`; `drawTile(ctx,id,px,py,anim)`.
  Tile ids used by maps: floor,wall,road,sidewalk,neon,water,door,rail,grass,desk,
  terminal,bed,rug,counter,wall_int,floor_int,puddle,vent,crate,server,billboard.
- `palette.js` → `PAL` per-city palettes {bg,wall,road,neon1,neon2,accent,fog}.
- `vfx.js` → `Particles` class (rain, sparks, datamotes); `glitchRect(ctx,x,y,w,h,amt)`.
- `portraits.js` → `drawPortrait(ctx,id,x,y,scale,emotion)` for dialogue; ids match ACTORS.

## 5. World (src/world/*)
- `maps.js` → `MAPS` id→`{w,h,tileset,layers:{ground:[],over:[]},collide:[],
  warps:[{x,y,to,tx,ty}],triggers:[{x,y,event,once}],npcs:[{id,x,y,path,script}],
  spawns:{default:{x,y}}, music, palette, weatherLock?}`. Maps: apartment, sister_room,
  aster_street, underground, rail_station, forge_street, forge_plant.
- `tilemap.js` → `TileMap` renders ground/over layers w/ camera; `worldToScreen`, collision query.
- `actor.js` → `Actor` class: pos, dir, anim, `moveGrid`, follows `path` waypoints or `script`.
- `overworld.js` → `OverworldScene`. Owns player Actor, camera (smooth follow), NPC actors,
  weather particles, day/night tint from G.clock, neon flicker. Interact (confirm) raycasts
  one tile ahead → fires NPC script or trigger. `menu` key → pause, `map` key → worldmap
  (only if rail_unlocked). Advances G.clock (1 real sec ≈ 1 game min).

## 6. Events (bus)
`scene:switch` `flag` `toast`(str) `dialogue:start`(node) `dialogue:end`
`jackin:start`(missionId) `jackin:win`(missionId) `jackin:lose`(missionId)
`quest:advance`({id,stage}) `kit:add`(progId) `codex:add`(entryId) `time:tick`({minutes,day})

## 7. UI (src/ui/*)
- `dialogue.js` → `say(nodes)` queue; `dialogueActive()`, `updateDialogue(dt)`,
  `renderDialogue(ctx,t)`, `dialogueKey(e)`. Node:{who,portrait,emotion,text,choices?:[{label,
  goto?,action?}]}. Typewriter honoring G.settings.textSpeed; portrait + neon frame.
- `menu.js` → EthicsScene, MenuScene, NewGameScene(name+sprite), OptionsScene, CreditsScene.
- `hud.js` → PauseScene (Kit/Codex/Quests/Save/Options tabs), `say`-independent toasts:
  `updateToasts/renderToasts`. Listens to bus 'toast'.
- `worldmap.js` → WorldMapScene: rail network graph, fast-travel to unlocked cities.

## 8. Story (src/story/*)
- `script.js` → IntroScene (cinematic: breakfast → walk → blackout ERROR 404 → night →
  sister gone → her room → first jack-in). Drives via dialogue + scripted camera.
- `quests.js` → registers bus listeners that advance G.quests and set flags. Quests:
  q_find_terminal, q_underground, q_forge_plant. Pure logic, no rendering.
- `dialogues.js` → exported dialogue trees per NPC/beat, consumed by scripts & NPC scripts.

## 9. Terminal / real Linux (src/terminal/*)
- `jackin.js` → JackInScene. Shows #term-layer, mounts xterm, calls `input.suspend(true)`,
  loads the mission, runs the backend, drives Heat/Trace meter + Glitch comms, detects
  win via mission.check(), emits jackin:win/lose, restores overworld.
- `backend.js` → two interchangeable shells behind one interface:
  `makeBackend(mode)` → `{ write(data), onData(cb), resize(c,r), check(), dispose() }`.
  - mode 'real': CheerpX x86 Linux (lazy-loaded). Mounts mission disk overlay.
  - mode 'sim': pure-JS POSIX-ish shell (sim-shell.js) over an in-memory FS. Always available,
    needs no cross-origin isolation, used as fallback + for fast verification.
- `sim-shell.js` → `SimShell(fs)` implementing: ls,cd,pwd,cat,echo,grep,find,head,tail,
  cp,mv,rm,mkdir,touch,chmod,whoami,man,help,clear,ps,history,sql (pipes to db.js),
  ssh (to sibling fictional hosts). Tab-complete + history. `fs` = nested {name:{...}|"file
  contents"} with perms metadata.
- `missions.js` → `MISSIONS` id→`{host,objective,intro:[commsLines],fs (sim layout),
  realDiskUrl?, hints:[...], heatRate, check(shellState)→bool, onWin:flag, reward:{creds,
  kit?,codex?}}`. Missions: m_find_underground (intro), m_forge_plant (city 2 boss).

## 10. Databases — REAL corp schemas (src/data/*)
The fiction: each corp runs a real-world-style enterprise stack. Schemas mirror what actual
companies use so SQL learned here is transferable.
- `db.js` → sql.js wrapper. `openDB(corpId)→Database`; `query(sql)`; used by `sql` shell cmd.
- `schemas/` → real-shaped DDL + seed:
  - `aster_hr.sql`  — Workday/SAP-SuccessFactors-style HR: employees, departments, positions,
    job_history, payroll, the row for the sister (Mara) present then "deleted".
  - `grid_rbac.sql` — Active-Directory/Okta-style: users, groups, roles, permissions,
    access_log (who erased what — the audit trail the player greps).
  - `forge_erp.sql` — SAP-ERP-style MES: plants, work_orders, machines, sensor_readings,
    maintenance_log (the failing plant the player fixes).
Seeds are deterministic and small. The "sister's deleted row" lives in aster_hr + grid_rbac
access_log so the DB beat proves reality is being rewritten.

## 11. Audio (src/core/audio.js)
WebAudio synth (no asset files). `audio.unlock()`, `audio.play(theme)` themes:
menu,aster,underground,forge,hack,sister,victory; `audio.sfx(name)`:
blip,confirm,cancel,step,error,win,keyget,glitch,train. Respect G.settings vols. Loops with
ambient layers; `audio.duck()` during dialogue.

## Conventions
- ES modules, no TypeScript. No external art/audio binaries (sql.js wasm + CheerpX CDN only).
- Colors via PAL where possible. Keep per-file scope tight; cross-talk only through bus + G.
- Fictional targets only; ethics splash gates first launch. The word "lesson" never appears in UI.
