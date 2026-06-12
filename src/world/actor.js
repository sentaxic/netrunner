// actor.js — every walking body in the overworld: the player and all NPCs.
//
// Grid-based smooth movement: an actor occupies a tile (tx,ty) and steps one
// tile at a time, lerping its pixel position. Collision goes through
// tilemap.isSolid (which reads map.collide) plus an optional isBlocked callback
// the scene supplies for actor-vs-actor occupancy.
//
// Contract (ARCHITECTURE.md §5): pos, dir, anim, moveGrid, follows `path`
// waypoints (wander w/ pauses) when given. Drawn via drawActor (16x24 sprite,
// feet anchored to the tile, so it's drawn 8px above the tile top).

import { drawActor, ACTORS } from '../assets/sprites.js'
import { TILE } from '../assets/tiles.js'

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const WALK_FRAMES = [0, 1, 0, 2] // contact, stride A, contact, stride B

export class Actor {
  constructor({ id, x, y, dir = 'down', look, path = null, script = null, speed = 2.2 } = {}) {
    this.id = id || 'actor'
    // grid position (tiles) + pixel position (world px, top-left of the tile)
    this.tx = x | 0
    this.ty = y | 0
    this.px = this.tx * TILE
    this.py = this.ty * TILE
    this.dir = DIRS[dir] ? dir : 'down'
    this.look = look || (ACTORS[this.id] ? this.id : 'a')
    this.script = script
    this.speed = speed              // tiles per second
    this.tint = 1

    // stepping state
    this.moving = false
    this.fx = this.tx               // step origin (still occupied mid-step)
    this.fy = this.ty
    this.prog = 0                   // 0..1 across the current step
    this.justArrived = false        // set the frame a step completes; scene consumes

    // animation
    this.walkT = 0
    this.frame = 0

    // wandering
    this.path = Array.isArray(path) && path.length ? path : null
    this.wpI = 0
    this.waitT = this.path ? Math.random() * 1.5 : 0
    this.idle = false               // scene may enable: idle NPCs glance around
    this.idleT = 2 + Math.random() * 4
    this.hidden = false
  }

  // ---- queries ---------------------------------------------------------------
  // True if the actor claims this tile (current tile, or the one it's leaving —
  // both stay blocked mid-step so nobody walks through a moving body).
  occupies(tx, ty) {
    if (this.tx === tx && this.ty === ty) return true
    return this.moving && this.fx === tx && this.fy === ty
  }

  get centerX() { return this.px + TILE / 2 }
  get centerY() { return this.py + TILE / 2 }

  // ---- placement / facing -------------------------------------------------------
  // Teleport: snap grid + pixels, cancel any step in flight.
  moveTo(tx, ty) {
    this.tx = this.fx = tx | 0
    this.ty = this.fy = ty | 0
    this.px = this.tx * TILE
    this.py = this.ty * TILE
    this.moving = false
    this.prog = 0
  }

  face(dir) { if (DIRS[dir]) this.dir = dir }

  // Turn toward a world tile (used when the player talks to an NPC).
  facePoint(tx, ty) {
    const dx = tx - this.tx, dy = ty - this.ty
    if (Math.abs(dx) >= Math.abs(dy)) this.dir = dx < 0 ? 'left' : 'right'
    else this.dir = dy < 0 ? 'up' : 'down'
  }

  // Hold still for a beat (dialogue, scripted moments).
  pause(sec = 2.5) { this.waitT = Math.max(this.waitT, sec) }

  // ---- stepping --------------------------------------------------------------------
  // Try to begin a one-tile step. Returns true if the step started. Always turns
  // to face the attempted direction, even when blocked (bump-to-face).
  tryStep(dx, dy, tilemap, isBlocked) {
    if (this.moving) return false
    if (dx) { dy = 0; dx = dx < 0 ? -1 : 1 } else if (dy) { dy = dy < 0 ? -1 : 1 } else return false
    this.dir = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down'
    const nx = this.tx + dx, ny = this.ty + dy
    if (tilemap && tilemap.isSolid(nx, ny)) return false
    if (isBlocked && isBlocked(nx, ny, this)) return false
    this.fx = this.tx
    this.fy = this.ty
    this.tx = nx
    this.ty = ny
    this.moving = true
    this.prog = 0
    return true
  }

  // Contract alias (ARCHITECTURE.md names it moveGrid).
  moveGrid(dx, dy, tilemap, isBlocked) { return this.tryStep(dx, dy, tilemap, isBlocked) }

  // ---- per-frame -------------------------------------------------------------------
  update(dt, tilemap, isBlocked) {
    this.justArrived = false

    if (this.moving) {
      this.prog += dt * this.speed
      this.walkT += dt * this.speed
      if (this.prog >= 1) {
        this.moving = false
        this.prog = 0
        this.px = this.tx * TILE
        this.py = this.ty * TILE
        this.justArrived = true
      } else {
        const k = this.prog
        this.px = (this.fx + (this.tx - this.fx) * k) * TILE
        this.py = (this.fy + (this.ty - this.fy) * k) * TILE
      }
      this.frame = WALK_FRAMES[Math.floor(this.walkT * 4) % 4]
    } else {
      this.frame = 0
      this.walkT = 0
    }

    // -- wandering: follow waypoints with unhurried pauses ------------------------
    if (this.path && !this.moving) {
      if (this.waitT > 0) {
        this.waitT -= dt
      } else {
        const wp = this.path[this.wpI]
        if (wp.x === this.tx && wp.y === this.ty) {
          this.wpI = (this.wpI + 1) % this.path.length
          this.waitT = 0.8 + Math.random() * 2.2     // linger — cities idle
        } else {
          const dx = Math.sign(wp.x - this.tx)
          const dy = Math.sign(wp.y - this.ty)
          // prefer the axis with more distance left; slide to the other if blocked
          const first = Math.abs(wp.x - this.tx) >= Math.abs(wp.y - this.ty)
          const a = first ? [dx, 0] : [0, dy]
          const b = first ? [0, dy] : [dx, 0]
          let ok = a[0] || a[1] ? this.tryStep(a[0], a[1], tilemap, isBlocked) : false
          if (!ok && (b[0] || b[1])) ok = this.tryStep(b[0], b[1], tilemap, isBlocked)
          if (!ok) this.waitT = 0.4 + Math.random() * 0.8 // someone's in the way; wait it out
        }
      }
    } else if (this.idle && !this.moving) {
      // -- stationary NPCs glance around now and then -----------------------------
      if (this.waitT > 0) { this.waitT -= dt }
      else {
        this.idleT -= dt
        if (this.idleT <= 0) {
          const dirs = ['up', 'down', 'left', 'right']
          this.dir = dirs[(Math.random() * 4) | 0]
          this.idleT = 2.5 + Math.random() * 5
        }
      }
    }
  }

  // ---- drawing ------------------------------------------------------------------------
  // Sprite is 16x24 with feet at the bottom: draw 8px above the tile so the feet
  // land on the tile and the head overlaps the tile behind (north of) the actor.
  draw(ctx, cam) {
    if (this.hidden) return
    drawActor(
      ctx,
      Math.round(this.px - cam.x),
      Math.round(this.py - cam.y) - 8,
      { look: this.look, dir: this.dir, frame: this.frame, tint: this.tint }
    )
  }
}

export default Actor
