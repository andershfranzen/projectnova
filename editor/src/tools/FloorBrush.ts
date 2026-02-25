import type { EditorToolInterface, EditorToolContext } from './BaseTool';

/**
 * Floor brush tool — click tiles to set/remove elevated floor heights.
 * Left-click to paint floor at the configured height.
 * Shift+click to remove floor.
 */
export class FloorBrush implements EditorToolInterface {
  private shiftDown = false;

  constructor() {
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.shiftDown = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shiftDown = false; });
  }

  private apply(wx: number, wz: number, ctx: EditorToolContext): void {
    const tx = Math.floor(wx);
    const tz = Math.floor(wz);
    const s = ctx.stateMgr.state;
    if (tx < 0 || tx >= s.meta.width || tz < 0 || tz >= s.meta.height) return;

    if (this.shiftDown) {
      ctx.stateMgr.removeFloor(tx, tz);
    } else {
      ctx.stateMgr.setFloor(tx, tz, s.floorHeightValue);
    }
    ctx.requestRender();
  }

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    this.apply(wx, wz, ctx);
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (dragging) this.apply(wx, wz, ctx);
  }

  onMouseUp(_wx: number, _wz: number, _ctx: EditorToolContext): void {}
}
