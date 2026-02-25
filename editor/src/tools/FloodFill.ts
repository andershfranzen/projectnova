import type { EditorToolInterface, EditorToolContext } from './BaseTool';

const MAX_FILL = 100000; // safety limit

export class FloodFill implements EditorToolInterface {
  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const s = ctx.stateMgr.state;
    const tx = Math.floor(wx);
    const tz = Math.floor(wz);
    if (tx < 0 || tx >= s.meta.width || tz < 0 || tz >= s.meta.height) return;

    const targetType = ctx.stateMgr.getTile(tx, tz);
    const fillType = s.selectedTileType;
    if (targetType === fillType) return;

    ctx.undoMgr.beginStroke('tiles');

    const w = s.meta.width;
    const h = s.meta.height;
    const visited = new Uint8Array(w * h);
    const stack: number[] = [tx, tz];
    let count = 0;

    while (stack.length > 0 && count < MAX_FILL) {
      const cz = stack.pop()!;
      const cx = stack.pop()!;
      if (cx < 0 || cx >= w || cz < 0 || cz >= h) continue;
      const idx = cz * w + cx;
      if (visited[idx]) continue;
      if (s.tiles[idx] !== targetType) continue;

      visited[idx] = 1;
      ctx.undoMgr.expandRegion(cx, cz);
      ctx.stateMgr.setTile(cx, cz, fillType);
      count++;

      stack.push(cx - 1, cz);
      stack.push(cx + 1, cz);
      stack.push(cx, cz - 1);
      stack.push(cx, cz + 1);
    }

    ctx.undoMgr.endStroke();
    ctx.requestRender();
    ctx.rebuildMinimap();
  }

  onMouseMove(): void {}
  onMouseUp(): void {}
}
