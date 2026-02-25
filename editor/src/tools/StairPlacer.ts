import type { EditorToolInterface, EditorToolContext } from './BaseTool';

/**
 * Stair placer tool — click to place a stair, shift+click to remove.
 */
export class StairPlacer implements EditorToolInterface {
  private shiftDown = false;

  constructor() {
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.shiftDown = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shiftDown = false; });
  }

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const tx = Math.floor(wx);
    const tz = Math.floor(wz);
    const s = ctx.stateMgr.state;
    if (tx < 0 || tx >= s.meta.width || tz < 0 || tz >= s.meta.height) return;

    if (this.shiftDown) {
      ctx.stateMgr.removeStair(tx, tz);
    } else {
      ctx.stateMgr.setStair(tx, tz, {
        direction: s.stairDirection,
        baseHeight: s.stairBaseHeight,
        topHeight: s.stairTopHeight,
      });
    }
    ctx.requestRender();
  }

  onMouseMove(_wx: number, _wz: number, _dragging: boolean, _ctx: EditorToolContext): void {}
  onMouseUp(_wx: number, _wz: number, _ctx: EditorToolContext): void {}
}
