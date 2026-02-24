import { TileType } from '@projectrs/shared';
import type { ChunkManager } from '../rendering/ChunkManager';

const TILE_COLORS_MAP: Record<number, string> = {
  [TileType.GRASS]: '#4a8a30',
  [TileType.DIRT]:  '#8c6840',
  [TileType.STONE]: '#808080',
  [TileType.WATER]: '#3060b0',
  [TileType.WALL]:  '#504040',
  [TileType.SAND]:  '#c0b080',
  [TileType.WOOD]:  '#705028',
};

// How many tiles the minimap shows in each direction from center
const VIEW_RADIUS = 48;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;

  constructor(size: number = 150) {
    this.size = size;

    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.cssText = `
      position: fixed; top: 10px; right: 10px;
      width: ${size}px; height: ${size}px;
      border: 2px solid #5a4a35; border-radius: 4px;
      z-index: 100; image-rendering: pixelated;
    `;

    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);
  }

  /** Update minimap with entity positions (windowed view from ChunkManager) */
  update(
    playerX: number,
    playerZ: number,
    remotePlayers: { x: number; z: number }[],
    npcs: { x: number; z: number }[],
    chunkManager: ChunkManager
  ): void {
    const { tiles, size: tileSize, startX, startZ } = chunkManager.getTilesForMinimap(playerX, playerZ, VIEW_RADIUS);
    const scale = this.size / tileSize;

    // Build image from tile data
    const imageData = this.ctx.createImageData(this.size, this.size);

    for (let dz = 0; dz < tileSize; dz++) {
      for (let dx = 0; dx < tileSize; dx++) {
        const tileType = tiles[dz * tileSize + dx];
        const color = TILE_COLORS_MAP[tileType] || '#000';
        const r = parseInt(color.substring(1, 3), 16);
        const g = parseInt(color.substring(3, 5), 16);
        const b = parseInt(color.substring(5, 7), 16);

        const px = Math.floor(dx * scale);
        const pz = Math.floor(dz * scale);
        const pw = Math.max(1, Math.ceil(scale));
        const ph = Math.max(1, Math.ceil(scale));

        for (let ddx = 0; ddx < pw; ddx++) {
          for (let ddz = 0; ddz < ph; ddz++) {
            const fx = px + ddx;
            const fz = pz + ddz;
            if (fx < this.size && fz < this.size) {
              const idx = (fz * this.size + fx) * 4;
              imageData.data[idx] = r;
              imageData.data[idx + 1] = g;
              imageData.data[idx + 2] = b;
              imageData.data[idx + 3] = 255;
            }
          }
        }
      }
    }

    this.ctx.putImageData(imageData, 0, 0);

    // Draw NPCs as yellow dots
    this.ctx.fillStyle = '#ff0';
    for (const npc of npcs) {
      const relX = (npc.x - startX) * scale;
      const relZ = (npc.z - startZ) * scale;
      if (relX >= 0 && relX < this.size && relZ >= 0 && relZ < this.size) {
        this.ctx.fillRect(relX - 1, relZ - 1, 3, 3);
      }
    }

    // Draw remote players as white dots
    this.ctx.fillStyle = '#fff';
    for (const rp of remotePlayers) {
      const relX = (rp.x - startX) * scale;
      const relZ = (rp.z - startZ) * scale;
      if (relX >= 0 && relX < this.size && relZ >= 0 && relZ < this.size) {
        this.ctx.fillRect(relX - 1, relZ - 1, 3, 3);
      }
    }

    // Draw local player as bright green dot (always center)
    this.ctx.fillStyle = '#0f0';
    const centerX = this.size / 2;
    const centerZ = this.size / 2;
    this.ctx.fillRect(centerX - 2, centerZ - 2, 4, 4);
  }
}
