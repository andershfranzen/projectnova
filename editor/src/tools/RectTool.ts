import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class RectTool implements EditorToolInterface {
  private startX = 0;
  private startZ = 0;
  private active = false;

  // Preview state for rendering
  preview: { x: number; z: number; w: number; h: number } | null = null;

  onMouseDown(wx: number, wz: number, _ctx: EditorToolContext): void {
    this.startX = Math.floor(wx);
    this.startZ = Math.floor(wz);
    this.active = true;
    this.preview = { x: this.startX, z: this.startZ, w: 1, h: 1 };
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (!dragging || !this.active) return;
    const ex = Math.floor(wx);
    const ez = Math.floor(wz);
    const x = Math.min(this.startX, ex);
    const z = Math.min(this.startZ, ez);
    const w = Math.abs(ex - this.startX) + 1;
    const h = Math.abs(ez - this.startZ) + 1;
    this.preview = { x, z, w, h };
    ctx.requestRender();
  }

  onMouseUp(wx: number, wz: number, ctx: EditorToolContext): void {
    if (!this.active) return;
    this.active = false;

    const ex = Math.floor(wx);
    const ez = Math.floor(wz);
    const x = Math.min(this.startX, ex);
    const z = Math.min(this.startZ, ez);
    const w = Math.abs(ex - this.startX) + 1;
    const h = Math.abs(ez - this.startZ) + 1;

    const s = ctx.stateMgr.state;
    ctx.undoMgr.beginStroke('tiles');
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        ctx.undoMgr.expandRegion(x + dx, z + dz);
        ctx.stateMgr.setTile(x + dx, z + dz, s.selectedTileType);
      }
    }
    ctx.undoMgr.endStroke();
    this.preview = null;
    ctx.requestRender();
    ctx.rebuildMinimap();
  }
}
