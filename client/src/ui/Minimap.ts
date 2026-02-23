import { MAP_SIZE, TileType } from '@projectrs/shared';

const TILE_COLORS_MAP: Record<TileType, string> = {
  [TileType.GRASS]: '#4a8a30',
  [TileType.DIRT]:  '#8c6840',
  [TileType.STONE]: '#808080',
  [TileType.WATER]: '#3060b0',
  [TileType.WALL]:  '#504040',
  [TileType.SAND]:  '#c0b080',
  [TileType.WOOD]:  '#705028',
};

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mapImage: ImageData | null = null;
  private size: number;
  private scale: number;

  constructor(size: number = 150) {
    this.size = size;
    this.scale = size / MAP_SIZE;

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

  /** Generate the static map image from tile data */
  generateFromTiles(tiles: TileType[][]): void {
    const imageData = this.ctx.createImageData(this.size, this.size);

    for (let x = 0; x < MAP_SIZE; x++) {
      for (let z = 0; z < MAP_SIZE; z++) {
        const tileType = tiles[x][z];
        const color = TILE_COLORS_MAP[tileType] || '#000';

        // Parse hex color
        const r = parseInt(color.substring(1, 3), 16);
        const g = parseInt(color.substring(3, 5), 16);
        const b = parseInt(color.substring(5, 7), 16);

        // Scale and draw pixel(s) for this tile
        const px = Math.floor(x * this.scale);
        const pz = Math.floor(z * this.scale);
        const pw = Math.max(1, Math.ceil(this.scale));
        const ph = Math.max(1, Math.ceil(this.scale));

        for (let dx = 0; dx < pw; dx++) {
          for (let dz = 0; dz < ph; dz++) {
            const fx = px + dx;
            const fz = pz + dz;
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

    this.mapImage = imageData;
  }

  /** Update minimap with entity positions */
  update(
    playerX: number,
    playerZ: number,
    remotePlayers: { x: number; z: number }[],
    npcs: { x: number; z: number }[]
  ): void {
    if (!this.mapImage) return;

    // Draw base map
    this.ctx.putImageData(this.mapImage, 0, 0);

    // Draw NPCs as yellow dots
    this.ctx.fillStyle = '#ff0';
    for (const npc of npcs) {
      const px = npc.x * this.scale;
      const pz = npc.z * this.scale;
      this.ctx.fillRect(px - 1, pz - 1, 3, 3);
    }

    // Draw remote players as white dots
    this.ctx.fillStyle = '#fff';
    for (const rp of remotePlayers) {
      const px = rp.x * this.scale;
      const pz = rp.z * this.scale;
      this.ctx.fillRect(px - 1, pz - 1, 3, 3);
    }

    // Draw local player as bright green dot
    this.ctx.fillStyle = '#0f0';
    const px = playerX * this.scale;
    const pz = playerZ * this.scale;
    this.ctx.fillRect(px - 2, pz - 2, 4, 4);
  }
}
