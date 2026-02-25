import { WallEdge } from '@projectrs/shared';
import type { StateManager } from '../state/EditorState';

/**
 * Renders wall edges as colored lines on tile boundaries.
 */
export class WallRenderer {
  private stateMgr: StateManager;

  constructor(stateMgr: StateManager) {
    this.stateMgr = stateMgr;
  }

  render(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    offsetX: number,
    offsetZ: number,
    canvasW: number,
    canvasH: number
  ): void {
    if (zoom < 1) return; // too small to see walls

    const s = this.stateMgr.state;
    const w = s.meta.width;
    const h = s.meta.height;

    // Visible tile range
    const startX = Math.max(0, Math.floor(-offsetX / zoom));
    const startZ = Math.max(0, Math.floor(-offsetZ / zoom));
    const endX = Math.min(w, Math.ceil((canvasW - offsetX) / zoom));
    const endZ = Math.min(h, Math.ceil((canvasH - offsetZ) / zoom));

    ctx.save();
    ctx.strokeStyle = '#331a00';
    ctx.lineWidth = zoom >= 4 ? 3 : 1;
    ctx.lineCap = 'butt';

    for (let z = startZ; z < endZ; z++) {
      for (let x = startX; x < endX; x++) {
        const mask = s.walls[z * w + x];
        if (mask === 0) continue;

        const px = offsetX + x * zoom;
        const pz = offsetZ + z * zoom;

        // N edge — top of tile
        if (mask & WallEdge.N) {
          ctx.beginPath();
          ctx.moveTo(px, pz);
          ctx.lineTo(px + zoom, pz);
          ctx.stroke();
        }

        // S edge — bottom of tile
        if (mask & WallEdge.S) {
          ctx.beginPath();
          ctx.moveTo(px, pz + zoom);
          ctx.lineTo(px + zoom, pz + zoom);
          ctx.stroke();
        }

        // W edge — left of tile
        if (mask & WallEdge.W) {
          ctx.beginPath();
          ctx.moveTo(px, pz);
          ctx.lineTo(px, pz + zoom);
          ctx.stroke();
        }

        // E edge — right of tile
        if (mask & WallEdge.E) {
          ctx.beginPath();
          ctx.moveTo(px + zoom, pz);
          ctx.lineTo(px + zoom, pz + zoom);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }
}
