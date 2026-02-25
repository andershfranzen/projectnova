import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class SpawnEraser implements EditorToolInterface {
  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const oldSpawns = ctx.undoMgr.snapshotSpawns();
    const removed = ctx.stateMgr.removeSpawnNear(wx, wz);
    if (removed) {
      ctx.undoMgr.pushSpawnChange(oldSpawns, ctx.undoMgr.snapshotSpawns());
      ctx.requestRender();
    }
  }

  onMouseMove(): void {}
  onMouseUp(): void {}
}
