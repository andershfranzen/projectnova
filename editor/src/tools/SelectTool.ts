import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class SelectTool implements EditorToolInterface {
  private startX = 0;
  private startZ = 0;
  private active = false;

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    this.startX = Math.floor(wx);
    this.startZ = Math.floor(wz);
    this.active = true;
    ctx.stateMgr.state.selection = { x: this.startX, z: this.startZ, w: 1, h: 1 };
    ctx.requestRender();
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (!dragging || !this.active) return;
    const ex = Math.floor(wx);
    const ez = Math.floor(wz);
    const x = Math.min(this.startX, ex);
    const z = Math.min(this.startZ, ez);
    const w = Math.abs(ex - this.startX) + 1;
    const h = Math.abs(ez - this.startZ) + 1;
    ctx.stateMgr.state.selection = { x, z, w, h };
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
    ctx.stateMgr.state.selection = { x, z, w, h };
    ctx.requestRender();
  }
}
