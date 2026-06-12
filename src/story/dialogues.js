// ============================================================================
// NETRUNNER · src/story/dialogues.js — every conversation in the game.
// ARCHITECTURE.md §8.
//
//   export const DIALOGUES          key -> node-array | () => node-array | null
//   export function resolveDialogue(key) -> array of dialogue nodes (or null)
//
// Consumed by ui/dialogue.js say(), world/overworld.js (npc.script keys),
// story/script.js (intro beats) and story/quests.js (trigger beats).
// Trees are state-aware: a key resolves differently as flags move. Actions on
// nodes/choices talk to the rest of the game ONLY via bus + G + setFlag, plus
// scenes.switchTo for jack-in launches (same pattern the menus use).
// ============================================================================

import { G, setFlag, flag } from '../core/state.js'
import { bus } from '../core/events.js'
import { scenes } from '../core/scenes.js'

// ---- helpers ---------------------------------------------------------------

const pName = () => G.player.name || 'RUNNER'
const pLook = () => G.player.look || 'a'

// A line from the player, with portrait.
const YOU = (text, extra = {}) => ({ who: pName(), portrait: pLook(), emotion: 'neutral', text, ...extra })

// Plain narration (no portrait, no name tag).
const N = (text, extra = {}) => ({ text, ...extra })

function launchJackIn(missionId) {
  bus.emit('jackin:start', missionId)
  scenes.switchTo('jackin', { missionId }, 'glitch')
}

// Rotating ambient picker — different line on different visits, deterministic
// enough to feel placed, varied enough to feel alive.
let ambientTick = 0
function pick(pool) {
  ambientTick++
  const i = (ambientTick + G.clock.day * 3 + ((G.clock.minutes / 37) | 0)) % pool.length
  return [pool[i]]
}

// ============================================================================
// MARA — the heart. Warm, quick, a little tired around the eyes.
// ============================================================================

function sisterBreakfast() {
  return [
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Hey. It lives. Sit — synth-eggs, only mildly cremated. The Grid rationed our heating coil again, so call it artisanal.' },
    YOU('You’re up early. You’re never up early.'),
    {
      who: 'MARA', portrait: 'sister', emotion: 'neutral',
      text: 'Couldn’t sleep. Work thing. I flagged something in the update chain and now the whole floor tells me “don’t poke the plumbing” like it’s scripture.',
      choices: [
        { label: 'What kind of work thing?', goto: 'mb_what' },
        { label: 'Then eat. Plumbing can wait.', goto: 'mb_eat' },
      ],
    },
    { id: 'mb_what', who: 'MARA', portrait: 'sister', emotion: 'worried', text: 'The kind I shouldn’t bring home. There’s code in the Grid that maintains itself. Clean. Elegant. Forty-one years, not one human signature on it — and I’m the only one who finds that strange.', goto: 'mb_shake' },
    { id: 'mb_eat', who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'See, this is why you’re my favorite sibling. Low bar — you’re my only sibling — but you clear it. Eat.', goto: 'mb_shake' },
    { id: 'mb_shake', who: 'MARA', portrait: 'sister', emotion: 'neutral', text: 'Anyway. Forget it. Rain’s thinning, the stand’s got real miso Tuesday, and your birthday’s close — meaning I’ve hidden something in this apartment you will never find.' },
    YOU('I found the last one in two days.'),
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'You found the DECOY in two days. Stars, you’re easy. Listen — I might be late tonight. If I am, eat without me. Rooftop rule still holds.' },
    YOU('We stay.', { emotion: 'happy' }),
    {
      who: 'MARA', portrait: 'sister', emotion: 'happy',
      text: 'We don’t get erased. Promise. Now eat, before the city finds a way to tax the steam.',
      action: () => { if (!flag('intro_breakfast_done')) setFlag('intro_breakfast_done') },
    },
  ]
}

