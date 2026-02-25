import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class ObjectPlacer implements EditorToolInterface {
  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const s = ctx.stateMgr.state;
    const x = Math.floor(wx) + 0.5;
    const z = Math.floor(wz) + 0.5;

    const oldSpawns = ctx.undoMgr.snapshotSpawns();
    ctx.stateMgr.addObjectSpawn(s.selectedObjectId, x, z);
    ctx.undoMgr.pushSpawnChange(oldSpawns, ctx.undoMgr.snapshotSpawns());
    ctx.requestRender();
  }

  onMouseMove(): void {}
  onMouseUp(): void {}
}
