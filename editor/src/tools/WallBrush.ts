import type { EditorToolInterface, EditorToolContext } from './BaseTool';
import { WallEdge } from '@projectrs/shared';

/**
 * Wall brush tool — click on tile edges to toggle wall segments.
 * Edge detection: mouse position relative to tile center determines which edge.
 */
export class WallBrush implements EditorToolInterface {
  /** Determine which edge based on mouse position within the tile */
  private getEdge(wx: number, wz: number): { tileX: number; tileZ: number; edge: number } {
    const tileX = Math.floor(wx);
    const tileZ = Math.floor(wz);
    const fx = wx - tileX; // 0..1 within tile
    const fz = wz - tileZ;

    // Divide tile into 4 triangular quadrants
    // N: fz < fx && fz < (1 - fx)
    // S: fz > fx && fz > (1 - fx)
    // W: fx < fz && fx < (1 - fz)
    // E: fx > fz && fx > (1 - fz)
    if (fz < fx && fz < (1 - fx)) {
      return { tileX, tileZ, edge: WallEdge.N };
    } else if (fz > fx && fz > (1 - fx)) {
      return { tileX, tileZ, edge: WallEdge.S };
    } else if (fx < fz && fx < (1 - fz)) {
      return { tileX, tileZ, edge: WallEdge.W };
    } else {
      return { tileX, tileZ, edge: WallEdge.E };
    }
  }

  /** Get the reciprocal tile and edge for a given edge */
  private getReciprocal(tileX: number, tileZ: number, edge: number): { tileX: number; tileZ: number; edge: number } | null {
    if (edge === WallEdge.N && tileZ > 0) return { tileX, tileZ: tileZ - 1, edge: WallEdge.S };
    if (edge === WallEdge.S) return { tileX, tileZ: tileZ + 1, edge: WallEdge.N };
    if (edge === WallEdge.W && tileX > 0) return { tileX: tileX - 1, tileZ, edge: WallEdge.E };
    if (edge === WallEdge.E) return { tileX: tileX + 1, tileZ, edge: WallEdge.W };
    return null;
  }

  onMouseDown(wx: number, wz: number, ctx: EditorToolContext): void {
    const { tileX, tileZ, edge } = this.getEdge(wx, wz);
    const s = ctx.stateMgr.state;
    if (tileX < 0 || tileX >= s.meta.width || tileZ < 0 || tileZ >= s.meta.height) return;

    // Snapshot walls for undo
    ctx.undoMgr.beginStroke('walls');
    ctx.undoMgr.expandRegion(tileX, tileZ);

    // Toggle the edge
    const current = ctx.stateMgr.getWall(tileX, tileZ);
    const hasEdge = (current & edge) !== 0;

    if (hasEdge) {
      ctx.stateMgr.setWall(tileX, tileZ, current & ~edge);
    } else {
      ctx.stateMgr.setWall(tileX, tileZ, current | edge);
    }

    // Set reciprocal on neighbor
    const recip = this.getReciprocal(tileX, tileZ, edge);
    if (recip && recip.tileX >= 0 && recip.tileX < s.meta.width && recip.tileZ >= 0 && recip.tileZ < s.meta.height) {
      ctx.undoMgr.expandRegion(recip.tileX, recip.tileZ);
      const neighborCurrent = ctx.stateMgr.getWall(recip.tileX, recip.tileZ);
      if (hasEdge) {
        ctx.stateMgr.setWall(recip.tileX, recip.tileZ, neighborCurrent & ~recip.edge);
      } else {
        ctx.stateMgr.setWall(recip.tileX, recip.tileZ, neighborCurrent | recip.edge);
      }
    }

    ctx.undoMgr.endStroke();
    ctx.requestRender();
  }

  onMouseMove(_wx: number, _wz: number, _dragging: boolean, _ctx: EditorToolContext): void {
    // No drag painting for walls — each click is a discrete toggle
  }

  onMouseUp(_wx: number, _wz: number, _ctx: EditorToolContext): void {
    // Nothing to do
  }
}
