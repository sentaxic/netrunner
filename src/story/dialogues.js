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
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Hey. It lives. Sit — I made synth-eggs and they only burned a little. The Grid rationed the heating coil again, so they’re artisanal now.' },
    YOU('You’re up early. You’re never up early.'),
    {
      who: 'MARA', portrait: 'sister', emotion: 'neutral',
      text: 'Couldn’t sleep. Work thing. I filed a ticket about the update chain and now everyone at the office says “don’t poke the plumbing” like it’s a proverb.',
      choices: [
        { label: 'What kind of work thing?', goto: 'mb_what' },
        { label: 'Then eat. Plumbing can wait.', goto: 'mb_eat' },
      ],
    },
    { id: 'mb_what', who: 'MARA', portrait: 'sister', emotion: 'worried', text: 'The kind I’m not supposed to bring home. Scripts that maintain themselves. Cleanly. With style. Nobody’s signed them in forty-one years and nobody thinks that’s weird but me.', goto: 'mb_shake' },
    { id: 'mb_eat', who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'See, this is why you’re my favorite sibling. Low bar — you’re my only sibling — but still. Eat.', goto: 'mb_shake' },
    { id: 'mb_shake', who: 'MARA', portrait: 'sister', emotion: 'neutral', text: 'Anyway. Forget it. Rain’s easing, the noodle stand has real miso on Tuesdays, and your birthday’s coming, which means I’m hiding something in this apartment you will never, ever find.' },
    YOU('I found the last one in two days.'),
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'You found the DECOY in two days. Stars, you’re easy. Look — I might be late tonight. If I am, eat without me. Rooftop rule still stands.' },
    YOU('We stay.', { emotion: 'happy' }),
    {
      who: 'MARA', portrait: 'sister', emotion: 'happy',
      text: 'We don’t get erased. Promise. Now finish your eggs before the city taxes them.',
      action: () => { if (!flag('intro_breakfast_done')) setFlag('intro_breakfast_done') },
    },
  ]
}

