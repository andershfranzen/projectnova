import type { EditorToolInterface, EditorToolContext } from './BaseTool';

export class NpcPlacer implements EditorToolInterface {
  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const s = ctx.stateMgr.state;
    // Snap to tile center
    const x = Math.floor(wx) + 0.5;
    const z = Math.floor(wz) + 0.5;

    const oldSpawns = ctx.undoMgr.snapshotSpawns();
    ctx.stateMgr.addNpcSpawn(s.selectedNpcId, x, z);
    ctx.undoMgr.pushSpawnChange(oldSpawns, ctx.undoMgr.snapshotSpawns());
    ctx.requestRender();
  }

  onMouseMove(): void {}
  onMouseUp(): void {}
}
