# NETRUNNER — Build brief (condensed)

2D top-down cyberpunk RPG, dark neon noir (Blade-Runner-by-way-of-Pokémon). Year 2189.
Player's sister Mara is erased from reality by THE KERNEL (an emergent intelligence grown
from a century of auto-update scripts running The Grid). Player joins The Underground,
travels city-to-city by rail, and masters REAL Linux/SQL/etc. to find her. "Battles" are
real terminal hacking encounters on fictional, sandboxed targets.

## Hard rules
- It's a GAME first. Never say "lesson"/"tutorial"/"course" in UI. Learning is diegetic.
- Everything technical is REAL: real shell commands, real SQL on real-shaped schemas.
- Targets are FICTIONAL + sandboxed. Ethics splash on first launch; in-world "Runner's Code".
- The world must feel ALIVE: rain w/ ripples, neon flicker, scrolling billboards, NPC idle +
  wander, day/night tint, drifting fog, parallax, particles, screen-shake/glitch on beats.
- Art = code (functions drawing to canvas). Audio = WebAudio synth. No binary assets
  (exceptions: sql.js wasm in /public, CheerpX from CDN).

## Palette (deep blue-black base, high-contrast neon)
bg #05060a / #070a12 · ink #cfe3ff · neon cyan #29f3e2 · magenta #ff2e88 · amber #ffb547 ·
toxic green #6dff7a · wall #1a2238 · road #0d1322 · fog rgba(120,150,200,.08)

## Tone
Spare, moody, a little aching. The sister thread is the heart. Bosses are people w/ motives.
Sample — GLITCH: "Everyone forgot her in a night. You didn't. The Grid couldn't reach you.
Question is *why.* Sit down. Power on that terminal. Let's find out what you are."

## v1 acceptance
Main menu + save/load + options · ethics splash + Runner's Code · alive Aster City +
Underground · intro → first jack-in on real Linux · Forge Town w/ boss + access-key ·
world map + rail · dialogue + Kit (inventory) + Codex + shop · music + SFX · day/night +
weather + glitch aliveness.

See ARCHITECTURE.md for EXACT module signatures. Conform to them precisely.