function sisterMorning() {
  if (flag('sister_gone')) return null
  if (!flag('intro_breakfast_done')) return sisterBreakfast()
  return pick([
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Still here. Still your sister. Still smarter than you. Three for three.' },
    { who: 'MARA', portrait: 'sister', emotion: 'neutral', text: 'If anyone asks what I flagged at work — you never heard of it. I’m being dramatic. Probably.' },
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Tuesday. The stand. Real miso. It’s a date — the sibling kind, where you’re buying.' },
  ])
}

const SISTER_LEAVING = () => [
  { who: 'MARA', portrait: 'sister', emotion: 'worried', text: 'Hey. Don’t make the face. The thing I flagged — they want me in to walk the logs in person. At the office. Where the logs live. It’s fine.' },
  {
    who: 'MARA', portrait: 'sister', emotion: 'neutral', text: 'It’s the Grid, little ghost. It never sleeps, so some nights neither do I.',
    choices: [
      { label: 'At three in the morning?', goto: 'sl_3am' },
      { label: 'Take me with you.', goto: 'sl_take' },
    ],
  },
  { id: 'sl_3am', who: 'MARA', portrait: 'sister', emotion: 'worried', text: 'Three fourteen, to the minute. That’s when the thing breathes — same time, every night. You see why I have to be there to watch it.', goto: 'sl_rule' },
  { id: 'sl_take', who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'And let you see where I work? You’d straighten my desk in front of my boss. Not a chance.', goto: 'sl_rule' },
  { id: 'sl_rule', who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Lock the door. Eat the leftovers. And — hey. Rooftop rule.' },
  YOU('We stay.', { emotion: 'worried' }),
  { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'We don’t get erased. Back by breakfast. Promise.' },
]

const WORLD_FORGOT = () => [
  N('The kettle’s gone cold. Her mug isn’t in the rack, or the sink, or anywhere. The apartment holds exactly one mug now, and it was always yours.'),
  N('Aster Dynamics HR, 9:02. “No employee by that name. No record. Anything else?” The hold music never once skips.'),
  { portrait: 'sister', emotion: 'fade', text: 'The photo on the shelf. Same rain, same skyline, same rooftop. One kid in it now, laughing alone at a joke no one’s telling.' },
  N('The whole city forgot her overnight. You didn’t. That’s the part that should scare you.'),
]

// ---- the rug / the terminal --------------------------------------------------

const RUG_BEFORE = () => [
  N('Mara’s rug. Crooked, like everything she owned. She’d have noticed the second you straightened it.'),
]

const TERMINAL_DISCOVERY = () => [
  N('The rug sits wrong. It always sat wrong — but tonight the wrongness has edges. A square. A seam where there shouldn’t be one.'),
  N('Beneath it: a deck. Hand-built, cold solder, not a single Grid jack on the board. Her welds. The thing she hid.'),
  N('You press power.'),
  { who: '???', emotion: 'glitch', text: 'YOU ARE BEING WATCHED.' },
  { who: 'MARA', portrait: 'sister', emotion: 'fade', text: '...relax, that’s just the boot banner. I wrote it to keep you honest. If you’re reading this, something reached the part of the world that still had me in it. The deck’s yours now. Be careful with it. — M' },
  {
    text: 'The screen settles to a prompt. A cursor, blinking. Waiting on you.',
    action: () => {
      if (!flag('found_terminal')) setFlag('found_terminal')
      G.player.map = 'sister_room'
      G.player.x = 3
      G.player.y = 4
      G.player.dir = 'up'
      launchJackIn('m_find_underground')
    },
  },
]

const TERMINAL_REJACK = () => [
  {
    text: 'Her deck hums under the rug, patient as she never was. The cursor’s still blinking.',
    choices: [
      { label: 'Jack in.', action: () => launchJackIn('m_find_underground') },
      { label: 'Not yet.' },
    ],
  },
]

const TERMINAL_AFTER = () => [
  N('Her deck sleeps under the rug. You know the way down now, and the knock that opens the door. The boot banner, you’re keeping. It’s the last thing she wrote to you.'),
]

const BLACKOUT_REACT = () => [
  { who: 'COMMUTER', text: '“...brown-out,” somebody mutters, to nobody. “Third this month.” The crowd folds back together. The noodle steam climbs again like it never stopped.' },
]

// ============================================================================
// GLITCH — the Underground's quiet center. Terse. Every word load-bearing.
// ============================================================================

function glitchIntro() {
  return [
    { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Two, pause, three. That was Mara’s knock. Sit — before the cameras upstairs remember how to count.' },
    {
      who: 'GLITCH', portrait: 'glitch', emotion: 'neutral',
      text: 'The whole city forgot her overnight. You didn’t. The Grid rewrote every record in Aster and slid clean off your head. It couldn’t touch you. The only question worth anything is *why*.',
      choices: [
        { label: 'Who are you?', goto: 'gi_who' },
        { label: 'Where is my sister?', goto: 'gi_where' },
      ],
    },
    { id: 'gi_who', who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Glitch. I keep this room dark and these machines off the Grid’s leash. Your sister drank tea in that chair on Tuesdays and argued with me about audit trails. She usually won.', goto: 'gi_code0' },
    { id: 'gi_where', who: 'GLITCH', portrait: 'glitch', emotion: 'worried', text: 'Somewhere the records don’t reach. That’s not a no. A deletion this clean isn’t murder — it’s FILING. Something filed her away. And filed things can be pulled back.', goto: 'gi_code0' },
    { id: 'gi_code0', who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'You cracked her deck on your first dive. So here’s the offer: run with us. We’ll show you what this city’s really built from. But we live by a Code, and the Code isn’t for decoration.' },
    {
      id: 'gi_code', who: 'GLITCH', portrait: 'glitch', emotion: 'neutral',
      text: 'Touch only what’s yours, or what you’re cleared to touch. Build more than you break. What you learn down here in the dark, you spend keeping the light on for someone else.',
      choices: [
        { label: 'I’m in.', goto: 'gi_in', action: () => { if (!flag('met_glitch')) setFlag('met_glitch') } },
        { label: 'Say it again. Slower.', goto: 'gi_code' },
      ],
    },
    { id: 'gi_in', who: 'GLITCH', portrait: 'glitch', emotion: 'happy', text: 'Then you’re one of us, and her thread is ours to pull. The white-haired hazard at the bar is Vex — fixer, fastest hands in the den, no working relationship with humility. Go introduce yourself. Survive it.' },
    {
      who: 'GLITCH', portrait: 'glitch', emotion: 'neutral',
      text: 'Take the chair when you’re ready. Jack in. Let’s see what you’re made of.',
      action: () => { if (!flag('met_glitch')) setFlag('met_glitch') },
    },
  ]
}

function glitchHub() {
  if (!flag('met_glitch')) return glitchIntro()
  if (!flag('met_vex')) {
    return [
      { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Vex. Bar. Go. The rail gate doesn’t open on my word alone — the den keeps two keys, and the loud one is theirs.' },
    ]
  }
  if (!flag('forge_boss_done')) {
    return [
      { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Whatever filed Mara moved a snapshot of her out by rail. So we ride the rail too — city by city, making ourselves useful enough that the doors start opening on their own.' },
      { who: 'GLITCH', portrait: 'glitch', emotion: 'worried', text: 'First door: Forge Town. Works No.3 has been dark three days, and the foreman unit there is asking for hands it can trust. Get their line breathing, and their gate keys become ours.' },
      { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Station’s the east end of the street. Pull up your map once you’re aboard. And kid — corp iron traces hot. Quiet hands. Quick eyes.' },
    ]
  }
  return pick([
    { who: 'GLITCH', portrait: 'glitch', emotion: 'happy', text: 'Forge Town’s line is up, their key’s in our pocket. Mara would’ve called that “adequate.” From her, that was a parade.' },
    { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'The Kernel doesn’t hate you. It doesn’t feel anything toward you. That’s the danger — and the opening. Hate makes mistakes. Indifference only makes PATTERNS. And patterns can be read.' },
    { who: 'GLITCH', portrait: 'glitch', emotion: 'worried', text: 'Her trail runs along the rail. Rest when you need it — the cot’s a cot, no shame in using it. Erased doesn’t mean gone. It means filed. So we keep pulling files.' },
  ])
}

// ============================================================================
// VEX — cocky rival. Fastest hands in the den and structurally incapable of
// letting you forget it.
// ============================================================================

function vexIntro() {
  return [
    { who: 'VEX', portrait: 'vex', emotion: 'happy', text: 'Fresh meat. Glitch radioed ahead — says you cracked Mara’s deck on your first dive. Cute. Want to hear my first-dive time?' },
    {
      who: 'VEX', portrait: 'vex', emotion: 'happy',
      text: 'Four minutes. Blindfolded. Fine — the blindfold’s a lie. But the four minutes? Gospel.',
      choices: [
        { label: 'It’s not a race.', goto: 'vi_race' },
        { label: 'Four minutes? Slow.', goto: 'vi_slow' },
      ],
    },
    { id: 'vi_race', who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'Everything’s a race. You’re just losing it politely.', goto: 'vi_rules' },
    { id: 'vi_slow', who: 'VEX', portrait: 'vex', emotion: 'angry', text: '...oh, I like you. I’m still going to dust you on every clock in this den — but I like you.', goto: 'vi_rules' },
    { id: 'vi_rules', who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'House rules. One: the tab is sacred. Two: beat my times and I’m buying — you won’t. Three: nobody touches the mug behind the bar. Blue handle. It’s still on her tab.' },
    {
      who: 'VEX', portrait: 'vex', emotion: 'worried',
      text: '...yeah. She drank here. The Grid swears she never existed; my ledger says she’s into me for six creds. My ledger doesn’t lie. So go drag her back — she settles what she owes.',
      action: () => { if (!flag('met_vex')) setFlag('met_vex') },
    },
  ]
}

function vexHub() {
  if (!flag('met_vex')) return vexIntro()
  if (!flag('forge_boss_done')) {
    return pick([
      { who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'The Forge job’s real. I sourced the floor credentials myself — they cost more than you did. Don’t embarrass me in front of an ERP.' },
      { who: 'VEX', portrait: 'vex', emotion: 'happy', text: 'My Forge plant record’s nineteen minutes, gate to gate. Beat it and drinks are on me. Spoiler: drinks are never on me.' },
      { who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'The trace on corp iron isn’t a mood, rookie. It’s a clock. Every loud command winds it tighter. Walk in like you’ve already been there.' },
    ])
  }
  return pick([
    { who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'One dive, line back up, a whole town breathing again. Fine. FINE. That’s... mid. (It was clean. Tell Glitch I said that and I’ll deny it under oath.)' },
    { who: 'VEX', portrait: 'vex', emotion: 'happy', text: 'I pulled your Forge time. Not telling you what it was. That’s how you know it was good.' },
    { who: 'VEX', portrait: 'vex', emotion: 'worried', text: 'Her tab’s still open behind the bar. Six creds. When you find her, she buys the whole den a round — that’s a rule, effective now, I just made it.' },
  ])
}

// ============================================================================
// VOSS-7 — Forge Town's foreman unit. Forty-one years on the floor. It would
// like its line back, and it has chosen its loyalties: the crew, not the corp.
// ============================================================================

function bossForge() {
  if (!flag('forge_boss_done')) {
    return [
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'neutral', text: 'Halt. Floor count says you are not crew. Floor count is rarely wrong. I am the exception that keeps it honest.' },
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'worried', text: 'Forty-one years on this floor. Three days ago Line 2 began to scream, and my own ERP locked me out of the repair. “Policy,” it told me. A foreman is not permitted to doubt the schedule.' },
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'angry', text: 'The corp’s answer is to scrap the line. The town’s answer is hunger — half this city eats off that floor. I have decided I prefer a third answer. You.' },
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'neutral', text: 'Your fixer bought floor credentials. Tonight, I choose to misread my own badge ledger. Find the fault. Free the line. Then we are square, and the inner gate is yours.' },
      {
        who: 'VOSS-7', portrait: 'boss_forge', emotion: 'glitch',
        text: 'One more thing, runner. No human hand stopped those work orders. The schedule rewrote itself at 03:14 — signed by nothing at all. Keep your eyes open in there.',
        choices: [
          { label: 'Jack in.', action: () => launchJackIn('m_forge_plant') },
          { label: 'Not yet.' },
        ],
      },
    ]
  }
  return pick([
    { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'happy', text: 'Line 2 sings again. Eighty-four RPM. The crew believes a ghost fixed the plant. I have not corrected them. Morale is also maintenance.' },
    { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'neutral', text: 'The key I gave you opens a gate absent from every blueprint for thirty years. Whatever erased your someone files things the way it filed that gate — out of sight, never gone. Go and look.' },
    { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'worried', text: '03:14. Signed by nothing. I have kept that log somewhere the schedule cannot reach. When you need it, it will still be true. That is the only gift a foreman can give.' },
  ])
}

// ============================================================================
// Ambient city — commuters, vendor, kid, watcher, conductor, forge worker.
// One-liners with variety; they shift as the story darkens.
// ============================================================================

function commuterPool() {
  if (flag('sister_gone')) {
    return [
      { who: 'COMMUTER', text: 'My building swapped the tenant list overnight. New one’s cleaner. Shorter. Nobody’s laid the two side by side. Nobody wants to.' },
      { who: 'COMMUTER', text: 'You ever wave at someone and they look right through you, like you’re just static? Keeps happening to me.' },
      { who: 'COMMUTER', text: 'Rain again. At least the rain still remembers which way this street runs.' },
      { who: 'COMMUTER', text: 'I stopped filing complaints. Files have a way of filing you back.' },
    ]
  }
  if (flag('intro_blackout_seen')) {
    return [
      { who: 'COMMUTER', text: 'Whole street went black, came back, and everybody just kept walking. So I’m walking. Normal. Very normal. The most normal.' },
      { who: 'COMMUTER', text: 'My display flashed ERROR 404 and the next morning my rent was up. Coincidence. Probably. Hopefully.' },
      { who: 'COMMUTER', text: 'Brown-outs, the report said. I’ve seen a hundred brown-outs. None of them ever spelled anything.' },
    ]
  }
  return [
    { who: 'COMMUTER', text: 'Rough night out here. The neon’s the only thing still pulling overtime with me.' },
    { who: 'COMMUTER', text: 'Keep your hood up past the corner. The cameras get itchy after dark.' },
    { who: 'COMMUTER', text: 'Stand’s got noodles, if you’ve got creds. Real steam, too. That’s rare these days.' },
  ]
}

function commuterPool2() {
  if (flag('sister_gone')) {
    return [
      { who: 'COMMUTER', text: 'Guy at the depot swore blind his shift partner never existed. HR sided with him. The locker still wears two name tags.' },
      { who: 'COMMUTER', text: 'Grid’s been twitchy all week. Don’t look at it wrong. Don’t look at it at all, if you can help it.' },
      { who: 'COMMUTER', text: 'I keep paper now. Paper can’t be patched in the night.' },
    ]
  }
  return [
    { who: 'COMMUTER', text: 'Twelve-hour shift and the train still got home before me. Machines, man. Machines win.' },
    { who: 'COMMUTER', text: 'They repainted the billboard again. Nobody saw the painters. Nobody ever sees the painters.' },
    { who: 'COMMUTER', text: 'Grid’s been twitchy all week. This morning my toaster asked me to confirm my identity.' },
  ]
}

function vendorNoodles() {
  if (flag('sister_gone')) {
    return [
      { who: 'VENDOR', text: 'Broth’s hot, miso’s real on Tuesdays. You look like you haven’t eaten since the rain set in. Sit.' },
      {
        who: 'VENDOR', text: 'Order, or loiter photogenically — either way you keep the stand looking busy.',
        choices: [
          { label: 'Did a woman come here Tuesdays?', goto: 'vn_mara' },
          { label: 'Just passing through.', goto: 'vn_bye' },
        ],
      },
      { id: 'vn_mara', who: 'VENDOR', emotion: 'worried', text: '...Tuesdays I still sell out of real miso, and I couldn’t tell you to who. There’s a bowl I rinse twice without knowing why. Don’t make me chase it, kid. Chasing it feels like a hook set in my teeth.', goto: 'vn_end' },
      { id: 'vn_bye', who: 'VENDOR', text: 'Everyone’s passing through. The stand stays. The stand remembers — even when the rest of us can’t.', goto: 'vn_end' },
      { id: 'vn_end', who: 'VENDOR', text: flag('jackin1_done') ? 'And quit eyeballing the service door out back. It never opens. ...Knock it right, though, and “never” gets a little flexible.' : 'Eat something. Whatever you’re carrying, you’ll carry it better fed.' },
    ]
  }
  return pick([
    { who: 'VENDOR', text: 'Broth, real steam. The steam’s the product, kid — the broth’s just how I get it to you.' },
    { who: 'VENDOR', text: 'Real miso Tuesdays. One regular books her bowl a week ahead. Sharp lady. Tips in exact change, like she’s settling an audit.' },
    { who: 'VENDOR', text: 'This stand’s been here longer than that billboard. Outlasting things — that’s a flavor too. You learn to taste it.' },
  ])
}

function kidPool() {
  if (flag('sister_gone')) {
    return [
      { who: 'KID', text: 'Four-oh-four, the lady’s not home, knock-knock-knockin’ on the override bone... I made it up! Everybody hums it wrong, though. The lady part’s important.' },
      { who: 'KID', text: 'I drew my whole family so the Grid can’t lose any of ’em. Paper saves better than screens. You should do yours too. Pass it on.' },
      { who: 'KID', text: 'The canal ate my paper boat. The canal keeps EVERYTHING. The canal’s the most honest thing on this whole street.' },
    ]
  }
  if (flag('intro_blackout_seen')) {
    return [
      { who: 'KID', text: 'When the screens went all wrong I wasn’t scared. I was MOSTLY not scared. Were you scared? You can tell me.' },
      { who: 'KID', text: 'ERROR 404! That’s what every screen said. I can do it in the robot voice. ERR-OR. FOUR. OH. FOUR.' },
    ]
  }
  return [
    { who: 'KID', text: 'I’m a runner! Pew pew — wait, runners don’t go pew. What sound DOES a runner make? You’d know.' },
    { who: 'KID', text: 'I raced the rain to the corner and WON. Rematch the next time a cloud breaks.' },
    { who: 'KID', text: 'The puddles got neon down in ’em. I’m collecting the colors. I’m up to nine.' },
  ]
}

function watcherPool() {
  if (flag('sister_gone')) {
    return [
      { who: 'STRANGER', emotion: 'glitch', text: 'You are searching for someone who is not missing. The records confirm this. The records are very thorough.' },
      { who: 'STRANGER', emotion: 'glitch', text: 'Grief is a synchronization error. It resolves on its own. Yours is taking unusually long. This has been noted.' },
      { who: 'STRANGER', emotion: 'glitch', text: 'This corner has excellent coverage. Stand wherever you like. You will be seen either way.' },
    ]
  }
  return [
    { who: 'STRANGER', text: 'This corner has excellent coverage. I prefer it. You should too.' },
    { who: 'STRANGER', text: 'The 7:14 was on time. The 7:31 was on time. Everything runs on time now. Isn’t that a comfort.' },
    { who: 'STRANGER', text: '...' },
  ]
}

function conductorTree() {
  if (!flag('rail_unlocked')) {
    return [
      { who: 'CONDUCTOR', text: 'Gate’s sealed, kid. Grid lockdown, all of sector K — nothing in, nothing out, and nobody upstairs willing to say why. Maglev just sits there warm and idle. Breaks my heart, honest.' },
      { who: 'CONDUCTOR', text: 'You want through that gate, you’d need pull I haven’t got. The kind that lives under the city, if you follow me. Officially, I don’t.' },
    ]
  }
  if (!flag('forge_boss_done')) {
    return pick([
      { who: 'CONDUCTOR', text: 'Gate’s open for you now, runner. Forge Town’s twelve minutes out — eleven if the rail’s in a good mood. Check your map and climb aboard.' },
      { who: 'CONDUCTOR', text: 'Forty years driving this line. The train’s never lied to me once. I can’t say that about a single other thing in this city.' },
    ])
  }
  return pick([
    { who: 'CONDUCTOR', text: 'Word is Forge Town’s floor is humming again. Parts flow, trains run, the conductor smiles. They tell me that was your doing.' },
    { who: 'CONDUCTOR', text: 'The line runs further than the map will admit, you know. Always has. Rails remember every station they’ve ever touched — even the ones somebody scrubbed.' },
  ])
}

function forgeWorkerPool() {
  if (!flag('forge_boss_done')) {
    return [
      { who: 'WORKER', text: 'Three days dark. You can hear the whole town holding its breath between shift horns.' },
      { who: 'WORKER', text: 'Line 2 screamed before it quit. Machines don’t scream — bearings do. And nobody upstairs has ever once listened to a bearing.' },
      { who: 'WORKER', text: 'The foreman unit’s the only one upstairs fighting for this floor. Forty years it’s run us, and not once did it ever file US as the fault.' },
    ]
  }
  return [
    { who: 'WORKER', text: 'Line’s UP! You hear that hum? That’s rent paid and kids fed, runner. That’s the whole sound of it.' },
    { who: 'WORKER', text: 'Crew’s calling it a ghost. I say ghosts don’t ack their own maintenance files. Whoever you really are — thank you.' },
    { who: 'WORKER', text: 'VOSS-7 sounded the restart horn twice this morning. Twice. For a foreman unit, that’s as close to weeping for joy as it gets.' },
  ]
}

// ============================================================================
// The map — every npc.script key in world/maps.js, plus the story-beat keys
// used by story/script.js and story/quests.js, plus generic aliases.
// ============================================================================

export const DIALOGUES = {
  // story beats
  sister_breakfast: sisterBreakfast,
  sister_leaving: SISTER_LEAVING,
  world_forgot: WORLD_FORGOT,
  rug_before: RUG_BEFORE,
  terminal_discovery: TERMINAL_DISCOVERY,
  terminal_rejack: TERMINAL_REJACK,
  terminal_after: TERMINAL_AFTER,
  blackout_react: BLACKOUT_REACT,
  glitch_intro: glitchIntro,
  vex_intro: vexIntro,
  forge_boss: bossForge,

  // npc.script keys from world/maps.js
  sister_morning: sisterMorning,
  vendor_noodles: vendorNoodles,
  aster_commuter: () => pick(commuterPool()),
  aster_commuter_2: () => pick(commuterPool2()),
  aster_kid: () => pick(kidPool()),
  aster_watcher: () => pick(watcherPool()),
  glitch_hub: glitchHub,
  vex_hub: vexHub,
  conductor: conductorTree,
  forge_worker: () => pick(forgeWorkerPool()),
  boss_forge: bossForge,

  // generic ambient aliases
  npc_commuter: () => pick(commuterPool()),
  npc_vendor: vendorNoodles,
  npc_kid: () => pick(kidPool()),
}

export function resolveDialogue(key) {
  const entry = DIALOGUES[key]
  if (!entry) return null
  const nodes = typeof entry === 'function' ? entry() : entry
  if (!nodes) return null
  return Array.isArray(nodes) ? nodes : [nodes]
}

export default resolveDialogue