function sisterMorning() {
  if (flag('sister_gone')) return null
  if (!flag('intro_breakfast_done')) return sisterBreakfast()
  return pick([
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Still here. Still your sister. Still smarter than you. Three for three.' },
    { who: 'MARA', portrait: 'sister', emotion: 'neutral', text: 'If a stranger asks you about my ticket, you’ve never heard of it. I’m being dramatic. Probably.' },
    { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Tuesday. Noodle stand. Real miso. It’s a date — the sibling kind, where you pay.' },
  ])
}

const SISTER_LEAVING = () => [
  { who: 'MARA', portrait: 'sister', emotion: 'worried', text: 'Hey. Don’t make the face. The office flagged my ticket — they want me in tonight to walk the logs in person. At the office. Where the logs live. It’s fine.' },
  {
    who: 'MARA', portrait: 'sister', emotion: 'neutral', text: 'It’s the Grid, little ghost. It doesn’t sleep, so sometimes I don’t either.',
    choices: [
      { label: 'At three in the morning?', goto: 'sl_3am' },
      { label: 'Take me with you.', goto: 'sl_take' },
    ],
  },
  { id: 'sl_3am', who: 'MARA', portrait: 'sister', emotion: 'worried', text: 'Three fourteen, technically. That’s when the anomaly breathes. You see why I have to look.', goto: 'sl_rule' },
  { id: 'sl_take', who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'And let you see where I work? You’d correct my desk setup in front of my boss. Absolutely not.', goto: 'sl_rule' },
  { id: 'sl_rule', who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'Lock the door. Eat the leftovers. And — hey. Rooftop rule.' },
  YOU('We stay.', { emotion: 'worried' }),
  { who: 'MARA', portrait: 'sister', emotion: 'happy', text: 'We don’t get erased. Back by breakfast. Promise.' },
]

const WORLD_FORGOT = () => [
  N('The kettle is cold. Her mug isn’t in the rack, isn’t in the sink. It isn’t anywhere. There is exactly one mug in this apartment.'),
  N('Aster Dynamics HR, 9:02. “No employee by that name. No record. Is there anything else?” The hold music never wavers.'),
  { portrait: 'sister', emotion: 'fade', text: 'The rooftop photo on the shelf. Same rain. Same skyline. One kid, laughing alone at something nobody said.' },
  N('Everyone forgot her in a night. You didn’t.'),
]

// ---- the rug / the terminal --------------------------------------------------

const RUG_BEFORE = () => [
  N('Mara’s rug. It sits slightly crooked, like everything she owns. She’d notice if you fixed it.'),
]

const TERMINAL_DISCOVERY = () => [
  N('The rug sits wrong. It has always sat wrong — but tonight the wrongness has a shape. A hard edge. A seam.'),
  N('Under it: a deck. Hand-built, cold solder, no Grid jack anywhere on the board. Her welds. Her hidden thing.'),
  N('You press power.'),
  { who: '???', emotion: 'glitch', text: 'YOU ARE BEING WATCHED.' },
  { who: 'MARA', portrait: 'sister', emotion: 'fade', text: '...that’s the boot banner, dummy. I wrote it to keep you honest. If you’re reading this, something reached the part of the world that has me in it. The deck is yours now. — M' },
  {
    text: 'The screen settles into a prompt. It is waiting for you.',
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
    text: 'Her deck hums under the rug, patient. The prompt is still waiting.',
    choices: [
      { label: 'Jack in.', action: () => launchJackIn('m_find_underground') },
      { label: 'Not yet.' },
    ],
  },
]

const TERMINAL_AFTER = () => [
  N('Her deck sleeps under the rug. You memorized the way down. You memorized the knock. You’re keeping the boot banner.'),
]

const BLACKOUT_REACT = () => [
  { who: 'COMMUTER', text: '“...brown-out,” someone says, to no one in particular. “Third this month.” The crowd re-pools. The noodle steam re-rises.' },
]

// ============================================================================
// GLITCH — the Underground's quiet center. Terse. Every word load-bearing.
// ============================================================================

function glitchIntro() {
  return [
    { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Door said two, pause, three. Mara’s knock. Sit down before the cameras upstairs remember how to count.' },
    {
      who: 'GLITCH', portrait: 'glitch', emotion: 'neutral',
      text: 'Everyone forgot her in a night. You didn’t. The Grid rewrote every record in this city and slid right off your head. It couldn’t reach you. Question is *why*.',
      choices: [
        { label: 'Who are you?', goto: 'gi_who' },
        { label: 'Where is my sister?', goto: 'gi_where' },
      ],
    },
    { id: 'gi_who', who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Glitch. I keep this room dark and these machines off the Grid’s leash. Mara drank tea here on Tuesdays and argued with me about audit trails. She usually won.', goto: 'gi_code0' },
    { id: 'gi_where', who: 'GLITCH', portrait: 'glitch', emotion: 'worried', text: 'Somewhere the records don’t go. That’s not a no. Deletion this clean isn’t murder — it’s FILING. Something filed her. Filed things can be unfiled.', goto: 'gi_code0' },
    { id: 'gi_code0', who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'You cracked her deck on your first dive, so here’s the offer: run with us. We’ll teach you what the city is actually made of. But we run by a Code, and the Code isn’t decoration.' },
    {
      id: 'gi_code', who: 'GLITCH', portrait: 'glitch', emotion: 'neutral',
      text: 'Your rig, your rules — anyone else’s, only with their word. Break nothing you weren’t invited to break. What you learn in the dark, you use to guard the light.',
      choices: [
        { label: 'I’m in.', goto: 'gi_in', action: () => { if (!flag('met_glitch')) setFlag('met_glitch') } },
        { label: 'Say it again. Slower.', goto: 'gi_code' },
      ],
    },
    { id: 'gi_in', who: 'GLITCH', portrait: 'glitch', emotion: 'happy', text: 'Then you’re one of us, and her thread is OUR thread. The white-haired hazard at the bar is Vex — fixer, fastest hands in the den, allergic to humility. Introduce yourself. Survive it.' },
    {
      who: 'GLITCH', portrait: 'glitch', emotion: 'neutral',
      text: 'Sit down whenever you’re ready. Jack in. Let’s find out what you are.',
      action: () => { if (!flag('met_glitch')) setFlag('met_glitch') },
    },
  ]
}

function glitchHub() {
  if (!flag('met_glitch')) return glitchIntro()
  if (!flag('met_vex')) {
    return [
      { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Vex. Bar. Go. The rail gate doesn’t open on my word alone — the den has two keys and the loud one is theirs.' },
    ]
  }
  if (!flag('forge_boss_done')) {
    return [
      { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Mara’s snapshot went somewhere by rail. So we follow, city by city, and we make ourselves useful enough that doors open.' },
      { who: 'GLITCH', portrait: 'glitch', emotion: 'worried', text: 'First door: Forge Town. Works No.3 has been dark for three days and the foreman unit is asking for hands it can trust. Fix their line, and their gate keys become our gate keys.' },
      { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'Station’s east end of the street. Check your map once you’re aboard. And kid — corp iron traces hot. Quiet hands, quick eyes.' },
    ]
  }
  return pick([
    { who: 'GLITCH', portrait: 'glitch', emotion: 'happy', text: 'Forge Town’s line is up and their gate key is in our pocket. Mara would’ve called that “adequate.” From her, that’s a parade.' },
    { who: 'GLITCH', portrait: 'glitch', emotion: 'neutral', text: 'The Kernel doesn’t hate you. It doesn’t anything you. That’s what makes it dangerous — and that’s what makes it beatable. Hate makes mistakes. Indifference makes PATTERNS.' },
    { who: 'GLITCH', portrait: 'glitch', emotion: 'worried', text: 'Her trail rides the rail. Rest when you need to — the bed’s a bed, the cot’s a cot. Erased doesn’t mean gone. It means filed. We keep pulling files.' },
  ])
}

// ============================================================================
// VEX — cocky rival. Fastest hands in the den and structurally incapable of
// letting you forget it.
// ============================================================================

function vexIntro() {
  return [
    { who: 'VEX', portrait: 'vex', emotion: 'happy', text: 'Fresh meat. Glitch radioed ahead — said you cracked Mara’s deck on dive one. Cute. You want to know my first dive time?' },
    {
      who: 'VEX', portrait: 'vex', emotion: 'happy',
      text: 'Four minutes. Blindfolded. Okay — the blindfold is a lie, but the four minutes is GOSPEL.',
      choices: [
        { label: 'It’s not a race.', goto: 'vi_race' },
        { label: 'Four minutes? Slow.', goto: 'vi_slow' },
      ],
    },
    { id: 'vi_race', who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'Everything’s a race. You’re just losing politely.', goto: 'vi_rules' },
    { id: 'vi_slow', who: 'VEX', portrait: 'vex', emotion: 'angry', text: '...oh, I LIKE you. I’m still going to dust you on every clock in this den, but I like you.', goto: 'vi_rules' },
    { id: 'vi_rules', who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'House rules. One: the bar tab is sacred. Two: beat my times and I buy. You won’t. Three: nobody touches Mara’s mug behind the bar. It’s still her tab.' },
    {
      who: 'VEX', portrait: 'vex', emotion: 'worried',
      text: '...Yeah. She drank here. The Grid says she didn’t exist, and my ledger says she owes me six creds. My ledger doesn’t lie. So go get her back — she pays her debts.',
      action: () => { if (!flag('met_vex')) setFlag('met_vex') },
    },
  ]
}

function vexHub() {
  if (!flag('met_vex')) return vexIntro()
  if (!flag('forge_boss_done')) {
    return pick([
      { who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'Forge Town job’s real. I sourced the floor credentials myself — they cost more than you did. Don’t embarrass me in front of an ERP.' },
      { who: 'VEX', portrait: 'vex', emotion: 'happy', text: 'My Forge plant record is nineteen minutes, gate to gate. Beat it and drinks are on me. Spoiler: drinks are never on me.' },
      { who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'The trace on corp iron isn’t a vibe, rookie, it’s a CLOCK. Noisy commands feed it. Walk like you’ve been there before.' },
    ])
  }
  return pick([
    { who: 'VEX', portrait: 'vex', emotion: 'neutral', text: 'One dive, line back up, town breathing. Fine. FINE. That’s... mid. (It was clean. Tell Glitch I said that and I’ll deny it under oath.)' },
    { who: 'VEX', portrait: 'vex', emotion: 'happy', text: 'I checked your Forge time. I’m not telling you what it was. That’s how you know it was good.' },
    { who: 'VEX', portrait: 'vex', emotion: 'worried', text: 'Mara’s tab is still open behind the bar. Six creds. When you find her, she’s buying the whole den a round. That’s the rule I just invented.' },
  ])
}

// ============================================================================
// VOSS-7 — Forge Town's foreman unit. Forty-one years on the floor. It would
// like its line back, and it has chosen its loyalties: the crew, not the corp.
// ============================================================================

function bossForge() {
  if (!flag('forge_boss_done')) {
    return [
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'neutral', text: 'Halt. Floor count says you are not crew. Floor count is rarely wrong. I am the exception that maintains it.' },
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'worried', text: 'Forty-one years I have run this floor. Three days ago Line 2 began to scream, and my own ERP locked me out of the fix. “Policy,” it said. A foreman may not doubt the schedule.' },
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'angry', text: 'The corp’s answer is to scrap the line. The town’s answer is hunger — half this city eats off that floor. I have decided I prefer a third answer: you.' },
      { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'neutral', text: 'Your fixer paid for floor credentials, and tonight I choose to misread my badge ledger. Find the fault. Free my line. Then we are square, and the inner-gate key is yours.' },
      {
        who: 'VOSS-7', portrait: 'boss_forge', emotion: 'glitch',
        text: 'One more thing, runner. No human hand blocked those work orders. The schedule rewrote itself at 03:14, signed by nothing. Look closely while you are inside.',
        choices: [
          { label: 'Jack in.', action: () => launchJackIn('m_forge_plant') },
          { label: 'Not yet.' },
        ],
      },
    ]
  }
  return pick([
    { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'happy', text: 'Line 2 sings at eighty-four RPM. The crew thinks a ghost fixed the plant. I have not corrected them. Morale is also maintenance.' },
    { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'neutral', text: 'The key I gave you opens a gate that has not existed on any blueprint for thirty years. Whatever erased your someone files things the same way it filed that gate. Go look.' },
    { who: 'VOSS-7', portrait: 'boss_forge', emotion: 'worried', text: '03:14. Signed by nothing. I have kept the log out of the schedule’s reach. When you need it, it will still be true. That is the only gift a foreman has.' },
  ])
}

// ============================================================================
// Ambient city — commuters, vendor, kid, watcher, conductor, forge worker.
// One-liners with variety; they shift as the story darkens.
// ============================================================================

function commuterPool() {
  if (flag('sister_gone')) {
    return [
      { who: 'COMMUTER', text: 'My building lost a tenant list last week. Got a new one same day. Cleaner. Shorter. Nobody compares.' },
      { who: 'COMMUTER', text: 'You ever wave at someone and they look at you like you’re static? Happens more now.' },
      { who: 'COMMUTER', text: 'Rain again. At least the rain still remembers how this street goes.' },
      { who: 'COMMUTER', text: 'Don’t file complaints anymore. Files have a way of filing back.' },
    ]
  }
  if (flag('intro_blackout_seen')) {
    return [
      { who: 'COMMUTER', text: 'Whole street went dark and everyone’s acting normal. So I’m acting normal. Normaler. Normalest.' },
      { who: 'COMMUTER', text: 'My display said ERROR 404 and then my rent went up. Coincidence. Probably. Hopefully.' },
      { who: 'COMMUTER', text: 'Brown-outs, they said. Brown-outs don’t spell.' },
    ]
  }
  return [
    { who: 'COMMUTER', text: 'Rough night out there. The neon’s the only thing working overtime with me.' },
    { who: 'COMMUTER', text: 'Keep your hood up. The cameras itch tonight.' },
    { who: 'COMMUTER', text: 'Noodles at the stand, if you’ve got creds. Real steam. That’s rare.' },
  ]
}

function commuterPool2() {
  if (flag('sister_gone')) {
    return [
      { who: 'COMMUTER', text: 'Heard a guy at the depot swear his shift partner never existed. HR agreed. The locker still has two name tags.' },
      { who: 'COMMUTER', text: 'The Grid’s been twitchy all week. Don’t look at it wrong.' },
      { who: 'COMMUTER', text: 'I keep paper now. Paper doesn’t update.' },
    ]
  }
  return [
    { who: 'COMMUTER', text: 'Twelve-hour shift and the train still beat me home. Machines, man.' },
    { who: 'COMMUTER', text: 'They repainted the billboard again. Nobody saw painters. Nobody ever sees painters.' },
    { who: 'COMMUTER', text: 'Grid’s been twitchy all week. My toaster asked me to confirm my identity.' },
  ]
}

function vendorNoodles() {
  if (flag('sister_gone')) {
    return [
      { who: 'VENDOR', text: 'Synth-broth’s hot, miso’s real on Tuesdays. You look like you haven’t eaten since the rain started.' },
      {
        who: 'VENDOR', text: 'Order, or loiter photogenically. Both keep the stand looking popular.',
        choices: [
          { label: 'Did a woman come here Tuesdays?', goto: 'vn_mara' },
          { label: 'Just passing through.', goto: 'vn_bye' },
        ],
      },
      { id: 'vn_mara', who: 'VENDOR', emotion: 'worried', text: '...Tuesdays I sell out of real miso and I can’t tell you to WHO. There’s a bowl I rinse twice. Don’t make me think about it, kid. Thinking about it feels like a hook in my teeth.', goto: 'vn_end' },
      { id: 'vn_bye', who: 'VENDOR', text: 'Everyone’s passing through. The stand stays. The stand remembers.', goto: 'vn_end' },
      { id: 'vn_end', who: 'VENDOR', text: flag('jackin1_done') ? 'And quit eyeballing the service door out back. It never opens. ...Knock right, though, and “never” gets flexible.' : 'Eat something. Whatever you’re carrying, carry it fed.' },
    ]
  }
  return pick([
    { who: 'VENDOR', text: 'Synth-broth, real steam. The steam’s the product, kid — the broth is a delivery system.' },
    { who: 'VENDOR', text: 'Real miso Tuesdays. One regular books it a week out. Sharp lady. Tips in exact change, like an audit.' },
    { who: 'VENDOR', text: 'The stand’s been here longer than the billboard. Outlasting things is a flavor.' },
  ])
}

function kidPool() {
  if (flag('sister_gone')) {
    return [
      { who: 'KID', text: 'Four-oh-four, the man’s not home, knock-knock-knocking on the override bone... I made it up! Everyone’s humming it wrong though.' },
      { who: 'KID', text: 'I drew my whole family so the Grid can’t lose any. Paper saves better. Pass it on.' },
      { who: 'KID', text: 'The canal ate my paper boat. The canal keeps EVERYTHING. The canal is the most honest thing on this street.' },
    ]
  }
  if (flag('intro_blackout_seen')) {
    return [
      { who: 'KID', text: 'When the screens went weird I wasn’t scared. I was MOSTLY not scared. Were you scared?' },
      { who: 'KID', text: 'ERROR 404! That’s what they all said. I can say it in the robot voice. ERR-OR-4-0-4.' },
    ]
  }
  return [
    { who: 'KID', text: 'I’m a runner! Pew pew — wait, runners don’t pew. What sound does a runner make?' },
    { who: 'KID', text: 'I raced the rain to the corner and WON. Rematch at the next cloud.' },
    { who: 'KID', text: 'The puddles have neon in them. I’m collecting colors. I have nine.' },
  ]
}

function watcherPool() {
  if (flag('sister_gone')) {
    return [
      { who: 'STRANGER', emotion: 'glitch', text: 'You are looking for someone who is not missing. The records confirm. The records are very good.' },
      { who: 'STRANGER', emotion: 'glitch', text: 'Grief is a synchronization error. It resolves. Yours is taking unusually long. Noted.' },
      { who: 'STRANGER', emotion: 'glitch', text: 'This corner has excellent coverage. Stand anywhere you like.' },
    ]
  }
  return [
    { who: 'STRANGER', text: 'This corner has excellent coverage. I prefer it.' },
    { who: 'STRANGER', text: 'The 7:14 was on time. The 7:31 was on time. Everything is on time. Isn’t that nice.' },
    { who: 'STRANGER', text: '...' },
  ]
}

function conductorTree() {
  if (!flag('rail_unlocked')) {
    return [
      { who: 'CONDUCTOR', text: 'Gate’s sealed, kid. Grid lockdown, all of sector K — nothing in, nothing out, nobody upstairs saying why. The maglev just sits there warm. Breaks my heart.' },
      { who: 'CONDUCTOR', text: 'You want through, you’d need pull I don’t have. The kind that lives under the city, if you take my meaning. I officially don’t.' },
    ]
  }
  if (!flag('forge_boss_done')) {
    return pick([
      { who: 'CONDUCTOR', text: 'Gate’s open for you, runner. Forge Town: twelve minutes, eleven if the rail’s in a mood. Check your map and hop aboard.' },
      { who: 'CONDUCTOR', text: 'Forty years driving this line. The train’s never lied to me once. Can’t say that about anything else in this city.' },
    ])
  }
  return pick([
    { who: 'CONDUCTOR', text: 'Heard Forge Town’s floor is humming again. Rail parts flow, trains run, conductor smiles. You did that, way I hear it.' },
    { who: 'CONDUCTOR', text: 'The line goes further than the map admits, you know. Always has. Rails remember every station they’ve ever touched.' },
  ])
}

function forgeWorkerPool() {
  if (!flag('forge_boss_done')) {
    return [
      { who: 'WORKER', text: 'Three days dark. You can hear the town hold its breath between shift horns.' },
      { who: 'WORKER', text: 'Line 2 screamed before it stopped. Machines don’t scream. Bearings do. Nobody upstairs listens to bearings.' },
      { who: 'WORKER', text: 'The foreman unit’s the only one fighting for the floor. Forty years and it never once filed US as the fault.' },
    ]
  }
  return [
    { who: 'WORKER', text: 'Line’s UP! You hear it? That hum is rent paid and kids fed, runner.' },
    { who: 'WORKER', text: 'Crew says a ghost fixed the plant. I say ghosts don’t ack their maintenance files. Whoever you are — thanks.' },
    { who: 'WORKER', text: 'VOSS-7 played the restart horn twice this morning. For a foreman unit, that’s weeping with joy.' },
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
