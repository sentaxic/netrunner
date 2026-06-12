// NETRUNNER boot. Wires core engine + scenes. Module contracts: see ARCHITECTURE.md.
import './style.css'
import '@xterm/xterm/css/xterm.css'
import { initRenderer, frame, setCRT } from './core/renderer.js'
import { scenes } from './core/scenes.js'
import { input } from './core/input.js'
import { G } from './core/state.js'
import { audio } from './core/audio.js'
import { bus } from './core/events.js'
import { updateDialogue, renderDialogue, dialogueActive, dialogueKey } from './ui/dialogue.js'
import { EthicsScene, MenuScene, NewGameScene, OptionsScene, CreditsScene } from './ui/menu.js'
import { PauseScene, renderToasts, updateToasts } from './ui/hud.js'
import { OverworldScene } from './world/overworld.js'
import { JackInScene } from './terminal/jackin.js'
import { WorldMapScene } from './ui/worldmap.js'
import { IntroScene } from './story/script.js'
import './story/quests.js' // registers quest/flag listeners

const ctx = initRenderer(document.getElementById('screen'))
input.init()
setCRT(G.settings.crt)

scenes.register('ethics', new EthicsScene())
scenes.register('menu', new MenuScene())
scenes.register('newgame', new NewGameScene())
scenes.register('options', new OptionsScene())
scenes.register('credits', new CreditsScene())
scenes.register('pause', new PauseScene())
scenes.register('overworld', new OverworldScene())
scenes.register('jackin', new JackInScene())
scenes.register('worldmap', new WorldMapScene())
scenes.register('intro', new IntroScene())

addEventListener('keydown', e => {
  audio.unlock()
  if (input.suspended) return // jack-in terminal owns the keyboard
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
  if (dialogueActive()) dialogueKey(e)
  else scenes.onKey(e)
})

scenes.switchTo(localStorage.getItem('netrunner_ethics_ack') ? 'menu' : 'ethics', {}, 'none')

frame((dt, t) => {
  if (dialogueActive()) updateDialogue(dt)
  else scenes.update(dt)
  updateToasts(dt)
  scenes.render(ctx)
  renderDialogue(ctx, t)
  renderToasts(ctx)
  scenes.renderTransition(ctx)
  input.endFrame()
})

// Dev/debug hook (used by automated verification too)
window.NR = { G, scenes, bus, audio }
