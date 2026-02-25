import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class LineTool implements EditorToolInterface {
  private startX = 0;
  private startZ = 0;
  private active = false;

  preview: { x0: number; z0: number; x1: number; z1: number } | null = null;

  onMouseDown(wx: number, wz: number, _ctx: EditorToolContext): void {
    this.startX = Math.floor(wx);
    this.startZ = Math.floor(wz);
    this.active = true;
    this.preview = { x0: this.startX, z0: this.startZ, x1: this.startX, z1: this.startZ };
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (!dragging || !this.active) return;
    this.preview = { x0: this.startX, z0: this.startZ, x1: Math.floor(wx), z1: Math.floor(wz) };
    ctx.requestRender();
  }

  onMouseUp(wx: number, wz: number, ctx: EditorToolContext): void {
    if (!this.active) return;
    this.active = false;

    const s = ctx.stateMgr.state;
    const ex = Math.floor(wx);
    const ez = Math.floor(wz);

    const points = bresenham(this.startX, this.startZ, ex, ez);

    ctx.undoMgr.beginStroke('tiles');
    const half = Math.floor(s.brushSize / 2);
    for (const [px, pz] of points) {
      for (let dz = -half; dz < s.brushSize - half; dz++) {
        for (let dx = -half; dx < s.brushSize - half; dx++) {
          ctx.undoMgr.expandRegion(px + dx, pz + dz);
          ctx.stateMgr.setTile(px + dx, pz + dz, s.selectedTileType);
        }
      }
    }
    ctx.undoMgr.endStroke();
    this.preview = null;
    ctx.requestRender();
    ctx.rebuildMinimap();
  }
}

function bresenham(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return points;
}
