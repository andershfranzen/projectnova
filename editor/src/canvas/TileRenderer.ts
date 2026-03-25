import type { EditorState, FloorLayer } from '../state/EditorState';

// Tile colors matching TileType enum order: GRASS, DIRT, STONE, WATER, WALL, SAND, WOOD
const TILE_RGB: [number, number, number][] = [
  [0x4a, 0x8a, 0x30], // GRASS
  [0x8c, 0x68, 0x40], // DIRT
  [0x80, 0x80, 0x80], // STONE
  [0x30, 0x60, 0xb0], // WATER
  [0x50, 0x40, 0x40], // WALL
  [0xc0, 0xb0, 0x80], // SAND
  [0x70, 0x50, 0x28], // WOOD
];

export class TileRenderer {
  private imageDataCache: ImageData | null = null;
  private cacheWidth = 0;
  private cacheHeight = 0;

  render(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
    canvasW: number, canvasH: number,
  ): void {
    if (zoom < 2) {
      // Low zoom: use ImageData for performance (1 pixel per tile or sub-pixel)
      this.renderImageData(ctx, state, scrollX, scrollZ, zoom, startX, startZ, endX, endZ, canvasW, canvasH);
    } else {
      // High zoom: use fillRect per tile
      this.renderFillRect(ctx, state, scrollX, scrollZ, zoom, startX, startZ, endX, endZ);
    }
  }

  private renderImageData(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
    canvasW: number, canvasH: number,
  ): void {
    // Create or reuse ImageData for the canvas
    if (!this.imageDataCache || this.cacheWidth !== canvasW || this.cacheHeight !== canvasH) {
      this.imageDataCache = ctx.createImageData(canvasW, canvasH);
      this.cacheWidth = canvasW;
      this.cacheHeight = canvasH;
    }

    const data = this.imageDataCache.data;
    const mapW = state.meta.width;
    const layer: FloorLayer | undefined = state.currentFloor > 0
      ? state.floorLayers.get(state.currentFloor)
      : undefined;

    // Fill with background
    data.fill(0);

    // For each screen pixel, determine which tile it maps to
    for (let py = 0; py < canvasH; py++) {
      const worldZ = py / zoom + scrollZ;
      const tz = Math.floor(worldZ);
      if (tz < 0 || tz >= state.meta.height) continue;

      for (let px = 0; px < canvasW; px++) {
        const worldX = px / zoom + scrollX;
        const tx = Math.floor(worldX);
        if (tx < 0 || tx >= mapW) continue;

        const tileIdx = tz * mapW + tx;
        const pixIdx = (py * canvasW + px) * 4;

        if (layer) {
          const floorTile = layer.tiles.get(tileIdx);
          if (floorTile !== undefined && floorTile >= 0) {
            const rgb = TILE_RGB[floorTile] || TILE_RGB[0];
            data[pixIdx] = rgb[0];
            data[pixIdx + 1] = rgb[1];
            data[pixIdx + 2] = rgb[2];
            data[pixIdx + 3] = 255;
          } else {
            // Dim ground
            const groundType = state.tiles[tileIdx];
            const rgb = TILE_RGB[groundType] || TILE_RGB[0];
            data[pixIdx] = Math.floor(rgb[0] * 0.25);
            data[pixIdx + 1] = Math.floor(rgb[1] * 0.25);
            data[pixIdx + 2] = Math.floor(rgb[2] * 0.25);
            data[pixIdx + 3] = 255;
          }
        } else {
          const tileType = state.tiles[tileIdx];
          const rgb = TILE_RGB[tileType] || TILE_RGB[0];
          data[pixIdx] = rgb[0];
          data[pixIdx + 1] = rgb[1];
          data[pixIdx + 2] = rgb[2];
          data[pixIdx + 3] = 255;
        }
      }
    }

    ctx.putImageData(this.imageDataCache, 0, 0);
  }

  private renderFillRect(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
  ): void {
    const mapW = state.meta.width;
    const tileSize = zoom;
    const layer: FloorLayer | undefined = state.currentFloor > 0
      ? state.floorLayers.get(state.currentFloor)
      : undefined;

    for (let tz = startZ; tz < endZ; tz++) {
      for (let tx = startX; tx < endX; tx++) {
        const sx = (tx - scrollX) * zoom;
        const sz = (tz - scrollZ) * zoom;
        const idx = tz * mapW + tx;

        if (layer) {
          // Upper floor: show ground dimmed, then overlay floor tiles
          const groundType = state.tiles[idx];
          const groundRgb = TILE_RGB[groundType] || TILE_RGB[0];
          // Dim ground floor
          ctx.fillStyle = `rgba(${groundRgb[0]},${groundRgb[1]},${groundRgb[2]},0.25)`;
          ctx.fillRect(sx, sz, tileSize + 0.5, tileSize + 0.5);

          const floorTile = layer.tiles.get(idx);
          if (floorTile !== undefined && floorTile >= 0) {
            const rgb = TILE_RGB[floorTile] || TILE_RGB[0];
            ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            ctx.fillRect(sx, sz, tileSize + 0.5, tileSize + 0.5);
          }
        } else {
          const tileType = state.tiles[idx];
          const rgb = TILE_RGB[tileType] || TILE_RGB[0];
          ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          ctx.fillRect(sx, sz, tileSize + 0.5, tileSize + 0.5);
        }
      }
    }
  }
}
