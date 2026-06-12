// tilemap.js — renders a maps.js map with a camera, answers collision queries.
//
// Contract (ARCHITECTURE.md §5): TileMap renders ground/over layers w/ camera;
// worldToScreen; collision query. The ground layer is drawn before actors, the
// over layer after, so actors sort between them:
//
//   tilemap.render(ctx, cam, t)            // ground (default layer)
//   ...draw actors...
//   tilemap.render(ctx, cam, t, 'over')    // or tilemap.renderOver(ctx, cam, t)
//
// cam = {x,y} world-pixel offset of the viewport's top-left. May be negative
// (small maps letterbox-center inside the 480x270 view).

import { TILE, drawTile, setTilePalette } from '../assets/tiles.js'
import { VIEW_W, VIEW_H } from '../core/renderer.js'

export class TileMap {
  constructor(map) {
    this.map = map
    this.w = map.w                 // size in tiles
    this.h = map.h
    this.pxW = map.w * TILE        // size in pixels
    this.pxH = map.h * TILE
    // Re-skin the shared tile art for this map's biome.
    setTilePalette(map.tileset || map.palette || 'aster')
  }

  // ---- pixel size helpers ---------------------------------------------------
  get widthPx() { return this.pxW }
  get heightPx() { return this.pxH }
  get tileSize() { return TILE }

  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h }

  // ---- collision -------------------------------------------------------------
  // Outside the map is solid. collide[] is 0/1 row-major.
  isSolid(tx, ty) {
    if (!this.inBounds(tx, ty)) return true
    return this.map.collide[ty * this.w + tx] === 1
  }

  // Tile id at a grid position ('ground' | 'over'); null when empty / off-map.
  tileAt(tx, ty, layer = 'ground') {
    if (!this.inBounds(tx, ty)) return null
    return this.map.layers[layer][ty * this.w + tx] || null
  }

  // ---- coordinate helpers ------------------------------------------------------
  worldToScreen(wx, wy, cam) {
    return { x: Math.round(wx - cam.x), y: Math.round(wy - cam.y) }
  }

  tileToScreen(tx, ty, cam) {
    return this.worldToScreen(tx * TILE, ty * TILE, cam)
  }

  screenToTile(sx, sy, cam) {
    return { x: Math.floor((sx + cam.x) / TILE), y: Math.floor((sy + cam.y) / TILE) }
  }

  // ---- rendering ----------------------------------------------------------------
  // t = anim time in seconds (drives neon flicker, billboards, water, steam...).
  // layer 'ground' draws before actors; 'over' after.
  render(ctx, cam, t = 0, layer = 'ground') {
    const tiles = this.map.layers[layer]
    if (!tiles) return
    const x0 = Math.max(0, Math.floor(cam.x / TILE))
    const y0 = Math.max(0, Math.floor(cam.y / TILE))
    const x1 = Math.min(this.w, Math.ceil((cam.x + VIEW_W) / TILE))
    const y1 = Math.min(this.h, Math.ceil((cam.y + VIEW_H) / TILE))
    const ox = Math.round(-cam.x)
    const oy = Math.round(-cam.y)
    for (let ty = y0; ty < y1; ty++) {
      const row = ty * this.w
      for (let tx = x0; tx < x1; tx++) {
        const id = tiles[row + tx]
        if (!id) continue // null = open sky / empty over-slot — backdrop shows through
        drawTile(ctx, id, tx * TILE + ox, ty * TILE + oy, t)
      }
    }
  }

  renderGround(ctx, cam, t = 0) { this.render(ctx, cam, t, 'ground') }
  renderOver(ctx, cam, t = 0) { this.render(ctx, cam, t, 'over') }
}

export default TileMap
