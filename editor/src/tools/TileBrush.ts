import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class TileBrush implements EditorToolInterface {
  private painting = false;

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    this.painting = true;
    ctx.undoMgr.beginStroke('tiles');
    this.paint(wx, wz, ctx);
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (dragging && this.painting) {
      this.paint(wx, wz, ctx);
    }
  }

  onMouseUp(_wx: number, _wz: number, ctx: EditorToolContext): void {
    if (this.painting) {
      this.painting = false;
      ctx.undoMgr.endStroke();
      ctx.rebuildMinimap();
    }
  }

  private paint(wx: number, wz: number, ctx: EditorToolContext): void {
    const s = ctx.stateMgr.state;
    const cx = Math.floor(wx);
    const cz = Math.floor(wz);
    const half = Math.floor(s.brushSize / 2);

    for (let dz = -half; dz < s.brushSize - half; dz++) {
      for (let dx = -half; dx < s.brushSize - half; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        ctx.undoMgr.expandRegion(tx, tz);
        ctx.stateMgr.setTile(tx, tz, s.selectedTileType);
      }
    }
    ctx.requestRender();
  }
}
