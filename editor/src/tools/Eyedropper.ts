import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class Eyedropper implements EditorToolInterface {
  onPick?: (tileType: number) => void;

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const tx = Math.floor(wx);
    const tz = Math.floor(wz);
    const tileType = ctx.stateMgr.getTile(tx, tz);
    ctx.stateMgr.state.selectedTileType = tileType;
    this.onPick?.(tileType);
  }

  onMouseMove(wx: number, wz: number, dragging: boolean, ctx: EditorToolContext): void {
    if (dragging) this.onMouseDown(wx, wz, ctx);
  }

  onMouseUp(): void {}
}
