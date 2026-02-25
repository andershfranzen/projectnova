import { TILEMAP_COLORS } from '@projectrs/shared';
import type { EditorState } from '../state/EditorState';

// Pre-compute tile colors as [r, g, b] arrays
const TILE_RGB: [number, number, number][] = TILEMAP_COLORS.map(c => [c.r, c.g, c.b]);

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

        const tileType = state.tiles[tz * mapW + tx];
        const rgb = TILE_RGB[tileType] || TILE_RGB[0];
        const idx = (py * canvasW + px) * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = 255;
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

    for (let tz = startZ; tz < endZ; tz++) {
      for (let tx = startX; tx < endX; tx++) {
        const tileType = state.tiles[tz * mapW + tx];
        const rgb = TILE_RGB[tileType] || TILE_RGB[0];

        const sx = (tx - scrollX) * zoom;
        const sz = (tz - scrollZ) * zoom;

        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(sx, sz, tileSize + 0.5, tileSize + 0.5); // +0.5 to avoid gaps
      }
    }
  }
}
