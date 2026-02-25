import type { EditorToolInterface, EditorToolContext } from './BaseTool';

/** Handles right-click drag to move spawns and right-click context menu */
export class SpawnDragger {
  private dragging = false;
  private dragType: 'npc' | 'object' = 'npc';
  private dragIndex = -1;
  private oldSpawns = '';

  tryStartDrag(wx: number, wz: number, ctx: EditorToolContext): boolean {
    const found = ctx.stateMgr.findSpawnNear(wx, wz, 1.5);
    if (!found) return false;

    this.dragging = true;
    this.dragType = found.type;
    this.dragIndex = found.index;
    this.oldSpawns = ctx.undoMgr.snapshotSpawns();
    return true;
  }

  onDrag(wx: number, wz: number, ctx: EditorToolContext): void {
    if (!this.dragging) return;
    const snap = Math.floor(wx) + 0.5;
    const snapZ = Math.floor(wz) + 0.5;
    if (this.dragType === 'npc') {
      const spawn = ctx.stateMgr.state.spawns.npcs[this.dragIndex];
      if (spawn) { spawn.x = snap; spawn.z = snapZ; }
    } else {
      const spawn = (ctx.stateMgr.state.spawns.objects || [])[this.dragIndex];
      if (spawn) { spawn.x = snap; spawn.z = snapZ; }
    }
    ctx.stateMgr.state.dirty = true;
    ctx.requestRender();
  }

  endDrag(ctx: EditorToolContext): void {
    if (!this.dragging) return;
    this.dragging = false;
    ctx.undoMgr.pushSpawnChange(this.oldSpawns, ctx.undoMgr.snapshotSpawns());
  }

  get isDragging(): boolean { return this.dragging; }
}
