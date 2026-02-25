import { CHUNK_SIZE } from '@projectrs/shared';
import type { EditorState } from '../state/EditorState';

export class GridOverlay {
  render(
    ctx: CanvasRenderingContext2D,
    state: EditorState,
    scrollX: number, scrollZ: number,
    zoom: number,
    startX: number, startZ: number,
    endX: number, endZ: number,
  ): void {
    // Tile grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let x = startX; x <= endX; x++) {
      const sx = (x - scrollX) * zoom;
      ctx.moveTo(sx, (startZ - scrollZ) * zoom);
      ctx.lineTo(sx, (endZ - scrollZ) * zoom);
    }
    for (let z = startZ; z <= endZ; z++) {
      const sz = (z - scrollZ) * zoom;
      ctx.moveTo((startX - scrollX) * zoom, sz);
      ctx.lineTo((endX - scrollX) * zoom, sz);
    }
    ctx.stroke();

    // Chunk boundary lines
    if (zoom >= 1) {
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();

      const chunkStartX = Math.floor(startX / CHUNK_SIZE) * CHUNK_SIZE;
      const chunkStartZ = Math.floor(startZ / CHUNK_SIZE) * CHUNK_SIZE;

      for (let x = chunkStartX; x <= endX; x += CHUNK_SIZE) {
        const sx = (x - scrollX) * zoom;
        ctx.moveTo(sx, (startZ - scrollZ) * zoom);
        ctx.lineTo(sx, (endZ - scrollZ) * zoom);
      }
      for (let z = chunkStartZ; z <= endZ; z += CHUNK_SIZE) {
        const sz = (z - scrollZ) * zoom;
        ctx.moveTo((startX - scrollX) * zoom, sz);
        ctx.lineTo((endX - scrollX) * zoom, sz);
      }
      ctx.stroke();
    }
  }
}
