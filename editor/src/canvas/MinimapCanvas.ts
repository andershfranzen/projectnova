import type { EditorState } from '../state/EditorState';

const TILE_RGB: [number, number, number][] = [
  [0x4a, 0x8a, 0x30], [0x8c, 0x68, 0x40], [0x80, 0x80, 0x80],
  [0x30, 0x60, 0xb0], [0x50, 0x40, 0x40], [0xc0, 0xb0, 0x80], [0x70, 0x50, 0x28],
];

export class MinimapCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private size: number;
  private dirty = true;

  onClick?: (worldX: number, worldZ: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.size = canvas.width;
    this.imageData = this.ctx.createImageData(this.size, this.size);

    canvas.addEventListener('mousedown', (e) => {
      this.handleClick(e);
    });
    canvas.addEventListener('mousemove', (e) => {
      if (e.buttons & 1) this.handleClick(e);
    });
  }

  private handleClick(e: MouseEvent): void {
    if (!this.onClick) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const mz = e.clientY - rect.top;
    // map pixel to world coords
    const state = this.lastState;
    if (!state || !state.meta.width) return;
    const scaleX = state.meta.width / this.size;
    const scaleZ = state.meta.height / this.size;
    this.onClick(mx * scaleX, mz * scaleZ);
  }

  private lastState: EditorState | null = null;

  /** Rebuild the minimap image from tile data */
  rebuild(state: EditorState): void {
    this.lastState = state;
    if (!state.meta.width || !state.meta.height) return;

    const { size } = this;
    const mapW = state.meta.width;
    const mapH = state.meta.height;
    const data = this.imageData.data;

    for (let py = 0; py < size; py++) {
      const tz = Math.floor((py / size) * mapH);
      for (let px = 0; px < size; px++) {
        const tx = Math.floor((px / size) * mapW);
        const tileType = state.tiles[tz * mapW + tx];
        const rgb = TILE_RGB[tileType] || TILE_RGB[0];
        const idx = (py * size + px) * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
    this.dirty = false;
  }

  /** Draw the viewport rectangle */
  drawViewport(scrollX: number, scrollZ: number, viewW: number, viewH: number, mapW: number, mapH: number): void {
    if (!mapW || !mapH) return;

    // Redraw cached image
    this.ctx.putImageData(this.imageData, 0, 0);

    const scaleX = this.size / mapW;
    const scaleZ = this.size / mapH;

    const vx = scrollX * scaleX;
    const vz = scrollZ * scaleZ;
    const vw = viewW * scaleX;
    const vh = viewH * scaleZ;

    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(vx, vz, vw, vh);
  }

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }
}
